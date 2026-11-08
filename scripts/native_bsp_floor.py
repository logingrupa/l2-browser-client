#!/usr/bin/env python3
"""Extract the proven 20_20 Brush397 floor from the actual saved Level.Model.

Only this exact package/slab is supported. No native client, converter, external
executable, source edits or live asset staging are performed. Output is stable
and confined to a caller-selected directory under project artifacts/.
"""
import argparse
import copy
from fractions import Fraction
import hashlib
import importlib
import json
import math
from pathlib import Path
import struct
from types import SimpleNamespace

from native_catalog.ue2 import FormatError, Package
from native_assets_lib.gltf import json_bytes
from reference_client_guard import require_reference_client
from native_map import COLLISION, MapSources, actor_properties, property_value

ROOT = Path(__file__).resolve().parent.parent
MAP_SHA = '1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4'
MODEL_SHA = 'be427963ce1dfe4a7bf75f5eae7b09911805023827f175aa0bf9ccb1e7d43653'
GLB_SHA = 'e4f877424832e2c2812c842f45d64b66f7e6431c7ad1a583f9c8a89f87ccf59e'
TEXTURE_SHA = '6744287c6d61d253881def76ce3038e428bab58d65f38a4a36a07f08d165ed4d'
TEXTURE_PACKAGE_SHA = '31bb796ea93c510bbfe155b912a9352811a098e6fa72f0b5e1c264a3f483c234'
TEXTURE_EXPORT_SHA = '675d496f702fc8cb4f2bd6469dc65d6dfa1e0415251cb65c8771f24c1ec92c8b'
ENGINE_SHA = '9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761'
READER_SHA = '572bd29fd5dbe54e369005d502fc05355512535bf99d42a060c81e6d9df3c1cd'
CLASS_SCRIPT_SHA = {
    'Engine.Actor': 'fb3ffb2bc23c3a6887cd3b075ef36ec5a74a7f2e1978370b561eb0a43f40d158',
    'Engine.StaticMeshActor': '36a978b05af6332b193e037a741112f95771c8446527c614cb6e9080141cb989',
}
MATERIAL = 'L2fortress_01_T.Fort01_command_planw'
SELECTED_NODES = (612, 620, 640, 641, 642, 648, 664, 666, 667, 668)
GEOMETRY_ID = 'interlude:20_20.Model798.Brush397'
GLB_RELATIVE = 'map-section-models/c0a585fb17270a11d9890807cc277277872aef74b99f27a2333fb3912ce2464e/model.glb'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(value, message):
    if not value:
        raise FormatError(message)


def pinned_bytes(path, expected):
    data = Path(path).read_bytes()
    require(sha(data) == expected, 'Pinned input changed: ' + str(path))
    return data


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


def difference(a, b):
    return [a[i]-b[i] for i in range(3)]


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


class PackageAdapter:
    def __init__(self, source):
        self.source, self.data, self.path = source, source.data, source.filename
        self.file_version = source.summary['version']
        self.licensee_version = source.summary['licenseeVersion']
        self.exports = [SimpleNamespace(index=e['exportIndex']-1, class_index=e['classIndex'],
            package_index=e['outerIndex'], object_flags=e['flags'], serial_offset=e['offset'],
            serial_size=e['size']) for e in source.exports]

    def name(self, index):
        return self.source.name(index)

    def export_name(self, export):
        return self.source.exports[export.index]['name']

    def require_resolvable_reference(self, reference):
        self.source.object_name(reference)

    def resolve_ref(self, reference):
        self.require_resolvable_reference(reference)
        if reference > 0:
            return self.exports[reference-1]
        if reference < 0:
            return self.source.imports[-reference-1]
        return None


def reviewed_reader():
    directory = ROOT/'scripts/vendor/lineage2elbera_bsp'
    pinned_bytes(directory/'__init__.py', READER_SHA)
    return importlib.import_module('vendor.lineage2elbera_bsp')


def source_nodes(map_data):
    require(sha(map_data) == MAP_SHA, 'Only the qualified original 20_20 map is supported')
    source = Package(map_data, '20_20.unr')
    require((source.summary['version'], source.summary['licenseeVersion']) == (123, 28),
            'Unsupported map version')
    package = PackageAdapter(source)
    reader = reviewed_reader()
    export, binding = reader.level_model_binding(package)
    require(binding['model'] == {'reference': 9184, 'qualified': '20_20.Model798'},
            'Saved Level.Model differs from the qualified model')
    raw = source.data[export.serial_offset:export.serial_offset+export.serial_size]
    require(sha(raw) == MODEL_SHA, 'Qualified final BSP model changed')
    file123_licensee28_extra_field = True
    model = reader._read_model(package, export, file123_licensee28_extra_field)
    checks = reader.validate_model(model)
    selected = []
    for index, node in enumerate(model.nodes):
        surface = model.surfs[node.i_surf]
        if source.object_name(surface.actor) != '20_20.Brush397':
            continue
        require(source.object_name(surface.material) == MATERIAL, 'Slab material identity changed')
        require(node.flags == 0 and surface.flags in (0, 4235264), 'Unqualified slab flags')
        points = [list(model.points[model.verts[node.i_vert_pool+k][0]]) for k in range(node.num_vertices)]
        selected.append({'node': index, 'surface': node.i_surf, 'sourceNodeFlags': node.flags,
            'sourceSurfaceFlags': surface.flags, 'sourcePlane': list(node.plane),
            'sourceSurfacePlane': list(surface.plane), 'sourceMaterial': MATERIAL,
            'sourceBrush': '20_20.Brush397', 'nativePositions': points,
            'nativeTextureBase': list(model.points[surface.p_base]),
            'nativeTextureU': list(model.vectors[surface.v_texture_u]),
            'nativeTextureV': list(model.vectors[surface.v_texture_v]),
            'sourceBrushPolygon': surface.i_brush_poly, 'sourceRenderSection': node.i_section,
            'sourceRenderVertexOffset': node.i_vert_offset, 'sourceLightMap': node.i_light_map})
    require(tuple(n['node'] for n in selected) == SELECTED_NODES, 'Qualified slab node census changed')
    spans = {name: {'offset': a, 'bytes': b-a, 'sha256': sha(source.data[a:b])}
             for name, (a, b) in model.source_spans.items()}
    proof = {'mapSha256': MAP_SHA, 'decodedMapSha256': sha(source.data), 'version': [123, 28],
        'modelSha256': MODEL_SHA, 'modelOffset': export.serial_offset, 'modelBytes': export.serial_size,
        'levelBinding': binding, 'modelSpans': spans, 'modelValidation': checks,
        'modelCounts': {k: len(getattr(model, k)) for k in ('nodes', 'surfs', 'points', 'vectors', 'verts')},
        'readerSha256': READER_SHA, 'readerRevision': '12c9656e2f053b233ec3fd87056491a6a6da8b0c'}
    return source, selected, proof


def extract_texture(glb):
    require(sha(glb) == GLB_SHA, 'Source StaticMesh GLB changed')
    require(struct.unpack_from('<III', glb) == (0x46546c67, 2, len(glb)), 'Invalid GLB header')
    size, kind = struct.unpack_from('<I4s', glb, 12)
    require(kind == b'JSON', 'Missing GLB JSON')
    doc = json.loads(glb[20:20+size])
    bin_size, kind = struct.unpack_from('<I4s', glb, 20+size)
    require(kind == b'BIN\0' and 28+size+bin_size == len(glb), 'Invalid GLB BIN')
    binary = glb[28+size:]
    material = doc['materials'][11]
    require(material['extras']['nativeSourceReference'] == MATERIAL and
            material['extras']['nativeSectionIndex'] == 11, 'Source material slot changed')
    texture = doc['textures'][material['pbrMetallicRoughness']['baseColorTexture']['index']]
    image = doc['images'][texture['source']]
    require(image['mimeType'] == 'image/png' and 'uri' not in image, 'Source PNG is not embedded')
    view = doc['bufferViews'][image['bufferView']]
    require(view['buffer'] == 0, 'Unexpected image buffer')
    start, length = view.get('byteOffset', 0), view['byteLength']
    require(0 <= start <= start+length <= len(binary), 'Image exceeds GLB buffer')
    png = binary[start:start+length]
    require(sha(png) == TEXTURE_SHA, 'Source PNG bytes changed')
    require(png[:8] == b'\x89PNG\r\n\x1a\n' and struct.unpack_from('>II', png, 16) == (256, 256),
            'Source PNG dimensions changed')
    return png, copy.deepcopy(material)


def xzy_reflected_fan_triangle(index):
    return (0, index+1, index)


def polygon_geometry(node, width, height):
    points, normal = node['nativePositions'], node['sourcePlane'][:3]
    require(len(points) in (4, 8) and width > 0 and height > 0, 'Unsupported polygon/dimensions')
    require(all(len(p) == 3 and all(math.isfinite(v) for v in p) for p in points), 'Nonfinite polygon')
    require(abs(dot(normal, normal)-1) < .002, 'Invalid source normal')
    rational = [[Fraction(v) for v in p] for p in points]
    exact_vertex_plane_normal = cross(difference(rational[1], rational[0]), difference(rational[2], rational[0]))
    require(any(exact_vertex_plane_normal) and all(dot(difference(p, rational[0]), exact_vertex_plane_normal) == 0
                                        for p in rational), 'Nonplanar/degenerate polygon')
    for i in range(len(points)):
        edge1 = difference(points[(i+1) % len(points)], points[i])
        edge2 = difference(points[(i+2) % len(points)], points[(i+1) % len(points)])
        require(dot(cross(edge1, edge2), normal) > 0, 'Nonconvex/degenerate/reversed source polygon')
    positions, normals, uvs, indices = [], [], [], []
    for point in points:
        positions.extend(f32(point[i]*.01) for i in (0, 2, 1))
        normals.extend(f32(normal[i]) for i in (0, 2, 1))
        relative = difference(point, node['nativeTextureBase'])
        uvs.extend((f32(dot(relative, node['nativeTextureU'])/width),
                    f32(dot(relative, node['nativeTextureV'])/height)))
    for i in range(1, len(points)-1):
        require(dot(cross(difference(points[i], points[0]), difference(points[i+1], points[0])), normal) > 0,
                'Invalid source fan winding')
        indices.extend(xzy_reflected_fan_triangle(i))
    return positions, normals, uvs, indices


def geometry_from_nodes(nodes):
    result = {'schemaVersion': 1, 'kind': 'native-bsp-floor-geometry', 'id': GEOMETRY_ID,
        'sourceModel': '20_20.Model798', 'sourceBrush': '20_20.Brush397',
        'positions': [], 'normals': [], 'uvs': [], 'indices': [], 'nodeRanges': []}
    for node in nodes:
        p, n, uv, idx = polygon_geometry(node, 256, 256)
        vertex_start, index_start = len(result['positions'])//3, len(result['indices'])
        result['positions'].extend(p); result['normals'].extend(n); result['uvs'].extend(uv)
        result['indices'].extend(vertex_start+i for i in idx)
        result['nodeRanges'].append({**copy.deepcopy(node), 'vertexStart': vertex_start,
            'vertexCount': len(p)//3, 'indexStart': index_start, 'indexCount': len(idx)})
    points = list(zip(*[iter(result['positions'])]*3))
    result['bounds'] = {'min': [min(p[j] for p in points) for j in range(3)],
                        'max': [max(p[j] for p in points) for j in range(3)]}
    result['coordinateRule'] = 'native XYZ -> XZY * 0.01; reverse each source fan triangle once; normals permuted without scaling'
    result['uvRule'] = 'dot(nativePosition - storedTextureBase, storedTextureU/V) / native texture width/height; float32 output, no wrap/clamp rewrite'
    return result


def actor_collision_evidence(source, client_access, bundle, source_material):
    from native_catalog.effects import parse_uc
    pinned_bytes(client_access.require_equal_file('system/Engine.u'), ENGINE_SHA)
    evidence = {}
    for name, expected in CLASS_SCRIPT_SHA.items():
        script = pinned_bytes(bundle/f'map-section/native-defaults/{name}.uc', expected)
        parsed = parse_uc(script.decode('utf-8-sig'), name)
        require(not parsed['unparsed'], 'Unparsed native class defaults')
        evidence[name] = {'defaults': parsed['properties'], 'sourceScriptSha256': expected,
                          'sourcePackageSha256': ENGINE_SHA, 'superClass': parsed['superClass']}
    actor = next(e for e in source.exports if e['object'] == '20_20.StaticMeshActor940')
    require(actor['classObject'] == 'Engine.StaticMeshActor', 'Unexpected shell actor class')
    props, _, _, _ = actor_properties(source, actor)
    resolved = {}
    for name in COLLISION:
        if any(p['name'] == name for p in props):
            resolved[name] = {'value': property_value(props, name), 'source': 'serialized-actor'}
        else:
            for klass in ('Engine.StaticMeshActor', 'Engine.Actor'):
                if name in evidence[klass]['defaults']:
                    resolved[name] = {'value': evidence[klass]['defaults'][name], 'source': klass}
                    break
            else:
                resolved[name] = {'status': 'unresolved'}
    return {'actor': actor['object'], 'exportIndex': actor['exportIndex'], 'resolvedActorFlags': resolved,
        'nativeClassEvidence': evidence, 'sourceStaticMeshSlot': source_material['extras']['nativeSlotProperties'],
        'scope': 'Native declarations retained. No native BSP collision, geodata, live actor state or pathfinding equivalence is asserted.'}


def embedded_glb(geometry, png):
    binary, views, accessors = bytearray(), [], []
    def append(payload):
        binary.extend(b'\0'*(-len(binary) % 4)); offset = len(binary); binary.extend(payload)
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(payload)})
        return len(views)-1
    def accessor(values, dimensions, integers=False, bounds=False):
        view = append(struct.pack('<'+str(len(values))+('I' if integers else 'f'), *values))
        result = {'bufferView': view, 'componentType': 5125 if integers else 5126,
                  'count': len(values)//dimensions, 'type': {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3'}[dimensions]}
        if bounds:
            result.update(min=geometry['bounds']['min'], max=geometry['bounds']['max'])
        accessors.append(result); return len(accessors)-1
    position = accessor(geometry['positions'], 3, bounds=True)
    normal = accessor(geometry['normals'], 3)
    uv = accessor(geometry['uvs'], 2)
    indices = accessor(geometry['indices'], 1, integers=True)
    image_view = append(png)
    material = {'name': MATERIAL, 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0},
                'metallicFactor': 0, 'roughnessFactor': 1},
                'extras': {'nativeSourceReference': MATERIAL, 'nativeBspSource': GEOMETRY_ID,
                           'nativeLightingStatus': 'stored lightmap references preserved in source JSON; lightmap not reproduced'}}
    doc = {'asset': {'version': '2.0', 'generator': 'native_bsp_floor.py'},
        'buffers': [{'byteLength': len(binary)}], 'bufferViews': views, 'accessors': accessors,
        'images': [{'mimeType': 'image/png', 'bufferView': image_view}],
        'textures': [{'source': 0, 'sampler': 0}], 'samplers': [{'wrapS': 10497, 'wrapT': 10497}],
        'materials': [material], 'meshes': [{'name': GEOMETRY_ID, 'primitives': [{'attributes': {
            'POSITION': position, 'NORMAL': normal, 'TEXCOORD_0': uv}, 'indices': indices, 'material': 0}]}],
        'nodes': [{'mesh': 0, 'name': GEOMETRY_ID}], 'scenes': [{'nodes': [0]}], 'scene': 0}
    encoded = json_bytes(doc); encoded += b' '*(-len(encoded) % 4)
    binary.extend(b'\0'*(-len(binary) % 4))
    return (struct.pack('<III', 0x46546c67, 2, 28+len(encoded)+len(binary))+
            struct.pack('<I4s', len(encoded), b'JSON')+encoded+struct.pack('<I4s', len(binary), b'BIN\0')+binary)


def build(client, source_bundle):
    client_access = require_reference_client(client)
    client, source_bundle = Path(client), Path(source_bundle)
    source, nodes, proof = source_nodes(pinned_bytes(client_access.require_equal_file('maps/20_20.unr'), MAP_SHA))
    png, source_material = extract_texture(pinned_bytes(source_bundle/GLB_RELATIVE, GLB_SHA))
    geometry = geometry_from_nodes(nodes)
    require(len(geometry['positions']) == 48*3 and len(geometry['indices']) == 28*3,
            'Selected slab geometry count changed')
    sources = MapSources(client)
    texture_path, texture_package, item = sources.resolve(MATERIAL, 'Texture')
    texture_export_sha = sha(texture_package.data[item['offset']:item['offset']+item['size']])
    require(texture_package.source_hash == TEXTURE_PACKAGE_SHA and texture_export_sha == TEXTURE_EXPORT_SHA,
            'Qualified native floor texture package/export changed')
    geometry['source'] = {**proof, 'sourceGlbSha256': GLB_SHA, 'sourceGlbMaterialSlot': 11,
        'converterSha256': sha(Path(__file__).read_bytes()),
        'sourceReaderSha256': sha((ROOT/'scripts/native_catalog/ue2.py').read_bytes())}
    geometry['material'] = {'sourceReference': MATERIAL, 'textureFile': 'texture.png',
        'textureSha256': TEXTURE_SHA, 'width': 256, 'height': 256,
        'nativeTexturePackage': texture_path, 'nativeTexturePackageSha256': texture_package.source_hash,
        'nativeTextureExportIndex': item['exportIndex'],
        'nativeTextureExportSha256': texture_export_sha}
    geometry['collisionDeclarations'] = actor_collision_evidence(source, client_access, source_bundle, source_material)
    geometry['limitations'] = ['Only the ten qualified final Brush397 nodes of this exact20_20 map are supported.',
        'No native visible pixels or complete map parity is established.',
        'Native source lightmap indices are retained; render/lightmap tail is fingerprinted, not decoded or rendered.',
        'Texture UV projection follows retained BSP source axes and reviewed reader; native render UV buffer is not compared.',
        'Native collision/geodata, audio and full material/lighting behavior remain separate.']
    files = {'bsp-floor.glb': bytes(embedded_glb(geometry, png)), 'bsp-floor.json': json_bytes(geometry), 'texture.png': png}
    manifest = {'schemaVersion': 1, 'kind': 'native-bsp-floor-bundle', 'id': GEOMETRY_ID,
        'sourceModel': geometry['sourceModel'], 'sourceBrush': geometry['sourceBrush'],
        'sourceMapSha256': MAP_SHA, 'counts': {'nodes': 10, 'vertices': 48, 'triangles': 28},
        'files': {name: {'sha256': sha(data), 'bytes': len(data)} for name, data in files.items()},
        'source': geometry['source'], 'limitations': geometry['limitations']}
    files['manifest.json'] = json_bytes(manifest)
    return files


def write_unchanged_or_new(output, files):
    output = Path(output)
    if output.exists():
        require(output.is_dir(), 'Output is not a directory')
        current = {p.name for p in output.iterdir()}
        require(not current or current == set(files), 'Output has unexpected or incomplete files')
        if current:
            require(all((output/name).is_file() and (output/name).read_bytes() == data for name, data in files.items()),
                    'Existing output differs; select a fresh scratch directory')
            return 'unchanged'
    output.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        with (output/name).open('xb') as stream:
            stream.write(data)
    return 'created'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--source-bundle', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    require_reference_client(args.client)
    target = args.output.resolve()
    require(target.is_relative_to((ROOT/'artifacts').resolve()) and target != (ROOT/'artifacts').resolve(),
            'Output must be a dedicated project artifacts/ scratch directory')
    require(not target.is_relative_to(args.client.resolve()) and not target.is_relative_to(args.source_bundle.resolve()),
            'Output must not alter an input tree')
    files = build(args.client, args.source_bundle)
    status = write_unchanged_or_new(target, files)
    print(json.dumps({'status': status, 'output': str(target), 'files': {n: sha(d) for n, d in files.items()}}, indent=2))


if __name__ == '__main__':
    main()
