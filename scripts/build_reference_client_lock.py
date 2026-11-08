import argparse
from fnmatch import fnmatchcase
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys

from reference_client_guard import REFERENCE_CLIENT_LOCK_FILE_FIELDS, REFERENCE_CLIENT_LOCK_SCHEMA_VERSION

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
HASHING_SCRIPT_PATH = Path(__file__).with_name('hash_reference_client_tree.py')
DEFAULT_LOCK_OUTPUT_PATH = REPOSITORY_ROOT / 'recipes' / 'reference-client-tree.lock.json'
MANIFEST_SCHEMA_VERSION = 1
REFERENCE_HOST = 'IMPORTA-PC'
REFERENCE_ROOT = 'C:/Lineage2-client'
CONVERSION_HOST = 'DATABASE-PC'
CONVERSION_ROOT = 'E:/Lineage2-client'
VOLATILE_CONFIG_PATTERNS = ('*.ini', '*.log', '*.bak', '*.bak-*')
FILE_CLASSES = ('equal', 'differing', 'importa-only', 'e-only', 'volatile-config', 'unreadable')
SHA256_PATTERN = re.compile('[0-9a-f]{64}')
LOCK_BUILDER_DESCRIPTION = 'Join the IMPORTA-PC and E: reference client manifests into recipes/reference-client-tree.lock.json.'


class ReferenceClientManifestError(ValueError):
    pass


def manifest_sort_key(row):
    return (row['path'].casefold(), row['path'])


def require_manifest_path(path, side):
    if not isinstance(path, str) or not path or '\\' in path or ':' in path:
        raise ReferenceClientManifestError(f'{side} manifest has an invalid path: {path!r}')
    if PurePosixPath(path).is_absolute() or any(part in ('', '.', '..') for part in path.split('/')):
        raise ReferenceClientManifestError(f'{side} manifest path is not a confined relative path: {path!r}')
    return path


def require_whole_number(value, description):
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ReferenceClientManifestError(f'{description} must be a non-negative integer')
    return value


def require_sorted_unique_rows(rows, side, list_name):
    keys = [manifest_sort_key(row) for row in rows]
    if keys != sorted(keys):
        raise ReferenceClientManifestError(f'{side} manifest {list_name} rows are not sorted by casefolded path')
    folded_paths = [key[0] for key in keys]
    if len(set(folded_paths)) != len(folded_paths):
        raise ReferenceClientManifestError(f'{side} manifest {list_name} repeats a casefolded path')


def validate_reference_client_manifest(manifest, side):
    if not isinstance(manifest, dict) or manifest.get('schemaVersion') != MANIFEST_SCHEMA_VERSION:
        raise ReferenceClientManifestError(f'{side} manifest schemaVersion must be {MANIFEST_SCHEMA_VERSION}')
    for field in ('root', 'host', 'pythonVersion'):
        if not isinstance(manifest.get(field), str) or not manifest[field]:
            raise ReferenceClientManifestError(f'{side} manifest needs a {field}')
    files, unreadable = manifest.get('files'), manifest.get('unreadable')
    if not isinstance(files, list) or not isinstance(unreadable, list):
        raise ReferenceClientManifestError(f'{side} manifest needs files and unreadable lists')
    for row in files:
        if not isinstance(row, dict) or set(row) != {'path', 'bytes', 'sha256', 'modifiedNanoseconds'}:
            raise ReferenceClientManifestError(f'{side} manifest file row has unexpected fields')
        require_manifest_path(row['path'], side)
        require_whole_number(row['bytes'], f'{side} bytes of {row["path"]}')
        require_whole_number(row['modifiedNanoseconds'], f'{side} modifiedNanoseconds of {row["path"]}')
        if not isinstance(row['sha256'], str) or not SHA256_PATTERN.fullmatch(row['sha256']):
            raise ReferenceClientManifestError(f'{side} manifest sha256 of {row["path"]} is not lowercase hex')
    for row in unreadable:
        if not isinstance(row, dict) or set(row) != {'path', 'reason'} or not isinstance(row['reason'], str):
            raise ReferenceClientManifestError(f'{side} manifest unreadable row has unexpected fields')
        require_manifest_path(row['path'], side)
    require_sorted_unique_rows(files, side, 'files')
    require_sorted_unique_rows(unreadable, side, 'unreadable')
    readable_paths = {row['path'].casefold() for row in files}
    if any(row['path'].casefold() in readable_paths for row in unreadable):
        raise ReferenceClientManifestError(f'{side} manifest lists a path as both readable and unreadable')
    return manifest


def is_volatile_config_path(path):
    file_name = PurePosixPath(path).name.casefold()
    return any(fnmatchcase(file_name, pattern) for pattern in VOLATILE_CONFIG_PATTERNS)


def index_by_casefolded_path(rows):
    return {row['path'].casefold(): row for row in rows}


def classify_one_path(importa_row, e_row, importa_unreadable, e_unreadable, path):
    if importa_unreadable or e_unreadable:
        return 'unreadable'
    if is_volatile_config_path(path):
        return 'volatile-config'
    if importa_row is None:
        return 'e-only'
    if e_row is None:
        return 'importa-only'
    if (importa_row['bytes'], importa_row['sha256']) == (e_row['bytes'], e_row['sha256']):
        return 'equal'
    return 'differing'


def summarise_side(manifest):
    return {
        'host': manifest['host'],
        'root': manifest['root'],
        'pythonVersion': manifest['pythonVersion'],
        'fileCount': len(manifest['files']),
        'totalBytes': sum(row['bytes'] for row in manifest['files']),
        'unreadableCount': len(manifest['unreadable']),
    }


def normalised_tree_root(root):
    return root.replace('\\', '/').rstrip('/').casefold()


def require_manifest_origin(manifest, side, expected_host, expected_root):
    if manifest['host'] != expected_host or normalised_tree_root(manifest['root']) != normalised_tree_root(expected_root):
        raise ReferenceClientManifestError(
            f'{side} manifest was hashed on {manifest["host"]} at {manifest["root"]}, expected {expected_host} at {expected_root}')


def classify_reference_client_trees(importa_manifest, e_manifest, hashing_script_sha256):
    validate_reference_client_manifest(importa_manifest, 'IMPORTA-PC')
    validate_reference_client_manifest(e_manifest, 'E:')
    require_manifest_origin(importa_manifest, 'IMPORTA-PC', REFERENCE_HOST, REFERENCE_ROOT)
    require_manifest_origin(e_manifest, 'E:', CONVERSION_HOST, CONVERSION_ROOT)
    if not isinstance(hashing_script_sha256, str) or not SHA256_PATTERN.fullmatch(hashing_script_sha256):
        raise ReferenceClientManifestError('hashing script SHA-256 must be lowercase hex')
    importa_files, e_files = index_by_casefolded_path(importa_manifest['files']), index_by_casefolded_path(e_manifest['files'])
    importa_unreadable = index_by_casefolded_path(importa_manifest['unreadable'])
    e_unreadable = index_by_casefolded_path(e_manifest['unreadable'])
    files, case_differences = {}, []
    class_counts = dict.fromkeys(FILE_CLASSES, 0)
    for folded_path in sorted({*importa_files, *e_files, *importa_unreadable, *e_unreadable}):
        importa_row, e_row = importa_files.get(folded_path), e_files.get(folded_path)
        importa_spelling = (importa_row or importa_unreadable.get(folded_path) or {}).get('path')
        e_spelling = (e_row or e_unreadable.get(folded_path) or {}).get('path')
        lock_path = importa_spelling or e_spelling
        if importa_spelling and e_spelling and importa_spelling != e_spelling:
            case_differences.append([importa_spelling, e_spelling])
        file_class = classify_one_path(importa_row, e_row, folded_path in importa_unreadable, folded_path in e_unreadable, lock_path)
        class_counts[file_class] += 1
        files[lock_path] = [
            file_class,
            importa_row['bytes'] if importa_row else None,
            importa_row['sha256'] if importa_row else None,
            e_row['bytes'] if e_row else None,
            e_row['sha256'] if e_row else None,
            e_row['modifiedNanoseconds'] if e_row else None,
        ]
    unreadable = [{'path': row['path'], 'side': side, 'reason': row['reason']}
        for side, manifest in (('importa', importa_manifest), ('e', e_manifest)) for row in manifest['unreadable']]
    return {
        'schemaVersion': REFERENCE_CLIENT_LOCK_SCHEMA_VERSION,
        'referenceHost': REFERENCE_HOST,
        'referenceRoot': REFERENCE_ROOT,
        'conversionHost': CONVERSION_HOST,
        'conversionRoot': CONVERSION_ROOT,
        'hashingScriptSha256': hashing_script_sha256,
        'hosts': {'importa': summarise_side(importa_manifest), 'e': summarise_side(e_manifest)},
        'classCounts': class_counts,
        'volatileConfigPatterns': list(VOLATILE_CONFIG_PATTERNS),
        'fileFields': list(REFERENCE_CLIENT_LOCK_FILE_FIELDS),
        'files': files,
        'caseDifferences': sorted(case_differences, key=lambda pair: (pair[0].casefold(), pair[0], pair[1])),
        'unreadable': sorted(unreadable, key=lambda row: (row['path'].casefold(), row['path'], row['side'])),
    }


def reference_client_lock_bytes(lock):
    return (json.dumps(lock, ensure_ascii=False, sort_keys=True, indent=1, allow_nan=False) + '\n').encode('utf-8')


def write_reference_client_lock(lock, output_path):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(reference_client_lock_bytes(lock))
    return output_path


def hashing_script_sha256(script_path=HASHING_SCRIPT_PATH):
    line_feed_script_bytes = Path(script_path).read_bytes().replace(b'\r\n', b'\n')
    return hashlib.sha256(line_feed_script_bytes).hexdigest()


def read_reference_client_manifest(path):
    return json.loads(Path(path).read_bytes().decode('utf-8'))


def main(argv=None):
    parser = argparse.ArgumentParser(description=LOCK_BUILDER_DESCRIPTION)
    parser.add_argument('--importa-manifest', type=Path, required=True)
    parser.add_argument('--e-manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=DEFAULT_LOCK_OUTPUT_PATH)
    arguments = parser.parse_args(argv)
    try:
        lock = classify_reference_client_trees(read_reference_client_manifest(arguments.importa_manifest),
            read_reference_client_manifest(arguments.e_manifest), hashing_script_sha256())
        written = write_reference_client_lock(lock, arguments.output)
    except (OSError, ValueError) as error:
        print(f'Reference client lock failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps({'output': str(written), 'classCounts': lock['classCounts']}, indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
