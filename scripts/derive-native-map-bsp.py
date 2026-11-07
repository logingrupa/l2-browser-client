"""Derive one immutable map bundle with the source-backed Brush397 BSP floor.

The pinned overlap bundle and extracted BSP payloads are read only. Preparation
defaults to artifacts scratch; --stage additionally appends a content-addressed
public bundle and changes only the selected catalog section's identity/path.
This does not reimport Editor work or certify native pixels/collision/lighting.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re

from native_assets_lib.gltf import json_bytes
from stage_native_runtime import replace_file

ROOT = Path(__file__).resolve().parent.parent
BASE = 'fdee12862293d14bb9812eb63789aa336f91ffd18473623b6debd709bfffc3dc'
BASE_BUNDLE = ROOT / 'artifacts/native-parity/research/map-overlap-20261106/runtime/bundle.json'
BASE_BUNDLE_SHA = 'b3c354c216559f494aaf6dae3cc2689e9130190e78d021bf1b4b466c5d47853b'
BASE_FILE_COUNT = 940
SECTION = 'map-20-20-section'
MANIFEST_FILE = 'map-section-runtime/manifest.json'
RECEIPT_FILE = 'map-section-runtime/receipt.json'
BSP_ID = 'interlude:20_20.Model798.Brush397'
SUPPORT_ID = 'interlude:20_20.StaticMeshActor940'
SOURCE = {'id': BSP_ID, 'sourceModel': '20_20.Model798', 'sourceBrush': '20_20.Brush397',
          'sourceMapSha256': '1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4'}
BSP_FILES = {'bsp-floor.glb', 'bsp-floor.json', 'texture.png'}
HASH = re.compile('[a-f0-9]{64}')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=unique)


def unlinked(path):
    """Reject links on the full ancestry, including a linked supplied root."""
    path = Path(path).absolute()
    for part in [*reversed(path.parents), path]:
        if part.is_symlink() or getattr(part, 'is_junction', lambda: False)():
            raise ValueError('Linked input/output refused: ' + str(part))
    return path


def local(root, relative):
    if not isinstance(relative, str) or not relative or '\\' in relative or ':' in relative:
        raise ValueError('Invalid relative path')
    parts = relative.split('/')
    for part in parts:
        if (part in ('', '.', '..') or re.search(r'[\x00-\x1f<>"|?*]', part) or part.endswith(('.', ' ')) or
                re.fullmatch(r'(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', part, re.I)):
            raise ValueError('Invalid path component')
    root = unlinked(root)
    path = unlinked(root.joinpath(*parts))
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('Path escapes root')
    return path


def file_set(root):
    root = unlinked(root)
    if not root.exists():
        return set()
    if not root.is_dir():
        raise ValueError('Expected directory: ' + str(root))
    result = set()
    def walk(directory):
        for child in directory.iterdir():
            unlinked(child)
            if child.is_dir():
                walk(child)
            elif child.is_file():
                result.add(child.relative_to(root).as_posix())
            else:
                raise ValueError('Unsupported filesystem entry: ' + str(child))
    walk(root)
    return result


def checked(path, expected, size=None):
    if not isinstance(expected, str) or not HASH.fullmatch(expected):
        raise ValueError('Invalid expected SHA256')
    data = unlinked(path).read_bytes()
    if sha(data) != expected or size is not None and (type(size) is not int or len(data) != size):
        raise ValueError('Input hash/length differs: ' + str(path))
    return data


def base_files():
    plan = read_json(checked(BASE_BUNDLE, BASE_BUNDLE_SHA))
    root = local(ROOT, 'public/l2/maps/' + BASE)
    if plan.get('manifestSha256') != BASE or not isinstance(plan.get('files'), dict):
        raise ValueError('Pinned base plan differs')
    files = {name: checked(local(root, name), record['sha256'], record['bytes'])
             for name, record in plan['files'].items()}
    if file_set(root) != set(files) or len(files) != BASE_FILE_COUNT or sha(files[MANIFEST_FILE]) != BASE:
        raise ValueError('Pinned base runtime file set differs; preserve changed work')
    return files


def validate_bsp(files, manifest_sha256):
    if set(files) != BSP_FILES | {'manifest.json'} or sha(files['manifest.json']) != manifest_sha256:
        raise ValueError('BSP manifest identity/file set differs')
    manifest = read_json(files['manifest.json'])
    if (manifest.get('schemaVersion') != 1 or manifest.get('kind') != 'native-bsp-floor-bundle' or
            any(manifest.get(key) != value for key, value in SOURCE.items()) or
            manifest.get('counts') != {'nodes': 10, 'vertices': 48, 'triangles': 28} or
            set(manifest.get('files', {})) != BSP_FILES):
        raise ValueError('BSP source identity, scope or file table differs')
    for name in BSP_FILES:
        record = manifest['files'][name]
        if record.get('sha256') != sha(files[name]) or type(record.get('bytes')) is not int or record['bytes'] != len(files[name]):
            raise ValueError('BSP payload hash/length differs: ' + name)
    geometry = read_json(files['bsp-floor.json'])
    if (geometry.get('schemaVersion') != 1 or geometry.get('kind') != 'native-bsp-floor-geometry' or
            any(geometry.get(key) != SOURCE[key] for key in ('id', 'sourceModel', 'sourceBrush'))):
        raise ValueError('BSP geometry identity differs')
    return manifest


def bsp_files(root, expected):
    if not isinstance(expected, str) or not HASH.fullmatch(expected):
        raise ValueError('Invalid BSP manifest SHA256')
    files = {name: local(root, name).read_bytes() for name in file_set(root)}
    validate_bsp(files, expected)
    return files


def derive(files, bsp, manifest_sha256):
    manifest = validate_bsp(bsp, manifest_sha256)
    original = read_json(files[MANIFEST_FILE])
    receipt = read_json(files[RECEIPT_FILE])
    if (sha(files[MANIFEST_FILE]) != BASE or receipt.get('manifestSha256') != BASE or
            'bsp' in original or 'bspFloor' in receipt.get('derivation', {}) or
            len(original.get('placements', [])) != 156 or len(original.get('models', [])) != 61 or
            sum(p.get('id') == SUPPORT_ID for p in original['placements']) != 1):
        raise ValueError('Base manifest scope changed or BSP already exists')
    entry = {**SOURCE, 'model': {'file': 'bsp-floor.glb', **manifest['files']['bsp-floor.glb']},
             'source': {'file': 'bsp-floor.json', **manifest['files']['bsp-floor.json']},
             'supportPlacementIds': [SUPPORT_ID]}
    updated = copy.deepcopy(original)
    updated['bsp'] = [entry]
    payload = json_bytes(updated)
    digest = sha(payload)
    receipt['manifestSha256'] = digest
    receipt.setdefault('derivation', {})['bspFloor'] = {
        'schemaVersion': 1, 'kind': 'native-source-bsp-floor-addition', 'baseManifestSha256': BASE,
        'manifest': '../map-section-bsp/manifest.json', 'manifestSha256': manifest_sha256,
        'sourceId': BSP_ID, 'sourceMapSha256': SOURCE['sourceMapSha256'],
        'counts': copy.deepcopy(manifest['counts']), 'existingGeometryUnchanged': True,
        'limitations': copy.deepcopy(manifest.get('limitations', []))}
    result = dict(files)
    result[MANIFEST_FILE] = payload
    result[RECEIPT_FILE] = json_bytes(receipt)
    for name, data in bsp.items():
        key = 'map-section-bsp/' + name
        if key in result:
            raise ValueError('Existing BSP destination refused')
        result[key] = data
    if {name for name in files if files[name] != result[name]} != {MANIFEST_FILE, RECEIPT_FILE}:
        raise ValueError('Unexpected existing resource mutation')
    return digest, result


def value_spans(text, wanted):
    """Locate selected JSON values while preserving every other byte."""
    decoder = json.JSONDecoder()
    spans = {}
    def whitespace(offset):
        while offset < len(text) and text[offset] in ' \r\n\t':
            offset += 1
        return offset
    def visit(offset, path):
        offset = start = whitespace(offset)
        if text[offset] == '{':
            offset = whitespace(offset + 1)
            while text[offset] != '}':
                key, offset = decoder.raw_decode(text, offset)
                offset = whitespace(offset)
                if text[offset] != ':':
                    raise ValueError('Invalid JSON property')
                offset = whitespace(visit(offset + 1, (*path, key)))
                if text[offset] != ',':
                    break
                offset = whitespace(offset + 1)
            offset += 1
        elif text[offset] == '[':
            offset, index = whitespace(offset + 1), 0
            while text[offset] != ']':
                offset = whitespace(visit(offset, (*path, index)))
                index += 1
                if text[offset] != ',':
                    break
                offset = whitespace(offset + 1)
            offset += 1
        else:
            _, offset = decoder.raw_decode(text, offset)
        if path in wanted:
            spans[path] = (start, offset)
        return offset
    visit(0, ())
    if set(spans) != set(wanted):
        raise ValueError('Catalog replacement location missing')
    return spans


def catalog_replace(before, old_hash, new_hash):
    catalog = read_json(before)
    indices = [i for i, row in enumerate(catalog.get('sections', [])) if row.get('id') == SECTION]
    if len(indices) != 1:
        raise ValueError('Catalog selected section missing or duplicated')
    index = indices[0]
    selected = catalog['sections'][index]
    if (selected.get('manifestSha256') != old_hash or
            selected.get('manifest') != '/l2/maps/' + old_hash + '/' + MANIFEST_FILE):
        raise ValueError('Catalog selects newer work or path differs; refuse replacement')
    values = {('sections', index, 'manifestSha256'): new_hash,
              ('sections', index, 'manifest'): '/l2/maps/' + new_hash + '/' + MANIFEST_FILE}
    text = before.decode('utf-8')
    spans = value_spans(text, values)
    for key, (start, end) in sorted(spans.items(), key=lambda item: item[1][0], reverse=True):
        token = text[start:end]
        if token.count(old_hash) != 1:
            raise ValueError('Catalog hash spelling is ambiguous')
        text = text[:start] + token.replace(old_hash, new_hash) + text[end:]
    after = text.encode('utf-8')
    expected = copy.deepcopy(catalog)
    expected['sections'][index].update(manifestSha256=new_hash, manifest=values[('sections', index, 'manifest')])
    if read_json(after) != expected:
        raise ValueError('Catalog changed outside selected fields')
    return after


def preflight(root, files, optional=()):
    existing = file_set(root)
    if existing - set(files) - set(optional):
        raise ValueError('Unexpected files in immutable output: ' + str(root))
    for name, data in files.items():
        target = local(root, name)
        if target.exists() and (not target.is_file() or target.read_bytes() != data):
            raise ValueError('Immutable output differs; use a new output: ' + str(target))


def immutable_write(path, data):
    """Exclusive creation avoids replacing a concurrent writer's immutable file."""
    unlinked(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open('xb') as stream:
            stream.write(data)
    except FileExistsError:
        if not path.is_file() or path.read_bytes() != data:
            raise ValueError('Immutable output changed concurrently: ' + str(path))


def commit_catalog(path, before, after):
    if unlinked(path).read_bytes() != before:
        raise ValueError('Catalog changed concurrently; no pointer replacement')
    if before != after:
        replace_file(path, after)


def run(args):
    output = unlinked(args.output)
    root = unlinked(ROOT)
    if not output.is_relative_to(root / 'artifacts') or output == root / 'artifacts':
        raise ValueError('Use a dedicated destination artifacts scratch directory')
    output = local(root, output.relative_to(root).as_posix())
    bsp_root = unlinked(args.bsp)
    if output.is_relative_to(bsp_root) or bsp_root.is_relative_to(output):
        raise ValueError('Output overlaps BSP input')
    files = base_files()
    bsp = bsp_files(bsp_root, args.bsp_sha256)
    digest, derived = derive(files, bsp, args.bsp_sha256)
    plan = {'schemaVersion': 1, 'kind': 'native-map-bsp-derivation', 'baseManifestSha256': BASE,
            'manifestSha256': digest, 'baseBundleSha256': BASE_BUNDLE_SHA,
            'bspManifestSha256': args.bsp_sha256, 'addedBspIds': [BSP_ID],
            'unchangedBaseFiles': sum(files[name] == derived[name] for name in files),
            'scriptSha256': sha(Path(__file__).read_bytes()),
            'files': {name: {'sha256': sha(data), 'bytes': len(data)} for name, data in sorted(derived.items())}}
    scratch = {'bundle/' + name: data for name, data in derived.items()}
    scratch['bundle.json'] = json_bytes(plan)
    before = after = None
    if args.stage:
        catalog_path = local(root, 'public/l2/catalog.json')
        before = catalog_path.read_bytes()
        selected = [row for row in read_json(before).get('sections', []) if row.get('id') == SECTION]
        if len(selected) != 1 or selected[0].get('manifestSha256') not in (BASE, digest):
            raise ValueError('Catalog selects newer work; refuse replacement')
        if selected[0]['manifestSha256'] == BASE:
            after = catalog_replace(before, BASE, digest)
            original_catalog = before
        else:
            after = before
            original_catalog = catalog_replace(before, digest, BASE)
        scratch.update({'catalog.before.json': original_catalog, 'catalog.after.json': after})
        destination = local(root, 'public/l2/maps/' + digest)
        preflight(destination, derived)
    # Preflight every receipt, bundle file, and public destination before writes.
    preflight(output, scratch, optional=('catalog.before.json', 'catalog.after.json') if not args.stage else ())
    for name, data in scratch.items():
        immutable_write(local(output, name), data)
    if args.stage:
        for name, data in derived.items():
            immutable_write(local(destination, name), data)
        commit_catalog(catalog_path, before, after)
    return {'status': 'staged' if args.stage else 'prepared', 'manifestSha256': digest,
            'files': len(derived), 'addedBspIds': [BSP_ID], 'unchangedBaseFiles': plan['unchangedBaseFiles'],
            'manifestPath': str(output / 'bundle' / MANIFEST_FILE),
            'publicChanged': bool(args.stage and before != after)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bsp', type=Path, required=True, help='Verified four-file extraction directory')
    parser.add_argument('--bsp-sha256', required=True, help='Exact extraction manifest SHA256')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--stage', action='store_true')
    print(json.dumps(run(parser.parse_args()), indent=2))
