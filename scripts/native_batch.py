"""One offline, recipe-driven entry point for existing native converters.

Never stages public assets, edits Editor scenes or invokes a native game client.
An unchanged batch is reused after hash verification, without rerunning adapters.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys

import native_batch_adapters as adapters

ROOT = Path(__file__).resolve().parent.parent
ID = re.compile(r'[a-z0-9][a-z0-9-]{0,79}')
HASH = re.compile(r'[a-f0-9]{64}')
MAX_JSON = 32 * 1024 * 1024


def require(value, message):
    if not value:
        raise ValueError(message)


def canonical(value):
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=True) + '\n').encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def safe_relative(value):
    require(isinstance(value, str) and value and '\\' not in value, 'Expected portable relative path')
    for part in value.split('/'):
        require(part and part not in ('.', '..') and not re.search(r'[:\x00-\x1f]', part)
                and not part.endswith(('.', ' ')) and not re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', part, re.I),
                'Unsafe relative path: ' + value)
    return value


def checked(path):
    path = Path(path).absolute()
    for parent in (path, *path.parents):
        if parent.exists() or parent.is_symlink():
            info = parent.lstat()
            require(not stat.S_ISLNK(info.st_mode) and not (getattr(info, 'st_file_attributes', 0) & 0x400),
                    'Symlink/junction/reparse boundary refused: ' + str(parent))
    return path.resolve()


def child(root, relative):
    root = checked(root)
    path = checked(root / safe_relative(relative))
    require(path.is_relative_to(root) and path != root, 'Path escapes declared root')
    return path


def load_json(path):
    path = checked(path)
    require(path.is_file() and 0 < path.stat().st_size <= MAX_JSON, 'JSON input missing or too large: ' + str(path))
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(path.read_bytes(), object_pairs_hook=unique,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Non-finite JSON: ' + value)))


def write_new(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as stream:
        stream.write(canonical(value))


def verify_lock(root, lock_path):
    lock = load_json(lock_path)
    require(lock.get('schemaVersion') == 1 and isinstance(lock.get('files'), list) and lock['files'], 'Invalid source lock')
    require(len(lock['files']) <= 100_000, 'Source lock is too large')
    pins, names = {}, set()
    for item in lock['files']:
        name = safe_relative(item['relativePath'])
        require(name.casefold() not in names, 'Duplicate/case-colliding source identity')
        names.add(name.casefold())
        require(type(item.get('bytes')) is int and item['bytes'] > 0 and isinstance(item.get('sha256'), str)
                and HASH.fullmatch(item['sha256']), 'Invalid source pin: ' + name)
        path = child(root, name)
        require(path.is_file() and path.stat().st_size == item['bytes'] and file_hash(path) == item['sha256'],
                'Source hash/size differs: ' + name)
        pins[name] = {'bytes': item['bytes'], 'sha256': item['sha256']}
    return pins


def prepare(recipe_path, output, project_root=ROOT):
    project_root = checked(project_root)
    recipe_path = checked(recipe_path)
    require(recipe_path.is_relative_to(project_root), 'Batch recipe must be inside project')
    recipe = load_json(recipe_path)
    require(set(recipe) == {'schemaVersion', 'kind', 'id', 'sources', 'jobs'} and recipe['schemaVersion'] == 1
            and recipe['kind'] == 'native-offline-asset-batch' and isinstance(recipe['id'], str) and ID.fullmatch(recipe['id']),
            'Invalid offline batch recipe')
    require(isinstance(recipe['sources'], dict) and 0 < len(recipe['sources']) <= 16, 'Declare source sets')
    require(isinstance(recipe['jobs'], list) and 0 < len(recipe['jobs']) <= 256, 'Declare 1..256 jobs')
    output = checked(output)
    artifacts = checked(project_root / 'artifacts')
    require(output.is_relative_to(artifacts) and output != artifacts, 'Batch output must be a dedicated artifacts subdirectory')
    require(not recipe_path.is_relative_to(output), 'Output overlaps batch recipe')
    sources = {}
    for name, source in recipe['sources'].items():
        require(ID.fullmatch(name) and isinstance(source, dict) and set(source) == {'root', 'lock'}, 'Invalid source set')
        root, lock = child(project_root, source['root']), child(project_root, source['lock'])
        require(root.is_dir(), 'Source root missing')
        require(not root.is_relative_to(output) and not output.is_relative_to(root) and not lock.is_relative_to(output),
                'Output overlaps source input/lock')
        sources[name] = {'root': source['root'], 'lock': source['lock'], 'lockSha256': file_hash(lock),
                         'files': verify_lock(root, lock)}
    ids, planned = set(), []
    for job in recipe['jobs']:
        adapters.validate_job(job)
        require(isinstance(job['id'], str) and ID.fullmatch(job['id']) and job['id'] not in ids, 'Invalid/duplicate job identity')
        require(job['source'] in sources, 'Unknown source set')
        dependencies = job.get('dependsOn', [])
        require(isinstance(dependencies, list) and all(isinstance(item, str) for item in dependencies)
                and len(set(dependencies)) == len(dependencies) and set(dependencies) <= ids,
                'Dependencies must name distinct earlier jobs')
        ids.add(job['id'])
        source = sources[job['source']]
        recipe_pins = {}
        for path in adapters.recipe_paths(job, project_root):
            path = checked(path)
            require(path.is_relative_to(project_root) and not path.is_relative_to(output), 'Job recipe escapes project/overlaps output')
            recipe_pins[path.relative_to(project_root).as_posix()] = file_hash(path)
        pins = adapters.adapter_pins(job['adapter'])
        descriptor = {'request': job, 'source': source, 'recipePins': recipe_pins, 'adapterPins': pins,
                      'collectorSha256': file_hash(Path(adapters.__file__))}
        planned.append({'id': job['id'], 'fingerprint': digest(canonical(descriptor)), 'descriptor': descriptor})
        # Validate the exact command during preflight, before any output writes.
        adapters.command(job, child(project_root, source['root']), child(project_root, source['lock']),
                         output / 'jobs' / job['id'], project_root)
    owner = {'schemaVersion': 1, 'kind': recipe['kind'], 'id': recipe['id'], 'recipe': recipe,
             'recipeSha256': file_hash(recipe_path), 'orchestratorSha256': file_hash(Path(__file__)),
             'sources': sources, 'jobs': planned,
             'scope': {'offline': True, 'browserStaging': False, 'editorEdits': False, 'nativeExecution': False}}
    return owner


def product_receipt(root, names):
    require(isinstance(names, list) and names and all(isinstance(name, str) for name in names), 'Adapter returned no products')
    require(len({name.casefold() for name in names}) == len(names), 'Duplicate/case-colliding products')
    result = {}
    for name in sorted(names):
        path = child(root, name)
        require(path.is_file(), 'Product is missing: ' + name)
        result[name] = {'bytes': path.stat().st_size, 'sha256': file_hash(path)}
    return result


def verify_products(root, products):
    require(isinstance(products, dict) and products, 'Empty product receipt')
    actual = product_receipt(root, list(products))
    require(actual == products, 'Converted product hash/size differs')


def verify_batch(output, owner=None):
    output = checked(output)
    require(not (output / '.running.json').exists(), 'Batch is active/interrupted; retained output is not a completed cache')
    recorded = load_json(output / 'owner.json')
    if owner is not None:
        require(recorded == owner, 'Batch inputs/settings/implementation changed; use a fresh output')
    receipt = load_json(output / 'batch.json')
    seal = load_json(output / 'complete.json')
    require(seal == {'schemaVersion': 1, 'ownerSha256': digest(canonical(recorded)),
                     'batchSha256': file_hash(output / 'batch.json')}, 'Batch completion seal differs')
    require(receipt.get('schemaVersion') == 1 and receipt.get('ownerSha256') == digest(canonical(recorded)), 'Batch ownership pin differs')
    planned = recorded['jobs']
    require(len(receipt['jobs']) == len(planned), 'Batch coverage is incomplete')
    for expected, result in zip(planned, receipt['jobs']):
        require(isinstance(expected['id'], str) and ID.fullmatch(expected['id'])
                and expected['fingerprint'] == digest(canonical(expected['descriptor'])), 'Invalid stored job descriptor')
        require(result['id'] == expected['id'] and result['fingerprint'] == expected['fingerprint'], 'Batch job identity differs')
        if result['status'] in ('converted', 'partial'):
            verify_products(output / 'jobs' / result['id'], result['products'])
        else:
            require(result['status'] in ('failed', 'blocked'), 'Unknown batch status')
    require(receipt['status'] == overall(receipt['jobs']), 'Batch status differs from actual jobs')
    return receipt


def overall(jobs):
    if any(job['status'] in ('failed', 'blocked') for job in jobs):
        return 'failed'
    return 'partial' if any(job['status'] == 'partial' for job in jobs) else 'converted'


def coverage(status):
    return {'sourceInventory': 'hash-verified-declared-source-set', 'conversion': status,
            'productIntegrity': 'verified' if status in ('converted', 'partial') else 'not-established',
            'browserStaging': 'not-requested', 'runtimeIntegration': 'not-evaluated', 'nativeParity': 'unverified'}


def run(recipe_path, output, *, plan_only=False, verify_only=False, reuse_from=None, project_root=ROOT, execute=subprocess.run):
    require(not (plan_only and verify_only), 'Plan and verify-only are separate modes')
    require(not (reuse_from and (plan_only or verify_only)), 'Reuse is only for a fresh conversion batch')
    project_root = checked(project_root)
    output = checked(output)
    owner = prepare(recipe_path, output, project_root)
    if plan_only:
        return {'mode': 'plan', 'output': str(output), 'owner': owner, 'writes': 0}
    if output.exists():
        require(output.is_dir(), 'Output is not a directory')
        require((output / 'owner.json').is_file(), 'Existing output is unowned; use a fresh directory')
        require(reuse_from is None, 'Reuse target must be fresh')
        receipt = verify_batch(output, owner)
        return {'mode': 'verify' if verify_only else 'verified-batch-reuse', 'output': str(output),
                'status': receipt['status'], 'jobs': receipt['jobs'], 'adapterExecutions': 0, 'writes': 0}
    require(not verify_only, 'Verify-only requires a complete existing batch')
    reuse = None
    if reuse_from:
        reuse_from = checked(reuse_from)
        require(not output.is_relative_to(reuse_from) and not reuse_from.is_relative_to(output), 'Reuse and output overlap')
        reuse = verify_batch(reuse_from)
    output.mkdir(parents=True, exist_ok=False)
    write_new(output / 'owner.json', owner)
    write_new(output / '.running.json', {'pid': os.getpid(), 'ownerSha256': digest(canonical(owner))})
    results, executions = [], 0
    try:
        for planned in owner['jobs']:
            job = planned['descriptor']['request']
            source = owner['sources'][job['source']]
            base = output / 'jobs' / job['id']
            result = {'id': job['id'], 'adapter': job['adapter'], 'fingerprint': planned['fingerprint']}
            dependencies = job.get('dependsOn', [])
            if any(row['id'] in dependencies and row['status'] != 'converted' for row in results):
                results.append({**result, 'status': 'blocked', 'coverage': coverage('blocked'), 'reason': 'Required earlier job is incomplete'})
                continue
            try:
                prior = next((row for row in reuse['jobs'] if row['id'] == job['id'] and row['fingerprint'] == planned['fingerprint']
                              and row['status'] in ('converted', 'partial')), None) if reuse else None
                if prior:
                    for name in prior['products']:
                        original = child(reuse_from / 'jobs' / job['id'], name)
                        destination = child(base, name)
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        with original.open('rb') as src, destination.open('xb') as dst:
                            shutil.copyfileobj(src, dst)
                    verify_products(base, prior['products'])
                    mode = 'verified-product-copy'
                else:
                    argv = adapters.command(job, child(project_root, source['root']), child(project_root, source['lock']), base, project_root)
                    logs = output / 'diagnostics'
                    logs.mkdir(exist_ok=True)
                    print(json.dumps({'job': job['id'], 'state': 'started', 'adapter': job['adapter']}), flush=True)
                    with (logs / (job['id'] + '.stdout.log')).open('xb') as stdout, (logs / (job['id'] + '.stderr.log')).open('xb') as stderr:
                        completed = execute(argv, cwd=project_root, stdout=stdout, stderr=stderr, shell=False, check=False)
                    executions += 1
                    require(completed.returncode in (0, 2), f'Adapter failed with exit {completed.returncode}; inspect retained diagnostics')
                    mode = 'adapter-executed'
                collected = adapters.collect(job, base, child(project_root, source['lock']), project_root)
                require(collected['status'] in ('converted', 'partial'), 'Invalid adapter status')
                if not prior:
                    require(completed.returncode == (0 if collected['status'] == 'converted' else 2), 'Adapter exit and coverage disagree')
                products = product_receipt(base, collected['products'])
                results.append({**result, 'status': collected['status'], 'counts': collected['counts'],
                                'sourceDependencies': collected['sourceDependencies'], 'products': products,
                                'unsupported': collected['unsupported'], 'limits': collected['limits'],
                                'coverage': coverage(collected['status'])})
                print(json.dumps({'job': job['id'], 'state': collected['status'], 'mode': mode, 'counts': collected['counts']}), flush=True)
            except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
                results.append({**result, 'status': 'failed', 'error': str(error), 'coverage': coverage('failed')})
                print(json.dumps({'job': job['id'], 'state': 'failed', 'error': str(error)}), flush=True)
        # Rehash locked originals after conversion before sealing a result.
        require(prepare(recipe_path, output, project_root) == owner,
                'Sources, recipes or implementation changed during batch')
        receipt = {'schemaVersion': 1, 'kind': 'native-offline-asset-batch-result', 'id': owner['id'],
                   'ownerSha256': digest(canonical(owner)), 'status': overall(results), 'jobs': results,
                   'counts': {'requestedJobs': len(owner['jobs']), 'convertedJobs': sum(row['status'] == 'converted' for row in results),
                              'partialJobs': sum(row['status'] == 'partial' for row in results),
                              'failedJobs': sum(row['status'] == 'failed' for row in results),
                              'blockedJobs': sum(row['status'] == 'blocked' for row in results)},
                   'runtimeIntegration': 'not-performed', 'nativeParity': 'unverified'}
        write_new(output / 'batch.json', receipt)
        write_new(output / 'complete.json', {'schemaVersion': 1, 'ownerSha256': digest(canonical(owner)),
                                           'batchSha256': file_hash(output / 'batch.json')})
    except BaseException:
        # Retain interrupted output and its lock; it must never look reusable.
        raise
    else:
        (output / '.running.json').unlink()
    verify_batch(output, owner)
    return {'mode': 'converted', 'output': str(output), 'status': receipt['status'], 'jobs': results, 'adapterExecutions': executions}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recipe', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--plan', action='store_true')
    mode.add_argument('--verify-only', action='store_true')
    parser.add_argument('--reuse-from', type=Path)
    args = parser.parse_args()
    try:
        result = run(args.recipe, args.output, plan_only=args.plan, verify_only=args.verify_only, reuse_from=args.reuse_from)
        print(json.dumps(result, indent=2))
        return {'failed': 1, 'partial': 2}.get(result.get('status'), 0)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
