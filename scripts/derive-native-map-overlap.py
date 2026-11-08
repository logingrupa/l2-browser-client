import argparse
import copy
import hashlib
import json
from pathlib import Path

from native_assets_lib.gltf import json_bytes
from native_map_overlap import audit_overlap
from native_store.catalog_writer import immutable_write, replace_file
from reference_client_guard import require_reference_client

OVERLAP_DERIVATION_DESCRIPTION = (
    'Append source-backed boundary overlaps using already converted mesh inputs.\n'
    '\n'
    'This scoped stage follows the completed 20_20 UV migration. It never invokes a\n'
    'converter or changes original assets. Missing mesh identities remain explicit\n'
    'coverage gaps. Run without --stage first; the authored append is a separate,\n'
    'guarded step so existing Editor work is never reimported.'
)

ROOT = Path(__file__).resolve().parent.parent
BASE = '9841a8fa0e53f441b24d07949360e5fdd18a5d790497d017419722f89d670dc2'
BASE_BUNDLE = ROOT / 'artifacts/native-parity/research/terrain-uv-migration-20261106/source/runtime-bundle/bundle.json'
BASE_BUNDLE_SHA = 'eeec3f15fd917a6ca8ef6aeca36f427c103337e42cbfc1e37609ead6edddce9f'
SECTION = 'map-20-20-section'
MANIFEST_FILE = 'map-section-runtime/manifest.json'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def local(root, relative):
    if not isinstance(relative, str) or not relative or '\\' in relative or ':' in relative:
        raise ValueError('Invalid relative path')
    parts = relative.split('/')
    if any(p in ('', '.', '..') for p in parts):
        raise ValueError('Invalid path component')
    path = root
    for part in parts:
        path = path / part
        if path.is_symlink() or getattr(path, 'is_junction', lambda: False)():
            raise ValueError('Linked input/output refused: ' + str(path))
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('Path escapes root')
    return path


def checked(path, expected, size=None):
    data = path.read_bytes()
    if sha(data) != expected or size is not None and len(data) != size:
        raise ValueError('Input bytes differ: ' + str(path))
    return data


def base_files():
    plan = json.loads(checked(BASE_BUNDLE, BASE_BUNDLE_SHA))
    prefix = 'maps/' + BASE + '/'
    public = ROOT / 'public/l2'
    files = {}
    for name, record in plan['files'].items():
        if name.startswith(prefix):
            files[name[len(prefix):]] = checked(local(public, name), record['sha256'], record['bytes'])
    current = {p.relative_to(public / prefix).as_posix() for p in (public / prefix).rglob('*') if p.is_file()}
    if current != set(files) or len(files) != 939 or sha(files[MANIFEST_FILE]) != BASE:
        raise ValueError('Pinned base runtime file set differs; preserve changed work')
    return files


def derive(files, report):
    old = json.loads(files[MANIFEST_FILE])
    additions = report['additions']
    existing = {p['id'] for p in old['placements']}
    models = {m['id']: m for m in old['models']}
    if not additions or any(p['id'] in existing or p['modelId'] not in models or p['materialOverrides'] for p in additions):
        raise ValueError('Overlap addition collides or requires unsupported models/materials')
    if len({p['id'] for p in additions}) != len(additions):
        raise ValueError('Duplicate overlap identity')
    audit_bytes = json_bytes(report)
    next_manifest = copy.deepcopy(old)
    next_manifest['placements'].extend(additions)
    overlap = {'schemaVersion': 1, 'kind': 'available-mesh-indexed-xy-overlap',
               'baseManifestSha256': BASE, 'audit': 'overlap-selection.json', 'auditSha256': sha(audit_bytes),
               'addedPlacements': len(additions), 'selectionCoverage': 'partial: converted models only',
               'terrainAndModelFilesUnchanged': True, 'noNativeVisibilityClaim': True}
    next_manifest['derivation']['placementOverlap'] = overlap
    next_manifest['coverage']['addedBoundaryOverlapPlacements'] = len(additions)
    next_manifest['gaps'].append('Boundary-overlap coverage is partial: only already converted model identities were evaluated. '
                                 'See overlap-selection.json for excluded origins and unconverted model census. '
                                 'Indexed geometry intersection proves inclusion, not native visibility or material parity.')
    payload = json_bytes(next_manifest)
    next_hash = sha(payload)
    receipt = json.loads(files['map-section-runtime/receipt.json'])
    receipt['manifestSha256'] = next_hash
    receipt['derivation']['placementOverlap'] = overlap
    receipt['validationScope'] = 'Additive indexed-geometry overlap derivative; original conversion/UV receipts retained. Not full-map or native-pixel parity.'
    result = dict(files)
    result[MANIFEST_FILE] = payload
    result['map-section-runtime/receipt.json'] = json_bytes(receipt)
    result['map-section-runtime/overlap-selection.json'] = audit_bytes
    changed_resource_names = [name for name in files if files[name] != result[name]]
    if set(changed_resource_names) != {MANIFEST_FILE, 'map-section-runtime/receipt.json'}:
        raise ValueError('Unexpected resource mutation')
    return next_hash, result


def require_existing_targets_match_before_writing(directory, derived, message):
    for name, data in derived.items():
        target = local(directory, name)
        if target.exists() and target.read_bytes() != data:
            raise ValueError(message)


def run(args):
    output = args.output.absolute()
    if not output.is_relative_to(ROOT):
        raise ValueError('Scratch output must be inside destination project')
    output = local(ROOT, output.relative_to(ROOT).as_posix())
    if not output.is_relative_to(ROOT / 'artifacts'):
        raise ValueError('Use destination artifacts scratch space')
    files = base_files()
    report = audit_overlap(args.client, args.raw, ROOT / 'public/l2/maps' / BASE / MANIFEST_FILE,
                           args.class_evidence, expected_runtime_sha256=BASE, recipe_path=args.recipe)
    next_hash, derived = derive(files, report)
    records = {name: {'sha256': sha(data), 'bytes': len(data)} for name, data in sorted(derived.items())}
    plan = {'schemaVersion': 1, 'kind': 'native-map-overlap-derivation', 'baseManifestSha256': BASE,
            'manifestSha256': next_hash, 'baseBundleSha256': BASE_BUNDLE_SHA, 'files': records,
            'addedPlacements': [p['id'] for p in report['additions']],
            'unchangedBaseFiles': sum(files[k] == derived[k] for k in files),
            'scriptSha256': sha(Path(__file__).read_bytes())}
    bundle = output / 'bundle'
    expected = set(derived)
    if bundle.exists():
        actual = {p.relative_to(bundle).as_posix() for p in bundle.rglob('*') if p.is_file()}
        if actual - expected:
            raise ValueError('Unexpected files in immutable output')
    require_existing_targets_match_before_writing(bundle, derived, 'Scratch bundle differs; use a new output')
    for name, data in derived.items():
        immutable_write(local(bundle, name), data)
    immutable_write(local(output, 'overlap-selection.json'), json_bytes(report))
    immutable_write(local(output, 'bundle.json'), json_bytes(plan))
    result = {'status': 'prepared', 'manifestSha256': next_hash, 'files': len(derived),
              'additions': plan['addedPlacements'], 'unchangedBaseFiles': plan['unchangedBaseFiles'],
              'manifestPath': str(bundle / MANIFEST_FILE), 'publicChanged': False}
    if args.stage:
        path = ROOT / 'public/l2/catalog.json'
        before = path.read_bytes()
        catalog = json.loads(before)
        entries = [row for row in catalog.get('sections', []) if row.get('id') == SECTION]
        if len(entries) != 1 or entries[0]['manifestSha256'] not in (BASE, next_hash):
            raise ValueError('Catalog selects newer work; refuse replacement')
        selected = entries[0]
        if selected['manifest'] != '/l2/maps/' + selected['manifestSha256'] + '/' + MANIFEST_FILE:
            raise ValueError('Selected catalog path differs from identity')
        destination = ROOT / 'public/l2/maps' / next_hash
        require_existing_targets_match_before_writing(destination, derived, 'Immutable public resource differs')
        for name, data in derived.items():
            immutable_write(local(destination, name), data)
        if path.read_bytes() != before:
            raise ValueError('Catalog changed concurrently; no pointer replacement')
        if selected['manifestSha256'] == BASE:
            catalog_text_with_original_formatting = before.decode('utf-8')
            if catalog_text_with_original_formatting.count(BASE) != 2:
                raise ValueError('Ambiguous base hash in catalog')
            after = catalog_text_with_original_formatting.replace(BASE, next_hash).encode('utf-8')
            expected_catalog = copy.deepcopy(catalog)
            item = next(row for row in expected_catalog['sections'] if row['id'] == SECTION)
            item.update(manifestSha256=next_hash, manifest='/l2/maps/' + next_hash + '/' + MANIFEST_FILE)
            if json.loads(after) != expected_catalog:
                raise ValueError('Catalog changed outside selected section')
            immutable_write(local(output, 'catalog.before.json'), before)
            immutable_write(local(output, 'catalog.after.json'), after)
            replace_file(path, after)
            result['publicChanged'] = True
        result['status'] = 'staged'
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=OVERLAP_DERIVATION_DESCRIPTION)
    parser.add_argument('--client', type=Path, default=ROOT / 'artifacts/native-parity/inputs/IMPORTA-PC')
    parser.add_argument('--raw', type=Path, default=ROOT / 'artifacts/native-parity/migration/maps/map-20-20')
    parser.add_argument('--class-evidence', type=Path, default=ROOT / 'artifacts/native-parity/research/map-geometry/native-defaults')
    parser.add_argument('--recipe', type=Path, default=ROOT / 'recipes/native-map-debug-location.json')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--stage', action='store_true')
    args = parser.parse_args()
    require_reference_client(args.client)
    print(json.dumps(run(args), indent=2))
