"""Append the qualified Actor3703 tree to the current immutable floor bundle.

Source normals must already be restored by restore-native-static-normals.py.
No broad conversion, authored reimport, material repair or native execution.
"""
import argparse
import copy
import importlib.util
import json
from pathlib import Path
import zipfile

from native_assets import verify_archive
from native_assets_lib.gltf import json_bytes
from native_map import (MapSources, actor_properties, decode_property,
                        explicit_properties, property_value, TRANSFORMS)
from native_map_geometry import read_class_evidence, gltf_placement
from native_map_overlap import parse_glb, source_placement, transform_positions, triangle_rectangle_overlap
from reference_client_guard import require_reference_client

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('native_bsp_derivation_io', Path(__file__).with_name('derive-native-map-bsp.py'))
io = importlib.util.module_from_spec(spec)
spec.loader.exec_module(io)
sha, checked, local, read_json = io.sha, io.checked, io.local, io.read_json
BASE = '93139ab0f6751ef3ea5f639876e862900d3767c711754ef2af9e2a0907e97a66'
BASE_PLAN = 'artifacts/native-parity/research/native-building-floor-20261106/runtime/bundle.json'
BASE_PLAN_SHA = '5dab36e54fe723bfab075d31c698bcdade599552e7abd9bcc2b97974af80dbf4'
MODEL = 'interlude:dion_tree_s.red_mt.dion_excute_tree1'
ACTOR = 'interlude:20_20.StaticMeshActor3703'
MAP_SHA = '1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4'
PROOF = 'artifacts/native-parity/research/map-overlap-expansion-20261106/bounds-scout/candidate-native-triangle-check.json'
PROOF_SHA = '56fa4c10449ad60e51ed9225442918c2354c354f6b230db5e0b01cd46aba6153'
GLB_SHA = 'aac78048d33b492052393816d4614ac7bced576b3a36924c3ad5d0452a105ebf'
MANIFEST, RECEIPT = io.MANIFEST_FILE, io.RECEIPT_FILE


def require(value, message):
    if not value:
        raise ValueError(message)


def base_files():
    plan = read_json(checked(ROOT / BASE_PLAN, BASE_PLAN_SHA))
    require(plan['manifestSha256'] == BASE and len(plan['files']) == 944, 'Current base plan changed')
    root = local(ROOT, 'public/l2/maps/' + BASE)
    require(io.file_set(root) == set(plan['files']), 'Base file set changed')
    return {name: checked(local(root, name), value['sha256'], value['bytes']) for name, value in plan['files'].items()}


def qualified_placement(client, proof):
    raw = ROOT / 'artifacts/native-parity/migration/maps/map-20-20'
    raw_manifest, receipt = read_json((raw / 'manifest.json').read_bytes()), read_json((raw / 'receipt.json').read_bytes())
    actor_bytes = checked(local(raw, raw_manifest['files']['actors']), receipt['outputs'][raw_manifest['files']['actors']]['sha256'])
    actors = [row for row in read_json(actor_bytes) if row['id'] == ACTOR]
    require(len(actors) == 1, 'Missing/ambiguous raw actor')
    actor = actors[0]
    package = MapSources(client).get(raw_manifest['recipe']['map'])
    require(package.source_hash == MAP_SHA == raw_manifest['sourcePackageSha256'], 'Source map changed')
    exports = [row for row in package.exports if row['exportIndex'] == actor['exportIndex']]
    require(len(exports) == 1 and exports[0]['object'] == actor['object'] and actor['exportIndex'] == 12707, 'Actor identity changed')
    props, _, _, _ = actor_properties(package, exports[0])
    props = [decode_property(package, prop, raw_manifest['files']['rawMap']) for prop in props]
    require(actor['sourceTransform'] == explicit_properties(props, TRANSFORMS) and
            actor['staticMesh'] == property_value(props, 'StaticMesh') and
            actor['materialOverrides'] == [p for p in props if p['name'] in ('Skins', 'Texture')], 'Actor differs from native tags')
    defaults = ROOT / 'artifacts/native-parity/research/map-geometry/native-defaults'
    require(all((defaults / name / 'defaults.json').is_file() for name in ('Engine.Actor', 'Engine.StaticMeshActor', 'Engine.TerrainInfo')), 'Retained defaults missing; extraction forbidden')
    evidence = read_class_evidence(client, defaults, reusable=defaults)
    placement = source_placement(actor, {'id': MODEL}, evidence)
    require(placement['matrix'] == gltf_placement(proof['actor']['nativeRowMatrix']) and
            placement['sourceLocation'] == proof['actor']['origin'] and not placement['materialOverrides'], 'Qualified placement changed')
    return placement


def read_archive(path, expected, client):
    payload = checked(path, expected)
    verified = verify_archive(path)
    require(verified['id'] == MODEL and verified['kind'] == 'model', 'Wrong model archive')
    with zipfile.ZipFile(path) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    asset, provenance = read_json(files['asset.json']), read_json(files['provenance.json'])
    require(asset['source']['object'] == MODEL.removeprefix('interlude:') and
            asset['source']['sha256'] == '4326a6ea88488a1cdf4e704f95ff98ae6b5ff053e9b5f4e56940bef85d427554', 'Wrong native source')
    require(sha(files['model.glb']) == GLB_SHA, 'Expected exact original normal correction')
    correction = read_json(files['native-static-normal-repair.json'])
    require(correction['kind'] == 'restore-original-static-normal-floats' and correction['normalizationApplied'] is False and
            correction['glbAfterSha256'] == GLB_SHA and correction['allNonNormalBytesUnchanged'] is True and
            correction['source']['proofSha256'] == PROOF_SHA, 'Missing verified normal preservation')
    for name, digest in provenance['dependencies'].items():
        checked(local(client, name), digest)
    require(sha(files['native-static-normal-source.json']) == PROOF_SHA, 'Source proof differs')
    files['asset.l2asset'] = payload
    return files, provenance['dependencies']


def derive(files, model_files, placement, proof):
    original = read_json(files[MANIFEST])
    require(sha(files[MANIFEST]) == BASE and len(original['models']) == 61 and len(original['placements']) == 156 and len(original.get('bsp', [])) == 1, 'Base scope differs')
    require(placement['id'] == ACTOR and placement['modelId'] == MODEL and not placement['materialOverrides'], 'Wrong new placement')
    require(ACTOR not in {p['id'] for p in original['placements']} and MODEL not in {m['id'] for m in original['models']}, 'Addition already exists')
    asset = read_json(model_files['asset.json'])
    require(asset['id'] == MODEL and sha(model_files['model.glb']) == GLB_SHA, 'Wrong corrected source model')
    primitives = parse_glb(model_files['model.glb'])
    triangles = sum(len(p['indices']) // 3 for p in primitives)
    require(len(primitives) == 3 and triangles == 520 and sum(len(p['positions']) for p in primitives) == 533, 'Geometry scope changed')
    hits = []
    for primitive in primitives:
        positions = transform_positions(primitive['positions'], placement['matrix'])
        indices = primitive['indices']
        for index in range(0, len(indices), 3):
            polygon, area = triangle_rectangle_overlap([positions[i] for i in indices[index:index+3]], [81.92, 921.60, 143.36, 981.76])
            if area > 0:
                hits.append({'section': primitive['primitive'], 'triangle': index // 3, 'areaSquareMetres': area, 'polygon': polygon})
    require([(row['section'], row['triangle']) for row in hits] == [(2,i) for i in (243,244,248,249,264,265,269,270)], 'Indexed overlap differs')
    archive_sha = sha(model_files['asset.l2asset'])
    model = {'id': MODEL, 'sourceObject': asset['source']['object'],
             'archive': {'file': archive_sha+'/asset.l2asset', 'sha256': archive_sha, 'bytes': len(model_files['asset.l2asset'])},
             'model': {'file': archive_sha+'/model.glb', 'sha256': GLB_SHA, 'bytes': len(model_files['model.glb'])},
             'limitations': copy.deepcopy(asset['limitations']),
             'structure': {'materials': 3, 'meshes': 1, 'primitives': 3, 'vertices': 533, 'triangles': 520,
                           'scope': 'Original normal floats restored; indexed geometry inclusion, not native visibility/material parity.'}}
    selection = {'schemaVersion': 1, 'kind': 'qualified-new-model-indexed-overlap', 'baseManifestSha256': BASE,
                 'sourceMapSha256': MAP_SHA, 'sourceProofSha256': PROOF_SHA, 'placement': placement,
                 'model': model, 'intersections': hits, 'normalCorrection': read_json(model_files['native-static-normal-repair.json']),
                 'sourceBoundaryScreen': {'missingModelIdentitiesScreened': 193, 'outsideOriginActorsScreened': 1794,
                   'aabbCandidates': 1, 'positiveIndexedCandidates': 1,
                   'limit': 'Retained bounds screening, not complete native rendering or full format support.'}}
    encoded_selection = json_bytes(selection)
    updated = copy.deepcopy(original)
    updated['models'].append(model); updated['placements'].append(placement)
    addition = {'schemaVersion': 1, 'baseManifestSha256': BASE, 'selection': 'new-model-overlap.json',
                'selectionSha256': sha(encoded_selection), 'modelId': MODEL, 'placementId': ACTOR,
                'originalGeometryUnchanged': True}
    updated['derivation']['newModelOverlap'] = addition
    updated['coverage']['additionalNewModelOverlapPlacements'] = 1
    updated['gaps'].append('Actor3703 adds one bounds/index-qualified model; leaf Shader lighting/two-sided semantics, native visibility and collision remain unverified.')
    encoded = json_bytes(updated); digest = sha(encoded)
    receipt = read_json(files[RECEIPT]); require(receipt['manifestSha256'] == BASE, 'Base receipt changed')
    receipt['manifestSha256'] = digest
    receipt.setdefault('derivation', {})['newModelOverlap'] = addition
    receipt['modelArchives'][model['archive']['file']] = archive_sha
    result = dict(files); result[MANIFEST] = encoded; result[RECEIPT] = json_bytes(receipt)
    result['map-section-runtime/new-model-overlap.json'] = encoded_selection
    for name, data in model_files.items():
        key = 'map-section-models/' + archive_sha + '/' + name
        require(key not in result, 'Model resource collision')
        result[key] = data
    require({name for name in files if files[name] != result[name]} == {MANIFEST, RECEIPT}, 'Unexpected base mutation')
    return digest, result


def run(args):
    output, client = io.unlinked(args.output), io.unlinked(args.client)
    require(output.is_relative_to(ROOT / 'artifacts') and output != ROOT / 'artifacts' and not output.is_relative_to(client) and
            not client.is_relative_to(output), 'Use separate destination scratch output')
    files = base_files()
    proof = read_json(checked(ROOT / PROOF, PROOF_SHA))
    model_files, dependencies = read_archive(io.unlinked(args.archive), args.sha256, client)
    placement = qualified_placement(client, proof)
    digest, derived = derive(files, model_files, placement, proof)
    plan = {'schemaVersion': 1, 'kind': 'native-map-new-model-derivation', 'baseManifestSha256': BASE,
            'manifestSha256': digest, 'baseBundleSha256': BASE_PLAN_SHA, 'addedModelId': MODEL, 'addedPlacementId': ACTOR,
            'unchangedBaseFiles': sum(files[name] == derived[name] for name in files),
            'implementation': {Path(__file__).name: sha(Path(__file__).read_bytes()), 'derive-native-map-bsp.py': sha(Path(io.__file__).read_bytes())},
            'files': {name: {'sha256': sha(data), 'bytes': len(data)} for name, data in sorted(derived.items())}}
    scratch = {'bundle/'+name: data for name,data in derived.items()}; scratch['bundle.json'] = json_bytes(plan)
    before = after = None
    if args.stage:
        catalog = local(ROOT, 'public/l2/catalog.json'); before = catalog.read_bytes()
        rows = [row for row in read_json(before)['sections'] if row['id'] == io.SECTION]
        require(len(rows) == 1 and rows[0]['manifestSha256'] in (BASE, digest), 'Catalog selects newer work')
        after = io.catalog_replace(before, BASE, digest) if rows[0]['manifestSha256'] == BASE else before
        scratch.update({'catalog.before.json': io.catalog_replace(after, digest, BASE), 'catalog.after.json': after})
        destination = local(ROOT, 'public/l2/maps/'+digest); io.preflight(destination, derived)
    io.preflight(output, scratch, optional=('catalog.before.json','catalog.after.json') if not args.stage else ())
    for name, expected in dependencies.items(): checked(local(client,name), expected)
    checked(local(client, 'maps/20_20.unr'), MAP_SHA)
    for name,data in scratch.items(): io.immutable_write(local(output,name),data)
    if args.stage:
        for name,data in derived.items(): io.immutable_write(local(destination,name),data)
        io.commit_catalog(catalog,before,after)
    return {'status':'staged' if args.stage else 'prepared', 'manifestSha256':digest, 'files':len(derived),
            'unchangedBaseFiles':plan['unchangedBaseFiles'], 'models':62, 'placements':157, 'publicChanged':bool(args.stage and before != after)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--client', type=Path, default=ROOT/'artifacts/native-parity/inputs/IMPORTA-PC')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--stage', action='store_true')
    args = parser.parse_args()
    require_reference_client(args.client)
    print(json.dumps(run(args),indent=2))
