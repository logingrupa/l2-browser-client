"""Offline, exact-source TerrainSector247 geometry and two unqualified UV variants.

This extractor does not widen the production mask-UV gate or stage runtime or
Editor assets. The corrected-formula variant is a conditional comparison only.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import struct

from native_catalog.ue2 import Package
from native_map import actor_properties, bitmap_words, read_g16
from native_map_geometry import (GltfBuilder, native_terrain, terrain_points, sector_oracle,
                                 vertex_normal, native_to_gltf, bit, quad_triangles,
                                 layer_records, texture_uv, qualified_mask_uv_rule, terrain_mask_uv)
from native_assets_lib.gltf import json_bytes
from reference_client_guard import require_reference_client

MAP_SHA = '1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4'
HEIGHT_SHA = 'e113df8ca85cac06d6816345ec66a7aaa3740d2cae8b33868c9c3cf47e4150f3'
RAW_TERRAIN_SHA = '86521817bddb124c44a979416c48ed1808cfdcd034915f1dc23de987d04909ac'
REFERENCE_MANIFEST_SHA = '857391b5ec667e8c9dddbfc849d50796499a85660840aa76312489423dc51252'
REFERENCE_GLB_SHA = '39417edb0294885ef6bd4107c85a917f6dcc4dc2985d11393bb41afa2e63a724'
SECTOR_OBJECT = '20_20.TerrainInfo0.TerrainSector247'
VARIANTS = ('ordinary', 'conditional-corrected')


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pin_bytes(data):
    return {'bytes': len(data), 'sha256': sha(data)}


def unqualified_corrected_mask_uv(ordinary, x, y):
    return [ordinary[0] - max(x - 240, 0) / 4096, ordinary[1] - max(y - 240, 0) / 4096]


def patch_mask_uv(x, y, width, height, variant):
    require(variant in VARIANTS, 'Unknown offline mask comparison variant')
    ordinary = terrain_mask_uv(x, y, width, height)
    if variant == 'ordinary':
        return ordinary
    return unqualified_corrected_mask_uv(ordinary, x, y)


def channel_rows(glb):
    require(len(glb) >= 28 and struct.unpack_from('<III', glb) == (0x46546c67, 2, len(glb)), 'Invalid reference GLB')
    size = struct.unpack_from('<I', glb, 12)[0]
    document = json.loads(glb[20:20 + size])
    binary = glb[28 + size:]
    result = {}
    for name, index in document['meshes'][0]['primitives'][0]['attributes'].items():
        if name not in ('POSITION', 'NORMAL', 'TEXCOORD_0', 'TEXCOORD_1'):
            continue
        accessor = document['accessors'][index]
        view = document['bufferViews'][accessor['bufferView']]
        dimensions = {'VEC2': 2, 'VEC3': 3}[accessor['type']]
        require(accessor['componentType'] == 5126 and not accessor.get('normalized') and 'sparse' not in accessor,
                'Unsupported reference channel')
        start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        stride = view.get('byteStride', dimensions * 4)
        result[name] = [binary[start + index * stride:start + index * stride + dimensions * 4] for index in range(accessor['count'])]
        require(all(len(row) == dimensions * 4 for row in result[name]), 'Reference channel exceeds binary')
    return result


def make_variant(native, sector, points, words, layers, variant):
    ox, oy = sector['offset']
    qx, qy = sector['quads']
    width, height = native['width'], native['height']
    positions, normals, masks = [], [], []
    diffuse = [[] for _ in layers]
    for y in range(oy, oy + qy + 1):
        for x in range(ox, ox + qx + 1):
            point = points[y * width + x]
            positions.append(native_to_gltf(point))
            normal = vertex_normal(points, words['EdgeTurnBitmap'], width, height, x, y)
            normals.append([normal[0], normal[2], normal[1]])
            masks.append(patch_mask_uv(x, y, width, height, variant))
            for index, layer in enumerate(layers):
                diffuse[index].append(texture_uv(layer['worldToTextureRowMajor'], point))
    indices, hidden, turned_count = [], 0, 0
    for y in range(qy):
        for x in range(qx):
            if not bit(words['QuadVisibilityBitmap'], width, ox + x, oy + y):
                hidden += 1
                continue
            turned = bit(words['EdgeTurnBitmap'], width, ox + x, oy + y)
            turned_count += turned
            a = y * (qx + 1) + x
            for triangle in quad_triangles(a, a + 1, a + qx + 1, a + qx + 2, turned, native_render_order=True):
                indices.extend(triangle)
    builder = GltfBuilder()
    builder.data['asset']['generator'] = 'extract-native-terrain-patch.py; offline comparison, not native UV qualification'
    attributes = {'POSITION': builder.accessor(positions, len(positions), 'VEC3'),
                  'NORMAL': builder.accessor(normals, len(normals), 'VEC3'),
                  'TEXCOORD_0': builder.accessor(masks, len(masks), 'VEC2'),
                  'TEXCOORD_1': builder.accessor(diffuse[0], len(positions), 'VEC2')}
    index_accessor = builder.accessor(indices, len(indices), 'SCALAR', 5125)
    variant_layers = copy.deepcopy(layers)
    formula = '(gridXY + 0.5) / heightmapDimensions'
    if variant == 'conditional-corrected':
        formula += ' - max(gridXY - 240, 0) / 4096'
    for index, layer in enumerate(variant_layers):
        layer['uvAccessor'] = builder.accessor(diffuse[index], len(positions), 'VEC2')
        layer['maskUV'] = formula
        layer['maskUVStatus'] = 'unqualified offline comparison; new sector has no joined native submission'
    comparison = {'variant': variant, 'maskFormula': formula, 'nativeSubmittedCoordinatesQualified': False,
                  'nativeVisiblePixelsQualified': False,
                  'purpose': 'Retained-source geometry and conditional mask-UV comparison only; not production policy.'}
    builder.data.update(meshes=[{'name': SECTOR_OBJECT, 'primitives': [{'attributes': attributes, 'indices': index_accessor, 'material': 0}],
                                'extras': {'nativeObject': SECTOR_OBJECT, 'nativeGridOffset': [ox, oy], 'nativeGridQuads': [qx, qy],
                                           'maskUvSet': 0, 'baseLayerUvSet': 1, 'nativeLayers': variant_layers,
                                           'offlineTerrainComparison': comparison}}],
                        materials=[{'name': 'Neutral geometry inspection; native terrain composition unresolved',
                                    'pbrMetallicRoughness': {'baseColorFactor': [.5, .5, .5, 1], 'metallicFactor': 0, 'roughnessFactor': 1}}],
                        nodes=[{'name': SECTOR_OBJECT, 'mesh': 0}], scenes=[{'nodes': [0]}], scene=0)
    files = builder.files()
    entry = builder.data['accessors'][attributes['TEXCOORD_0']]
    view = builder.data['bufferViews'][entry['bufferView']]
    return files, {'comparison': comparison, 'vertices': len(positions), 'quads': qx * qy, 'hiddenQuads': hidden,
                   'turnedVisibleQuads': turned_count, 'triangles': len(indices) // 3,
                   'maskByteOffset': view['byteOffset'], 'maskBytes': view['byteLength'],
                   'channelHashes': {key: sha(b''.join(rows)) for key, rows in channel_rows(files['terrain.glb']).items()},
                   'layers': variant_layers}


def compare_variants(ordinary, candidate, mask_offset, vertex_count):
    require(len(ordinary) == len(candidate), 'Offline variant binary lengths differ')
    changed = [index for index, (a, b) in enumerate(zip(ordinary, candidate)) if a != b]
    allowed = {mask_offset + index * 8 + 4 + byte for index in range(vertex_count) for byte in range(4)}
    require(set(changed).issubset(allowed), 'Offline variants differ outside primary V fields')
    fields = [index for index in range(vertex_count) if ordinary[mask_offset + index * 8 + 4:mask_offset + index * 8 + 8] !=
              candidate[mask_offset + index * 8 + 4:mask_offset + index * 8 + 8]]
    return {'changedBytes': len(changed), 'changedPrimaryVFields': len(fields), 'changedPrimaryVVertexIndices': fields,
            'everyUAndNonMaskByteEqual': True}


def write_products(output, products, protected_roots):
    output = Path(output).resolve()
    require(not any(output.is_relative_to(root) for root in protected_roots), 'Offline output must be outside all source/reference roots')
    if output.exists():
        paths = {path.relative_to(output).as_posix() for path in output.rglob('*') if path.is_file()}
        require(paths == set(products), 'Existing offline patch output file set differs')
        require(all((output / name).read_bytes() == value for name, value in products.items()), 'Existing offline patch output bytes differ')
        return 'unchanged'
    output.mkdir(parents=True)
    for name, value in products.items():
        path = output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value)
    return 'created'


def extract(client, raw, reference, output):
    client_access = require_reference_client(client)
    client, raw, reference, output = (Path(path).resolve() for path in (client, raw, reference, output))
    protected_roots = [client, raw, reference]
    require(not any(output.is_relative_to(root) for root in protected_roots), 'Offline output must be outside all source/reference roots')
    observed, source_data = {}, {}
    def read(path, name, expected=None):
        value = path.read_bytes()
        require(expected is None or sha(value) == expected, 'Offline terrain source hash differs: ' + name)
        observed[name] = pin_bytes(value)
        source_data[path] = value
        return value
    package = Package(read(client_access.require_equal_file('maps/20_20.unr'), 'client/maps/20_20.unr', MAP_SHA), '20_20.unr')
    heights = Package(read(client_access.require_equal_file('textures/T_20_20.utx'), 'client/textures/T_20_20.utx', HEIGHT_SHA), 'T_20_20.utx')
    terrain = json.loads(read(raw / 'terrain.json', 'raw/terrain.json', RAW_TERRAIN_SHA))[0]
    manifest = json.loads(read(reference / 'manifest.json', 'reference/manifest.json', REFERENCE_MANIFEST_SHA))
    old_glb = read(reference / 'terrain.glb', 'reference/terrain.glb', REFERENCE_GLB_SHA)
    native = native_terrain(package)
    require(native['object'].casefold() == '20_20.terraininfo0' and (native['width'], native['height']) == (256, 256), 'Offline native terrain identity differs')
    matches = [item for item in heights.exports if item['object'].casefold() == 't_20_20.height.20_20' and item['className'] == 'Texture']
    require(len(matches) == 1, 'Offline source height texture missing/ambiguous')
    height = read_g16(heights, matches[0])
    mip = height['mips'][0]
    require((mip['width'], mip['height']) == (256, 256) and mip['sha256'] == terrain['height']['mips'][0]['sha256'], 'Offline height mip identity differs')
    samples = struct.unpack('<65536H', mip['raw'])
    points = terrain_points(native, samples)
    oracle = sector_oracle(native, points)
    require(oracle['xyMatches'] == 256, 'Offline source-coordinate oracle differs')
    sector = next(row for row in oracle['sectors'] if row['object'] == SECTOR_OBJECT)
    require(sector['offset'] == [112, 240] and sector['quads'] == [16, 15] and sector['exportIndex'] == 2516,
            'Offline patch source selection differs')
    props, _, _, _ = actor_properties(package, package.exports[native['exportIndex'] - 1])
    words, topology_source = {}, {}
    for name in ('QuadVisibilityBitmap', 'EdgeTurnBitmap', 'QuadVisibilityBitmapOrig', 'EdgeTurnBitmapOrig'):
        values = [prop for prop in props if prop['name'] == name]
        require(len(values) == 1, 'Offline topology source is ambiguous')
        prop = values[0]
        payload = bytes.fromhex(prop['payloadHex'])
        decoded = bitmap_words(payload)
        require(len(decoded['words']) == 2048, 'Offline topology bitmap dimension differs')
        words[name] = decoded['words']
        topology_source[name] = {'payloadOffset': prop['payloadOffset'], 'bytes': len(payload), 'sha256': sha(payload)}
    require(words['QuadVisibilityBitmap'] == words['QuadVisibilityBitmapOrig'] and words['EdgeTurnBitmap'] == words['EdgeTurnBitmapOrig'],
            'Current/original source topology differs; inspect before extension')
    layers = layer_records(terrain, native, package, 'maps/20_20.unr')
    require(qualified_mask_uv_rule(native, manifest['selectedRegion'], package, 'maps/20_20.unr', layers) is not None,
            'Existing original UV scope changed')
    require(qualified_mask_uv_rule(native, sector, package, 'maps/20_20.unr', layers) is None,
            'Adjacent UV qualification changed; re-evaluate comparison labels')
    products, variants, files = {}, {}, {}
    for variant in VARIANTS:
        files[variant], variants[variant] = make_variant(native, sector, points, words, layers, variant)
        products.update({variant + '/' + name: value for name, value in files[variant].items()})
    differences = compare_variants(files['ordinary']['terrain.bin'], files['conditional-corrected']['terrain.bin'],
                                   variants['ordinary']['maskByteOffset'], variants['ordinary']['vertices'])
    old_channels = channel_rows(old_glb)
    seam = []
    for index, y in enumerate(range(240, 256)):
        old_index = (y - 208) * 49 + 48
        new_index = index * 17
        row = {'grid': [112, y], 'referenceVertex': old_index, 'patchVertex': new_index}
        for variant in VARIANTS:
            channels = channel_rows(files[variant]['terrain.glb'])
            for name in ('POSITION', 'NORMAL', 'TEXCOORD_1'):
                require(channels[name][new_index] == old_channels[name][old_index], 'Offline shared-edge geometry/diffuse differs')
            mask = struct.unpack('<2f', channels['TEXCOORD_0'][new_index])
            old_mask = struct.unpack('<2f', old_channels['TEXCOORD_0'][old_index])
            row[variant] = {'maskUV': mask, 'vDifferenceFromReference': mask[1] - old_mask[1]}
        seam.append(row)
    script_root = Path(__file__).resolve().parent
    for name in ('extract-native-terrain-patch.py', 'native_map_geometry.py', 'native_map.py',
                 'native_catalog/ue2.py', 'native_assets_lib/gltf.py'):
        read(script_root / name, 'implementation/' + name)
    report = {'schemaVersion': 1, 'kind': 'offline-native-terrain-patch-comparison', 'sourceSector': sector,
              'sourceHost': 'IMPORTA-PC', 'sourceNativeRoot': 'C:/Lineage2-client',
              'height': {'object': matches[0]['object'], 'exportIndex': matches[0]['exportIndex'],
                         'mip': {key: value for key, value in mip.items() if key != 'raw'}},
              'nativeTerrain': {key: native[key] for key in ('object', 'exportIndex', 'width', 'height', 'toWorld', 'toHeightmap', 'nativePayload')},
              'topologySource': topology_source, 'variants': variants, 'variantBinaryDifference': differences,
              'sharedEdge': {'vertices': 16, 'positionsNormalsAndBaseUV2ByteEqual': True, 'records': seam},
              'sourceIdentities': observed, 'sourceFilesUnchanged': True,
              'productionStaged': False, 'nativeMaskCoordinatesQualified': False, 'nativeVisiblePixelsQualified': False,
              'limitations': ['Conditional formula extension is an experiment, not evidence of new native UV coordinates.',
                              'No native visible pixels, selected draw/resources, shader/material/light or audio parity.',
                              'Original source heights/topology and existing full-map reference normal algorithm; cached Z discrepancy is retained.',
                              'No synthetic 257th height sample, full-rectangle regeneration, prior735-V migration or source repositioning.']}
    products['patch.json'] = json_bytes(report)
    receipt = {'kind': report['kind'], 'sourceIdentities': observed,
               'outputs': {name: pin_bytes(value) for name, value in sorted(products.items())},
               'productionStaged': False, 'nativeMaskCoordinatesQualified': False}
    products['receipt.json'] = json_bytes(receipt)
    require(all(path.read_bytes() == value for path, value in source_data.items()), 'Offline terrain input changed during extraction')
    status = write_products(output, products, protected_roots)
    return {'status': status, 'output': str(output), 'files': len(products), 'vertices': 272, 'triangles': 480,
            'changedPrimaryVFields': differences['changedPrimaryVFields'], 'variantChangedBytes': differences['changedBytes'],
            'receiptSha256': sha(products['receipt.json']), 'productionStaged': False, 'nativeMaskCoordinatesQualified': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--raw', type=Path, required=True)
    parser.add_argument('--reference-section', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    require_reference_client(args.client)
    print(json.dumps(extract(args.client, args.raw, args.reference_section, args.output), indent=2))


if __name__ == '__main__':
    main()
