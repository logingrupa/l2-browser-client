"""Run the source-pinned raw migration milestone; no native client is executed."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import zipfile

from native_assets import Converter, UMODEL, hash_file, verify_archive
from native_assets_lib.gltf import json_bytes
from native_source_stage import inventory, read_manifest, stage, verify_sources
from native_texture_validation import verify_texture_products

ROOT = Path(__file__).resolve().parent.parent
DEFERRED = [
    'Native visual acceptance of equipment and attack/death playback, world gameplay/collision and native terrain layer rendering.',
    'Live Power Strike timing and attachment, complete character attack reference and Babylon effect simulation; reviewed source dispatch is preserved.',
    'Native/browser visual acceptance and actual Babylon Editor edit/save/rebuild acceptance.',
    'Runtime compressed-texture/material integration, unoptimized workload baseline and subsequent optimization/120 FPS tests.',
]


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_bytes(json_bytes(value))
    temporary.replace(path)


def project_file(relative):
    if not isinstance(relative, str):
        raise ValueError('Recipe file must be a project-relative path')
    path = (ROOT / relative).resolve(strict=True)
    if not path.is_relative_to(ROOT) or not path.is_file():
        raise ValueError('Recipe file escapes project')
    return path


def load_recipe(path):
    recipe = read_json(path)
    if recipe.get('schemaVersion') != 1 or not isinstance(recipe.get('jobs'), list) or not recipe['jobs']:
        raise ValueError('Expected schemaVersion1 migration recipe with jobs')
    ids, earlier_adapters = set(), {}
    for job in recipe['jobs']:
        identity = job.get('id', '')
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', identity) or identity in ids:
            raise ValueError('Migration job ID is invalid or duplicated')
        ids.add(identity)
        if job.get('adapter') not in ('assets', 'map', 'effect', 'map-section', 'npc-profiles'):
            raise ValueError('Unknown migration adapter: ' + str(job.get('adapter')))
        if job['adapter'] == 'map-section' and earlier_adapters.get(job.get('mapJob')) != 'map':
            raise ValueError('Map section requires an explicitly named earlier raw-map job')
        earlier_adapters[identity] = job['adapter']
        project_file(job['recipe'])
    project_file(recipe['sourceManifest'])
    project_file(recipe['acceptance'])
    return recipe


def safe_output(output, client):
    output, client = Path(output).resolve(), Path(client).resolve()
    allowed = (ROOT / 'artifacts').resolve()
    if not output.is_relative_to(allowed) or output == allowed:
        raise ValueError('Migration output must be a subdirectory of project artifacts/')
    if output.is_relative_to(client) or client.is_relative_to(output):
        raise ValueError('Migration outputs and source inputs must not overlap')
    return output


def dependency_pins(dependencies, manifest):
    pinned = {entry['relativePath'].casefold(): entry['sha256'] for entry in manifest['files']}
    for name, value in dependencies.items():
        digest = value['sha256'] if isinstance(value, dict) else value
        if pinned.get(name.casefold()) != digest:
            raise ValueError('Output depends on a source outside the pinned fleet snapshot: ' + name)


def output_file(output, relative):
    path = (Path(output) / relative).resolve()
    if not path.is_relative_to(Path(output).resolve()):
        raise ValueError('Migration product escapes output root')
    return path


def active_products(output):
    """Only the current recipe's catalog, not superseded immutable cache entries."""
    coverage = read_json(Path(output) / 'coverage.json')
    archives, bundles = set(), []
    for job in coverage['jobs']:
        if job['support'] == 'failed':
            continue
        path = output_file(output, job['path'])
        if path.name == 'asset.l2asset':
            archives.add(path)
        else:
            bundle = read_json(path)
            bundles.append(path.parent)
            if bundle.get('kind') == 'native-map-section-runtime':
                context = section_context(output, job)
                bundles.append(context['geometry'])
                for model in bundle['models']:
                    archives.add(output_file(context['models'], model['archive']['file']))
            else:
                for asset in bundle.get('assets', []):
                    archives.add(output_file(path.parent, asset['archive']))
    return sorted(archives), sorted(set(bundles))


def section_context(output, job):
    identity = job['id']
    base = 'sections/' + identity
    if job.get('adapter') != 'map-section' or job.get('path') != base+'/map-section-runtime/manifest.json' or job.get('geometryPath') != base+'/map-section/manifest.json':
        raise ValueError('Map section product paths differ from the declared adapter')
    map_job = job.get('sourceMapJob', '')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', map_job) or job.get('sourceMapPath') != 'maps/'+map_job+'/manifest.json':
        raise ValueError('Map section source-map dependency is missing or invalid')
    return {'raw': output_file(output, 'maps/'+map_job), 'geometry': output_file(output, base+'/map-section'),
            'models': output_file(output, base+'/map-section-models'), 'runtime': output_file(output, base+'/map-section-runtime')}


def receipt_files(receipt):
    if receipt.get('kind') == 'native-map-section-runtime':
        return ['manifest.json']
    if 'outputs' in receipt:
        return receipt['outputs']
    return ['manifest.json', *(entry['file'] for entry in receipt['files'])]


def receipt_dependencies(receipt):
    if 'dependencies' in receipt:
        return receipt['dependencies']
    if 'sourceDependencies' in receipt:
        return receipt['sourceDependencies']
    if receipt.get('kind') == 'native-map-section-runtime':
        # Runtime products pin the complete geometry receipt and every model
        # archive; their source dependencies are verified through those products.
        return {}
    return {entry['path']: entry['sha256'] for entry in receipt['sourceFiles']}


def check_coverage(recipe, output):
    coverage = read_json(Path(output) / 'coverage.json')
    if coverage.get('migrationRecipe') != recipe:
        raise ValueError('Migration recipe differs from recorded coverage')
    for key, path in [('sourceManifestSha256', recipe['sourceManifest']), ('acceptanceSha256', recipe['acceptance'])]:
        if coverage.get(key) != hash_file(project_file(path)):
            raise ValueError('Migration provenance/acceptance pin changed: ' + key)
    expected = set()
    for job in recipe['jobs']:
        if coverage.get('recipePins', {}).get(job['recipe']) != hash_file(project_file(job['recipe'])):
            raise ValueError('Migration job recipe pin changed: ' + job['id'])
        if job['adapter'] == 'assets':
            expected.update(job['id'] + ':' + str(index) for index in range(len(read_json(project_file(job['recipe'])))))
        else:
            expected.add(job['id'])
    jobs = coverage.get('jobs', [])
    if not expected or len(jobs) != len(expected) or {job['id'] for job in jobs} != expected:
        raise ValueError('Migration coverage does not contain every requested job exactly once')
    if any(job['support'] == 'failed' or job.get('unsupported') for job in jobs):
        raise ValueError('Migration coverage contains failed or unsupported requested jobs')
    recorded = {job['id']: job for job in jobs}
    for job in recipe['jobs']:
        if job['adapter'] == 'map-section':
            row = recorded[job['id']]
            section_context(output, row)
            if row['sourceMapJob'] != job['mapJob'] or recorded.get(job['mapJob'], {}).get('path') != 'maps/'+job['mapJob']+'/manifest.json':
                raise ValueError('Map section dependency differs from its requested raw-map job')
            if row['support'] != 'section-products-ready-for-runtime-validation':
                raise ValueError('Map section coverage is incomplete')


def product_files(output):
    """Authored products only; diagnostics and validator timestamps are not products."""
    output = Path(output)
    products = {}
    archives, bundles = active_products(output)
    for path in archives:
        products[path.relative_to(output).as_posix()] = hash_file(path)
    for bundle in bundles:
        receipt_path = bundle / 'receipt.json'
        receipt = read_json(receipt_path)
        products[receipt_path.relative_to(output).as_posix()] = hash_file(receipt_path)
        for relative in receipt_files(receipt):
            path = output_file(bundle, relative)
            products[path.relative_to(output).as_posix()] = hash_file(path)
    return dict(sorted(products.items()))


def validate_products(output, client, manifest):
    output = Path(output)
    results, errors = [], []
    archives, bundles = active_products(output)
    for path in archives:
        relative = path.relative_to(output).as_posix()
        try:
            result = verify_archive(path)
            with zipfile.ZipFile(path) as archive:
                for name in archive.namelist():
                    unpacked = output_file(path.parent, name)
                    if not unpacked.is_file() or unpacked.read_bytes() != archive.read(name):
                        raise ValueError('Unpacked file differs from verified archive: ' + name)
            asset = read_json(path.parent / 'asset.json')
            provenance = read_json(path.parent / 'provenance.json')
            dependency_pins(provenance['dependencies'], manifest)
            # Validate unpacked payloads too: these are the files used by tools.
            for entry in asset['files']:
                payload = (path.parent / entry['path']).resolve()
                if not payload.is_relative_to(path.parent.resolve()) or hash_file(payload) != entry['sha256']:
                    raise ValueError('Unpacked payload differs from archive manifest')
            row = {'path': relative, **{key: result[key] for key in ('id', 'kind', 'sha256', 'bytes')}, 'archiveVerified': True}
            if result['kind'] == 'model':
                report = output / 'validation' / (result['sha256'] + '.gltf.json')
                report.parent.mkdir(parents=True, exist_ok=True)
                completed = subprocess.run(['node', str(ROOT / 'scripts/validate-native-gltf.mjs'), str(path.parent / asset['model']['file']), str(report)], capture_output=True, text=True, timeout=180)
                if completed.returncode:
                    detail = completed.stderr.strip() or completed.stdout.strip()
                    raise ValueError('Khronos glTF validation failed: ' + detail)
                validation = read_json(report)
                row['gltf'] = {'version': validation['version'], 'errors': validation['issues']['numErrors'], 'warnings': validation['issues']['numWarnings']}
            elif result['kind'] == 'texture':
                row['texture'] = verify_texture_products(path.parent, provenance['metadata'])
            results.append(row)
        except (ValueError, OSError, KeyError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
            errors.append({'path': relative, 'error': str(error)})
    from native_map import verify_map
    from native_map_geometry import verify_geometry, verify_section_runtime
    from native_effect_bundle import verify_effect_bundle
    from native_actor_profiles import verify_npc_profiles
    contexts = {}
    for job in read_json(output/'coverage.json')['jobs']:
        if job.get('adapter') == 'map-section' and job['support'] != 'failed':
            context = section_context(output, job)
            contexts[context['geometry']] = contexts[context['runtime']] = context
    bundle_results = []
    for bundle in bundles:
        receipt = bundle / 'receipt.json'
        try:
            dependency_pins(receipt_dependencies(read_json(receipt)), manifest)
            kind = read_json(bundle/'manifest.json').get('kind')
            row = {'path': bundle.relative_to(output).as_posix(), 'kind': kind, 'verified': True}
            if kind == 'native-map-raw':
                verify_map(client, bundle)
            elif kind == 'native-effect-bundle':
                verify_effect_bundle(client, bundle)
            elif kind == 'native-npc-profiles':
                verify_npc_profiles(client, bundle)
            elif kind == 'native-terrain-section':
                context = contexts[bundle]
                verify_geometry(client, context['raw'], bundle)
                glb = bundle/'terrain.glb'
                report = output/'validation'/(hash_file(glb)+'.gltf.json')
                report.parent.mkdir(parents=True, exist_ok=True)
                completed = subprocess.run(['node', str(ROOT/'scripts/validate-native-gltf.mjs'), str(glb), str(report)], capture_output=True, text=True, timeout=180)
                if completed.returncode:
                    raise ValueError('Terrain Khronos glTF validation failed: '+(completed.stderr.strip() or completed.stdout.strip()))
                validation = read_json(report)
                row['gltf'] = {'version': validation['version'], 'errors': validation['issues']['numErrors'], 'warnings': validation['issues']['numWarnings']}
            elif kind == 'native-map-section-runtime':
                context = contexts[bundle]
                result = verify_section_runtime(client, context['raw'], context['geometry'], context['models'], bundle)
                if result['errors'] or result['support'] != 'section-products-ready-for-runtime-validation':
                    raise ValueError('Section runtime products are incomplete: '+json.dumps(result['errors']))
            else:
                raise ValueError('Unknown active migration bundle kind: '+str(kind))
            bundle_results.append(row)
        except (ValueError, OSError, KeyError) as error:
            errors.append({'path': receipt.relative_to(output).as_posix(), 'error': str(error)})
    return {'archives': results, 'bundles': bundle_results, 'errors': errors, 'passed': not errors}


def run_migration(recipe, client, output, manifest, source_inventory=None):
    output = safe_output(output, client)
    output.mkdir(parents=True, exist_ok=True)
    source_inventory = source_inventory or inventory(manifest, client)
    write_json(output / 'inventory.json', source_inventory)
    converter = Converter(client, output / 'assets', os.environ.get('L2_UMODEL', str(UMODEL)))
    from native_map import migrate_map
    from native_effect_bundle import migrate_effect_bundle
    from native_actor_profiles import migrate_npc_profiles
    from native_map_geometry import build_geometry, build_section_runtime
    jobs, run_rows = [], []
    for job in recipe['jobs']:
        print(json.dumps({'job': job['id'], 'state': 'started'}), flush=True)
        request = read_json(project_file(job['recipe']))
        started = time.monotonic()
        try:
            if job['adapter'] == 'assets':
                if not isinstance(request, list) or not request:
                    raise ValueError('Asset recipe must contain requests')
                for index, entry in enumerate(request):
                    identity = job['id'] + ':' + str(index)
                    try:
                        result = converter.convert(entry)
                        path = Path(result['file'])
                        asset = read_json(path.parent / 'asset.json')
                        jobs.append({'id': identity, 'recipe': job['recipe'], 'requestIndex': index, 'support': 'converted', 'assetId': result['id'], 'sha256': result['sha256'], 'path': path.relative_to(output).as_posix(), 'limitations': asset['limitations']})
                        if asset['kind'] == 'texture':
                            texture_metadata = read_json(path.parent / 'provenance.json')['metadata']
                            jobs[-1]['textureProducts'] = {key: texture_metadata[key] for key in ('nativeTextureSource', 'nativeTextureDDS')}
                        elif asset['kind'] == 'model':
                            model_metadata = read_json(path.parent / 'provenance.json')['metadata']
                            parts = model_metadata.get('parts', [model_metadata])
                            jobs[-1]['nativeAttachmentSources'] = [part['nativeAttachmentSource'] for part in parts if 'nativeAttachmentSource' in part]
                            if 'nativeAnimationFamilies' in model_metadata:
                                jobs[-1]['nativeAnimationFamilies'] = model_metadata['nativeAnimationFamilies']
                        run_rows.append({'id': identity, 'cacheHit': result['cacheHit']})
                    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as error:
                        jobs.append({'id': identity, 'recipe': job['recipe'], 'support': 'failed', 'error': str(error)})
            elif job['adapter'] == 'map-section':
                raw = output/'maps'/job['mapJob']
                base = output/'sections'/job['id']
                dependency = next((row for row in jobs if row['id'] == job['mapJob']), None)
                if not dependency or dependency['support'] == 'failed' or dependency.get('unsupported'):
                    raise ValueError('Required raw-map migration did not succeed: '+job['mapJob'])
                geometry = build_geometry(client, raw, request, base/'map-section')
                runtime = build_section_runtime(client, raw, base/'map-section', base/'map-section-models', base/'map-section-runtime', os.environ.get('L2_UMODEL', str(UMODEL)))
                runtime_manifest = read_json(base/'map-section-runtime/manifest.json')
                jobs.append({'id': job['id'], 'adapter': 'map-section', 'recipe': job['recipe'], 'support': runtime['support'],
                             'path': (base/'map-section-runtime/manifest.json').relative_to(output).as_posix(),
                             'geometryPath': (base/'map-section/manifest.json').relative_to(output).as_posix(),
                             'sourceMapJob': job['mapJob'], 'sourceMapPath': 'maps/'+job['mapJob']+'/manifest.json',
                             'coverage': {**geometry['coverage'], **runtime_manifest.get('coverage', {})},
                             'unsupportedRuntimeMaterials': runtime_manifest.get('unsupportedRuntimeMaterials', []),
                             'gaps': list(dict.fromkeys(geometry['gaps']+runtime_manifest['gaps'])),
                             'unsupported': runtime['errors']})
                run_rows.append({'id': job['id'], 'cacheHit': geometry['cacheHit'] and runtime['cacheHits'] == runtime['models'] and not runtime['errors'],
                                 'geometryCacheHit': geometry['cacheHit'], 'staticModelCacheHits': runtime['cacheHits'], 'staticModels': runtime['models']})
            else:
                folder, migrate = {'map': ('maps', migrate_map), 'effect': ('effects', migrate_effect_bundle),
                    'npc-profiles': ('npc-profiles', migrate_npc_profiles)}[job['adapter']]
                result = migrate(client, request, output / folder / job['id'])
                bundle = read_json(output / folder / job['id'] / 'manifest.json')
                support = result.get('support', bundle.get('support', 'raw-data-extracted'))
                coverage = support if isinstance(support, dict) else result.get('coverage', bundle.get('coverage'))
                jobs.append({'id': job['id'], 'recipe': job['recipe'], 'support': 'raw-data-extracted' if isinstance(support, dict) else support, 'path': folder + '/' + job['id'] + '/manifest.json', 'coverage': coverage, 'gaps': result.get('gaps', bundle.get('gaps', [])), 'unsupported': result.get('unsupported', bundle.get('unsupported', []))})
                if job['adapter'] == 'npc-profiles':
                    jobs[-1]['adapter'] = 'npc-profiles'
                run_rows.append({'id': job['id'], 'cacheHit': result['cacheHit']})
        except (ValueError, OSError, KeyError, subprocess.SubprocessError) as error:
            jobs.append({'id': job['id'], 'recipe': job['recipe'], 'support': 'failed', 'error': str(error)})
        print(json.dumps({'job': job['id'], 'seconds': round(time.monotonic() - started, 3), 'state': 'finished'}), flush=True)
    pins = {job['recipe']: hash_file(project_file(job['recipe'])) for job in recipe['jobs']}
    coverage = {'schemaVersion': 1, 'milestone': 'raw-programmatic-migration', 'sourceHost': manifest['sourceHost'], 'sourceRoot': manifest['sourceRoot'], 'sourceManifestSha256': hash_file(project_file(recipe['sourceManifest'])), 'acceptanceSha256': hash_file(project_file(recipe['acceptance'])), 'recipePins': pins, 'jobs': jobs, 'unsupportedPackages': [row for row in source_inventory['files'] if row['status'].startswith('unsupported')], 'deferred': DEFERRED, 'visualAcceptance': 'unverified', 'editorAcceptance': 'unverified', 'performanceAcceptance': 'not-measured'}
    coverage['migrationRecipe'] = recipe
    coverage['knownDefects'] = recipe.get('knownDefects', [])
    write_json(output / 'coverage.json', coverage)
    verification = validate_products(output, client, manifest)
    write_json(output / 'validation.json', verification)
    write_json(output / 'products.json', product_files(output))
    # Run cache flags do not alter deterministic migration products.
    write_json(output / 'run.json', {'jobs': run_rows})
    ok = verification['passed'] and all(job['support'] != 'failed' and not job.get('unsupported') for job in jobs)
    summary = {'passed': ok, 'output': str(output), 'jobs': len(jobs), 'archives': len(verification['archives']), 'cacheHits': sum(row['cacheHit'] for row in run_rows), 'cacheJobs': len(run_rows), 'failedJobs': [job['id'] for job in jobs if job['support'] == 'failed']}
    print(json.dumps(summary), flush=True)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recipe', type=Path, default=ROOT / 'recipes/native-migration.json')
    parser.add_argument('--client', type=Path, default=ROOT / 'artifacts/native-parity/inputs/IMPORTA-PC')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/native-parity/migration')
    parser.add_argument('--fleet-stage', action='store_true', help='Rehash authoritative fleet inputs and fill the local staged snapshot first')
    parser.add_argument('--local-candidate', type=Path, help='Optional existing local copy; remote equality is checked before reuse')
    parser.add_argument('--ssh-alias', default='fleet-importa-pc')
    parser.add_argument('--inventory-only', action='store_true')
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--prove-rebuild', action='store_true', help='After migration, test cache replay and rebuild into a genuinely empty retained directory')
    parser.add_argument('--stage-runtime', action='store_true', help='Stage current verified models into ignored public/l2 for local browser/Editor use')
    args = parser.parse_args()
    recipe = load_recipe(args.recipe)
    manifest = read_manifest(project_file(recipe['sourceManifest']))
    output = safe_output(args.output, args.client)
    if args.fleet_stage:
        result = stage(manifest, args.client, args.local_candidate, args.ssh_alias)
        write_json(output / 'staging.json', result)
    if args.verify_only:
        verify_sources(manifest, args.client)
        check_coverage(recipe, output)
        verification = validate_products(output, args.client, manifest)
        if not (output / 'products.json').exists() or product_files(output) != read_json(output / 'products.json'):
            raise ValueError('Products differ from recorded migration or migration is missing')
        print(json.dumps(verification, indent=2))
        return 0 if verification['passed'] else 1
    source_inventory = inventory(manifest, args.client)
    if args.inventory_only:
        write_json(output / 'inventory.json', source_inventory)
        print(json.dumps(source_inventory['verification']))
        return 0
    first = run_migration(recipe, args.client, output, manifest, source_inventory)
    if not first['passed']:
        return 1
    if args.stage_runtime:
        from stage_native_runtime import stage_runtime
        print(json.dumps(stage_runtime(output)), flush=True)
    if args.prove_rebuild:
        expected = product_files(output)
        replay = run_migration(recipe, args.client, output, manifest, source_inventory)
        unchanged = expected == product_files(output)
        rebuild = Path(tempfile.mkdtemp(prefix='migration-clean-', dir=output.parent))
        clean = run_migration(recipe, args.client, rebuild, manifest, source_inventory)
        actual = product_files(rebuild)
        proof = {'schemaVersion': 1, 'passed': replay['passed'] and clean['passed'] and unchanged and expected == actual and replay['cacheHits'] == replay['cacheJobs'] and clean['cacheHits'] == 0, 'cacheReplay': replay, 'cleanBuild': clean, 'cleanDirectoryWasEmpty': True, 'productCount': len(expected), 'productsIdentical': expected == actual, 'mismatches': sorted(key for key in expected.keys() | actual.keys() if expected.get(key) != actual.get(key)), 'acceptanceSha256': hash_file(project_file(recipe['acceptance']))}
        write_json(output / 'reproducibility.json', proof)
        print(json.dumps(proof), flush=True)
        return 0 if proof['passed'] else 1
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        sys.exit(1)
