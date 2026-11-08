#!/usr/bin/env python3
"""Source-backed UE123/28 terrain section and static placement migration.

No native client or source package is modified. The native TerrainInfo FCoords
are the position oracle; serialized sector bounds are checked independently.
Materials remain editable source relationships: this tool does not certify
Lineage's terrain blending, lighting, navigation or native visual parity.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import struct
import sys
import tempfile
import zipfile

from native_assets_lib.gltf import json_bytes
from native_catalog.ue2 import FormatError, Package, Reader
from native_map import actor_properties, file_hash, property_value, safe_path, sha, verify_map, MapSources, static_mesh_request
from reference_client_guard import require_reference_client

REFERENCE_REPO = 'emmanuelgoldstein1337/UT2004_CMAKE'
REFERENCE_COMMIT = 'deda0fb464371b661b616b4e58ff4d53f6f011f1'
REFERENCE_FILES = {
    'Core/Inc/UnMath.h': 'b6d249a334781f3c00d7819a22692a7558f4cbc632be42599364bbbb2a43c709',
    'Core/Src/UnMath.cpp': '2b303f1b37e72de1e3d182233f7d628a677a77baa74951e5fc55ea2f800266da',
    'Engine/Inc/UnTerrain.h': '02505d3d7a7bf97efc547dcbfef58d967343100085ca40fd82998193f88c736f',
    'Engine/Src/UnTerrain.cpp': '6633d1e7e0cf0912bee3f3e72f1bd60a7b73519b64f125e929e6f10aeaa7b5c5',
    'Engine/Inc/AActor.h': '66cee801be28d23fa21f26375603648c41c84a52e49dbce290b2f23325b6b2e5',
    'Core/Src/UnObj.cpp': '4aa6ad2216ab4ad83c8c2b957bb948fc05bfb3092fa0d1a5d07988f9bf0094b0',
}
BOUND_TOLERANCE = 0.001
UV_TOLERANCE = 0.00001
MAX_DECLARED_STATIC_MODELS = 1024
SOURCE_TO_GLTF = [.01, 0, 0, 0, 0, 0, .01, 0, 0, .01, 0, 0, 0, 0, 0, 1]
QUALIFIED_MASK_UV_SOURCE_SHA256 = '1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4'
MASK_UV_LAYER_PAIRS = (
    ('T_texture.Texture.Base', 'T_texture.Texture.layer0'),
    ('t_oren.Obase_1', 'T_20_20.Height.20_20_BASE_C'),
    ('T_texture.Texture.g_01', 'T_20_20.Height.20_20_S_C'),
    ('t_oren.OG_53', 'T_20_20.Height.20_20_G1'),
    ('t_oren.OG_44', 'T_20_20.Height.20_20_G2'),
    ('t_oren.OG_43_t', 'T_20_20.Height.20_20_G3'),
    ('t_oren.OST_10', 'T_20_20.Height.20_20_C'),
    ('t_oren.OS_01', 'T_20_20.Height.20_20_R'),
    ('t_oren.OG_49_t', 'T_20_20.Height.20_20_G4'),
)


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def xyz(value):
    result = [value[axis] for axis in 'XYZ']
    if not all(type(v) in (int, float) and math.isfinite(v) for v in result):
        raise FormatError('Non-finite native vector')
    return result


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def subtract(a, b):
    return [x - y for x, y in zip(a, b)]


def cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


def unit(v):
    length = math.sqrt(dot(v, v))
    if length <= 0 or not math.isfinite(length):
        raise FormatError('Degenerate terrain normal')
    return [x/length for x in v]


def native_to_gltf(point):
    return [point[0] * .01, point[2] * .01, point[1] * .01]


def coords_point(coords, point):
    delta = [f32(a-b) for a, b in zip(point, coords['origin'])]
    return [f32(sum(f32(a*b) for a, b in zip(delta, axis))) for axis in coords['axes']]


def calculated_coords(location, scale, width, height):
    if any(v <= 0 for v in scale):
        raise FormatError('Unsupported non-positive terrain scale')
    origin = [f32(f32(-location[0]/scale[0]) + width//2),
              f32(f32(-location[1]/scale[1]) + height//2),
              f32(f32(f32(-256.0*location[2])/scale[2]) + 32767)]
    return {'origin': origin, 'axes': [[scale[0], 0, 0], [0, scale[1], 0], [0, 0, f32(scale[2]/256)]]}


def read_coords(reader):
    values = [[reader.number('f') for _ in range(3)] for _ in range(4)]
    if not all(math.isfinite(v) for row in values for v in row):
        raise FormatError('Non-finite native terrain FCoords')
    return {'origin': values[0], 'axes': values[1:]}


def native_terrain(package):
    if (package.summary['version'], package.summary['licenseeVersion']) != (123, 28):
        raise FormatError('Terrain native payload supports only verified UE123/licensee28')
    items = [item for item in package.exports if item['classObject'] == 'Engine.TerrainInfo']
    if len(items) != 1:
        raise FormatError('Expected exactly one Engine.TerrainInfo')
    item = items[0]
    _, reader, _, _ = actor_properties(package, item)
    start = reader.position
    references = [reader.compact() for _ in range(reader.count(4096))]
    sectors_x, sectors_y = reader.number('i'), reader.number('i')
    to_world, to_height = read_coords(reader), read_coords(reader)
    width, height = reader.number('i'), reader.number('i')
    if not 2 <= width <= 4096 or not 2 <= height <= 4096 or sectors_x*sectors_y != len(references):
        raise FormatError('Native terrain dimensions/sector count disagree')
    colors = reader.count(4096*4096)
    if colors != width*height:
        raise FormatError('Native terrain vertex-color count disagrees with dimensions')
    color_bytes = reader.take(colors*4)
    if reader.position != reader.end:
        raise FormatError('Native TerrainInfo layout has trailing bytes')
    sectors = []
    for reference in references:
        if not 1 <= reference <= len(package.exports):
            raise FormatError('Terrain sector reference outside export table')
        sector = package.exports[reference-1]
        if sector['classObject'] != 'Engine.TerrainSector' or sector['outerIndex'] != item['exportIndex']:
            raise FormatError('Terrain sector class/owner differs')
        props, tail = package.properties(sector)
        if props or tail.compact() != item['exportIndex']:
            raise FormatError('Unsupported TerrainSector properties/owner')
        qx, qy, ox, oy = [tail.number('i') for _ in range(4)]
        bounds = [tail.number('f') for _ in range(6)]
        valid = tail.number('B')
        if valid != 1 or not all(math.isfinite(v) for v in bounds) or not (0 <= ox < ox+qx < width and 0 <= oy < oy+qy < height):
            raise FormatError('Invalid native terrain sector extent/bounds')
        sectors.append({'object': sector['object'], 'exportIndex': reference, 'offset': [ox, oy],
                        'quads': [qx, qy], 'bounds': bounds, 'nativePayloadOffset': sector['offset'],
                        'remainingNativeBytes': tail.end-tail.position})
    if len({tuple(row['offset']) for row in sectors}) != len(sectors):
        raise FormatError('Duplicate native sector origin')
    return {'object': item['object'], 'exportIndex': item['exportIndex'], 'toWorld': to_world, 'toHeightmap': to_height,
            'width': width, 'height': height, 'sectorsX': sectors_x, 'sectorsY': sectors_y,
            'sectors': sectors, 'vertexColorsBGRA': color_bytes,
            'nativePayload': {'offset': start, 'bytes': reader.end-start, 'sha256': sha(package.data[start:reader.end])}}


def bit(words, width, x, y):
    index = x+y*width
    if index < 0 or index//32 >= len(words):
        raise FormatError('Terrain bitmap index outside source words')
    return bool(words[index//32] & (1 << (index & 31)))


def quad_triangles(a, b, c, d, turned, native_render_order=False):
    faces = [(a, b, c), (c, b, d)] if turned else [(a, b, d), (a, d, c)]
    return [(a, c, b) for a, b, c in faces] if native_render_order else faces


def terrain_points(native, samples):
    w, h = native['width'], native['height']
    if len(samples) != w*h:
        raise FormatError('Height sample count disagrees with native terrain dimensions')
    return [coords_point(native['toWorld'], [x, y, samples[y*w+x]]) for y in range(h) for x in range(w)]


def sector_oracle(native, points):
    w = native['width']
    results = []
    for sector in native['sectors']:
        ox, oy = sector['offset']
        qx, qy = sector['quads']
        vertices = [points[y*w+x] for y in range(oy, oy+qy+1) for x in range(ox, ox+qx+1)]
        measured = [min(p[i] for p in vertices) for i in range(3)] + [max(p[i] for p in vertices) for i in range(3)]
        errors = [abs(a-b) for a, b in zip(measured, sector['bounds'])]
        results.append({**sector, 'reconstructedBounds': measured, 'absoluteErrors': errors,
                        'xyMatches': max(errors[i] for i in (0, 1, 3, 4)) <= BOUND_TOLERANCE,
                        'allBoundsMatch': max(errors) <= BOUND_TOLERANCE})
    return {'toleranceNativeUnits': BOUND_TOLERANCE, 'compared': len(results),
            'xyMatches': sum(row['xyMatches'] for row in results),
            'allBoundsMatch': sum(row['allBoundsMatch'] for row in results),
            'maxHeightError': max(max(row['absoluteErrors'][2], row['absoluteErrors'][5]) for row in results),
            'interpretation': 'Serialized sector bounds are cached; UE2 CheckComputeDataOnLoad rebuilds vertices and GenerateTriangles updates bounds. Differences are retained, never used to fit samples.',
            'sectors': results}


def select_terrain_sectors(native, oracle, recipe):
    if ('terrainSector' in recipe) == ('terrainSectorRectangle' in recipe):
        raise FormatError('Declare exactly one terrainSector or terrainSectorRectangle')
    policy = recipe.get('cachedSectorBoundsPolicy', 'require-all')
    if policy not in ('require-all', 'require-xy-preserve-z-discrepancies'):
        raise FormatError('Unsupported cached sector bounds policy')
    if 'terrainSector' in recipe:
        selected = [row for row in oracle['sectors'] if row['object'] == recipe['terrainSector']]
        if policy != 'require-all' or len(selected) != 1 or not selected[0]['allBoundsMatch']:
            raise FormatError('Selected sector has not passed the independent native bounds oracle')
        return selected[0], selected
    rectangle = recipe['terrainSectorRectangle']
    if not isinstance(rectangle, dict) or set(rectangle) != {'minOffset', 'maxOffset'}:
        raise FormatError('Rectangle requires explicit minOffset/maxOffset native sector origins')
    for key in ('minOffset', 'maxOffset'):
        value = rectangle[key]
        if not isinstance(value, list) or len(value) != 2 or any(type(v) is not int or v < 0 for v in value):
            raise FormatError('Sector rectangle offsets must be pairs of nonnegative integers')
    minimum, maximum = rectangle['minOffset'], rectangle['maxOffset']
    if any(minimum[i] > maximum[i] for i in range(2)):
        raise FormatError('Sector rectangle has reversed origin bounds')
    selected = sorted((row for row in oracle['sectors'] if all(minimum[i] <= row['offset'][i] <= maximum[i] for i in range(2))),
                      key=lambda row: (row['offset'][1], row['offset'][0]))
    lookup = {tuple(row['offset']): row for row in selected}
    if not selected or len(lookup) != len(selected) or tuple(minimum) not in lookup or tuple(maximum) not in lookup:
        raise FormatError('Sector rectangle corners must identify unique native sector origins')
    xs, ys = sorted({row['offset'][0] for row in selected}), sorted({row['offset'][1] for row in selected})
    if len(selected) != len(xs)*len(ys):
        raise FormatError('Sector rectangle contains missing cells')
    widths = {x: lookup[(x, ys[0])]['quads'][0] for x in xs}
    heights = {y: lookup[(xs[0], y)]['quads'][1] for y in ys}
    if (any(type(q) is not int or q <= 0 for q in [*widths.values(), *heights.values()]) or
            any(row['quads'] != [widths[row['offset'][0]], heights[row['offset'][1]]] for row in selected) or
            any(x+widths[x] != following for x, following in zip(xs, xs[1:])) or
            any(y+heights[y] != following for y, following in zip(ys, ys[1:]))):
        raise FormatError('Sector rectangle is not a contiguous native quad grid')
    quads = [xs[-1]+widths[xs[-1]]-xs[0], ys[-1]+heights[ys[-1]]-ys[0]]
    if any(minimum[i]+quads[i] >= native[key] for i, key in enumerate(('width', 'height'))):
        raise FormatError('Sector rectangle exceeds native height samples')
    if any(not row['xyMatches'] or (policy == 'require-all' and not row['allBoundsMatch']) for row in selected):
        raise FormatError('Selected rectangle has not passed its declared native bounds oracle policy')
    bounds = [min(row['reconstructedBounds'][i] for row in selected) for i in range(3)]
    bounds += [max(row['reconstructedBounds'][i] for row in selected) for i in range(3, 6)]
    region = {'object': native['object'], 'kind': 'native-sector-rectangle', 'offset': list(minimum), 'quads': quads,
              'bounds': bounds, 'boundsBasis': 'reconstructed original source samples; cached bounds retained per selected sector',
              'sectorGrid': [len(xs), len(ys)], 'sectorObjects': [row['object'] for row in selected],
              'cachedBoundsPolicy': policy, 'cachedBoundsToleranceNativeUnits': BOUND_TOLERANCE,
              'cachedZBoundsMatched': sum(row['allBoundsMatch'] for row in selected),
              'cachedZBoundsMismatched': sum(not row['allBoundsMatch'] for row in selected)}
    return region, selected


def static_model_limit(recipe):
    if 'sourceSpawnReferenceActor' in recipe and type(recipe['sourceSpawnReferenceActor']) is not bool:
        raise ValueError('sourceSpawnReferenceActor must be an explicit boolean')
    limit = recipe.get('maxStaticModels', 16)
    if type(limit) is not int or not 1 <= limit <= MAX_DECLARED_STATIC_MODELS:
        raise ValueError(f'maxStaticModels must be an integer in 1..{MAX_DECLARED_STATIC_MODELS}')
    return limit


def static_model_policies(recipe):
    policies = recipe.get('staticModelPolicies', {})
    if (not isinstance(policies, dict) or len(policies) > MAX_DECLARED_STATIC_MODELS or
            any(not isinstance(name, str) or not re.fullmatch(r'\w+(?:\.\w+)+', name) or policy != 'preserve-native-graph'
                for name, policy in policies.items()) or len({name.casefold() for name in policies}) != len(policies)):
        raise ValueError('Static material policies require unique exact qualified source objects and preserve-native-graph policy')
    return policies


def validate_static_requests(requests, placements, recipe):
    limit = static_model_limit(recipe)
    identities = [row['object'] for row in requests]
    minimum = 0 if 'terrainSectorRectangle' in recipe else 1
    if (not minimum <= len(requests) <= limit or len(set(identities)) != len(identities) or
            set(identities) != {row['resolvedMeshObject'] for row in placements}):
        raise ValueError(f'Runtime conversion requires the exact declared section request set with at most{limit} models')
    policies = static_model_policies(recipe)
    if set(policies)-set(identities) or any(row.get('materialPolicy') != policies.get(row['object']) for row in requests):
        raise ValueError('Declared static material policies must match the exact selected source models/requests')
    return limit


def vertex_normal(points, words, width, height, x, y):
    normals = []
    for cy in (y, y-1):
        for cx in (x, x-1):
            if not (0 <= cx < width-1 and 0 <= cy < height-1):
                continue
            a = cy*width+cx
            for i, j, k in quad_triangles(a, a+1, a+width, a+width+1, bit(words, width, cx, cy)):
                normals.append(unit(cross(subtract(points[j], points[i]), subtract(points[k], points[i]))))
    return unit([sum(row[i] for row in normals) for i in range(3)])


def serialized_matrix(properties):
    rows = property_value(properties, 'TerrainMatrix')
    if not isinstance(rows, list):
        raise FormatError('Missing serialized terrain material matrix')
    result = []
    for label in ('XPlane', 'YPlane', 'ZPlane', 'WPlane'):
        plane = property_value(rows, label)
        if not isinstance(plane, list):
            raise FormatError('Missing material matrix plane')
        values = [property_value(plane, axis) for axis in 'XYZW']
        if not all(type(v) in (int, float) and math.isfinite(v) for v in values):
            raise FormatError('Incomplete material matrix fields')
        result.append(values)
    return result


def texture_uv(matrix, native_point):
    p = [*native_point, 1]
    return [sum(p[row]*matrix[row][column] for row in range(4)) for column in (0, 1)]


def qualified_mask_uv_rule(native, selected, package, source_path, layers):
    if (source_path.replace('\\', '/').casefold() != 'maps/20_20.unr' or
            package.source_hash != QUALIFIED_MASK_UV_SOURCE_SHA256 or
            native['object'].casefold() != '20_20.terraininfo0' or
            (native['width'], native['height']) != (256, 256) or
            selected['offset'] != [64, 208] or selected['quads'] != [48, 47]):
        return None
    pairs = [(layer['index'], layer['texture'].casefold(), layer['alphaMap'].casefold()) for layer in layers]
    expected = [(index, diffuse.casefold(), mask.casefold()) for index, (diffuse, mask) in enumerate(MASK_UV_LAYER_PAIRS)]
    if pairs != expected:
        return None
    return {
        'id': 'interlude-20_20-submitted-mask-uv-20261106',
        'formula': '(gridXY + 0.5) / heightmapDimensions - max(gridXY - 240, 0) / 4096',
        'status': 'native-submitted-coordinate-match; offscreen capture, visible parity unverified',
        'source': {'package': source_path, 'packageSha256': package.source_hash, 'object': native['object'],
                   'heightmapDimensions': [256, 256], 'gridMinimum': [64, 208], 'gridMaximum': [112, 255]},
        'evidence': {
            'handoff': 'artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/native-result-20261106/BROWSER_HANDOFF.md',
            'handoffSha256': 'fe2e05c2468858931332c207f5b45c6b3ec7cdf9f61121d897ad137aa9b66556',
            'manifestSha256': '8321cd6758bdbffdcaf436be54e5ed3e7dbb295dd68285b93dfccd1f8a0306a0',
            'traceSha256': 'd391b2a28db6a752cf24ee0bdcdb54ec74ace3446b55c917f88e1a170d1daada',
            'declarationCall': 462, 'vertexUploadCall': 142108, 'indexUploadCall': 142123, 'witnessDrawCall': 142131,
            'matchedPositionUvRecords': 1749, 'affectedSelectedPositions': 735,
            'coordinateRoute': 'fixed-function supplied TEXCOORD0, texture transforms disabled',
            'limitations': ['offscreen submissions; no visible-native-pixel or screen-improvement proof',
                            'pilot stopped on unresolved descendant path; graphics-writer count unestablished',
                            'engine material/cache identity, CPU pruning, bUseAlpha and final composition unresolved']},
    }


def terrain_mask_uv(x, y, width, height, qualified_rule=None):
    ordinary = [(x+.5)/width, (y+.5)/height]
    if qualified_rule is None:
        return ordinary
    return [ordinary[0] - max(x-240, 0)/4096, ordinary[1] - max(y-240, 0)/4096]


def layer_sampling_source(layer, package, terrain_export, source_path):
    names = ('Scale', 'ToWorld', 'ToMaskmap', 'bUseAlpha')
    properties = []
    start, end = terrain_export['offset'], terrain_export['offset'] + terrain_export['size']
    for prop in layer['properties']:
        if prop['name'] not in names:
            continue
        payload = prop['payload']
        tag_start, payload_start, size = prop['offset'], payload['offset'], payload['bytes']
        if (payload['path'] != 'raw/map.unwrapped.bin' or
                not all(type(value) is int for value in (tag_start, payload_start, size)) or size < 0 or
                not 0 <= start <= tag_start < payload_start <= payload_start + size <= end <= len(package.data)):
            raise FormatError('Terrain layer property exceeds its native export')
        raw_payload = package.data[payload_start:payload_start+size]
        if sha(raw_payload) != payload['sha256']:
            raise FormatError('Terrain layer property payload hash differs from native source')
        serialized = package.data[tag_start:payload_start+size]
        properties.append({'property': prop, 'serializedTagAndPayload': {
            'offset': tag_start, 'bytes': len(serialized), 'payloadOffsetWithinRecord': payload_start-tag_start,
            'sha256': sha(serialized), 'hex': serialized.hex()}})
    return {'package': source_path, 'packageSha256': package.source_hash,
            'object': terrain_export['object'], 'exportIndex': terrain_export['exportIndex'],
            'layerIndex': layer['index'], 'offsetBasis': 'unwrapped native package; raw map property paths are provenance only',
            'properties': properties, 'omittedProperties': [name for name in names if not any(p['name'] == name for p in layer['properties'])],
            'interpretation': 'Original property tags, array indices and bytes; no defaults, resampling or native sampling/blend semantics inferred.'}


def layer_records(terrain, native, package, source_path):
    terrain_export = package.exports[native['exportIndex']-1]
    if terrain['id'] != 'interlude:'+terrain_export['object'] or native['object'] != terrain_export['object']:
        raise FormatError('Terrain layer source identity differs from native export')
    records = []
    for layer in terrain['layers']:
        props = layer['properties']
        texture, alpha = property_value(props, 'Texture'), property_value(props, 'AlphaMap')
        if not texture or not texture['object'] or not alpha or not alpha['object']:
            continue
        matrix = serialized_matrix(props)
        scale = [property_value(props, name) for name in ('UScale', 'VScale')]
        rot = property_value(props, 'LayerRotation')
        if property_value(props, 'TextureMapAxis') != 0 or property_value(props, 'TextureRotation') != 0 or rot != {'Pitch': 0, 'Yaw': 0, 'Roll': 0}:
            raise FormatError('Non-XY/rotated layer requires a separately verified UV adapter')
        if any(property_value(props, key) != 0 for key in ('UPan', 'VPan')) or any(v is None or v <= 0 for v in scale):
            raise FormatError('Nonzero pan/invalid layer scale is outside this verified UV case')
        inv = native['toHeightmap']
        transposed_origin = [-f32(dot(inv['origin'], axis)) for axis in inv['axes']]
        tex_origin = [f32(dot([-v for v in transposed_origin], axis)) for axis in inv['axes']]
        errors = []
        for axis in (0, 1):
            coefficient = f32(inv['axes'][axis][axis]/scale[axis])
            expected_translation = f32(-tex_origin[axis]*coefficient)
            errors += [abs(matrix[axis][axis]-coefficient), abs(matrix[3][axis]-expected_translation)]
            errors += [abs(matrix[row][axis]) for row in range(3) if row != axis]
        if max(errors) > UV_TOLERANCE:
            raise FormatError('Serialized terrain UV matrix differs from native reference calculation')
        records.append({'index': layer['index'], 'texture': texture['object'], 'alphaMap': alpha['object'],
                        'useAlpha': property_value(props, 'bUseAlpha'), 'worldToTextureRowMajor': matrix,
                        'uvCoefficientMaxError': max(errors), 'maskUV': '(gridXY + 0.5) / heightmapDimensions',
                        'maskUVStatus': 'inspection-candidate; native mask sampling remains unverified',
                        'nativeSamplingSource': layer_sampling_source(layer, package, terrain_export, source_path),
                        'channelAndBlendStatus': 'Lineage compressed alpha-map channel selection and layer blending remain unverified; source references and bUseAlpha are preserved'})
    if not records:
        raise FormatError('No supported native terrain layers')
    return records


def read_class_evidence(client, work, reusable=None):
    from native_catalog.effects import read_class_defaults, parse_uc, UELIB, UELIB_SHA256
    if file_hash(UELIB) != UELIB_SHA256:
        raise FormatError('Class parser differs from pinned UELib')
    evidence = {}
    for reference in ('Engine.Actor', 'Engine.StaticMeshActor', 'Engine.TerrainInfo'):
        base = Path(reusable)/reference if reusable else None
        if base and (base/'defaults.json').is_file():
            result = json.loads((base/'defaults.json').read_text(encoding='utf-8'))
            script = safe_path(base, result['sourceScript']).read_bytes()
            if sha(script) != result['sourceScriptSha256'] or file_hash(safe_path(client, result['source']['package'])) != result['source']['packageSha256']:
                raise FormatError('Reused native class evidence no longer matches sources')
        else:
            base = work/reference
            result = read_class_defaults(client, reference, base)
            script = safe_path(base, result['sourceScript']).read_bytes()
        parsed = parse_uc(script.decode('utf-8-sig'), reference)
        if result['source']['object'] != reference or result['uelibSha256'] != UELIB_SHA256 or result['helperSha256'] != file_hash(Path(__file__).parent/'native_catalog/extract_ue_defaults.ps1'):
            raise FormatError('Native class evidence reader/source identity differs')
        if parsed['unparsed'] or parsed['properties'] != result['properties'] or parsed['superClass'] != result['superClass']:
            raise FormatError('Native class evidence differs from its retained script')
        evidence[reference] = {'defaults': result['properties'], 'superClass': result['superClass'], 'source': result['source'],
                               'sourceScriptSha256': result['sourceScriptSha256'], 'sourceScript': script.decode('utf-8-sig'),
                               'uelibSha256': result['uelibSha256'], 'helperSha256': result['helperSha256']}
    actor_script = evidence['Engine.Actor']['sourceScript']
    for name, kind in (('Location', 'Vector'), ('Rotation', 'Rotator'), ('PrePivot', 'Vector')):
        if not re.search(r'\bvar[^;\n]*\b'+kind+r'\s+'+name+r'\s*;', actor_script):
            raise FormatError('Zero-initialized actor field declaration not established: '+name)
    if not re.search(r'\bvar[^;\n]*\bbool\s+Inverted\s*;', evidence['Engine.TerrainInfo']['sourceScript']):
        raise FormatError('Terrain Inverted declaration is not established')
    return evidence


def resolved_static_values(actor, evidence):
    if actor['classObject'] != 'Engine.StaticMeshActor' or evidence['Engine.StaticMeshActor']['superClass'] != 'Actor':
        raise FormatError('Only exact native Engine.StaticMeshActor inheritance is supported')
    base, child = evidence['Engine.Actor']['defaults'], evidence['Engine.StaticMeshActor']['defaults']
    result = {}
    for name in ('Location', 'Rotation', 'PrePivot', 'DrawScale', 'DrawScale3D'):
        field = actor['sourceTransform'][name]
        if field['status'] == 'serialized':
            result[name] = {'value': field['value'], 'source': 'serialized-actor-property'}
        elif name in child or name in base:
            value = child[name] if name in child else base[name]
            result[name] = {'value': value, 'source': 'Engine.StaticMeshActor' if name in child else 'Engine.Actor'}
        elif name in ('Location', 'Rotation', 'PrePivot'):
            labels = ('Pitch', 'Yaw', 'Roll') if name == 'Rotation' else tuple('XYZ')
            result[name] = {'value': dict.fromkeys(labels, 0), 'source': 'native-declared-field-zero-init',
                            'evidence': 'Exact Engine.Actor declaration + no base/child override; UObject::InitProperties zero-fills newly declared fields'}
        else:
            raise FormatError('Native default is unresolved: '+name)
    return result


def rotation_rows(rotation):
    def sine(value):
        index = (int(value) >> 2) & 16383
        return f32(math.sin(index*2*math.pi/16384))
    p, y, r = (rotation[name] for name in ('Pitch', 'Yaw', 'Roll'))
    sp, sy, sr, cp, cy, cr = sine(p), sine(y), sine(r), sine(p+16384), sine(y+16384), sine(r+16384)
    return [[cp*cy, cp*sy, sp], [sr*sp*cy-cr*sy, sr*sp*sy+cr*cy, -sr*cp],
            [-(cr*sp*cy+sr*sy), cy*sr-cr*sp*sy, cr*cp]]


def static_matrix(values):
    location, pivot, scale3 = (xyz(values[name]['value']) for name in ('Location', 'PrePivot', 'DrawScale3D'))
    uniform = values['DrawScale']['value']
    if not math.isfinite(uniform) or uniform == 0 or any(v == 0 for v in scale3):
        raise FormatError('Singular static actor scale')
    rotation = rotation_rows(values['Rotation']['value'])
    rows = [[rotation[i][j]*scale3[i]*uniform for j in range(3)]+[0] for i in range(3)]
    rows.append([location[j]-sum(pivot[i]*rows[i][j] for i in range(3)) for j in range(3)]+[1])
    return rows


def gltf_placement(native_rows):
    umodel_xzy_basis_permutation = (0, 2, 1)
    result = [[native_rows[umodel_xzy_basis_permutation[i]][umodel_xzy_basis_permutation[j]] for j in range(3)]+[0] for i in range(3)]
    result.append([native_rows[3][axis]*.01 for axis in umodel_xzy_basis_permutation]+[1])
    native_row_major_as_gltf_column_major = [v for row in result for v in row]
    return native_row_major_as_gltf_column_major


class GltfBuilder:
    def __init__(self):
        self.binary = bytearray()
        self.data = {'asset': {'version': '2.0', 'generator': 'native_map_geometry.py'}, 'bufferViews': [], 'accessors': []}

    def accessor(self, rows, count, kind, component=5126):
        while len(self.binary) % 4:
            self.binary.append(0)
        offset = len(self.binary)
        flat = [v for row in rows for v in row] if kind != 'SCALAR' else rows
        payload = struct.pack('<'+str(len(flat))+('f' if component == 5126 else 'I'), *flat)
        self.binary.extend(payload)
        view = len(self.data['bufferViews'])
        self.data['bufferViews'].append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(payload)})
        accessor = {'bufferView': view, 'componentType': component, 'count': count, 'type': kind}
        if kind == 'VEC3':
            accessor['min'] = [f32(min(row[i] for row in rows)) for i in range(3)]
            accessor['max'] = [f32(max(row[i] for row in rows)) for i in range(3)]
        self.data['accessors'].append(accessor)
        return len(self.data['accessors'])-1

    def files(self):
        self.data['buffers'] = [{'uri': 'terrain.bin', 'byteLength': len(self.binary)}]
        gltf = json_bytes(self.data)
        embedded = json.loads(gltf)
        embedded['buffers'][0].pop('uri')
        text = json_bytes(embedded)
        text += b' '*(-len(text)%4)
        binary = bytes(self.binary)+b'\0'*(-len(self.binary)%4)
        glb = struct.pack('<III', 0x46546c67, 2, 28+len(text)+len(binary))
        glb += struct.pack('<I4s', len(text), b'JSON')+text+struct.pack('<I4s', len(binary), b'BIN\0')+binary
        return {'terrain.gltf': gltf, 'terrain.bin': bytes(self.binary), 'terrain.glb': glb}


def implementation_hash():
    root = Path(__file__).parent
    paths = ('native_map_geometry.py', 'native_map.py', 'native_catalog/ue2.py', 'native_catalog/effects.py',
             'native_catalog/extract_ue_defaults.ps1', 'native_assets_lib/gltf.py')
    return sha(json_bytes({name: file_hash(root/name) for name in paths}))


def verify_geometry(client, raw_output, output):
    client, raw_output, output = Path(client).resolve(), Path(raw_output).resolve(), Path(output).resolve()
    verify_map(client, raw_output)
    receipt = json.loads((output/'receipt.json').read_text(encoding='utf-8'))
    if receipt.get('kind') != 'native-terrain-section' or receipt['implementationSha256'] != implementation_hash():
        raise ValueError('Geometry receipt/implementation differs; rebuild required')
    if receipt['rawMapReceiptSha256'] != file_hash(raw_output/'receipt.json'):
        raise ValueError('Raw map extraction changed; rebuild geometry')
    for relative, expected in receipt['outputs'].items():
        if file_hash(safe_path(output, relative)) != expected:
            raise ValueError('Geometry output hash mismatch: '+relative)
    for relative, expected in receipt['sourceDependencies'].items():
        if file_hash(safe_path(client, relative)) != expected:
            raise ValueError('Geometry native dependency changed: '+relative)
    files = {p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()}
    if files != {'receipt.json', *receipt['outputs']}:
        raise ValueError('Geometry output file set differs from receipt')
    report = json.loads((output/'manifest.json').read_text(encoding='utf-8'))
    if sha(json_bytes(report['recipe'])) != receipt['recipeSha256']:
        raise ValueError('Geometry recipe differs from receipt')
    selected, members = select_terrain_sectors(report['nativeTerrain'], json.loads((output/'sector-oracle.json').read_text(encoding='utf-8')), report['recipe'])
    if 'terrainSectorRectangle' in report['recipe']:
        if report.get('selectedRegion') != selected or report.get('selectedSectors') != members:
            raise ValueError('Geometry rectangle selection differs from source oracle/recipe')
    elif report.get('selectedSector') != selected:
        raise ValueError('Geometry single-sector selection differs from source oracle/recipe')
    validate_static_requests(json.loads((output/'static-mesh-requests.json').read_text(encoding='utf-8')),
                             json.loads((output/'static-placements.json').read_text(encoding='utf-8')), report['recipe'])
    return {'verified': True, 'cacheHit': True, 'support': report['support'], 'coverage': report['coverage'], 'gaps': report['gaps']}


def build_geometry(client, raw_output, recipe, output, defaults_cache=None):
    client, raw_output, output = Path(client).resolve(), Path(raw_output).resolve(), Path(output).resolve()
    if output.is_relative_to(client) or client.is_relative_to(output) or output.is_relative_to(raw_output) or raw_output.is_relative_to(output):
        raise ValueError('Geometry output must be separate from source and raw extraction')
    if recipe.get('schemaVersion') != 1 or recipe.get('kind') != 'native-terrain-section':
        raise ValueError('Expected native-terrain-section recipe version1')
    static_model_limit(recipe)
    static_model_policies(recipe)
    verify_map(client, raw_output)
    recipe_hash = sha(json_bytes(recipe))
    if (output/'receipt.json').is_file():
        old = json.loads((output/'receipt.json').read_text(encoding='utf-8'))
        if old.get('recipeSha256') == recipe_hash:
            try:
                return verify_geometry(client, raw_output, output)
            except (ValueError, OSError):
                pass
        actual = {p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()}
        if old.get('kind') != 'native-terrain-section' or actual-{'receipt.json', *old['outputs']}:
            raise ValueError('Refuse to replace unowned geometry outputs')
    elif output.exists() and any(output.iterdir()):
        raise ValueError('Refuse nonempty geometry output without a receipt')
    output.parent.mkdir(parents=True, exist_ok=True)
    raw_manifest = json.loads((raw_output/'manifest.json').read_text(encoding='utf-8'))
    package = Package(safe_path(client, raw_manifest['recipe']['map']).read_bytes(), Path(raw_manifest['recipe']['map']).name)
    native = native_terrain(package)
    terrain = json.loads((raw_output/'terrain.json').read_text(encoding='utf-8'))[0]
    mip = terrain['height']['mips'][0]
    raw = safe_path(raw_output, mip['rawPath']).read_bytes()
    samples = struct.unpack('<'+str(len(raw)//2)+'H', raw)
    actors = json.loads((raw_output/'actors.json').read_text(encoding='utf-8'))
    terrain_actor = next(a for a in actors if a['id'] == terrain['id'])
    calc = calculated_coords(xyz(terrain_actor['sourceTransform']['Location']['value']), xyz(terrain['terrainScale']), native['width'], native['height'])
    if calc != native['toWorld']:
        raise FormatError('Native ToWorld differs from source-backed CalcCoords; no geometry emitted')
    points = terrain_points(native, samples)
    oracle = sector_oracle(native, points)
    if oracle['xyMatches'] != len(native['sectors']):
        raise FormatError('Native sector XY bounds disagree with terrain coordinates')
    selected, selected_sectors = select_terrain_sectors(native, oracle, recipe)
    is_rectangle = 'terrainSectorRectangle' in recipe
    words = {}
    for name in ('QuadVisibilityBitmap', 'EdgeTurnBitmap'):
        record = next(r for r in terrain['bitmaps'] if r['name'] == name)
        payload = safe_path(raw_output, record['path']).read_bytes()
        words[name] = struct.unpack('<'+str(len(payload)//4)+'I', payload)
        if len(words[name])*32 != native['width']*native['height']:
            raise FormatError('Topology word count disagrees with native dimensions')
    layers = layer_records(terrain, native, package, raw_manifest['recipe']['map'])
    mask_uv_rule = qualified_mask_uv_rule(native, selected, package, raw_manifest['recipe']['map'], layers)
    if mask_uv_rule is not None:
        for layer in layers:
            layer['maskUV'] = mask_uv_rule['formula']
            layer['maskUVStatus'] = mask_uv_rule['status']
            layer['channelAndBlendStatus'] = ('Captured fixed-function submissions select mask alpha; '
                                            'CPU pruning, bUseAlpha consumer, final composition, lighting and visible parity remain unverified.')
    ox, oy = selected['offset']
    qx, qy = selected['quads']
    w, h = native['width'], native['height']
    positions, normals, mask_uv, source_points = [], [], [], []
    layer_uvs = [[] for _ in layers]
    for y in range(oy, oy+qy+1):
        for x in range(ox, ox+qx+1):
            point = points[y*w+x]
            source_points.append(point)
            positions.append(native_to_gltf(point))
            normal = vertex_normal(points, words['EdgeTurnBitmap'], w, h, x, y)
            normals.append([normal[0], normal[2], normal[1]])
            mask_uv.append(terrain_mask_uv(x, y, w, h, mask_uv_rule))
            for index, layer in enumerate(layers):
                layer_uvs[index].append(texture_uv(layer['worldToTextureRowMajor'], point))
    indices, hidden, turned_count = [], 0, 0
    for y in range(qy):
        for x in range(qx):
            if not bit(words['QuadVisibilityBitmap'], w, ox+x, oy+y):
                hidden += 1
                continue
            turned = bit(words['EdgeTurnBitmap'], w, ox+x, oy+y)
            turned_count += turned
            a = y*(qx+1)+x
            for tri in quad_triangles(a, a+1, a+qx+1, a+qx+2, turned, native_render_order=True):
                indices.extend(tri)
    with tempfile.TemporaryDirectory(prefix='native-terrain-', dir=output.parent) as temp:
        work = Path(temp)
        evidence = read_class_evidence(client, work/'classes', defaults_cache)
        inverted = property_value(terrain_actor['properties'], 'Inverted')
        if inverted is None:
            inverted = evidence['Engine.TerrainInfo']['defaults'].get('Inverted', False)
        if inverted:
            raise FormatError('Inverted terrain requires separately verified rendering/normals')
        out = work/'result'
        out.mkdir()
        builder = GltfBuilder()
        attributes = {'POSITION': builder.accessor(positions, len(positions), 'VEC3'),
                      'NORMAL': builder.accessor(normals, len(normals), 'VEC3'),
                      'TEXCOORD_0': builder.accessor(mask_uv, len(mask_uv), 'VEC2'),
                      'TEXCOORD_1': builder.accessor(layer_uvs[0], len(positions), 'VEC2')}
        index_accessor = builder.accessor(indices, len(indices), 'SCALAR', 5125)
        for index, layer in enumerate(layers):
            layer['uvAccessor'] = builder.accessor(layer_uvs[index], len(positions), 'VEC2')
        builder.data.update(meshes=[{'name': selected['object'], 'primitives': [{'attributes': attributes, 'indices': index_accessor, 'material': 0}],
                                    'extras': {'nativeObject': selected['object'], 'nativeBounds': selected['bounds'], 'sourceToGltf': SOURCE_TO_GLTF,
                                               'maskUvSet': 0, 'baseLayerUvSet': 1, 'nativeLayers': layers}}],
                            materials=[{'name': 'Neutral geometry inspection; native terrain shader pending',
                                        'pbrMetallicRoughness': {'baseColorFactor': [.5, .5, .5, 1], 'metallicFactor': 0, 'roughnessFactor': 1}}],
                            nodes=[{'name': selected['object'], 'mesh': 0}], scenes=[{'nodes': [0]}], scene=0)
        if mask_uv_rule is not None:
            builder.data['meshes'][0]['extras']['maskUVRule'] = mask_uv_rule
        if is_rectangle:
            extras = builder.data['meshes'][0]['extras']
            extras.pop('nativeBounds')
            extras.update(nativeSectorObjects=selected['sectorObjects'], reconstructedBounds=selected['bounds'],
                          nativeSectorRectangle=recipe['terrainSectorRectangle'])
        files = builder.files()
        sources = MapSources(client)
        placements, requests = [], {}
        zmin, zmax = recipe['staticActorOriginZ']
        if not all(type(v) in (int, float) and math.isfinite(v) for v in (zmin, zmax)) or zmin >= zmax:
            raise ValueError('Invalid static actor source-Z selection bounds')
        actor_origins_in_xy, actor_origins_excluded_z = 0, 0
        for actor in actors:
            if actor['class'] != 'StaticMeshActor':
                continue
            location = actor['sourceTransform']['Location'].get('value')
            if not location or not (selected['bounds'][0] <= location['X'] <= selected['bounds'][3] and selected['bounds'][1] <= location['Y'] <= selected['bounds'][4]):
                continue
            actor_origins_in_xy += 1
            if not zmin <= location['Z'] <= zmax:
                actor_origins_excluded_z += 1
                continue
            values = resolved_static_values(actor, evidence)
            matrix = static_matrix(values)
            ref = actor['staticMesh']['object']
            relative, _, item = sources.resolve(ref, 'StaticMesh')
            requests[ref] = static_mesh_request(relative, item)
            placements.append({'id': actor['id'], 'sourceMesh': ref, 'resolvedMeshObject': item['object'], 'assetId': 'interlude:'+item['object'],
                               'resolvedProperties': values, 'nativeRowMajorMatrix': matrix,
                               'gltfColumnMajorMatrix': gltf_placement(matrix), 'materialOverrides': actor['materialOverrides'],
                               'collision': actor['collision'], 'collisionClassDefaults': evidence['Engine.StaticMeshActor']['defaults'],
                               'sourceBoundsSelection': 'serialized actor origin only; mesh overlaps and server collision are not inferred'})
        for request in requests.values():
            policy = static_model_policies(recipe).get(request['object'])
            if policy:
                request['materialPolicy'] = policy
        validate_static_requests(list(requests.values()), placements, recipe)
        topology = {'wholeMapQuads': (w-1)*(h-1), 'wholeMapHiddenQuads': sum(not bit(words['QuadVisibilityBitmap'], w, x, y) for y in range(h-1) for x in range(w-1)),
                    'wholeMapTurnedVisibleQuads': sum(bit(words['QuadVisibilityBitmap'], w, x, y) and bit(words['EdgeTurnBitmap'], w, x, y) for y in range(h-1) for x in range(w-1)),
                    'sectionQuads': qx*qy, 'sectionHiddenQuads': hidden, 'sectionTurnedVisibleQuads': turned_count,
                    'indexRule': 'bit=x+y*width, uint32 little-endian, least-significant bit first; turned uses (x+1,y)--(x,y+1)',
                    'boundaryRule': 'Native sectors cover (width-1)*(height-1) quads; no fabricated 257th sample or neighbor seam'}
        reference = next(actor for actor in actors if actor['object'] == recipe['referenceActor'])
        anchor = xyz(reference['sourceTransform']['Location']['value'])
        nearest = [max(0, min(w-1, round((anchor[0]-points[0][0])/native['toWorld']['axes'][0][0]))),
                   max(0, min(h-1, round((anchor[1]-points[0][1])/native['toWorld']['axes'][1][1])))]
        native_report = {key: value for key, value in native.items() if key not in ('vertexColorsBGRA', 'sectors')}
        manifest = {'schemaVersion': 1, 'kind': 'native-terrain-section', 'support': 'geometry-reconstructed-native-visual-parity-pending',
                    'recipe': recipe, 'sourceToGltf': SOURCE_TO_GLTF, 'nativeTerrain': native_report, 'selectedSector': selected,
                    'referenceActor': {'object': reference['object'], 'location': anchor, 'nearestHeightSample': nearest,
                                       'nearestTerrainZ': points[nearest[1]*w+nearest[0]][2], 'walkableNativeSpawnVerified': False},
                    'coverage': {'vertices': len(positions), 'triangles': len(indices)//3, 'staticActors': len(placements),
                                 'uniqueStaticMeshes': len(requests), 'terrainLayersWithUV': len(layers), 'terrainLayersRendered': 0,
                                 'nativeSectorBoundsCompared': oracle['compared'], 'nativeSectorBoundsMatched': oracle['allBoundsMatch']},
                    'topology': topology, 'nativeDefaultEvidence': {name: {key: value for key, value in row.items() if key != 'sourceScript'} for name, row in evidence.items()},
                    'referenceImplementation': {'repository': REFERENCE_REPO, 'commit': REFERENCE_COMMIT, 'files': REFERENCE_FILES,
                                                'scope': 'UE2 reference formulas cross-checked against exact Lineage serialized FCoords, UV matrices, package defaults and native sector bounds; not a claim of identical title-specific runtime'},
                    'tolerances': {'nativeBounds': BOUND_TOLERANCE, 'uvCoefficients': UV_TOLERANCE},
                    'gaps': ['Terrain glTF uses a named neutral inspection material. Lineage DXT1/P8 alpha-map channel choice, blending, lighting and visual parity remain unverified.',
                             f'{oracle["compared"]-oracle["allBoundsMatch"]} cached sector Z bounds differ from current height samples in this map; complete discrepancies are retained in sector-oracle.json. Selected sector passes unchanged tolerance.',
                             'PlayerStart0 is below the sampled surface. This section is a nearby surface candidate, not a certified walkable native spawn or server collision asset.',
                             'Static placement uses source defaults and UE2 rotation quantization; native CPU trig-library/rounding parity and rendered static-mesh alignment remain to be measured.',
                             'BSP, underground rooms, water, terrain decorations and physics are not reconstructed by this terrain-only output.']}
        if mask_uv_rule is not None:
            manifest['maskUVRule'] = mask_uv_rule
            manifest['gaps'][0] = ('Terrain glTF uses a named neutral inspection material. Mask UVs match the scoped '
                                   'offscreen native submissions; final composition, lighting and visible parity remain unverified.')
        if is_rectangle:
            manifest.pop('selectedSector')
            manifest.update(selectedRegion=selected, selectedSectors=selected_sectors)
            manifest['coverage']['terrainSectors'] = len(selected_sectors)
            manifest['staticActorSelection'] = {'nativeXYMinimum': selected['bounds'][:2], 'nativeXYMaximum': selected['bounds'][3:5],
                'nativeZWindow': [zmin, zmax], 'originSelection': 'serialized actor origin inclusive; full raw actor inventory inspected',
                'actorOriginsWithinXY': actor_origins_in_xy, 'actorOriginsExcludedByZ': actor_origins_excluded_z,
                'selectedActors': len(placements), 'maxStaticModels': static_model_limit(recipe),
                'limitations': 'Excluded Z origins and mesh overlaps are not inferred or added; this is a declared section, not a complete world.'}
            manifest['gaps'][1] = (f'{oracle["compared"]-oracle["allBoundsMatch"]} cached sector Z bounds differ across the map; '
                                  f'{selected["cachedZBoundsMismatched"]} of {len(selected_sectors)} selected sectors differ. '
                                  'Fixed tolerance and complete source discrepancies are retained; original samples are unchanged and no visual-parity pass is inferred.')
            manifest['gaps'][2] = (f'{reference["object"]} is retained at its authored XYZ; its exact XY can be sampled on source terrain. '
                                  'Live native pawn/camera and walkable collision remain unverified; source startup selection is not visual parity.')
            manifest['gaps'].append(f'{actor_origins_excluded_z} static actor origins within this rectangle are excluded by the declared source Z window.')
        files.update({'manifest.json': json_bytes(manifest), 'sector-oracle.json': json_bytes(oracle),
                      'layers.json': json_bytes(layers), 'static-placements.json': json_bytes(placements),
                      'static-mesh-requests.json': json_bytes([requests[key] for key in sorted(requests)]),
                      'native-vertex-colors.bgra': native['vertexColorsBGRA'],
                      'native-section-positions.float32le': struct.pack('<'+str(len(source_points)*3)+'f', *(v for point in source_points for v in point))})
        for name, row in evidence.items():
            files['native-defaults/'+name+'.uc'] = row['sourceScript'].encode('utf-8')
        for name, payload in files.items():
            target = safe_path(out, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
        dependencies = {name: entry['sha256'] for name, entry in json.loads((raw_output/'receipt.json').read_text())['dependencies'].items()}
        dependencies.update({name: entry['sha256'] for name, entry in sources.dependencies.items()})
        dependencies.update({row['source']['package']: row['source']['packageSha256'] for row in evidence.values()})
        receipt = {'schemaVersion': 1, 'kind': 'native-terrain-section', 'recipeSha256': recipe_hash,
                   'implementationSha256': implementation_hash(), 'rawMapReceiptSha256': file_hash(raw_output/'receipt.json'),
                   'sourceDependencies': dependencies, 'outputs': {name: sha(payload) for name, payload in files.items()}}
        (out/'receipt.json').write_bytes(json_bytes(receipt))
        output.mkdir(parents=True, exist_ok=True)
        for path in out.rglob('*'):
            if path.is_file():
                target = safe_path(output, path.relative_to(out).as_posix())
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)
    return {**verify_geometry(client, raw_output, output), 'cacheHit': False}


def reference_surface_candidate(manifest, points, maps, origins):
    native = manifest['nativeTerrain']
    region = manifest.get('selectedRegion', manifest.get('selectedSector'))
    ox, oy = region['offset']
    qx, qy = region['quads']
    reference = manifest['referenceActor']
    anchor = reference['location']
    grid = coords_point(native['toHeightmap'], anchor)
    if not (ox <= grid[0] <= ox+qx and oy <= grid[1] <= oy+qy):
        raise FormatError('Reference actor XY lies outside the selected terrain rectangle')
    gx, gy = min(math.floor(grid[0]), ox+qx-1), min(math.floor(grid[1]), oy+qy-1)
    if not bit(maps['QuadVisibilityBitmap'], native['width'], gx, gy):
        raise FormatError('Reference actor XY lies on a hidden native terrain quad')
    a = (gy-oy)*(qx+1)+(gx-ox)
    corners = [points[i] for i in (a, a+1, a+qx+1, a+qx+2)]
    turned = bit(maps['EdgeTurnBitmap'], native['width'], gx, gy)
    fx, fy = grid[0]-gx, grid[1]-gy
    face = ((0, 1, 2) if fx+fy <= 1 else (2, 1, 3)) if turned else ((0, 1, 3) if fy <= fx else (0, 3, 2))
    p, q, r = [corners[i] for i in face]
    determinant = (q[1]-r[1])*(p[0]-r[0])+(r[0]-q[0])*(p[1]-r[1])
    if not math.isfinite(determinant) or determinant == 0:
        raise FormatError('Reference terrain triangle has degenerate XY')
    first = ((q[1]-r[1])*(anchor[0]-r[0])+(r[0]-q[0])*(anchor[1]-r[1]))/determinant
    second = ((r[1]-p[1])*(anchor[0]-r[0])+(p[0]-r[0])*(anchor[1]-r[1]))/determinant
    weights = [first, second, 1-first-second]
    if any(not math.isfinite(value) or not -1e-6 <= value <= 1+1e-6 for value in weights):
        raise FormatError('Reference XY does not lie on the selected native triangle')
    point = [anchor[0], anchor[1], sum(weight*corner[2] for weight, corner in zip(weights, (p, q, r)))]
    slope = max(math.degrees(math.acos(max(-1, min(1, unit(cross(subtract(corners[j], corners[i]), subtract(corners[k], corners[i])))[2]))))
                for i, j, k in quad_triangles(0, 1, 2, 3, turned))
    clearance = min((math.hypot(point[0]-origin[0], point[1]-origin[1]) for origin in origins), default=0)
    return {'sourcePosition': point, 'gltfGroundPosition': native_to_gltf(point), 'cell': [gx, gy], 'edgeTurn': turned,
            'cornerSourcePositions': corners, 'triangleCornerIndices': list(face), 'triangleBarycentricWeights': weights,
            'maxCellSlopeDegrees': slope, 'nearestStaticActorOriginDistanceMetres': clearance*.01,
            'referenceActor': {'object': reference['object'], 'authoredSourcePosition': list(anchor),
                               'authoredHeightAboveTerrainNativeUnits': anchor[2]-point[2]},
            'selection': 'exact authored reference actor XY; original terrain triangle interpolation',
            'heightRule': 'barycentric interpolation on the native diagonal using original float32 world vertices; authored reference Z retained separately',
            'collisionVerified': False, 'nativeSpawnVerified': False,
            'limitation': 'Reference selection is source-backed; live native pawn/camera, actor collision height and mesh/BSP/server collision remain unverified. No native transform or terrain sample is changed.'}


def surface_spawn_candidate(section_output, raw_output, placements):
    section_output, raw_output = Path(section_output), Path(raw_output)
    manifest = json.loads((section_output/'manifest.json').read_text(encoding='utf-8'))
    native = manifest['nativeTerrain']
    sector = manifest['selectedRegion'] if 'selectedRegion' in manifest else manifest['selectedSector']
    ox, oy = sector['offset']
    qx, qy = sector['quads']
    points = list(struct.iter_unpack('<3f', (section_output/'native-section-positions.float32le').read_bytes()))
    terrain = json.loads((raw_output/'terrain.json').read_text(encoding='utf-8'))[0]
    maps = {}
    for name in ('QuadVisibilityBitmap', 'EdgeTurnBitmap'):
        record = next(row for row in terrain['bitmaps'] if row['name'] == name)
        payload = safe_path(raw_output, record['path']).read_bytes()
        maps[name] = struct.unpack('<'+str(len(payload)//4)+'I', payload)
    origins = [xyz(row['resolvedProperties']['Location']['value']) for row in placements]
    if manifest['recipe'].get('sourceSpawnReferenceActor', False):
        return reference_surface_candidate(manifest, points, maps, origins)
    candidates = []
    for y in range(1, qy-1):
        for x in range(1, qx-1):
            if not bit(maps['QuadVisibilityBitmap'], native['width'], ox+x, oy+y):
                continue
            a = y*(qx+1)+x
            corner_ids = (a, a+1, a+qx+1, a+qx+2)
            corners = [points[i] for i in corner_ids]
            turned = bit(maps['EdgeTurnBitmap'], native['width'], ox+x, oy+y)
            first, last = (corners[1], corners[2]) if turned else (corners[0], corners[3])
            point = [(first[i]+last[i])/2 for i in range(3)]
            slope = max(math.degrees(math.acos(max(-1, min(1, unit(cross(subtract(corners[j], corners[i]), subtract(corners[k], corners[i])))[2]))))
                        for i, j, k in quad_triangles(0, 1, 2, 3, turned))
            if slope > 20:
                continue
            clearance = min((math.hypot(point[0]-origin[0], point[1]-origin[1]) for origin in origins), default=0)
            candidates.append({'sourcePosition': point, 'gltfGroundPosition': native_to_gltf(point),
                               'cell': [ox+x, oy+y], 'edgeTurn': turned, 'cornerSourcePositions': corners,
                               'maxCellSlopeDegrees': slope, 'nearestStaticActorOriginDistanceMetres': clearance*.01})
    if not candidates:
        raise FormatError('No visible interior terrain cell meets the declared 20-degree candidate slope threshold')
    chosen = max(candidates, key=lambda row: (row['nearestStaticActorOriginDistanceMetres'], -row['cell'][1], -row['cell'][0]))
    selection = 'visible interior cell centre, <=20 degree face slope, maximum XY distance from the seven serialized static origins'
    if 'selectedRegion' in manifest:
        selection = f'visible interior cell centre, <=20 degree face slope, maximum XY distance from the {len(origins)} selected serialized static origins'
    return {**chosen, 'selection': selection,
            'heightRule': 'interpolation at the midpoint of the native diagonal, using source float32 world vertices',
            'collisionVerified': False, 'nativeSpawnVerified': False,
            'limitation': 'Origin clearance does not measure mesh bounds, BSP or collision; validate actual movement and geometry before treating this as a walkable spawn.'}


def glb_structure(path):
    payload = path.read_bytes()
    if len(payload) < 28 or struct.unpack_from('<III', payload) != (0x46546c67, 2, len(payload)):
        raise FormatError('Invalid section model GLB header')
    size, kind = struct.unpack_from('<I4s', payload, 12)
    if kind != b'JSON' or 20+size+8 > len(payload):
        raise FormatError('Invalid section model GLB JSON chunk')
    document = json.loads(payload[20:20+size])
    binary_size, binary_kind = struct.unpack_from('<I4s', payload, 20+size)
    if binary_kind != b'BIN\0' or 28+size+binary_size != len(payload):
        raise FormatError('Invalid section model GLB binary chunk')
    if any(buffer.get('uri') for buffer in document.get('buffers', [])):
        raise FormatError('Section model GLB has an external buffer')
    triangles, vertices, primitives = 0, 0, 0
    for mesh in document.get('meshes', []):
        for primitive in mesh['primitives']:
            if primitive.get('mode', 4) != 4:
                raise FormatError('Section mesh is not a triangle primitive')
            count = document['accessors'][primitive['indices']]['count']
            if count % 3:
                raise FormatError('Section mesh index count is not divisible by three')
            triangles += count//3
            vertices += document['accessors'][primitive['attributes']['POSITION']]['count']
            primitives += 1
    return {'meshes': len(document.get('meshes', [])), 'primitives': primitives, 'vertices': vertices,
            'triangles': triangles, 'materials': len(document.get('materials', [])),
            'scope': 'GLB structure and archive payload hashes verified; rendering/alpha/collision parity remains separate'}


def verify_section_runtime(client, raw_output, section_output, model_output, runtime_output):
    from native_assets import implementation_hash as converter_hash, verify_archive, UMODEL_SHA256
    section_output, model_output, runtime_output = Path(section_output).resolve(), Path(model_output).resolve(), Path(runtime_output).resolve()
    verify_geometry(client, raw_output, section_output)
    receipt = json.loads((runtime_output/'receipt.json').read_text(encoding='utf-8'))
    if receipt.get('kind') != 'native-map-section-runtime' or receipt.get('implementationSha256') != implementation_hash() or receipt.get('converterImplementationSha256') != converter_hash() or receipt.get('umodelSha256') != UMODEL_SHA256:
        raise ValueError('Section runtime implementation/receipt differs')
    if receipt['sectionReceiptSha256'] != file_hash(section_output/'receipt.json') or receipt['manifestSha256'] != file_hash(runtime_output/'manifest.json'):
        raise ValueError('Section runtime input/manifest hash differs')
    manifest = json.loads((runtime_output/'manifest.json').read_text(encoding='utf-8'))
    expected_roots = {'terrain': Path(os.path.relpath(section_output, runtime_output)).as_posix(),
                      'models': Path(os.path.relpath(model_output, runtime_output)).as_posix()}
    if manifest['resourceRoots'] != expected_roots or manifest['terrain']['file'] != 'terrain.glb':
        raise ValueError('Section runtime resource roots differ from selected inputs')
    for group, record in [(section_output, manifest['terrain']), *((model_output, model[key]) for model in manifest['models'] for key in ('model', 'archive'))]:
        path = safe_path(group, record['file'])
        if path.stat().st_size != record['bytes'] or file_hash(path) != record['sha256']:
            raise ValueError('Section runtime resource hash/length differs: '+record['file'])
    for model in manifest['models']:
        result = verify_archive(safe_path(model_output, model['archive']['file']))
        if result['id'] != model['id'] or receipt['modelArchives'].get(model['archive']['file']) != model['archive']['sha256']:
            raise ValueError('Section runtime native model identity/receipt differs')
    return {'verified': True, 'models': len(manifest['models']), 'placements': len(manifest['placements']),
            'support': manifest['support'], 'errors': manifest['errors']}


def build_section_runtime(client, raw_output, section_output, model_output, runtime_output, umodel=None):
    from native_assets import Converter, UMODEL, UMODEL_SHA256, implementation_hash as converter_hash, verify_archive
    client, raw_output, section_output = Path(client).resolve(), Path(raw_output).resolve(), Path(section_output).resolve()
    model_output, runtime_output = Path(model_output).resolve(), Path(runtime_output).resolve()
    for protected in (client, raw_output, section_output, model_output):
        if runtime_output.is_relative_to(protected) or protected.is_relative_to(runtime_output):
            raise ValueError('Runtime output must be separate from sources and products')
    verify_geometry(client, raw_output, section_output)
    requests = json.loads((section_output/'static-mesh-requests.json').read_text(encoding='utf-8'))
    placements = json.loads((section_output/'static-placements.json').read_text(encoding='utf-8'))
    geometry_manifest = json.loads((section_output/'manifest.json').read_text(encoding='utf-8'))
    validate_static_requests(requests, placements, geometry_manifest['recipe'])
    converter = Converter(client, model_output, umodel or UMODEL)
    models, errors, cache_hits = [], [], 0
    for request in requests:
        try:
            result = converter.convert(request)
            cache_hits += bool(result['cacheHit'])
            archive = Path(result['file'])
            verify_archive(archive)
            folder = archive.parent
            asset = json.loads((folder/'asset.json').read_text(encoding='utf-8'))
            glb = folder/'model.glb'
            with zipfile.ZipFile(archive) as packed:
                if packed.read('model.glb') != glb.read_bytes():
                    raise FormatError('Standalone section model differs from verified archive payload')
            models.append({'sourceObject': request['object'], 'id': asset['id'],
                           'archive': {'file': archive.relative_to(model_output).as_posix(), 'sha256': file_hash(archive), 'bytes': archive.stat().st_size},
                           'model': {'file': glb.relative_to(model_output).as_posix(), 'sha256': file_hash(glb), 'bytes': glb.stat().st_size},
                           'structure': glb_structure(glb), 'limitations': asset['limitations']})
            if asset.get('model', {}).get('nativeMaterialGraph'):
                models[-1]['nativeMaterialGraph'] = asset['model']['nativeMaterialGraph']
        except Exception as error:
            errors.append({'sourceObject': request['object'], 'errorType': type(error).__name__, 'error': str(error)})
    geometry = section_output/'terrain.glb'
    manifest = {'schemaVersion': 1, 'kind': 'native-map-section-runtime',
                'resourceRoots': {'terrain': Path(os.path.relpath(section_output, runtime_output)).as_posix(),
                                  'models': Path(os.path.relpath(model_output, runtime_output)).as_posix()},
                'terrain': {'file': 'terrain.glb', 'sha256': file_hash(geometry), 'bytes': geometry.stat().st_size,
                            'materialStatus': 'neutral-inspection-material; native layer shader pending'},
                'models': models, 'placements': [{'id': p['id'], 'sourceMesh': p['sourceMesh'], 'modelId': p['assetId'],
                                                 'matrix': p['gltfColumnMajorMatrix'], 'sourceLocation': p['resolvedProperties']['Location']['value'],
                                                 'materialOverrides': p['materialOverrides']} for p in placements],
                'surfaceSpawnCandidate': surface_spawn_candidate(section_output, raw_output, placements),
                'errors': errors, 'support': 'section-products-ready-for-runtime-validation' if not errors else 'partial-section-products',
                'gaps': ['Terrain blending/lighting remains unimplemented.', 'Static model material approximation and native visual alignment require browser/native review.',
                         'The proposed surface spawn has measured origin clearance, not verified mesh/BSP/server collision.']}
    unsupported = [{'modelId': model['id'], 'sourceObject': model['sourceObject'],
                    'runtimeStatus': model['nativeMaterialGraph']['runtimeStatus'],
                    'graphManifest': model['nativeMaterialGraph']['manifest'],
                    'runtimeGaps': model['nativeMaterialGraph']['runtimeGaps'],
                    'placementIds': [p['id'] for p in manifest['placements'] if p['modelId'] == model['id']]}
                   for model in models if model.get('nativeMaterialGraph')]
    if unsupported:
        manifest['unsupportedRuntimeMaterials'] = unsupported
        manifest['coverage'] = {'unsupportedMaterialModels': len(unsupported),
                                'diagnosticMaterialPlacements': sum(len(row['placementIds']) for row in unsupported),
                                'nativeMaterialRuntimeParityVerified': False}
        manifest['gaps'].append(f'{len(unsupported)} source models across {manifest["coverage"]["diagnosticMaterialPlacements"]} placements retain complete native material graphs with named diagnostic slots; native billboarding, texture animation, FadeColor, Combiner and Shader blending remain unsupported.')
    payload = json_bytes(manifest)
    receipt = {'schemaVersion': 1, 'kind': 'native-map-section-runtime', 'implementationSha256': implementation_hash(),
               'converterImplementationSha256': converter_hash(), 'umodelSha256': UMODEL_SHA256,
               'sectionReceiptSha256': file_hash(section_output/'receipt.json'), 'manifestSha256': sha(payload),
               'modelArchives': {row['archive']['file']: row['archive']['sha256'] for row in models}}
    if runtime_output.exists() and any(runtime_output.iterdir()):
        if {p.name for p in runtime_output.iterdir()}-{'manifest.json', 'receipt.json'} or not (runtime_output/'receipt.json').is_file():
            raise ValueError('Runtime output contains unowned files')
        if json.loads((runtime_output/'receipt.json').read_text(encoding='utf-8')).get('kind') != 'native-map-section-runtime':
            raise ValueError('Runtime output does not have an owned receipt')
    runtime_output.mkdir(parents=True, exist_ok=True)
    for name, data in (('manifest.json', payload), ('receipt.json', json_bytes(receipt))):
        target = runtime_output/name
        if not target.is_file() or target.read_bytes() != data:
            target.write_bytes(data)
    return {**verify_section_runtime(client, raw_output, section_output, model_output, runtime_output), 'cacheHits': cache_hits,
            'manifest': str(runtime_output/'manifest.json'), 'surfaceSpawnCandidate': manifest['surfaceSpawnCandidate']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--map-output', type=Path, required=True)
    parser.add_argument('--recipe', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--defaults-cache', type=Path)
    parser.add_argument('--model-output', type=Path, help='Optional conversion of only the declared section static meshes')
    parser.add_argument('--runtime-output', type=Path, help='Runtime manifest output; requires --model-output')
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    require_reference_client(args.client)
    if args.verify:
        result = verify_geometry(args.client, args.map_output, args.output)
    else:
        if not args.recipe:
            parser.error('--recipe is required unless --verify is used')
        result = build_geometry(args.client, args.map_output, json.loads(args.recipe.read_text(encoding='utf-8-sig')), args.output, args.defaults_cache)
    if args.model_output or args.runtime_output:
        if not args.model_output or not args.runtime_output:
            parser.error('--model-output and --runtime-output must be used together')
        result['runtime'] = build_section_runtime(args.client, args.map_output, args.output, args.model_output, args.runtime_output)
    print(json_bytes(result).decode('utf-8'))
    if result.get('runtime', {}).get('errors'):
        raise SystemExit(1)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
