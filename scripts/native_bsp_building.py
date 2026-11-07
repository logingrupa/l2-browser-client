#!/usr/bin/env python3
"""Recover the original command hall's missing room shell from saved Level.Model.

Qualified 20_20 Brush610 only. Reuse pinned, already converted original textures;
never invoke a native client or overwrite the static meshes/terrain/Editor scene.
"""
import argparse
import copy
from fractions import Fraction
import json
from pathlib import Path
import struct

from native_assets_lib.gltf import json_bytes
from native_bsp_floor import (ROOT, MAP_SHA, MODEL_SHA, GLB_SHA, GLB_RELATIVE,
    TEXTURE_PACKAGE_SHA, PackageAdapter, cross, difference, dot, f32,
    pinned_bytes, require, reviewed_reader, sha, source_nodes, write_unchanged_or_new)
from native_map import MapSources

BRUSH = '20_20.Brush610'
SUPPORT = 'interlude:20_20.StaticMeshActor1913'
PARTS = {
    'walls': {'nodes': (1448, 1449, 1451, 1452, 1454, 1455, 1458, 1459),
        'material': 'L2fortress_01_T.Fort01_deffense_wall01', 'slot': 0,
        'glb': GLB_RELATIVE, 'glbSha256': GLB_SHA,
        'textureSha256': '09dc1510d8017f3dd0c3fbcac7cf98e9e7d87f09de00959d7273e955f8d3699a',
        'exportSha256': '1791675a9de3ff958b0598c225ef8cc604e0045054ab9ce0cf72830b5283ab59'},
    'floor': {'nodes': (1457,), 'material': 'L2fortress_01_T.Fort01_command_planw', 'slot': 11,
        'glb': GLB_RELATIVE, 'glbSha256': GLB_SHA,
        'textureSha256': '6744287c6d61d253881def76ce3038e428bab58d65f38a4a36a07f08d165ed4d',
        'exportSha256': '675d496f702fc8cb4f2bd6469dc65d6dfa1e0415251cb65c8771f24c1ec92c8b'},
    'ceiling': {'nodes': (1456,), 'material': 'L2fortress_01_T.fort_wsquare_bwall', 'slot': 9,
        'glb': 'map-section-models/c336148c8c2423fc6f188ab984c4ffc6a312e62516ba3445b41b5aa6fb599e7e/model.glb',
        'glbSha256': 'f83f8903ab299075eaae8983d4f5fc3fd6eb3d7ff121985dad45d5e234c7bd74',
        'textureSha256': 'f98adcdfde88c93dab9b0cd3a4db7d037c941b8e5edaf0df7f8aa419b8e632ef',
        'exportSha256': 'aa0cb30617fcbb3fade1e7b2c39edd842a729043f271d28d0ebea212ad1c354a'},
}


def convex_triangles(points, normal):
    """Exact convex triangulation retaining collinear native boundary vertices.

    A simple fan creates zero-area triangles on these saved CSG polygons. Ears
    containing another boundary point are deferred; no vertex is moved/dropped.
    """
    require(3 <= len(points) <= 64 and len({tuple(p) for p in points}) == len(points),
            'Unsupported/duplicate BSP polygon vertices')
    q = [[Fraction(v) for v in p] for p in points]
    plane = next((cross(difference(q[i], q[0]), difference(q[i+1], q[0]))
                  for i in range(1, len(q)-1)
                  if any(cross(difference(q[i], q[0]), difference(q[i+1], q[0])))), None)
    require(plane is not None and all(dot(difference(p, q[0]), plane) == 0 for p in q),
            'Nonplanar/degenerate BSP polygon')
    require(dot(plane, normal) > 0, 'Reversed BSP polygon')
    turn = lambda a, b, c: dot(cross(difference(q[b], q[a]), difference(q[c], q[b])), plane)
    require(all(turn(i-1, i, (i+1) % len(q)) >= 0 for i in range(len(q))),
            'Nonconvex BSP polygon')
    remaining, result = list(range(len(q))), []
    while len(remaining) > 3:
        for k, b in enumerate(remaining):
            a, c = remaining[k-1], remaining[(k+1) % len(remaining)]
            if turn(a, b, c) <= 0:
                continue
            if any(all(turn(u, v, p) >= 0 for u, v in ((a, b), (b, c), (c, a)))
                   for p in remaining if p not in (a, b, c)):
                continue
            result.extend((a, c, b))  # one XZY reflection
            del remaining[k]
            break
        else:
            raise ValueError('Cannot triangulate the exact convex source boundary')
    require(turn(*remaining) > 0, 'Degenerate final BSP triangle')
    result.extend((remaining[0], remaining[2], remaining[1]))
    return result


def building_nodes(map_data):
    source, _, proof = source_nodes(map_data)  # retain existing strict map/model/reader pins
    adapter, reader = PackageAdapter(source), reviewed_reader()
    export, _ = reader.level_model_binding(adapter)
    model = reader._read_model(adapter, export, True)
    selected = []
    for index, node in enumerate(model.nodes):
        surface = model.surfs[node.i_surf]
        if source.object_name(surface.actor) != BRUSH:
            continue
        require(node.flags == surface.flags == 0, 'Building source flags changed')
        selected.append({'node': index, 'surface': node.i_surf, 'sourceBrush': BRUSH,
            'sourceMaterial': source.object_name(surface.material), 'sourceNodeFlags': node.flags,
            'sourceSurfaceFlags': surface.flags, 'sourcePlane': list(node.plane),
            'sourceSurfacePlane': list(surface.plane), 'nativePositions': [list(model.points[
                model.verts[node.i_vert_pool+k][0]]) for k in range(node.num_vertices)],
            'nativeTextureBase': list(model.points[surface.p_base]),
            'nativeTextureU': list(model.vectors[surface.v_texture_u]),
            'nativeTextureV': list(model.vectors[surface.v_texture_v]),
            'sourceBrushPolygon': surface.i_brush_poly, 'sourceRenderSection': node.i_section,
            'sourceRenderVertexOffset': node.i_vert_offset, 'sourceLightMap': node.i_light_map})
    require(tuple(row['node'] for row in selected) == tuple(sorted(
        index for part in PARTS.values() for index in part['nodes'])), 'Building final-node census changed')
    return selected, proof


def original_texture(client, bundle, part):
    raw = pinned_bytes(Path(bundle)/part['glb'], part['glbSha256'])
    size = struct.unpack_from('<I', raw, 12)[0]
    doc, binary = json.loads(raw[20:20+size]), raw[28+size:]
    material = doc['materials'][part['slot']]
    require(material['extras']['nativeSourceReference'] == part['material'] and
            material.get('alphaMode', 'OPAQUE') == 'OPAQUE', 'Source material binding changed')
    texture = doc['textures'][material['pbrMetallicRoughness']['baseColorTexture']['index']]
    image = doc['images'][texture['source']]
    require(image['mimeType'] == 'image/png' and 'uri' not in image, 'Expected original embedded PNG')
    view = doc['bufferViews'][image['bufferView']]
    png = binary[view.get('byteOffset', 0):view.get('byteOffset', 0)+view['byteLength']]
    require(sha(png) == part['textureSha256'], 'Original texture bytes changed')
    path, package, item = MapSources(client).resolve(part['material'], 'Texture')
    require(package.source_hash == TEXTURE_PACKAGE_SHA and
            sha(package.data[item['offset']:item['offset']+item['size']]) == part['exportSha256'],
            'Native texture package/export changed')
    return png, {'sourceReference': part['material'], 'textureSha256': sha(png),
        'width': struct.unpack_from('>I', png, 16)[0], 'height': struct.unpack_from('>I', png, 20)[0],
        'nativeTexturePackage': path, 'nativeTexturePackageSha256': package.source_hash,
        'nativeTextureExportIndex': item['exportIndex'], 'nativeTextureExportSha256': part['exportSha256'],
        'sourceGlb': part['glb'], 'sourceGlbSha256': part['glbSha256'], 'sourceGlbMaterialSlot': part['slot']}


def geometry(nodes, part_name, material):
    result = {'schemaVersion': 1, 'kind': 'native-bsp-building-geometry',
        'id': 'interlude:20_20.Model798.Brush610.'+part_name, 'sourceModel': '20_20.Model798',
        'sourceBrush': BRUSH, 'positions': [], 'normals': [], 'uvs': [], 'indices': [], 'nodeRanges': []}
    for row in nodes:
        points, normal = row['nativePositions'], row['sourcePlane'][:3]
        start, index_start = len(result['positions'])//3, len(result['indices'])
        indices = convex_triangles(points, normal)
        for p in points:
            result['positions'].extend(f32(p[i]*.01) for i in (0, 2, 1))
            result['normals'].extend(f32(normal[i]) for i in (0, 2, 1))
            relative = difference(p, row['nativeTextureBase'])
            result['uvs'].extend((f32(dot(relative, row['nativeTextureU'])/material['width']),
                                  f32(dot(relative, row['nativeTextureV'])/material['height'])))
        result['indices'].extend(start+i for i in indices)
        result['nodeRanges'].append({**copy.deepcopy(row), 'vertexStart': start, 'vertexCount': len(points),
                                    'indexStart': index_start, 'indexCount': len(indices)})
    result['bounds'] = {name: [fn(result['positions'][axis::3]) for axis in range(3)]
                        for name, fn in (('min', min), ('max', max))}
    result['coordinateRule'] = 'native XYZ -> XZY * 0.01; reverse source triangle winding once; preserve normals'
    result['uvRule'] = 'dot(nativePosition - nativeTextureBase, nativeTextureU/V) / original texture dimensions; float32'
    result['material'] = material
    return result


def embedded_glb(g, png):
    # The existing one-material BSP writer already preserves all float32 channels.
    from native_bsp_floor import embedded_glb as floor_glb
    raw = floor_glb(g, png)
    size = struct.unpack_from('<I', raw, 12)[0]
    doc, binary = json.loads(raw[20:20+size]), raw[28+size:]
    doc['asset']['generator'] = 'native_bsp_building.py'
    mat = doc['materials'][0]
    mat['name'] = mat['extras']['nativeSourceReference'] = g['material']['sourceReference']
    mat['extras']['nativeBspSource'] = g['id']
    doc['meshes'][0]['name'] = doc['nodes'][0]['name'] = g['id']
    encoded = json_bytes(doc); encoded += b' '*(-len(encoded) % 4)
    return (struct.pack('<III', 0x46546c67, 2, 28+len(encoded)+len(binary))+
            struct.pack('<I4s', len(encoded), b'JSON')+encoded+struct.pack('<I4s', len(binary), b'BIN\0')+binary)


def build(client, bundle):
    nodes, proof = building_nodes(pinned_bytes(Path(client)/'maps/20_20.unr', MAP_SHA))
    files, resources = {}, []
    for name, part in PARTS.items():
        png, material = original_texture(client, bundle, part)
        selected = [n for n in nodes if n['node'] in part['nodes']]
        require(all(n['sourceMaterial'] == part['material'] for n in selected), 'Building material census changed')
        g = geometry(selected, name, material)
        g['source'] = {**proof, 'converterSha256': sha(Path(__file__).read_bytes())}
        g['limitations'] = ['Only the ten final Brush610 nodes in this pinned map are qualified.',
            'Native lightmap references retained; lightmaps and complete native material/lighting parity remain unimplemented.',
            'BSP UVs follow original projection vectors; native submitted render UVs have not been compared.',
            'Original door cutouts retained. Native doors, antiportals, geodata and complete map coverage remain separate.']
        stem = 'bsp-command-'+name
        files[stem+'.json'], files[stem+'.glb'], files[stem+'.png'] = json_bytes(g), embedded_glb(g, png), png
        resources.append({'id': g['id'], 'sourceModel': g['sourceModel'], 'sourceBrush': BRUSH,
            'sourceMapSha256': MAP_SHA, 'supportPlacementIds': [SUPPORT],
            'model': {'file': stem+'.glb', 'sha256': sha(files[stem+'.glb']), 'bytes': len(files[stem+'.glb'])},
            'source': {'file': stem+'.json', 'sha256': sha(files[stem+'.json']), 'bytes': len(files[stem+'.json'])}})
    files['manifest.json'] = json_bytes({'schemaVersion': 1, 'kind': 'native-bsp-building-bundle',
        'sourceModel': '20_20.Model798', 'sourceBrush': BRUSH, 'sourceMapSha256': MAP_SHA,
        'counts': {'nodes': 10, 'vertices': 52, 'triangles': 32}, 'resources': resources,
        'files': {name: {'sha256': sha(data), 'bytes': len(data)} for name, data in files.items()}})
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--source-bundle', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    target = args.output.resolve()
    require(target.is_relative_to(ROOT/'artifacts') and target != ROOT/'artifacts', 'Use dedicated artifacts scratch')
    require(not any(target.is_relative_to(p.resolve()) or p.resolve().is_relative_to(target)
                    for p in (args.client, args.source_bundle)), 'Output overlaps input')
    files = build(args.client, args.source_bundle)
    print(json.dumps({'status': write_unchanged_or_new(target, files), 'output': str(target),
                      'manifestSha256': sha(files['manifest.json'])}, indent=2))


if __name__ == '__main__':
    main()
