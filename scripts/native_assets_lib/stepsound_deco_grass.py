"""Expected terrain-decoration instance counts for the GRASS footstep gate.

Native rule (artifacts/native-parity/research/native-sound-answers-20261107/
REPORT.md, Q1): on terrain, the local pawn's footstep is GRASS when
``ATerrainInfo::GetDecoLayerAlpha(Location, 0, 0.0)`` counts more than one
runtime-generated DecoInfo record of all DecoLayers within XY distance 64 in the
nearest sector; otherwise LAND. Those records exist only at runtime (RenderDeco)
and are never serialized, and the browser renders no decorations.

This bundle therefore carries an APPROXIMATION, labelled as such everywhere:
the expected number of generated instances per terrain quad, computed from the
original DecoLayer declarations (DensityMap, DensityMultiplier, MaxPerQuad,
ShowOnTerrain/ShowOnInvisibleTerrain) and the terrain transform/visibility of
the original map. The native generator (0x10726230, seeded SRand) is not
rebuilt and no instance position is claimed. Inputs are read-only and
hash-pinned; outputs are refuse-overwrite with a zero-write repeat.
"""
from __future__ import annotations

import math
import struct

from native_assets_lib.animation_audio_bundle import Inputs, HASH
from native_assets_lib.gltf import json_bytes
from native_assets_lib.texture_mips import build_texture_source
from native_catalog.ue2 import Package
from native_map import actor_properties, decode_property, property_value
from native_map_geometry import bit, native_terrain
from stage_native_players import checked, child, decode, digest, relative_name, require

KIND = 'native-stepsound-deco-grass'
RECIPE_KIND = 'native-stepsound-deco-grass-bundle'
RULE_LABEL = 'approximation of native deco instance count — browser does not render decorations'
GRID_SCALE = 256


def dxt1_green(data, width, height):
    """Green channel (RGB565 expanded to 8 bits) of a DXT1 level, rows top-first."""
    require(width > 0 and height > 0 and width % 4 == 0 and height % 4 == 0 and len(data) == width * height // 2,
            'DXT1 level size differs from its dimensions')
    out = bytearray(width * height)
    blocks_x = width // 4
    for block in range(len(data) // 8):
        c0, c1, bits = struct.unpack_from('<HHI', data, block * 8)
        g0, g1 = (c0 >> 5) & 63, (c1 >> 5) & 63
        g0, g1 = (g0 << 2) | (g0 >> 4), (g1 << 2) | (g1 >> 4)
        # c0 <= c1 selects the three-colour mode whose index 3 is transparent black.
        palette = (g0, g1, (2 * g0 + g1) // 3, (g0 + 2 * g1) // 3) if c0 > c1 else (g0, g1, (g0 + g1) // 2, 0)
        top, left = (block // blocks_x) * 4, (block % blocks_x) * 4
        for pixel in range(16):
            out[(top + pixel // 4) * width + left + pixel % 4] = palette[(bits >> (2 * pixel)) & 3]
    return bytes(out)


def quad_means(channel, texture_width, texture_height, heightmap_width, heightmap_height):
    """Mean 0..1 value of the texels in each quad's cell [q, q+1) x texture/heightmap.

    Texel = vertex x texture/heightmap size (the UT2004 GetLayerAlpha ratio
    mapping), rows = grid Y. The footprint is a presentation choice; Interlude's
    own density sampling is not reconstructed.
    """
    quads_x, quads_y = heightmap_width - 1, heightmap_height - 1
    require(len(channel) == texture_width * texture_height and quads_x > 0 and quads_y > 0, 'Invalid density channel')
    columns = []
    for qx in range(quads_x):
        x0 = qx * texture_width // heightmap_width
        columns.append((x0, max(x0 + 1, (qx + 1) * texture_width // heightmap_width)))
    result = []
    for qy in range(quads_y):
        y0 = qy * texture_height // heightmap_height
        y1 = max(y0 + 1, (qy + 1) * texture_height // heightmap_height)
        for x0, x1 in columns:
            total = 0
            for y in range(y0, y1):
                row = y * texture_width
                total += sum(channel[row + x0:row + x1])
            result.append(total / ((y1 - y0) * (x1 - x0) * 255))
    return result


def expected_capped(alpha, low, high, cap):
    """E[min(cap, alpha * U(low, high))]: expected instances of one layer in one quad."""
    require(all(isinstance(v, (int, float)) and math.isfinite(v) for v in (alpha, low, high, cap)) and
            0 <= low <= high and cap >= 0 and 0 <= alpha <= 1, 'Invalid density expectation input')
    if alpha == 0 or cap == 0 or high == 0:
        return 0.0
    lo, hi = alpha * low, alpha * high
    if hi <= cap:
        return (lo + hi) / 2
    if lo >= cap:
        return float(cap)
    return ((cap * cap - lo * lo) / 2 + cap * (hi - cap)) / (hi - lo)


def correlation(left, right):
    count = len(left)
    require(count == len(right) and count > 1, 'Correlation inputs differ')
    mean_left, mean_right = sum(left) / count, sum(right) / count
    cov = sum((a - mean_left) * (b - mean_right) for a, b in zip(left, right))
    var_left = sum((a - mean_left) ** 2 for a in left)
    var_right = sum((b - mean_right) ** 2 for b in right)
    return 0.0 if var_left == 0 or var_right == 0 else cov / math.sqrt(var_left * var_right)


def flip_rows(values, columns):
    rows = [values[index:index + columns] for index in range(0, len(values), columns)]
    return [value for row in reversed(rows) for value in row]


def build_grid(layers, quads_x, quads_y, visible):
    """Sum of per-layer expectations per quad; invisible quads hold none."""
    grid = [0.0] * (quads_x * quads_y)
    for layer in layers:
        if layer['showOnTerrain'] != 1:
            continue
        low, high, cap = layer['densityMultiplier']['min'], layer['densityMultiplier']['max'], layer['maxPerQuad']
        for index, alpha in enumerate(layer['alpha']):
            if visible[index] or layer['showOnInvisibleTerrain'] == 1:
                grid[index] += expected_capped(alpha, low, high, cap)
    return grid


def encode_grid(grid):
    values = [round(value * GRID_SCALE) for value in grid]
    require(all(0 <= value <= 0xFFFF for value in values), 'Expected instance grid exceeds its encoding')
    return struct.pack('<' + str(len(values)) + 'H', *values)


def flatten(value):
    if isinstance(value, list) and value and isinstance(value[0], dict) and 'name' in value[0]:
        names = [field['name'] for field in value]
        require(len(set(names)) == len(names), 'Duplicate DecoLayer field')
        return {field['name']: flatten(field.get('value')) for field in value}
    return value


def export_named(package, reference, class_name):
    matches = [item for item in package.exports if item['object'].casefold() == reference.casefold()]
    require(len(matches) == 1 and matches[0]['className'] == class_name, 'Exact qualified object/class unresolved: ' + reference)
    return matches[0]


def pinned_package(inputs, client, record):
    name = relative_name(record['path'])
    data = inputs.read({'path': client + '/' + name, 'sha256': record['sha256'], 'bytes': record['bytes']})
    return Package(data, name.split('/')[-1])


def decoded_level(package, reference, expected_size):
    item = export_named(package, reference, 'Texture')
    metadata, files = build_texture_source(package, item)
    level = metadata['mips'][0]
    require(metadata['format']['name'] == 'DXT1' and [level['width'], level['height']] == expected_size and
            metadata.get('sourceExportFullyConsumed') is True, 'Texture format/size differs from the recipe: ' + reference)
    mip = files[level['file']]
    require(digest(mip) == level['sha256'], 'Texture level hash differs: ' + reference)
    return item, metadata, mip


def prepare(root, recipe_path):
    inputs = Inputs(root)
    recipe_path = checked(recipe_path)
    require(recipe_path.is_relative_to(inputs.root), 'Recipe must stay within project root')
    raw_recipe = recipe_path.read_bytes()
    recipe = decode(inputs.read({'path': recipe_path.relative_to(inputs.root).as_posix(), 'sha256': digest(raw_recipe)}))
    require(recipe.get('schemaVersion') == 1 and recipe.get('kind') == RECIPE_KIND, 'Unsupported deco-grass recipe')
    client = relative_name(recipe['client'])
    rule = recipe['rule']
    require(rule.get('countRadius') == 64.0 and rule.get('grassMinimumCount') == 2 and rule.get('densityChannel') == 'green',
            'Recipe rule differs from the native GetDecoLayerAlpha gate (64 UU, count > 1)')
    package = pinned_package(inputs, client, recipe['map'])
    require((package.summary['version'], package.summary['licenseeVersion']) == (123, 28), 'Map package version differs')
    native = native_terrain(package)
    require(native['object'].casefold() == recipe['terrain'].casefold(), 'Terrain object differs from the recipe')
    width, height = native['width'], native['height']
    quads_x, quads_y = width - 1, height - 1
    axes, origin = native['toHeightmap']['axes'], native['toHeightmap']['origin']
    require(axes[0][1] == axes[0][2] == axes[1][0] == axes[1][2] == 0 and axes[0][0] > 0 and axes[1][1] > 0,
            'Terrain heightmap transform is not axis-aligned')
    quad_size = [1 / axes[0][0], 1 / axes[1][1]]
    terrain_item = export_named(package, recipe['terrain'], 'TerrainInfo')
    tags, _, _, _ = actor_properties(package, terrain_item)
    properties = [decode_property(package, tag, recipe['map']['path']) for tag in tags]
    visibility = property_value(properties, 'QuadVisibilityBitmap')
    require(isinstance(visibility, dict) and isinstance(visibility.get('words'), list) and len(visibility['words']) * 32 == width * height,
            'QuadVisibilityBitmap differs from the terrain dimensions')
    visible = [bit(visibility['words'], width, qx, qy) for qy in range(quads_y) for qx in range(quads_x)]
    declarations = property_value(properties, 'DecoLayers')
    require(isinstance(declarations, list) and len(declarations) == recipe['expectedCoverage']['decoLayers'], 'DecoLayer count differs')
    density_package = pinned_package(inputs, client, recipe['densityPackage'])
    layers, published = [], []
    for index, raw in enumerate(declarations):
        fields = flatten(raw)
        density_ref = fields['DensityMap']['object']
        item, metadata, mip = decoded_level(density_package, density_ref, recipe['densityMapSize'])
        level = metadata['mips'][0]
        alpha = quad_means(dxt1_green(mip, level['width'], level['height']), level['width'], level['height'], width, height)
        multiplier = {'min': float(fields['DensityMultiplier']['Min']), 'max': float(fields['DensityMultiplier']['Max'])}
        layer = {'index': index, 'alpha': alpha, 'densityMultiplier': multiplier, 'maxPerQuad': int(fields['MaxPerQuad']),
                 'showOnTerrain': int(fields['ShowOnTerrain']), 'showOnInvisibleTerrain': int(fields['ShowOnInvisibleTerrain'])}
        layers.append(layer)
        expected = [expected_capped(value, multiplier['min'], multiplier['max'], layer['maxPerQuad']) for value in alpha]
        published.append({'index': index, 'staticMesh': fields['StaticMesh']['object'],
                          'densityMap': {'object': item['object'], 'package': recipe['densityPackage']['path'],
                                         'exportSha256': digest(density_package.data[item['offset']:item['offset'] + item['size']]),
                                         'format': 'DXT1', 'width': level['width'], 'height': level['height'], 'mip0Sha256': level['sha256']},
                          'densityMultiplier': multiplier, 'maxPerQuad': layer['maxPerQuad'],
                          'scaleMultiplier': fields.get('ScaleMultiplier'), 'fadeoutRadius': fields.get('FadeoutRadius'),
                          'showOnTerrain': layer['showOnTerrain'], 'showOnInvisibleTerrain': layer['showOnInvisibleTerrain'],
                          'bForceRender': int(fields['bForceRender']), 'seed': int(fields['Seed']),
                          'nonZeroQuads': sum(value > 0 for value in alpha),
                          'expectedInstancesVisibleQuads': round(sum(e for e, v in zip(expected, visible) if v), 3)})
    grid = build_grid(layers, quads_x, quads_y, visible)
    payload = encode_grid(grid)
    grid_sha = digest(payload)
    # Supporting orientation evidence only: layer 0 density against the grass and
    # road alpha maps, same rows versus vertically flipped rows.
    check = recipe['orientationCheck']
    alpha_package = pinned_package(inputs, client, check['package'])
    orientation = {}
    for reference in check['alphaMaps']:
        _, metadata, mip = decoded_level(alpha_package, reference, check['alphaMapSize'])
        level = metadata['mips'][0]
        mask = quad_means(dxt1_green(mip, level['width'], level['height']), level['width'], level['height'], width, height)
        orientation[reference] = {'sameRows': round(correlation(layers[0]['alpha'], mask), 4),
                                  'flippedRows': round(correlation(flip_rows(layers[0]['alpha'], quads_x), mask), 4)}
    sectors = [[*sector['offset'], *sector['quads']] for sector in native['sectors']]
    for ox, oy, qx, qy in sectors:
        require(0 <= ox and 0 <= oy and qx > 0 and qy > 0 and ox + qx <= quads_x and oy + qy <= quads_y, 'Sector outside the quad grid')
    coverage = {'decoLayers': len(layers), 'quadsX': quads_x, 'quadsY': quads_y, 'sectors': len(sectors),
                'visibleQuads': sum(visible), 'quadsWithExpectedInstances': sum(value > 0 for value in grid)}
    require(coverage == recipe['expectedCoverage'], 'Deco-grass coverage differs from recipe: ' + json_bytes(coverage).decode())
    inputs.unchanged()
    grid_file = 'grid/' + grid_sha + '.bin'
    manifest = {
        'schemaVersion': 1, 'kind': KIND,
        'inputs': [{k: v for k, v in value.items() if k != 'mtimeNs'} for value in inputs.records.values()],
        'terrain': {'object': native['object'], 'exportIndex': native['exportIndex'], 'heightmap': [width, height],
                    'quads': [quads_x, quads_y], 'quadSize': quad_size,
                    # toHeightmap: grid = (native - origin) . axes, so grid (0, 0) is this native XY.
                    'origin': [origin[0] + 0.0, origin[1] + 0.0],
                    'sectors': sectors,
                    'visibility': 'QuadVisibilityBitmap; ShowOnInvisibleTerrain=0 layers place nothing on invisible quads'},
        'decoLayers': published,
        'grid': {'file': grid_file, 'bytes': len(payload), 'sha256': grid_sha, 'scale': GRID_SCALE,
                 'encoding': 'uint16le row-major [quadY][quadX]; expected instances per quad = value / scale',
                 'maxPerQuad': round(max(grid), 4), 'totalExpected': round(sum(grid), 3)},
        'rule': {'id': rule['id'], 'label': RULE_LABEL, 'status': 'approximation',
                 'countRadius': rule['countRadius'], 'grassMinimumCount': rule['grassMinimumCount'],
                 'native': ('GetDecoLayerAlpha mode 0 (0x10728cd0) finds the nearest sector and counts generated DecoInfo records '
                            'of all DecoLayers within XY distance 64; GRASS when the count is > 1, else LAND (REPORT.md Q1). '
                            'Records exist only when Option.ini RenderDeco is on or a layer has bForceRender.'),
                 'approximation': [
                     'density = green channel of the grayscale DXT1 mip 0 / 255, mean of the texels covering each quad UV cell '
                     '(channel choice and texel footprint: presentation choice)',
                     'expected per quad and layer = E[min(MaxPerQuad, density x U(DensityMultiplier.Min, DensityMultiplier.Max))] '
                     '(presentation choice; native generator 0x10726230 and its seeded SRand not rebuilt)',
                     'instances uniform within a quad; the browser integrates per-quad density over the 64-unit XY circle '
                     'restricted to the nearest sector and compares the expectation with 2',
                     'invisible quads hold no instances (ShowOnInvisibleTerrain=0)',
                     'RenderDeco assumed on: retained Option.ini says RenderDeco=True (a config value, not a runtime observation)']},
        'orientationCheck': {'status': 'supporting evidence, not native proof', 'layer': 0, 'correlations': orientation},
        'coverage': coverage,
        'limits': ['No native instance positions, counts or seeded generation are reconstructed.',
                   'The density channel, texel footprint and multiplier sampling are browser choices.',
                   'Grass applies to the local player only; other pawns on terrain use LAND natively.'],
    }
    payloads = {grid_file: payload, 'manifest.json': json_bytes(manifest)}
    return manifest, payloads, inputs


def run(root, recipe_path, output, *, plan=False, verify_only=False, prepare_bundle=prepare):
    require(not (plan and verify_only), 'Plan and verify-only are mutually exclusive')
    manifest, payloads, inputs = prepare_bundle(root, recipe_path)
    output = checked(output)
    require(any(output != inputs.root / name and output.is_relative_to(inputs.root / name)
                for name in ('artifacts', 'scratch', '.scratch')), 'Output must be a named artifacts/scratch subdirectory')
    for name in inputs.records:
        path = child(inputs.root, name)
        require(not path.is_relative_to(output) and not output.is_relative_to(path.parent), 'Output overlaps an input or retained directory')
    exists = output.exists()
    if exists:
        require(output.is_dir(), 'Output is not a directory')
        actual = {path.relative_to(output).as_posix() for path in output.rglob('*') if checked(path).is_file()}
        require(actual == set(payloads), 'Existing output file set differs; preserved')
        for name, data in payloads.items():
            require(child(output, name).read_bytes() == data, 'Existing immutable output differs; preserved: ' + name)
    require(not verify_only or exists, 'Verify-only requires a complete existing output')
    status = 'planned' if plan else 'verified' if verify_only else 'preserved' if exists else 'produced'
    written = 0
    if status == 'produced':
        output.mkdir(parents=True, exist_ok=False)
        # The completion manifest is written last; all writes are exclusive.
        for name in sorted(payloads, key=lambda name: name == 'manifest.json'):
            path = child(output, name)
            path.parent.mkdir(parents=True, exist_ok=True)
            checked(path.parent)
            with path.open('xb') as stream:
                stream.write(payloads[name])
            written += 1
    inputs.unchanged()
    return {'status': status, 'manifestSha256': digest(payloads['manifest.json']), 'coverage': manifest['coverage'],
            'grid': {k: manifest['grid'][k] for k in ('sha256', 'maxPerQuad', 'totalExpected')},
            'orientationCheck': manifest['orientationCheck']['correlations'],
            'filesWritten': written, 'sourceInputsUnchanged': True,
            'files': [{'path': name, 'bytes': len(data), 'sha256': digest(data)} for name, data in sorted(payloads.items())]}


__all__ = ['HASH', 'KIND', 'RECIPE_KIND', 'RULE_LABEL', 'GRID_SCALE', 'build_grid', 'correlation', 'dxt1_green', 'encode_grid',
           'expected_capped', 'flip_rows', 'prepare', 'quad_means', 'run']
