#!/usr/bin/env python3
import argparse
import json
import math
import os
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import zipfile

from native_assets_lib.gltf import json_bytes
from native_catalog.ue2 import FormatError, Package
from native_map import file_hash, require_lock_equal_client_path, safe_path, sha, verify_map, MapSources, static_mesh_request
from reference_client_guard import require_reference_client
from world.gltf_builder import glb_structure
from world.native_terrain_sectors import (BOUND_TOLERANCE, bit, native_terrain, read_height_samples, read_topology_words, sector_oracle,
    select_terrain_sectors, source_backed_terrain_points)
from world.section_static_models import static_model_limit, static_model_policies, validate_static_requests
from world.static_placement import (gltf_placement, read_class_evidence, require_terrain_not_inverted, resolved_static_values,
    static_matrix)
from world.surface_spawn_candidate import surface_spawn_candidate
from world.terrain_coordinates import SOURCE_TO_GLTF, xyz
from world.terrain_layers import UV_TOLERANCE, layer_records, qualified_mask_uv_rule
from world.terrain_rectangle_mesh import build_terrain_rectangle_gltf, rectangle_source_points

TERRAIN_SECTION_MIGRATION_DESCRIPTION = ('Source-backed UE123/28 terrain section and static placement migration. '
    'No native client or source package is modified. The native TerrainInfo FCoords are the position oracle; '
    'serialized sector bounds are checked independently. Materials remain editable source relationships: '
    "this tool does not certify Lineage's terrain blending, lighting, navigation or native visual parity.")
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
GEOMETRY_WORLD_MODULE_PATHS = ('world/map_actor_properties.py', 'world/map_sources.py', 'world/terrain_coordinates.py',
                               'world/native_terrain_sectors.py', 'world/terrain_layers.py', 'world/gltf_builder.py',
                               'world/static_placement.py', 'world/terrain_rectangle_mesh.py', 'world/surface_spawn_candidate.py',
                               'world/section_static_models.py', 'world/reader_licensee_layouts.py', 'world/elbera_reader_cross_check.py')


def implementation_hash():
    root = Path(__file__).parent
    paths = ('native_map_geometry.py', 'native_map.py', 'native_catalog/ue2.py', 'native_catalog/effects.py',
             'native_catalog/extract_ue_defaults.ps1', 'native_assets_lib/gltf.py', *GEOMETRY_WORLD_MODULE_PATHS)
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
        if file_hash(require_lock_equal_client_path(client, relative)) != expected:
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
    package = Package(require_lock_equal_client_path(client, raw_manifest['recipe']['map']).read_bytes(), Path(raw_manifest['recipe']['map']).name)
    native = native_terrain(package)
    terrain = json.loads((raw_output/'terrain.json').read_text(encoding='utf-8'))[0]
    samples = read_height_samples(raw_output, terrain)
    actors = json.loads((raw_output/'actors.json').read_text(encoding='utf-8'))
    terrain_actor = next(a for a in actors if a['id'] == terrain['id'])
    points = source_backed_terrain_points(native, terrain, terrain_actor, samples)
    oracle = sector_oracle(native, points)
    if oracle['xyMatches'] != len(native['sectors']):
        raise FormatError('Native sector XY bounds disagree with terrain coordinates')
    selected, selected_sectors = select_terrain_sectors(native, oracle, recipe)
    is_rectangle = 'terrainSectorRectangle' in recipe
    words = read_topology_words(raw_output, terrain, native)
    layers = layer_records(terrain, native, package, raw_manifest['recipe']['map'])
    mask_uv_rule = qualified_mask_uv_rule(native, selected, package, raw_manifest['recipe']['map'], layers)
    if mask_uv_rule is not None:
        for layer in layers:
            layer['maskUV'] = mask_uv_rule['formula']
            layer['maskUVStatus'] = mask_uv_rule['status']
            layer['channelAndBlendStatus'] = ('Captured fixed-function submissions select mask alpha; '
                                            'CPU pruning, bUseAlpha consumer, final composition, lighting and visible parity remain unverified.')
    qx, qy = selected['quads']
    w, h = native['width'], native['height']
    source_points = rectangle_source_points(native, points, selected)
    with tempfile.TemporaryDirectory(prefix='native-terrain-', dir=output.parent) as temp:
        work = Path(temp)
        evidence = read_class_evidence(client, work/'classes', defaults_cache)
        require_terrain_not_inverted(terrain_actor, evidence)
        out = work/'result'
        out.mkdir()
        files, mesh_statistics = build_terrain_rectangle_gltf(native, points, words, layers, selected, mask_uv_rule,
                                                              recipe['terrainSectorRectangle'] if is_rectangle else None, Path(__file__).name)
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
                    'sectionQuads': qx*qy, 'sectionHiddenQuads': mesh_statistics['hiddenQuads'], 'sectionTurnedVisibleQuads': mesh_statistics['turnedQuads'],
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
                    'coverage': {'vertices': mesh_statistics['vertexCount'], 'triangles': mesh_statistics['triangleCount'], 'staticActors': len(placements),
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
    parser = argparse.ArgumentParser(description=TERRAIN_SECTION_MIGRATION_DESCRIPTION)
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
