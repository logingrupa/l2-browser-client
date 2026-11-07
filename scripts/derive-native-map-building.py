#!/usr/bin/env python3
"""Append qualified command-hall BSP to an existing section, preserving all assets.

Produces immutable runtime data and three guarded Editor append snapshots. No
scene rebuild/reimport. --stage changes only the catalog's selected section.
"""
import argparse
import copy
import importlib.util
import json
from pathlib import Path

from native_assets_lib.gltf import json_bytes
from native_bsp_building import PARTS, BRUSH, SUPPORT
from native_bsp_floor import ROOT, MAP_SHA, require, sha

spec = importlib.util.spec_from_file_location('bsp_io', ROOT/'scripts/derive-native-map-bsp.py')
io = importlib.util.module_from_spec(spec)
spec.loader.exec_module(io)
MANIFEST, RECEIPT = io.MANIFEST_FILE, io.RECEIPT_FILE


def run(args):
    base, extracted, output = (io.unlinked(p.resolve()) for p in (args.base_bundle, args.extracted, args.output))
    require(output.is_relative_to(ROOT/'artifacts') and output != ROOT/'artifacts', 'Use dedicated artifacts scratch')
    require(not any(output.is_relative_to(p) or p.is_relative_to(output) for p in (base, extracted)), 'Output overlaps input')
    files = {name: io.local(base, name).read_bytes() for name in io.file_set(base)}
    require(sha(files[MANIFEST]) == args.base_sha256, 'Base section manifest changed')
    original = io.read_json(files[MANIFEST])
    require(original['kind'] == 'native-map-section-runtime' and
            sum(p['id'] == SUPPORT for p in original['placements']) == 1 and
            not any(r['sourceBrush'] == BRUSH for r in original.get('bsp', [])), 'Unsupported/already-appended base')
    # Check all resources declared by the base manifest before copying them.
    def check(prefix, record):
        value = files[prefix+record['file']]
        require(sha(value) == record['sha256'] and len(value) == record['bytes'], 'Base resource changed')
    check('map-section/', original['terrain'])
    for record in original['models']:
        for key in ('model', 'archive'):
            check('map-section-models/', record[key])
    for record in original.get('bsp', []):
        for key in ('model', 'source'):
            check('map-section-bsp/', record[key])
    for record in original.get('terrainPatches', []):
        for key in ('model', 'source'):
            check('map-section/', record[key])
    payloads = {name: io.local(extracted, name).read_bytes() for name in io.file_set(extracted)}
    require(sha(payloads['manifest.json']) == args.extracted_sha256, 'Extracted manifest changed')
    proof = io.read_json(payloads['manifest.json'])
    require(proof['kind'] == 'native-bsp-building-bundle' and proof['sourceMapSha256'] == MAP_SHA and
            proof['sourceBrush'] == BRUSH and proof['counts'] == {'nodes': 10, 'vertices': 52, 'triangles': 32} and
            set(proof['files']) == set(payloads)-{'manifest.json'} and len(proof['resources']) == 3,
            'Unsupported building extraction')
    for name, pin in proof['files'].items():
        require(sha(payloads[name]) == pin['sha256'] and len(payloads[name]) == pin['bytes'], 'Extraction payload changed')
    scene = ROOT/'assets/native-world.scene'
    materials = {}
    for path in sorted((scene/'meshes').glob('*.json')):
        raw = path.read_bytes()
        for material in json.loads(raw).get('materials', []):
            reference = material.get('metadata', {}).get('gltf', {}).get('extras', {}).get('nativeSourceReference')
            if reference in [part['material'] for part in PARTS.values()] and reference not in materials:
                materials[reference] = {'meshPath': path.relative_to(ROOT).as_posix(), 'meshSha256': sha(raw),
                    'materialId': material['id'], 'nativeSourceReference': reference}
    require(len(materials) == 3, 'Existing authored original materials are missing')
    scratch, snapshots = {}, []
    updated, previous_hash = copy.deepcopy(original), args.base_sha256
    for part_name, resource in zip(PARTS, proof['resources']):
        require(resource['id'] == 'interlude:20_20.Model798.Brush610.'+part_name and
                resource['sourceModel'] == '20_20.Model798' and resource['sourceBrush'] == BRUSH and
                resource['sourceMapSha256'] == MAP_SHA and resource['supportPlacementIds'] == [SUPPORT],
                'Unexpected building resource identity')
        for key, suffix in (('model', '.glb'), ('source', '.json')):
            record = resource[key]
            require(record['file'] == 'bsp-command-'+part_name+suffix and
                    proof['files'][record['file']] == {k: record[k] for k in ('sha256', 'bytes')},
                    'Building resource descriptor mismatch')
        source = io.read_json(payloads[resource['source']['file']])
        updated.setdefault('bsp', []).append(resource)
        encoded = json_bytes(updated); next_hash = sha(encoded)
        snapshot = {'schemaVersion': 1, 'kind': 'native-editor-bsp-snapshot', 'baseManifestSha256': previous_hash,
            'bspResource': resource, 'nativeBsp': copy.deepcopy(resource),
            'geometry': {key: source[key] for key in ('positions', 'normals', 'uvs', 'indices')},
            'material': materials[PARTS[part_name]['material']]}
        path = 'editor-'+part_name+'.json'
        scratch[path], scratch['manifest-'+part_name+'.json'] = json_bytes(snapshot), encoded
        snapshots.append({'snapshot': path, 'snapshotSha256': sha(scratch[path]),
            'manifest': 'manifest-'+part_name+'.json', 'manifestSha256': next_hash})
        previous_hash = next_hash
    derived = dict(files)
    derived[MANIFEST] = encoded
    receipt = io.read_json(files[RECEIPT])
    require(receipt['manifestSha256'] == args.base_sha256, 'Base receipt identity differs')
    receipt['manifestSha256'] = next_hash
    receipt.setdefault('derivation', {})['buildingBsp'] = {'baseManifestSha256': args.base_sha256,
        'extractedManifestSha256': args.extracted_sha256, 'resources': proof['resources'],
        'counts': proof['counts'], 'existingGeometryUnchanged': True}
    derived[RECEIPT] = json_bytes(receipt)
    for name, value in payloads.items():
        destination = 'map-section-bsp/'+('command-manifest.json' if name == 'manifest.json' else name)
        require(destination not in derived, 'Existing BSP output conflicts')
        derived[destination] = value
    require({name for name in files if files[name] != derived[name]} == {MANIFEST, RECEIPT}, 'Unexpected base mutation')
    plan = {'schemaVersion': 1, 'kind': 'native-map-building-bsp-derivation', 'baseManifestSha256': args.base_sha256,
        'manifestSha256': next_hash, 'addedBspIds': [r['id'] for r in proof['resources']],
        'unchangedBaseFiles': len(files)-2, 'editorAppends': snapshots,
        'implementation': {Path(__file__).name: sha(Path(__file__).read_bytes())},
        'baseFiles': {name: {'sha256': sha(value), 'bytes': len(value)} for name, value in sorted(files.items())},
        'files': {name: {'sha256': sha(value), 'bytes': len(value)} for name, value in sorted(derived.items())}}
    scratch['bundle.json'] = json_bytes(plan)
    scratch.update({'bundle/'+name: value for name, value in derived.items()})
    before = after = None
    if args.stage:
        catalog_path = ROOT/'public/l2/catalog.json'
        before = catalog_path.read_bytes()
        selected = [r for r in io.read_json(before)['sections'] if r['id'] == io.SECTION]
        require(len(selected) == 1 and selected[0]['manifestSha256'] in (args.base_sha256, next_hash),
                'Catalog advanced to another section; preserve newer work')
        after = before if selected[0]['manifestSha256'] == next_hash else io.catalog_replace(before, args.base_sha256, next_hash)
        destination = ROOT/'public/l2/maps'/next_hash
        io.preflight(destination, derived)
    io.preflight(output, scratch)
    for name, value in scratch.items():
        io.immutable_write(io.local(output, name), value)
    if args.stage:
        for name, value in derived.items():
            io.immutable_write(io.local(destination, name), value)
        io.commit_catalog(catalog_path, before, after)
    return {'status': 'staged' if args.stage else 'prepared', 'manifestSha256': next_hash,
        'unchangedBaseFiles': len(files)-2, 'addedFiles': len(derived)-len(files), 'editorAppends': snapshots}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-bundle', type=Path, required=True)
    parser.add_argument('--base-sha256', required=True)
    parser.add_argument('--extracted', type=Path, required=True)
    parser.add_argument('--extracted-sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--stage', action='store_true')
    print(json.dumps(run(parser.parse_args()), indent=2))
