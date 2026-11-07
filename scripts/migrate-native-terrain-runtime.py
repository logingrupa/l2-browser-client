"""Derive the qualified 20_20 terrain runtime without reconverting its models.

Default writes a verified, immutable scratch bundle. --stage additionally appends
its resources to public/l2 and replaces only the selected catalog section entry.
This is a derived runtime receipt, not a fresh full-migration validation receipt.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path, PurePosixPath
import struct

from native_assets_lib.gltf import json_bytes
from stage_native_runtime import immutable_write, replace_file, verified_archive

ROOT = Path(__file__).resolve().parent.parent
BASE_MANIFEST = '062218e6dc1c887e5018489f69b1faaed571b519d937cc0d7c7c9b8c1474e2c2'
MAP_SHA = '1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4'
OLD_UV = '957f2061e9b83e8e4fdb6e1504ee66fb2100a0c0b6cf4e70f686e97e98814695'
NEW_UV = 'd549356ff531e4271099c2097807eec899cc45eb96d512be04b03855d558963d'
HANDOFF_SHA = 'fe2e05c2468858931332c207f5b45c6b3ec7cdf9f61121d897ad137aa9b66556'
SECTION = 'map-20-20-section'
RULE = 'interlude-20_20-submitted-mask-uv-20261106'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key: ' + key)
        result[key] = value
    return result


def decode(data):
    return json.loads(data, object_pairs_hook=unique_pairs)


def local(root, relative):
    relative = str(relative)
    parts = PurePosixPath(relative).parts
    if not parts or '\\' in relative or ':' in relative or relative.startswith('/') or any(p in ('.', '..') for p in parts):
        raise ValueError('Unsafe relative path: ' + relative)
    path = root
    for part in parts:
        path = path / part
        if path.is_symlink() or getattr(path, 'is_junction', lambda: False)():
            raise ValueError('Symlink/junction refused: ' + str(path))
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('Path escapes root')
    return path


def project_path(root, path):
    absolute = Path(path).absolute()
    try:
        relative = absolute.relative_to(root).as_posix()
    except ValueError as error:
        raise ValueError('Path must stay inside the project') from error
    return local(root, relative)


def checked(path, expected, size=None):
    data = path.read_bytes()
    if digest(data) != expected or size is not None and len(data) != size:
        raise ValueError('Hash/length mismatch: ' + str(path))
    return data


def geometry_files(directory):
    receipt_data = local(directory, 'receipt.json').read_bytes()
    receipt = decode(receipt_data)
    if receipt.get('kind') != 'native-terrain-section' or not isinstance(receipt.get('outputs'), dict):
        raise ValueError('Invalid geometry receipt')
    files = {'receipt.json': receipt_data}
    for name, expected in receipt['outputs'].items():
        files[name] = checked(local(directory, name), expected)
    actual = set()
    for path in directory.rglob('*'):
        local(directory, path.relative_to(directory).as_posix())
        if path.is_file():
            actual.add(path.relative_to(directory).as_posix())
    if actual != set(files):
        raise ValueError('Geometry file set differs from receipt')
    if receipt.get('sourceDependencies', {}).get('maps/20_20.unr') != MAP_SHA:
        raise ValueError('Geometry is outside the pinned 20_20 source')
    return receipt, files


def glb_parts(data):
    if len(data) < 28 or struct.unpack_from('<III', data) != (0x46546c67, 2, len(data)):
        raise ValueError('Invalid terrain GLB header')
    chunks, offset = {}, 12
    while offset < len(data):
        length, kind = struct.unpack_from('<II', data, offset)
        offset += 8
        if length % 4 or kind in chunks or offset + length > len(data):
            raise ValueError('Invalid terrain GLB chunks')
        chunks[kind] = data[offset:offset+length]
        offset += length
    if set(chunks) != {0x4e4f534a, 0x004e4942}:
        raise ValueError('Expected JSON and BIN terrain chunks')
    return decode(chunks[0x4e4f534a]), chunks[0x004e4942]


def primary_region(document, binary):
    primitive = document['meshes'][0]['primitives'][0]
    accessor = document['accessors'][primitive['attributes']['TEXCOORD_0']]
    view = document['bufferViews'][accessor['bufferView']]
    if (len(document['meshes']) != 1 or len(document['meshes'][0]['primitives']) != 1 or
        accessor.get('type') != 'VEC2' or accessor.get('componentType') != 5126 or accessor.get('count') != 2352 or
        accessor.get('normalized', False) or 'sparse' in accessor or view.get('buffer') != 0 or view.get('byteStride', 8) != 8):
        raise ValueError('Unexpected terrain primary-UV layout')
    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    if start < 0 or start + 18816 > len(binary):
        raise ValueError('Primary UVs outside terrain buffer')
    return start, 18816


def compare_geometry(old_files, new_files):
    old_doc, old_bin = glb_parts(old_files['terrain.glb'])
    new_doc, new_bin = glb_parts(new_files['terrain.glb'])
    start, length = primary_region(old_doc, old_bin)
    if primary_region(new_doc, new_bin) != (start, length) or len(old_bin) != len(new_bin):
        raise ValueError('Terrain buffer layout changed')
    # All accessor definitions and primitive bindings must remain identical,
    # including positions/normals/indices and diffuse TEXCOORD_1.
    for key in ('accessors', 'bufferViews'):
        if old_doc[key] != new_doc[key]:
            raise ValueError('Terrain accessor layout changed: ' + key)
    if old_doc['meshes'][0]['primitives'] != new_doc['meshes'][0]['primitives']:
        raise ValueError('Terrain primitive bindings changed')
    normalized = copy.deepcopy(new_doc)
    extras = normalized['meshes'][0].get('extras', {})
    extras.pop('maskUVRule', None)
    old_layers = old_doc['meshes'][0].get('extras', {}).get('nativeLayers', [])
    new_layers = extras.get('nativeLayers', [])
    if len(old_layers) != len(new_layers):
        raise ValueError('Terrain layer set changed')
    for old_layer, new_layer in zip(old_layers, new_layers):
        for key in ('maskUV', 'maskUVStatus', 'channelAndBlendStatus'):
            if key in old_layer:
                new_layer[key] = old_layer[key]
            else:
                new_layer.pop(key, None)
    if normalized != old_doc:
        raise ValueError('Unrelated terrain material/scene metadata changed')
    for files, document, binary in ((old_files, old_doc, old_bin), (new_files, new_doc, new_bin)):
        raw = files['terrain.bin']
        if raw + b'\0' * (-len(raw) % 4) != binary:
            raise ValueError('Standalone terrain buffer differs from GLB')
        external = decode(files['terrain.gltf'])
        if len(external.get('buffers', [])) != 1 or external['buffers'][0].pop('uri', None) != 'terrain.bin' or external != document:
            raise ValueError('Standalone terrain glTF differs from GLB')
    if digest(old_bin[start:start+length]) != OLD_UV or digest(new_bin[start:start+length]) != NEW_UV:
        raise ValueError('Primary UV hash does not match the qualified oracle')
    expected = bytearray(old_bin)
    changed = 0
    for vertex in range(2352):
        x, y = 64 + vertex % 49, 208 + vertex // 49
        position = start + vertex * 8
        if struct.unpack_from('<ff', old_bin, position) != ((x+.5)/256, (y+.5)/256):
            raise ValueError('Original terrain grid differs')
        if y > 240:
            struct.pack_into('<f', expected, position + 4, (y+.5)/256-(y-240)/4096)
            changed += 1
    if changed != 735 or bytes(expected) != new_bin:
        raise ValueError('Terrain changed outside the 735 qualified V fields')
    old_manifest, new_manifest = decode(old_files['manifest.json']), decode(new_files['manifest.json'])
    rule = new_manifest.get('maskUVRule', {})
    source = rule.get('source', {})
    if (rule.get('id') != RULE or source.get('packageSha256') != MAP_SHA or source.get('object') != '20_20.TerrainInfo0' or
        source.get('heightmapDimensions') != [256, 256] or source.get('gridMinimum') != [64, 208] or source.get('gridMaximum') != [112, 255] or
        new_doc['meshes'][0].get('extras', {}).get('maskUVRule') != rule):
        raise ValueError('Missing qualified source/section provenance')
    if old_manifest.get('recipe') != new_manifest.get('recipe') or old_manifest.get('selectedRegion') != new_manifest.get('selectedRegion'):
        raise ValueError('Selected terrain recipe/region changed')
    allowed = {'receipt.json', 'manifest.json', 'layers.json', 'terrain.glb', 'terrain.gltf', 'terrain.bin'}
    if set(old_files) != set(new_files) or any(old_files[name] != new_files[name] for name in old_files if name not in allowed):
        raise ValueError('Unrelated terrain sidecars changed')
    return {'changedVScalars': changed, 'primaryUVSha256': NEW_UV, 'otherBufferBytesUnchanged': True}


def original_runtime(root):
    base = local(root, 'public/l2/maps/' + BASE_MANIFEST)
    manifest_data = checked(local(base, 'map-section-runtime/manifest.json'), BASE_MANIFEST)
    manifest = decode(manifest_data)
    receipt_data = local(base, 'map-section-runtime/receipt.json').read_bytes()
    receipt = decode(receipt_data)
    if (receipt.get('kind') != 'native-map-section-runtime' or receipt.get('manifestSha256') != BASE_MANIFEST or
        manifest.get('kind') != 'native-map-section-runtime' or manifest.get('schemaVersion') != 1 or manifest.get('errors') or
        manifest.get('support') != 'section-products-ready-for-runtime-validation' or
        manifest.get('resourceRoots') != {'terrain': '../map-section', 'models': '../map-section-models'}):
        raise ValueError('Original runtime identity/state differs')
    geometry_receipt, geometry = geometry_files(local(base, 'map-section'))
    if digest(geometry['receipt.json']) != receipt.get('sectionReceiptSha256'):
        raise ValueError('Original geometry receipt differs')
    if (manifest['terrain']['file'] != 'terrain.glb' or manifest['terrain']['sha256'] != digest(geometry['terrain.glb']) or
        manifest['terrain']['bytes'] != len(geometry['terrain.glb'])):
        raise ValueError('Original terrain binding differs')
    models, archives, identities = {}, {}, set()
    for model in manifest['models']:
        archive, glb = model['archive'], model['model']
        sha = archive['sha256']
        if model['id'] in identities or archive['file'] != sha + '/asset.l2asset' or glb['file'] != sha + '/model.glb':
            raise ValueError('Invalid or duplicate original model identity')
        identities.add(model['id'])
        archive_path = local(base, 'map-section-models/' + archive['file'])
        checked(archive_path, sha, archive['bytes'])
        result, archive_data, asset, payloads = verified_archive(archive_path, sha)
        if result['kind'] != 'model' or result['id'] != model['id'] or asset['model']['file'] != 'model.glb':
            raise ValueError('Original model archive identity differs')
        checked(local(base, 'map-section-models/' + glb['file']), glb['sha256'], glb['bytes'])
        if digest(payloads['model.glb']) != glb['sha256']:
            raise ValueError('Original model GLB differs from archive')
        models['map-section-models/' + archive['file']] = archive_path
        for name, payload in payloads.items():
            relative = 'map-section-models/' + sha + '/' + name
            path = local(base, relative)
            checked(path, digest(payload), len(payload))
            models[relative] = path
        for slot in decode(payloads.get('provenance.json', b'{}')).get('metadata', {}).get('materialSlots', []):
            if 'texture' in slot:
                relative = 'map-section-models/' + sha + '/evidence/export/' + '/'.join(slot['texture'].split('.')) + '.png'
                path = local(base, relative)
                checked(path, slot['textureSha256'])
                models[relative] = path
        archives[archive['file']] = sha
    if not identities or archives != receipt.get('modelArchives') or any(p['modelId'] not in identities for p in manifest['placements']):
        raise ValueError('Original model set/placements differ')
    return manifest, receipt, receipt_data, geometry, models


def catalog_replace(data, section):
    """Replace only one JSON value span; preserve every byte outside that span."""
    text = data.decode('utf-8')
    catalog = decode(text)
    matches = [item for item in catalog.get('sections', []) if item.get('id') == SECTION]
    if len(matches) != 1:
        raise ValueError('Catalog must contain one selected section')
    start = len(text) - len(text.lstrip())
    if text[start:start+1] != '{':
        raise ValueError('Catalog must be an object')
    decoder, cursor = json.JSONDecoder(object_pairs_hook=unique_pairs), start + 1
    while True:
        while text[cursor].isspace() or text[cursor] == ',':
            cursor += 1
        if text[cursor] == '}':
            raise ValueError('Catalog sections array not found')
        key, cursor = decoder.raw_decode(text, cursor)
        while text[cursor].isspace():
            cursor += 1
        if text[cursor] != ':':
            raise ValueError('Invalid catalog member')
        cursor += 1
        while text[cursor].isspace():
            cursor += 1
        if key != 'sections':
            _, cursor = decoder.raw_decode(text, cursor)
            continue
        if text[cursor] != '[':
            raise ValueError('Invalid catalog sections')
        cursor += 1
        while True:
            while text[cursor].isspace() or text[cursor] == ',':
                cursor += 1
            item, end = decoder.raw_decode(text, cursor)
            if item.get('id') == SECTION:
                return (text[:cursor] + json_bytes(section).decode() + text[end:]).encode(), item
            cursor = end


def payload(value):
    return value.read_bytes() if isinstance(value, Path) else value


def derivation(old_receipt, old_receipt_data, new_geometry, comparison):
    return {'schemaVersion': 1, 'kind': 'native-terrain-primary-uv-migration', 'rule': RULE,
        'scriptSha256': digest(Path(__file__).read_bytes()), 'handoffSha256': HANDOFF_SHA,
        'validatorImplementations': {name: digest((Path(__file__).parent / name).read_bytes())
            for name in ('stage_native_runtime.py', 'native_assets.py', 'native_assets_lib/gltf.py')},
        'originalRuntimeManifestSha256': BASE_MANIFEST, 'originalRuntimeReceiptSha256': digest(old_receipt_data),
        'newGeometryReceiptSha256': digest(new_geometry['receipt.json']),
        'modelConversion': 'unchanged original archives; no reconversion or current-converter certification',
        'originalConverterProvenance': {k: old_receipt[k] for k in ('implementationSha256', 'converterImplementationSha256', 'umodelSha256') if k in old_receipt},
        'nativeEvidenceLimit': 'offscreen submitted coordinates and configured bindings; no visible pixel parity', **comparison}


def derived_receipt(manifest_sha, original_receipt, provenance):
    return {'schemaVersion': 1, 'kind': 'native-map-section-runtime', 'manifestSha256': manifest_sha,
        'sectionReceiptSha256': provenance['newGeometryReceiptSha256'], 'modelArchives': original_receipt['modelArchives'],
        'derivation': provenance,
        'validationScope': 'geometry-only derivation; not native_migration.verify_section_runtime/current converter certification'}


def prepare_bundle(root, geometry, output):
    root = Path(root).absolute()
    if root.is_symlink() or getattr(root, 'is_junction', lambda: False)():
        raise ValueError('Project root must not be a link')
    geometry, output = project_path(root, geometry), project_path(root, output)
    artifacts = local(root, 'artifacts')
    if (not geometry.is_relative_to(artifacts) or not output.is_relative_to(artifacts) or
        geometry.is_relative_to(output) or output.is_relative_to(geometry)):
        raise ValueError('Geometry and scratch output must be separate artifacts directories')
    manifest, old_receipt, receipt_data, old_geometry, models = original_runtime(root)
    new_receipt, new_geometry = geometry_files(geometry)
    comparison = compare_geometry(old_geometry, new_geometry)
    provenance = derivation(old_receipt, receipt_data, new_geometry, comparison)
    derived = copy.deepcopy(manifest)
    derived['terrain'].update(sha256=digest(new_geometry['terrain.glb']), bytes=len(new_geometry['terrain.glb']))
    derived['derivation'] = provenance
    runtime_data = json_bytes(derived)
    runtime_sha = digest(runtime_data)
    receipt = derived_receipt(runtime_sha, old_receipt, provenance)
    prefix = 'maps/' + runtime_sha + '/'
    files = {prefix + 'map-section/' + name: data for name, data in new_geometry.items()}
    files.update({prefix + name: path for name, path in models.items()})
    files[prefix + 'map-section-runtime/manifest.json'] = runtime_data
    files[prefix + 'map-section-runtime/receipt.json'] = json_bytes(receipt)
    current_catalog = local(root, 'public/l2/catalog.json').read_bytes()
    if output.exists() and any(output.iterdir()):
        before = local(output, 'catalog.before.json').read_bytes()
    else:
        before = current_catalog
    target_entry = {'id': SECTION, 'manifest': '/l2/' + prefix + 'map-section-runtime/manifest.json', 'manifestSha256': runtime_sha}
    # Preserve unknown fields within the selected entry too.
    original_entry = next((item for item in decode(before).get('sections', []) if item.get('id') == SECTION), {})
    expected_old = '/l2/maps/' + BASE_MANIFEST + '/map-section-runtime/manifest.json'
    if original_entry.get('manifest') != expected_old or original_entry.get('manifestSha256') != BASE_MANIFEST:
        raise ValueError('Catalog no longer selects the pinned source; preserve newer work')
    target_entry = {**original_entry, **target_entry}
    after, _ = catalog_replace(before, target_entry)
    if current_catalog not in (before, after):
        raise ValueError('Stale catalog: changed since the bundle was prepared')
    files.update({'catalog.before.json': before, 'catalog.after.json': after})
    files = {name: payload(value) for name, value in files.items()}
    records = {name: {'sha256': digest(value), 'bytes': len(value)} for name, value in sorted(files.items())}
    plan = {'schemaVersion': 1, 'kind': 'native-terrain-runtime-migration', 'baseManifestSha256': BASE_MANIFEST,
        'manifestSha256': runtime_sha, 'catalogBeforeSha256': digest(before), 'catalogAfterSha256': digest(after),
        'files': records, 'derivation': provenance}
    files['bundle.json'] = json_bytes(plan)
    if output.exists():
        existing = set()
        for path in output.rglob('*'):
            local(output, path.relative_to(output).as_posix())
            if path.is_file():
                existing.add(path.relative_to(output).as_posix())
        if existing and existing != set(files):
            raise ValueError('Existing bundle file set differs; use a new scratch directory')
    for name, value in files.items():
        path = local(output, name)
        if path.exists() and path.read_bytes() != payload(value):
            raise ValueError('Existing immutable bundle differs: ' + name)
    for name, value in files.items():
        immutable_write(local(output, name), payload(value))
    return plan


def stage_bundle(root, output):
    root = Path(root).absolute()
    if root.is_symlink() or getattr(root, 'is_junction', lambda: False)():
        raise ValueError('Project root must not be a link')
    output = project_path(root, output)
    if not output.is_relative_to(local(root, 'artifacts')):
        raise ValueError('Bundle must remain in project artifacts')
    plan = decode(local(output, 'bundle.json').read_bytes())
    if (plan.get('kind') != 'native-terrain-runtime-migration' or plan.get('baseManifestSha256') != BASE_MANIFEST or
        plan.get('derivation', {}).get('scriptSha256') != digest(Path(__file__).read_bytes())):
        raise ValueError('Unsupported or stale bundle recipe')
    # Reconstruct the entire plan from original immutable inputs and bundled
    # geometry before any public write; receipts alone cannot bless tampering.
    geometry = local(output, 'maps/' + plan['manifestSha256'] + '/map-section')
    old_manifest, old_receipt, old_receipt_data, old_geometry, models = original_runtime(root)
    _, new_geometry = geometry_files(geometry)
    comparison = compare_geometry(old_geometry, new_geometry)
    expected_provenance = derivation(old_receipt, old_receipt_data, new_geometry, comparison)
    if plan['derivation'] != expected_provenance:
        raise ValueError('Derived provenance differs from verified inputs')
    files = {name: checked(local(output, name), record['sha256'], record['bytes']) for name, record in plan['files'].items()}
    before, after = files['catalog.before.json'], files['catalog.after.json']
    if digest(before) != plan['catalogBeforeSha256'] or digest(after) != plan['catalogAfterSha256']:
        raise ValueError('Catalog receipt differs')
    prefix = 'maps/' + plan['manifestSha256'] + '/'
    expected_files = {prefix + 'map-section/' + name for name in new_geometry} | {prefix + name for name in models} | {
        prefix + 'map-section-runtime/manifest.json', prefix + 'map-section-runtime/receipt.json', 'catalog.before.json', 'catalog.after.json'}
    if set(files) != expected_files:
        raise ValueError('Derived resource file set differs')
    expected = copy.deepcopy(old_manifest)
    expected['terrain'].update(sha256=digest(new_geometry['terrain.glb']), bytes=len(new_geometry['terrain.glb']))
    expected['derivation'] = plan['derivation']
    if json_bytes(expected) != files[prefix + 'map-section-runtime/manifest.json'] or digest(json_bytes(expected)) != plan['manifestSha256']:
        raise ValueError('Derived runtime changed unrelated source data')
    if files[prefix + 'map-section-runtime/receipt.json'] != json_bytes(derived_receipt(plan['manifestSha256'], old_receipt, expected_provenance)):
        raise ValueError('Derived receipt differs from verified inputs')
    if (plan['derivation'].get('originalRuntimeReceiptSha256') != digest(old_receipt_data) or
        plan['derivation'].get('newGeometryReceiptSha256') != digest(new_geometry['receipt.json'])):
        raise ValueError('Original/derived dependency changed')
    for name, path in models.items():
        if files.get(prefix + name) != path.read_bytes():
            raise ValueError('Derived model bytes changed')
    expected_entry = next(item for item in decode(before)['sections'] if item['id'] == SECTION)
    expected_entry = {**expected_entry, 'manifest': '/l2/' + prefix + 'map-section-runtime/manifest.json', 'manifestSha256': plan['manifestSha256']}
    expected_catalog, _ = catalog_replace(before, expected_entry)
    if expected_catalog != after:
        raise ValueError('Catalog changed outside the selected section entry')
    catalog = local(root, 'public/l2/catalog.json')
    current = catalog.read_bytes()
    if current not in (before, after):
        raise ValueError('Stale catalog: public selection changed; no publication')
    public_files = {name: data for name, data in files.items() if name.startswith(prefix)}
    for name, data in public_files.items():
        path = local(root, 'public/l2/' + name)
        if path.exists() and path.read_bytes() != data:
            raise ValueError('Existing immutable public resource differs')
    if current == after:
        if any(not local(root, 'public/l2/' + name).is_file() for name in public_files):
            raise ValueError('Already-selected runtime has missing immutable resources')
        return {'status': 'already-staged', 'manifestSha256': plan['manifestSha256']}
    if catalog.read_bytes() != before:
        raise ValueError('Stale catalog before publication')
    for name, data in public_files.items():
        immutable_write(local(root, 'public/l2/' + name), data)
    if catalog.read_bytes() != before:
        raise ValueError('Stale catalog; immutable resources retained but selection untouched')
    replace_file(catalog, after)
    return {'status': 'staged', 'manifestSha256': plan['manifestSha256'], 'files': len(public_files)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--geometry', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--stage', action='store_true')
    args = parser.parse_args()
    plan = prepare_bundle(ROOT, args.geometry, args.output)
    result = {'status': 'bundle-ready', 'manifestSha256': plan['manifestSha256'], 'output': str(args.output), 'publicChanged': False}
    if args.stage:
        staged = stage_bundle(ROOT, args.output)
        result.update(staged, publicChanged=staged['status'] == 'staged')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
