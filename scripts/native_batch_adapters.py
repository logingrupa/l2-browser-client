from __future__ import annotations

from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import stat
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
ADAPTERS = frozenset(('assets', 'migration', 'environment', 'sky', 'sounds', 'ambient'))
HASH = re.compile(r'[a-f0-9]{64}')
ID = re.compile(r'[a-z0-9][a-z0-9-]{0,79}')
COMMON_LIMIT = 'Offline conversion coverage only; no browser staging, world playback, Editor acceptance or native parity is established.'


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def relative_name(name):
    require(isinstance(name, str) and 0 < len(name) <= 1024 and '\\' not in name, 'Invalid relative product/recipe path')
    for part in name.split('/'):
        require(part not in ('', '.', '..') and not re.search(r'[:\x00-\x1f]', part) and not part.endswith(('.', ' '))
                and not re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', part, re.I),
                'Unsafe relative product/recipe path: ' + name)
    return name


def reject_links(path):
    for entry in (path, *path.parents):
        if entry.exists() or entry.is_symlink():
            info = entry.lstat()
            require(not stat.S_ISLNK(info.st_mode) and not (getattr(info, 'st_file_attributes', 0) & 0x400),
                    'Linked/reparse input or product refused: ' + str(entry))


def child(root, name):
    root = Path(root).absolute()
    path = root / relative_name(name)
    reject_links(path)
    require(path.resolve().is_relative_to(root.resolve()) and path.is_file(), 'Missing/escaped regular file: ' + name)
    return path


def read_json(path):
    path = Path(path)
    reject_links(path.absolute())
    require(path.is_file() and path.stat().st_size <= 64 * 1024 * 1024, 'Missing/oversized JSON file: ' + str(path))
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(path.read_text(encoding='utf-8-sig'), object_pairs_hook=unique,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite JSON value: ' + value)))


def validate_job(job):
    require(isinstance(job, dict), 'Batch job must be an object')
    require(set(job) <= {'id', 'adapter', 'source', 'recipe', 'files', 'dependsOn'}, 'Unknown batch adapter job field')
    require(isinstance(job.get('id'), str) and ID.fullmatch(job['id']), 'Invalid batch job ID')
    require(isinstance(job.get('adapter'), str) and job['adapter'] in ADAPTERS, 'Unknown batch adapter')
    require(isinstance(job.get('source'), str) and ID.fullmatch(job['source']), 'Invalid batch source ID')
    if 'dependsOn' in job:
        values = job['dependsOn']
        require(isinstance(values, list) and all(isinstance(v, str) and ID.fullmatch(v) for v in values)
                and len(values) == len(set(values)) and job['id'] not in values, 'Invalid job dependencies')
    needs_recipe = job['adapter'] in ('assets', 'migration', 'sounds', 'ambient')
    require(('recipe' in job) == needs_recipe, 'This adapter requires exactly its supported recipe field')
    if needs_recipe:
        relative_name(job['recipe'])
    require('files' not in job or job['adapter'] == 'environment', 'files is only supported for environment jobs')
    if 'files' in job:
        files = job['files']
        require(isinstance(files, list) and 0 < len(files) <= 64 and
                all(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9._-]*\.int', name) for name in files),
                'Environment files must be explicit flat .int names')
        require(len(files) == len(set(name.casefold() for name in files)), 'Duplicate environment source name')


def recipe_paths(job, project_root=ROOT):
    validate_job(job)
    if 'recipe' not in job:
        return []
    recipe = child(project_root, job['recipe'])
    paths = [recipe]
    if job['adapter'] == 'migration':
        value = read_json(recipe)
        require(value.get('schemaVersion') == 1 and isinstance(value.get('jobs'), list) and value['jobs'], 'Invalid legacy migration recipe')
        paths += [child(project_root, value[key]) for key in ('sourceManifest', 'acceptance')]
        for row in value['jobs']:
            require(isinstance(row, dict) and row.get('adapter') in ('assets', 'effect', 'npc-profiles'),
                    'Unknown legacy migration adapter')
            paths.append(child(project_root, row['recipe']))
    return sorted(set(paths))


def _audio_module(name):
    filename = 'export-native-sounds.py' if name == 'sounds' else 'export-native-map-audio.py'
    spec = importlib.util.spec_from_file_location('_batch_' + name, ROOT / 'scripts' / filename)
    require(spec is not None and spec.loader is not None, 'Missing audio adapter module')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def adapter_pins(name):
    require(isinstance(name, str) and name in ADAPTERS, 'Unknown batch adapter')
    files = {'scripts/native_batch_adapters.py'}
    result = {}
    if name in ('assets', 'migration', 'sounds', 'ambient'):
        import native_assets
        result['fingerprint:native-assets'] = native_assets.implementation_hash()
        tool = Path(native_assets.UMODEL)
        reject_links(tool.absolute())
        actual = digest(tool.read_bytes())
        require(actual == native_assets.UMODEL_SHA256, 'UModel differs from pinned converter tool')
        result['tool:UEViewer-UModel-build1590'] = actual
        files.add('scripts/native_assets.py')
    if name == 'migration':
        files.update('scripts/' + item for item in ('native_migration.py', 'native_source_stage.py', 'native_actor_profiles.py',
            'native_texture_validation.py', 'validate-native-gltf.mjs'))
    elif name in ('sounds', 'ambient'):
        files.update('scripts/' + item for item in _audio_module(name).implementation()['files'])
    elif name == 'environment':
        files.update('scripts/' + item for item in ('native_environment.py', 'export-native-environment.py', 'native_catalog/ue2.py'))
    elif name == 'sky':
        files.update('scripts/' + item for item in ('native_sky.py', 'native_bsp_floor.py', 'world/bsp_reader_binding.py', 'world/map_actor_properties.py',
            'native_catalog/ue2.py', 'native_assets_lib/gltf.py', 'native_assets_lib/texture_dds.py'))
        files.update(path.relative_to(ROOT).as_posix() for path in (ROOT / 'scripts/vendor/lineage2elbera_bsp').rglob('*.py'))
        from PIL import DdsImagePlugin, Image
        for label, path in [('Pillow-DdsImagePlugin', DdsImagePlugin.__file__), ('Pillow-imaging', Image.core.__file__)]:
            result['tool:' + label] = digest(Path(path).read_bytes())
    result.update({name: digest(child(ROOT, name).read_bytes()) for name in sorted(files)})
    return dict(sorted(result.items()))


def command(job, source_root, source_lock, output, project_root=ROOT):
    validate_job(job)
    name = job['adapter']
    recipe_paths(job, project_root)
    recipe = str(child(project_root, job['recipe'])) if 'recipe' in job else None
    script = {'assets': 'native_assets.py', 'migration': 'native_migration.py', 'environment': 'export-native-environment.py',
              'sky': 'native_sky.py', 'sounds': 'export-native-sounds.py', 'ambient': 'export-native-map-audio.py'}[name]
    argv = [sys.executable, '-B', str(child(project_root, 'scripts/' + script))]
    source_root, source_lock, output = map(lambda value: str(Path(value).absolute()), (source_root, source_lock, output))
    if name == 'assets':
        return argv + ['batch', recipe, '--client', source_root, '--output', output]
    if name == 'migration':
        require(child(project_root, read_json(recipe)['sourceManifest']).resolve() == Path(source_lock).resolve(),
                'Legacy migration source lock differs from the selected batch source')
        return argv + ['--recipe', recipe, '--client', source_root, '--output', output]
    if name == 'environment':
        return argv + ['--input-dir', source_root, '--output', output] + (['--files', *job['files']] if 'files' in job else [])
    if name == 'sky':
        return argv + ['--client', source_root, '--output', output]
    return argv + ['--client-snapshot', source_root, '--input-lock', source_lock, '--recipe', recipe, '--output', output]


def _lock(source_lock):
    value = read_json(source_lock)
    require(value.get('schemaVersion') == 1 and isinstance(value.get('files'), list) and value['files'], 'Invalid batch source lock')
    pins, folded = {}, set()
    for row in value['files']:
        name = relative_name(row['relativePath'])
        require(name.casefold() not in folded and isinstance(row.get('sha256'), str) and HASH.fullmatch(row['sha256'])
                and type(row.get('bytes')) is int and row['bytes'] > 0, 'Invalid/duplicate locked source')
        folded.add(name.casefold()); pins[name] = row
    return pins


def _dependencies(values, pins, target):
    require(isinstance(values, dict), 'Source dependency table must be an object')
    for name, value in values.items():
        relative_name(name)
        sha256 = value.get('sha256') if isinstance(value, dict) else value
        require(name in pins and sha256 == pins[name]['sha256'], 'Unpinned/mismatched source dependency: ' + name)
        require(name not in target or target[name] == sha256, 'Conflicting source dependency')
        target[name] = sha256


def _checked_files(output, descriptors):
    require(isinstance(descriptors, dict) and descriptors, 'Empty/invalid product table')
    result, folded = [], set()
    for name, info in descriptors.items():
        relative_name(name)
        require(name.casefold() not in folded, 'Case-colliding product path')
        folded.add(name.casefold())
        expected = info.get('sha256') if isinstance(info, dict) else info
        require(isinstance(expected, str) and HASH.fullmatch(expected), 'Invalid product SHA256')
        data = child(output, name).read_bytes()
        require(digest(data) == expected, 'Product hash differs: ' + name)
        if isinstance(info, dict) and 'bytes' in info:
            require(type(info['bytes']) is int and info['bytes'] == len(data), 'Product length differs: ' + name)
        result.append(name)
    return result


def _asset(output, relative, pins, dependencies, expected_request=None):
    import native_assets
    archive_path = child(output, relative)
    checked = native_assets.verify_archive(archive_path)
    manifest = read_json(archive_path.parent / 'asset.json')
    provenance = read_json(archive_path.parent / 'provenance.json')
    require(manifest.get('kind') in ('model', 'texture', 'audio') and manifest.get('id') == checked['id'], 'Invalid asset kind/identity')
    require(provenance.get('source') == manifest.get('source') and provenance.get('converterSha256') == native_assets.implementation_hash()
            and provenance.get('tool', {}).get('sha256') == native_assets.UMODEL_SHA256, 'Asset converter/source provenance differs')
    if expected_request is not None:
        require(provenance.get('request') == expected_request and manifest['kind'] == expected_request.get('kind'), 'Asset request/kind differs')
    _dependencies(provenance['dependencies'], pins, dependencies)
    products = [relative]
    with zipfile.ZipFile(archive_path) as archive:
        for entry in archive.namelist():
            path = child(archive_path.parent, entry)
            require(path.read_bytes() == archive.read(entry), 'Loose asset payload differs from archive: ' + entry)
            products.append(path.relative_to(Path(output)).as_posix())
    return manifest, products


def _assets(job, output, pins, project_root):
    import native_assets
    requests = read_json(child(project_root, job['recipe']))
    require(isinstance(requests, list) and 0 < len(requests) <= 4096, 'Asset recipe must contain bounded requests')
    products, dependencies, counts, limits = [], {}, Counter(), []
    for request in requests:
        require(isinstance(request, dict), 'Invalid asset request')
        request = {key: value for key, value in request.items() if value is not None}
        key = native_assets.sha(native_assets.json_bytes({'request': request, 'implementation': native_assets.implementation_hash(),
                                                         'umodel': native_assets.UMODEL_SHA256}))
        index = 'index/' + key + '.json'
        record = read_json(child(output, index))
        directory = record.get('directory')
        require(isinstance(directory, str) and HASH.fullmatch(directory), 'Invalid content-addressed asset directory')
        require(isinstance(record.get('outputs'), dict) and {'asset.json', 'asset.l2asset', 'provenance.json'} <= record['outputs'].keys(),
                'Asset cache index lacks required products')
        _checked_files(Path(output) / directory, record['outputs'])
        _dependencies(record['dependencies'], pins, dependencies)
        manifest, entries = _asset(output, directory + '/asset.l2asset', pins, dependencies, request)
        require(set(record['outputs']) == {str(Path(entry).relative_to(directory)).replace('\\', '/') for entry in entries},
                'Asset cache index does not describe exactly the archive and loose payloads')
        require(record['dependencies'] == read_json(child(output, directory + '/provenance.json'))['dependencies'],
                'Asset cache index dependency closure differs from provenance')
        require(digest(child(output, directory + '/asset.l2asset').read_bytes()) == directory, 'Asset directory differs from archive hash')
        products += [index, *entries]
        counts[manifest['kind'] + 'Assets'] += 1
        counts['animationEvents'] += len(manifest.get('animationEvents', []))
        limits.extend(manifest.get('limitations', []))
    counts['requestedAssets'] = len(requests)
    limits.append('Asset collection verifies archive/payload integrity and source identities; Khronos glTF validation, rendered geometry/deformation and audible behavior are separate checks.')
    return _result('converted', counts, products, dependencies, [], limits)


def _environment(job, output, pins):
    from native_environment import build_products, DEFAULT_FILES
    manifest = read_json(child(output, 'manifest.json'))
    require(manifest.get('kind') == 'native-environment-conversion', 'Wrong environment product kind')
    names = job.get('files', DEFAULT_FILES)
    sources = {name: child(output, 'original/' + relative_name(name)).read_bytes() for name in names}
    expected = build_products(sources)
    require(set(expected) == set(manifest.get('products', {})) | {'manifest.json'}, 'Environment product closure differs')
    for name, data in expected.items():
        require(child(output, name).read_bytes() == data, 'Environment reconstructed product differs: ' + name)
    dependencies = {}
    for row in manifest['inputs']:
        _dependencies({row['name']: row['originalSha256']}, pins, dependencies)
        require(row['originalBytes'] == pins[row['name']]['bytes'], 'Environment source length differs')
    tables = read_json(child(output, 'sky-tables.json'))
    records = read_json(child(output, 'environment-records.json'))
    unsupported = [row for row in tables.get('anomalies', []) if row.get('kind') == 'unsupported-color-syntax']
    if not tables['typedComplete'] and not unsupported:
        unsupported = [{'status': 'typed-table-coverage-incomplete', 'anomalies': tables.get('anomalies', [])}]
    return _result('converted' if tables['typedComplete'] else 'partial',
        {'sourceFiles': len(sources), 'propertyRecords': records['propertyRecords'], 'tables': tables['tableCount'],
         'physicalColorRows': tables['physicalColorRows'], 'anomalies': len(tables.get('anomalies', []))},
        expected.keys(), dependencies, unsupported, ['Source tables do not select native file/type/time/interpolation or runtime colors.'])


def _sky(output, pins):
    manifest = read_json(child(output, 'manifest.json'))
    require(manifest.get('schemaVersion') == 1 and manifest.get('kind') == 'native-sky-source-bundle', 'Wrong sky product kind')
    products = _checked_files(output, manifest['files'])
    require({'sky.json', 'sky.glb'} <= set(products), 'Sky payloads are incomplete')
    snapshot = read_json(child(output, 'sky.json'))
    require(snapshot.get('kind') == 'native-sky-source-snapshot' and snapshot.get('source') == manifest['source']
            and snapshot.get('id') == manifest.get('id'), 'Sky snapshot identity differs')
    source = manifest['source']
    require(source.get('converterSha256') == digest((ROOT / 'scripts/native_sky.py').read_bytes()) and
            source.get('ddsWrapperSha256') == digest((ROOT / 'scripts/native_assets_lib/texture_dds.py').read_bytes()), 'Sky converter pins changed')
    dependencies = {}
    _dependencies({'maps/20_20.unr': source['mapSha256'], 'textures/l2_skies.utx': source['skyPackageSha256'],
                   'system/Engine.u': source['enginePackageSha256']}, pins, dependencies)
    parts = snapshot['parts']
    counts = {'nodes': sum(len(part['nodeRanges']) for part in parts), 'vertices': sum(len(part['positions']) // 3 for part in parts),
              'triangles': sum(len(part['indices']) // 3 for part in parts), 'materialRoots': len(parts),
              'textures': len({part['texture']['sourceReference'] for part in parts})}
    require(counts == manifest['counts'], 'Sky coverage counts differ from retained geometry')
    return _result('converted', counts, ['manifest.json', *products], dependencies, [], manifest['limitations'])


def _migration(job, output, pins, source_lock, project_root):
    import native_migration
    recipe = read_json(child(project_root, job['recipe']))
    coverage = read_json(child(output, 'coverage.json'))
    validation = read_json(child(output, 'validation.json'))
    require(coverage.get('migrationRecipe') == recipe and coverage.get('sourceManifestSha256') == digest(Path(source_lock).read_bytes()),
            'Migration recipe/source lock provenance differs')
    require(coverage.get('acceptanceSha256') == digest(child(project_root, recipe['acceptance']).read_bytes()), 'Migration acceptance pin differs')
    expected = set()
    for row in recipe['jobs']:
        require(coverage.get('recipePins', {}).get(row['recipe']) == digest(child(project_root, row['recipe']).read_bytes()), 'Migration child recipe differs')
        expected.update(row['id'] + ':' + str(i) for i in range(len(read_json(child(project_root, row['recipe']))))) if row['adapter'] == 'assets' else expected.add(row['id'])
    jobs = coverage.get('jobs', [])
    require(len(jobs) == len(expected) and {row['id'] for row in jobs} == expected, 'Migration omitted or duplicated requested jobs')
    require(validation.get('passed') is True and validation.get('errors') == [], 'Migration product validation failed')
    archives, bundles = native_migration.active_products(output)
    archive_checks = {row['path']: row for row in validation['archives']}
    bundle_checks = {row['path']: row for row in validation['bundles']}
    require(len(archive_checks) == len(validation['archives']) and set(archive_checks) ==
            {path.relative_to(Path(output)).as_posix() for path in archives}, 'Migration archive validation coverage differs')
    require(len(bundle_checks) == len(validation['bundles']) and set(bundle_checks) ==
            {path.relative_to(Path(output)).as_posix() for path in bundles}, 'Migration bundle validation coverage differs')
    products = read_json(child(output, 'products.json'))
    require(products == native_migration.product_files(output), 'Migration products differ from their active receipt')
    files = _checked_files(output, products)
    dependencies, kinds = {}, Counter()
    for path in archives:
        relative = path.relative_to(Path(output)).as_posix()
        manifest, extra = _asset(output, relative, pins, dependencies)
        check = archive_checks[relative]
        require(check.get('archiveVerified') is True and check.get('id') == manifest['id'] and check.get('kind') == manifest['kind']
                and check.get('sha256') == digest(path.read_bytes()) and check.get('bytes') == path.stat().st_size,
                'Migration archive validation identity differs')
        if manifest['kind'] == 'model':
            require_passed_migration_gltf_summary(check.get('gltf'))
        files += extra; kinds[manifest['kind'] + 'Assets'] += 1
    for bundle in bundles:
        receipt = read_json(bundle / 'receipt.json')
        _dependencies(native_migration.receipt_dependencies(receipt), pins, dependencies)
        manifest = read_json(bundle / 'manifest.json')
        check = bundle_checks[bundle.relative_to(Path(output)).as_posix()]
        require(check.get('verified') is True and check.get('kind') == manifest.get('kind'), 'Migration bundle validation identity differs')
    unsupported = [row for row in jobs if row.get('support') == 'failed' or row.get('unsupported')]
    unsupported += coverage.get('unsupportedPackages', [])
    return _result('partial' if unsupported else 'converted', {'requestedJobs': len(jobs), 'bundleCount': len(bundles), **kinds},
        ['coverage.json', 'validation.json', 'products.json', *files], dependencies, unsupported,
        [*coverage.get('deferred', []), 'Migration validation summaries are bound to active products; validators are not rerun by collection.'])


def require_passed_migration_gltf_summary(summary):
    require(isinstance(summary, dict) and summary.get('version') == '2.0.0-dev.3.10' and summary.get('errors') == 0
            and type(summary.get('warnings')) is int and summary['warnings'] >= 0, 'Migration glTF validation summary is missing or failed')


def _audio(job, output, pins, source_lock, project_root):
    name = job['adapter']; module = _audio_module(name)
    owner = read_json(child(output, 'run.json')); inventory = read_json(child(output, 'inventory.json'))
    coverage = read_json(child(output, 'coverage.json')); manifest = read_json(child(output, 'SHA256-MANIFEST.json'))
    require(owner.get('kind') == ('native-staged-sound-products' if name == 'sounds' else 'native-map-ambient-audio-products')
            and owner.get('recipeSha256') == digest(child(project_root, job['recipe']).read_bytes())
            and owner.get('inputLockSha256') == digest(Path(source_lock).read_bytes())
            and owner.get('implementation') == module.implementation(), 'Audio owner/implementation/source pins differ')
    require(coverage.get('kind') == ('native-staged-sound-coverage' if name == 'sounds' else 'native-map-ambient-export-coverage'), 'Wrong audio coverage kind')
    require(coverage == module.coverage_document(inventory, coverage['sounds']), 'Audio coverage counters/status differ')
    require(len(coverage['sounds']) == len(inventory['sounds']), 'Audio source/product row count differs')
    require(manifest.get('schemaVersion') == 1 and isinstance(manifest.get('files'), list), 'Invalid audio output manifest')
    descriptors = {row['path']: row for row in manifest['files']}
    require(len(descriptors) == len(manifest['files']) and 'SHA256-MANIFEST.json' not in descriptors, 'Duplicate/self-referencing audio product')
    files = _checked_files(output, descriptors)
    actual = set()
    for path in Path(output).rglob('*'):
        reject_links(path)
        if path.is_file(): actual.add(path.relative_to(Path(output)).as_posix())
    require(actual == set(files) | {'SHA256-MANIFEST.json'}, 'Audio file closure changed or run is incomplete')
    dependencies = {}
    if 'map' in inventory:
        row = inventory['map']; _dependencies({row['relativePath']: row['sha256']}, pins, dependencies)
    for row in inventory.get('packages', []):
        source = row['source']; _dependencies({source['relativePath']: source['sha256']}, pins, dependencies)
    for source, result in zip(inventory['sounds'], coverage['sounds']):
        identity = 'stableId' if name == 'sounds' else 'referenceKey'
        require(isinstance(source.get(identity), str) and result.get(identity) == source[identity], 'Audio source/result identity differs')
        if source.get('sourcePackage'):
            package = source['sourcePackage']; _dependencies({package['relativePath']: package['sha256']}, pins, dependencies)
        if result['status'] == 'exported-and-verified':
            descriptor = result['products']['archive']
            require(descriptor['path'] in descriptors, 'Audio archive is outside product manifest')
            _checked_files(output, {descriptor['path']: descriptor})
            asset, _ = _asset(output, descriptor['path'], pins, dependencies)
            package = source['sourcePackage']; export = source['export']
            require(asset['kind'] == 'audio' and asset['id'] == source['id'] and
                    asset['source']['object'] == export['object'] and asset['source']['sha256'] == package['sha256'],
                    'Audio archive identity differs from source inventory')
            folder = child(output, descriptor['path']).parent
            provenance = read_json(folder / 'provenance.json')
            require(provenance['request'] == {'kind': 'audio', 'package': package['relativePath'], 'object': export['object']}
                    and provenance['dependencies'] == {package['relativePath']: package['sha256']}, 'Audio request/dependency join differs')
            metadata = provenance['metadata']; native = source['nativeSound']
            raw_descriptor = source['serializedExport']
            _checked_files(output, {raw_descriptor['path']: raw_descriptor})
            if name == 'sounds':
                native_descriptor = source['nativePayload']
                _checked_files(output, {native_descriptor['path']: native_descriptor})
                native_path = child(output, native_descriptor['path'])
            else:
                native_path = child(output, source['nativePayloadFile'])
            original = native_path.read_bytes()
            require(metadata['nativePayloadSha256'] == digest(original) == native['embeddedPayloadSha256'] and
                    metadata['nativeExportIndex'] == export['exportIndex'] == native['exportIndex'] and
                    metadata['nativeFormat'] == native['nativeFormat'] and len(original) == native['embeddedPayloadBytes'],
                    'Audio source payload/export-index join differs')
            serialized = child(output, raw_descriptor['path']).read_bytes()
            offset = native['embeddedPayloadOffsetUnwrapped'] - export['offset']
            require(offset >= 0 and serialized[offset:offset + len(original)] == original and
                    len(serialized) == export['size'], 'Audio payload does not join retained serialized source bytes')
            from native_audio import decode_native_audio
            decoded, mime, decoded_metadata = decode_native_audio(native_path)
            expected_metadata = {**decoded_metadata, 'nativePayloadSha256': digest(original),
                                 'nativeExportIndex': export['exportIndex'], 'nativeFormat': native['nativeFormat']}
            audio_path = child(folder, asset['audio']['file'])
            audio_descriptor = result['products']['audio']
            require(metadata == expected_metadata and audio_descriptor['metadata'] == metadata and
                    audio_descriptor['mime'] == mime and audio_descriptor['path'] == audio_path.relative_to(Path(output)).as_posix()
                    and audio_path.read_bytes() == decoded, 'Audio decoded payload/metadata join differs')
            _checked_files(output, {audio_descriptor['path']: audio_descriptor})
    unsupported = [row for row in coverage['sounds'] if row['status'] != 'exported-and-verified']
    if name == 'sounds':
        unsupported += [row for row in inventory.get('packages', []) if row.get('status') == 'unsupported-package']
    complete = coverage['status'] in ('selected-staged-sounds-exported', 'referenced-dependencies-exported-omissions-unresolved')
    return _result('converted' if complete else 'partial', coverage['counts'], ['SHA256-MANIFEST.json', *files],
                   dependencies, unsupported, inventory.get('limitations', []))


def _result(status, counts, products, dependencies, unsupported, limits):
    return {'status': status, 'counts': dict(counts), 'products': sorted(set(products)),
            'sourceDependencies': dict(sorted(dependencies.items())), 'unsupported': unsupported,
            'limits': list(dict.fromkeys([COMMON_LIMIT, *limits]))}


def collect(job, output, source_lock, project_root=ROOT):
    validate_job(job)
    output = Path(output).absolute()
    reject_links(output)
    require(output.is_dir(), 'Adapter output directory is missing')
    try:
        for path in output.rglob('*'):
            reject_links(path)
        pins = _lock(source_lock)
        if job['adapter'] == 'assets': return _assets(job, output, pins, project_root)
        if job['adapter'] == 'environment': return _environment(job, output, pins)
        if job['adapter'] == 'sky': return _sky(output, pins)
        if job['adapter'] == 'migration': return _migration(job, output, pins, source_lock, project_root)
        return _audio(job, output, pins, source_lock, project_root)
    except (KeyError, TypeError, IndexError) as error:
        raise ValueError('Malformed ' + job['adapter'] + ' product/receipt: ' + str(error)) from error
