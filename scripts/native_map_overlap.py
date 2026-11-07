#!/usr/bin/env python3
"""Audit source section overlaps using retained converted meshes; never convert.

Only positive-area indexed triangle projections inside the declared terrain XY
rectangle qualify. This is partial coverage of already converted mesh identities,
not native visibility, collision, an expanded Z policy, or full-world selection.
The default CLI writes JSON to stdout; --output exclusively creates a new report.
"""
import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
import struct
import zipfile

from native_assets import verify_archive
from native_assets_lib.gltf import json_bytes
from native_catalog.ue2 import FormatError
from native_map import (COLLISION, TRANSFORMS, MapSources, actor_properties,
                        decode_property, explicit_properties, file_hash,
                        property_value, safe_path, sha)
from native_map_geometry import (SOURCE_TO_GLTF, gltf_placement,
                                 read_class_evidence, resolved_static_values,
                                 static_matrix)


def require(condition, message):
    if not condition:
        raise FormatError(message)


def finite_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def integer(value, minimum=0):
    return type(value) is int and value >= minimum


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def verify_file(root, relative, expected, checked=None):
    path = safe_path(Path(root), relative)
    digest = expected['sha256'] if isinstance(expected, dict) else expected
    require(isinstance(digest, str) and len(digest) == 64 and
            all(c in '0123456789abcdef' for c in digest), 'Invalid expected file hash')
    require(path.is_file(), 'Missing retained input: ' + str(path))
    if isinstance(expected, dict):
        require(path.stat().st_size == expected['bytes'], 'Input size differs: ' + str(path))
    key = str(path.resolve())
    measured = checked.get(key) if checked is not None else None
    if measured is None:
        measured = file_hash(path)
        if checked is not None:
            checked[key] = measured
    require(measured == digest, 'Input hash differs: ' + str(path))
    return path


def parse_glb(data):
    """Read the bounded static layout actually emitted by our retained converter.

    Unsupported layouts fail rather than producing approximate bounds. Accessor
    strides/offsets are honored; sparse, compressed, transformed or animated mesh
    layouts require a separate implementation before they can be selected.
    """
    require(isinstance(data, bytes) and 28 <= len(data) <= 96*1024*1024,
            'Invalid or oversized GLB')
    require(struct.unpack_from('<III', data) == (0x46546c67, 2, len(data)),
            'Invalid GLB header/length')
    json_size, json_kind = struct.unpack_from('<I4s', data, 12)
    require(json_kind == b'JSON' and json_size % 4 == 0 and 20+json_size+8 <= len(data),
            'Invalid GLB JSON chunk')
    doc = json.loads(data[20:20+json_size])
    bin_size, bin_kind = struct.unpack_from('<I4s', data, 20+json_size)
    require(bin_kind == b'BIN\0' and bin_size % 4 == 0 and 28+json_size+bin_size == len(data),
            'Unsupported extra/missing GLB chunks')
    binary = data[28+json_size:]
    require(doc.get('asset', {}).get('version') == '2.0' and not doc.get('extensionsUsed') and
            not doc.get('extensionsRequired') and not doc.get('extensions') and
            not doc.get('skins') and not doc.get('animations'), 'Unsupported GLB extensions/animation')
    buffers = doc.get('buffers')
    require(isinstance(buffers, list) and len(buffers) == 1 and
            set(buffers[0]) == {'byteLength'} and integer(buffers[0]['byteLength']) and
            0 <= len(binary)-buffers[0]['byteLength'] <= 3, 'Unsupported GLB buffer layout')
    binary = binary[:buffers[0]['byteLength']]
    meshes, nodes, scenes = doc.get('meshes'), doc.get('nodes'), doc.get('scenes')
    require(isinstance(meshes, list) and 0 < len(meshes) <= 1024 and
            isinstance(nodes, list) and len(nodes) == len(meshes) and
            isinstance(scenes, list) and len(scenes) == 1 and doc.get('scene', 0) == 0,
            'Unsupported GLB static scene layout')
    require(all(isinstance(n, dict) and set(n).issubset({'mesh', 'name', 'extras'}) and
                integer(n.get('mesh')) for n in nodes), 'Unsupported GLB node transform/hierarchy')
    require(sorted(n['mesh'] for n in nodes) == list(range(len(meshes))) and
            set(scenes[0]).issubset({'nodes', 'name', 'extras'}) and
            scenes[0].get('nodes') == list(range(len(nodes))),
            'GLB scene must reference each identity mesh exactly once')
    accessors, views = doc.get('accessors'), doc.get('bufferViews')
    require(isinstance(accessors, list) and isinstance(views, list), 'Missing GLB accessors/views')

    def accessor(index, positions=False):
        require(integer(index) and index < len(accessors), 'Invalid accessor index')
        a = accessors[index]
        require(isinstance(a, dict) and not a.get('sparse') and not a.get('extensions') and
                not a.get('normalized') and integer(a.get('bufferView')) and
                a['bufferView'] < len(views), 'Unsupported accessor layout')
        formats = {5126: ('f', 4)} if positions else {5121: ('B', 1), 5123: ('H', 2), 5125: ('I', 4)}
        require(a.get('componentType') in formats and a.get('type') == ('VEC3' if positions else 'SCALAR') and
                integer(a.get('count'), 1) and a['count'] <= 10_000_000,
                'Unsupported position/index accessor')
        fmt, width = formats[a['componentType']]
        dimensions = 3 if positions else 1
        size = width*dimensions
        view = views[a['bufferView']]
        require(isinstance(view, dict) and view.get('buffer') == 0 and not view.get('extensions'),
                'Unsupported buffer view')
        start, length = view.get('byteOffset', 0), view.get('byteLength')
        offset, stride = a.get('byteOffset', 0), view.get('byteStride', size)
        require(all(integer(v) for v in (start, length, offset, stride)) and
                start+length <= len(binary) and stride >= size and stride % width == 0 and
                (start+offset) % width == 0 and offset+(a['count']-1)*stride+size <= length,
                'Accessor exceeds buffer view or has invalid alignment/stride')
        rows = [struct.unpack_from('<'+fmt*dimensions, binary, start+offset+i*stride)
                for i in range(a['count'])]
        if positions:
            require(all(all(finite_number(v) for v in p) for p in rows), 'Nonfinite GLB positions')
        return rows

    result = []
    for mesh_index, mesh in enumerate(meshes):
        require(isinstance(mesh, dict) and not mesh.get('weights') and not mesh.get('extensions') and
                isinstance(mesh.get('primitives'), list) and mesh['primitives'], 'Unsupported GLB mesh')
        for primitive_index, primitive in enumerate(mesh['primitives']):
            require(primitive.get('mode', 4) == 4 and not primitive.get('targets') and
                    not primitive.get('extensions') and isinstance(primitive.get('attributes'), dict) and
                    not any(k.startswith(('JOINTS_', 'WEIGHTS_')) for k in primitive['attributes']),
                    'Unsupported GLB primitive deformation/topology')
            positions = accessor(primitive['attributes'].get('POSITION'), True)
            indices = [row[0] for row in accessor(primitive.get('indices'))]
            require(len(indices) % 3 == 0 and all(i < len(positions) for i in indices),
                    'Invalid triangle indices')
            result.append({'mesh': mesh_index, 'primitive': primitive_index,
                           'positions': positions, 'indices': indices})
    return result


def transform_positions(positions, matrix):
    require(len(matrix) == 16 and all(finite_number(v) for v in matrix) and
            [matrix[i] for i in (3, 7, 11, 15)] == [0, 0, 0, 1], 'Invalid affine placement matrix')
    require(all(len(p) == 3 and all(finite_number(v) for v in p) for p in positions),
            'Invalid local positions')
    result = [[sum(p[k]*matrix[k*4+i] for k in range(3))+matrix[12+i] for i in range(3)]
              for p in positions]
    require(all(all(finite_number(v) for v in p) for p in result), 'Nonfinite transformed positions')
    return result


def triangle_rectangle_overlap(triangle, rectangle):
    """Clip a glTF triangle against native-XY-as-glTF-XZ rectangle, without fitting.

    Return the clipped polygon and its projected area. Edge/point contacts and
    triangles with zero projected area do not qualify. Binary64 arithmetic and
    strict area > 0 are documented selection semantics, not parity tolerances.
    """
    require(len(triangle) == 3 and all(len(p) == 3 and all(finite_number(v) for v in p)
                                     for p in triangle), 'Invalid triangle')
    require(len(rectangle) == 4 and all(finite_number(v) for v in rectangle) and
            rectangle[0] < rectangle[2] and rectangle[1] < rectangle[3], 'Invalid XY rectangle')
    poly = [list(p) for p in triangle]
    for axis, boundary, sign in ((0, rectangle[0], 1), (0, rectangle[2], -1),
                                 (2, rectangle[1], 1), (2, rectangle[3], -1)):
        clipped = []
        for a, b in zip(poly, poly[1:]+poly[:1]):
            inside_a, inside_b = (a[axis]-boundary)*sign >= 0, (b[axis]-boundary)*sign >= 0
            if inside_a:
                clipped.append(a)
            if inside_a != inside_b:
                fraction = (boundary-a[axis])/(b[axis]-a[axis])
                point = [a[i]+fraction*(b[i]-a[i]) for i in range(3)]
                point[axis] = boundary
                clipped.append(point)
        poly = clipped
        if not poly:
            return [], 0.0
    # Subtract one origin before cross products to avoid cancellation from large
    # world offsets. This preserves the selection rule without a fitted epsilon.
    origin = poly[0]
    area = abs(sum((a[0]-origin[0])*(b[2]-origin[2])-(b[0]-origin[0])*(a[2]-origin[2])
                   for a, b in zip(poly, poly[1:]+poly[:1])))/2
    require(finite_number(area), 'Nonfinite clipped polygon area')
    return (poly, area) if area > 0 else ([], 0.0)


def source_placement(actor, model, evidence):
    values = resolved_static_values(actor, evidence)
    matrix = gltf_placement(static_matrix(values))
    transform_positions([], matrix)
    return {'id': actor['id'], 'sourceMesh': actor['staticMesh']['object'], 'modelId': model['id'],
            'matrix': matrix, 'sourceLocation': values['Location']['value'],
            'materialOverrides': actor['materialOverrides']}


def select_overlaps(actors, runtime, geometry, model_loader):
    """Pure deterministic selection; caller must verify inputs before production use.

    model_loader(model-record) returns parse_glb() primitives. Existing runtime
    placements are never changed. Unknown model identities are counted explicitly.
    """
    region = geometry.get('selectedRegion', geometry.get('selectedSector', {}))
    bounds = region.get('bounds')
    require(isinstance(bounds, list) and len(bounds) == 6 and all(finite_number(v) for v in bounds),
            'Missing source section bounds')
    rectangle = [bounds[0]*.01, bounds[1]*.01, bounds[3]*.01, bounds[4]*.01]
    require(rectangle[0] < rectangle[2] and rectangle[1] < rectangle[3], 'Reversed section bounds')
    z_window = geometry['recipe']['staticActorOriginZ']
    require(isinstance(z_window, list) and len(z_window) == 2 and all(finite_number(v) for v in z_window) and
            z_window[0] < z_window[1], 'Invalid source Z policy')
    evidence = geometry['nativeDefaultEvidence']
    models = {}
    for model in runtime['models']:
        key = model['sourceObject'].casefold()
        require(key not in models and model['id'] == 'interlude:'+model['sourceObject'],
                'Duplicate/mismatched runtime model identity')
        models[key] = model
    by_id = {a['id']: a for a in actors}
    require(len(by_id) == len(actors), 'Duplicate raw actor identity')
    existing = {}
    for placed in runtime['placements']:
        require(placed['id'] not in existing and placed['id'] in by_id, 'Invalid existing placement identity')
        actor = by_id[placed['id']]
        model = models.get(actor['staticMesh']['object'].casefold())
        require(model is not None and source_placement(actor, model, evidence) == placed,
                'Existing placement differs from retained source: '+placed['id'])
        existing[placed['id']] = placed
    census = defaultdict(int)
    categories = defaultdict(lambda: defaultdict(list))
    cache, additions, witnesses = {}, [], []
    for actor in sorted(actors, key=lambda a: a['exportIndex']):
        if actor['class'] != 'StaticMeshActor':
            continue
        require(actor['classObject'] == 'Engine.StaticMeshActor' and actor['id'] == 'interlude:'+actor['object'],
                'Unsupported static actor class/identity')
        census['allStaticActors'] += 1
        location = actor['sourceTransform']['Location'].get('value')
        require(isinstance(location, dict) and set(location) == set('XYZ') and
                all(finite_number(v) for v in location.values()), 'Static actor lacks finite serialized origin')
        source = actor['staticMesh']['object']
        require(isinstance(source, str) and source.count('.') >= 1, 'Missing qualified static mesh')
        if not z_window[0] <= location['Z'] <= z_window[1]:
            census['outsideSourceZWindow'] += 1
            categories['excludedSourceZ'][source].append(actor['id'])
            continue
        census['withinSourceZWindow'] += 1
        if bounds[0] <= location['X'] <= bounds[3] and bounds[1] <= location['Y'] <= bounds[4]:
            require(actor['id'] in existing, 'Existing source-origin placement missing: '+actor['id'])
            census['originInsideXY'] += 1
            categories['retainedOriginInsideXY'][source].append(actor['id'])
            continue
        census['originOutsideXYWithinZ'] += 1
        model = models.get(source.casefold())
        if model is None:
            census['notEvaluatedMissingConvertedModel'] += 1
            categories['notEvaluatedMissingConvertedModel'][source].append(actor['id'])
            continue
        census['evaluatedOutsideOrigins'] += 1
        categories['evaluatedOutsideOrigins'][source].append(actor['id'])
        key = source.casefold()
        if key not in cache:
            cache[key] = model_loader(model)
        placed = source_placement(actor, model, evidence)
        hits, first, world_points = 0, None, []
        for primitive in cache[key]:
            vertices = transform_positions(primitive['positions'], placed['matrix'])
            indices = primitive['indices']
            world_points.extend(vertices)
            if (max(p[0] for p in vertices) < rectangle[0] or min(p[0] for p in vertices) > rectangle[2] or
                    max(p[2] for p in vertices) < rectangle[1] or min(p[2] for p in vertices) > rectangle[3]):
                continue
            for offset in range(0, len(indices), 3):
                vertex_indices = indices[offset:offset+3]
                triangle = [vertices[i] for i in vertex_indices]
                polygon, area = triangle_rectangle_overlap(triangle, rectangle)
                if area > 0:
                    hits += 1
                    if first is None:
                        first = {'mesh': primitive['mesh'], 'primitive': primitive['primitive'],
                                 'triangle': offset//3, 'vertexIndices': vertex_indices,
                                 'worldTriangleGltf': triangle, 'clippedPolygonGltf': polygon,
                                 'projectedAreaSquareMetres': area}
        if not hits:
            census['evaluatedNoPositiveAreaIntersection'] += 1
            continue
        census['positiveAreaIntersectingActors'] += 1
        categories['positiveAreaIntersectingActors'][source].append(actor['id'])
        if actor['id'] not in existing:
            additions.append(placed)
        witnesses.append({'actorId': actor['id'], 'exportIndex': actor['exportIndex'],
                          'sourceMesh': source, 'sourceLocation': location, 'alreadyPresent': actor['id'] in existing,
                          'modelSha256': model['model']['sha256'], 'modelFile': model['model']['file'],
                          'intersectingTriangles': hits,
                          'worldBoundsGltf': [min(p[i] for p in world_points) for i in range(3)]+
                                             [max(p[i] for p in world_points) for i in range(3)],
                          'firstTriangle': first})
    for key in ('outsideSourceZWindow', 'withinSourceZWindow', 'originInsideXY', 'originOutsideXYWithinZ',
                'notEvaluatedMissingConvertedModel', 'evaluatedOutsideOrigins',
                'evaluatedNoPositiveAreaIntersection', 'positiveAreaIntersectingActors'):
        census[key] += 0
    census.update(existingPlacements=len(existing), additivePlacements=len(additions),
                  resultingPlacements=len(existing)+len(additions), knownConvertedModels=len(models))
    return {'schemaVersion': 1, 'kind': 'native-map-known-mesh-overlap-audit',
            'selection': {'sourceXYRectangle': [bounds[0], bounds[1], bounds[3], bounds[4]],
                          'sourceActorOriginZ': z_window, 'gltfXZRectangle': rectangle,
                          'rule': 'positive projected area after indexed triangle clipping; original Z-origin policy unchanged',
                          'arithmetic': 'binary64, strict area > 0, translated cross products; no fitted tolerance'},
            'census': dict(census), 'modelsByDisposition': {
                category: [{'sourceObject': source, 'actorCount': len(ids), 'actorIds': ids}
                           for source, ids in sorted(rows.items())]
                for category, rows in sorted(categories.items())},
            'additions': additions, 'witnesses': witnesses,
            'limits': ['Partial known-converted-mesh coverage; missing mesh identities are not inferred or converted.',
                       'Native visibility, material pixels, collision and whole-world completeness are unverified.',
                       'Zero projected-area vertical faces and edge/point-only contacts do not qualify.',
                       'Source transforms reuse existing declared defaults and UE2 formula; native floating-point placement parity remains unverified.',
                       'No terrain geometry, UV/UV2, source asset, authored record or native state is changed by this audit.']}


def audit_overlap(client_root, raw_root, runtime_manifest_path, class_evidence_root, *,
                  expected_runtime_sha256, recipe_path=None):
    """Verify retained evidence and return selection, without extraction or writes."""
    client, raw = Path(client_root).resolve(), Path(raw_root).resolve()
    runtime_path = Path(runtime_manifest_path).resolve()
    runtime_root, bundle = runtime_path.parent, runtime_path.parent.parent
    checked = {}
    verify_file(runtime_root, runtime_path.name, expected_runtime_sha256, checked)
    runtime = read_json(runtime_path)
    require(runtime.get('kind') == 'native-map-section-runtime' and not runtime.get('errors') and
            runtime.get('resourceRoots') == {'models': '../map-section-models', 'terrain': '../map-section'},
            'Unsupported section resource roots/status')
    section, model_root = safe_path(bundle, 'map-section'), safe_path(bundle, 'map-section-models')
    geometry = read_json(section/'manifest.json')
    section_receipt, runtime_receipt = read_json(section/'receipt.json'), read_json(runtime_root/'receipt.json')
    require(section_receipt.get('kind') == 'native-terrain-section' and
            runtime_receipt.get('kind') == 'native-map-section-runtime' and
            runtime_receipt['manifestSha256'] == expected_runtime_sha256 and
            runtime_receipt['sectionReceiptSha256'] == file_hash(section/'receipt.json'),
            'Section/runtime receipt identity mismatch')
    for relative, expected in section_receipt['outputs'].items():
        verify_file(section, relative, expected, checked)
    for relative, expected in section_receipt['sourceDependencies'].items():
        verify_file(client, relative, expected, checked)
    require(sha(json_bytes(geometry['recipe'])) == section_receipt['recipeSha256'], 'Section recipe mismatch')
    if recipe_path is not None:
        require(read_json(recipe_path) == geometry['recipe'], 'Selected recipe differs from retained section')
    verify_file(section, runtime['terrain']['file'], runtime['terrain'], checked)

    raw_receipt, raw_manifest = read_json(raw/'receipt.json'), read_json(raw/'manifest.json')
    require(raw_receipt.get('kind') == 'native-map-raw' and raw_manifest.get('kind') == 'native-map-raw' and
            not raw_manifest.get('unsupported'), 'Raw source inventory is incomplete/unsupported')
    for root, table in ((raw, raw_receipt['outputs']), (client, raw_receipt['dependencies'])):
        for relative, expected in table.items():
            verify_file(root, relative, expected, checked)
    require(sha(json_bytes(raw_manifest['recipe'])) == raw_receipt['recipeSha256'], 'Raw recipe mismatch')
    source_map = raw_manifest['recipe']['map']
    source_hash = raw_manifest['sourcePackageSha256']
    require(section_receipt['sourceDependencies'].get(source_map) == source_hash and
            raw_receipt['dependencies'][source_map]['sha256'] == source_hash, 'Raw/section source map differs')
    sources = MapSources(client)
    package = sources.get(source_map)
    require(package.source_hash == source_hash and package.data == safe_path(raw, raw_manifest['files']['rawMap']).read_bytes(),
            'Raw unwrapped map differs from verified native package')
    actors = read_json(safe_path(raw, raw_manifest['files']['actors']))
    by_export = {a['exportIndex']: a for a in actors}
    require(len(by_export) == len(actors), 'Duplicate raw actor export')
    # Verify the actor projection actually used by this selection against native
    # tagged properties. Retained exporter version changes are not a reason to
    # regenerate terrain or overwrite source artifacts.
    static_exports = [e for e in package.exports if e['classObject'] == 'Engine.StaticMeshActor']
    require(len(static_exports) == sum(a['class'] == 'StaticMeshActor' for a in actors), 'Static source census differs')
    for item in static_exports:
        actor = by_export.get(item['exportIndex'])
        require(actor is not None and actor['object'] == item['object'] and actor['classObject'] == item['classObject'],
                'Raw actor export identity differs')
        props, _, _, _ = actor_properties(package, item)
        props = [decode_property(package, prop, raw_manifest['files']['rawMap']) for prop in props]
        require(actor['sourceTransform'] == explicit_properties(props, TRANSFORMS) and
                actor['collision'] == explicit_properties(props, COLLISION) and
                actor['staticMesh'] == property_value(props, 'StaticMesh') and
                actor['materialOverrides'] == [p for p in props if p['name'] in ('Skins', 'Texture')],
                'Retained actor transform/reference differs from source tags: '+item['object'])

    defaults = Path(class_evidence_root).resolve()
    for name in ('Engine.Actor', 'Engine.StaticMeshActor', 'Engine.TerrainInfo'):
        require(safe_path(defaults, name+'/defaults.json').is_file(), 'Missing retained class defaults; extraction forbidden')
    evidence = read_class_evidence(client, defaults, reusable=defaults)
    evidence_without_scripts = {name: {k: v for k, v in row.items() if k != 'sourceScript'}
                                for name, row in evidence.items()}
    require(evidence_without_scripts == geometry['nativeDefaultEvidence'], 'Section/native default evidence differs')

    parsed = {}
    for model in runtime['models']:
        require(model['id'] == 'interlude:'+model['sourceObject'], 'Model/source identity mismatch')
        glb = verify_file(model_root, model['model']['file'], model['model'], checked)
        archive_path = verify_file(model_root, model['archive']['file'], model['archive'], checked)
        require(runtime_receipt['modelArchives'].get(model['archive']['file']) == model['archive']['sha256'],
                'Runtime model archive receipt mismatch')
        verified = verify_archive(archive_path)
        require(verified['id'] == model['id'] and verified['kind'] == 'model', 'Wrong archive model identity')
        with zipfile.ZipFile(archive_path) as archive:
            asset = json.loads(archive.read('asset.json'))
            provenance = json.loads(archive.read('provenance.json'))
            require(archive.read('model.glb') == glb.read_bytes() and asset['source']['object'] == model['sourceObject'] and
                    asset['model']['sourceToGltf'] == SOURCE_TO_GLTF and asset['model']['unit'] == 'metre' and
                    asset['model']['sourceUnitsPerMetre'] == 100, 'Model bytes/source coordinate basis differ')
            for relative, expected in provenance['dependencies'].items():
                verify_file(client, relative, expected, checked)
            _, mesh_package, mesh_item = sources.resolve(model['sourceObject'], 'StaticMesh')
            require(mesh_package.source_hash == asset['source']['sha256'] and mesh_item['object'] == model['sourceObject'],
                    'Converted model source package/object differs')
        parsed[model['sourceObject'].casefold()] = parse_glb(glb.read_bytes())
    report = select_overlaps(actors, runtime, geometry, lambda m: parsed[m['sourceObject'].casefold()])
    report['provenance'] = {'sourceMap': source_map, 'sourceMapSha256': source_hash,
                            'rawActorsSha256': file_hash(safe_path(raw, raw_manifest['files']['actors'])),
                            'rawReceiptSha256': file_hash(raw/'receipt.json'),
                            'sectionOriginalRawReceiptSha256': section_receipt['rawMapReceiptSha256'],
                            'rawReceiptRelationship': 'same map independently reparsed; historical raw receipts may differ',
                            'sectionManifestSha256': file_hash(section/'manifest.json'),
                            'runtimeManifestSha256': expected_runtime_sha256,
                            'recipeSha256': sha(json_bytes(geometry['recipe'])),
                            'scriptSha256': file_hash(Path(__file__)),
                            'transformImplementationSha256': file_hash(Path(__file__).with_name('native_map_geometry.py')),
                            'verifiedInputs': [{'path': name, 'sha256': value} for name, value in sorted(checked.items())]}
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', required=True)
    parser.add_argument('--raw', required=True)
    parser.add_argument('--runtime-manifest', required=True)
    parser.add_argument('--runtime-sha256', required=True)
    parser.add_argument('--class-evidence', required=True)
    parser.add_argument('--recipe')
    parser.add_argument('--output', help='Exclusive new scratch JSON report; omitted means stdout only')
    args = parser.parse_args()
    report = audit_overlap(args.client, args.raw, args.runtime_manifest, args.class_evidence,
                           expected_runtime_sha256=args.runtime_sha256, recipe_path=args.recipe)
    payload = json_bytes(report)
    if args.output:
        output = Path(args.output).resolve()
        for protected in (Path(args.client).resolve(), Path(args.raw).resolve(),
                          Path(args.runtime_manifest).resolve().parent.parent,
                          Path(args.class_evidence).resolve()):
            require(not output.is_relative_to(protected), 'Report must stay outside protected inputs')
        require(output.parent.is_dir(), 'Create the destination scratch directory explicitly first')
        with output.open('xb') as stream:
            stream.write(payload)
    else:
        print(payload.decode('utf-8'))


if __name__ == '__main__':
    main()
