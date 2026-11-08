import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import hashlib
import json
from pathlib import PurePosixPath
import re

from hash_reference_client_tree import canonical_json_bytes
from native_assets_lib.texture_mips import REVIEWED_VERSIONS
from native_catalog.ue2 import FormatError, summary
from reference_client_guard import require_reference_client

REPOSITORY_ROOT = SCRIPTS_ROOT.parent
TEXTURE_PACKAGE_CENSUS_PATH = REPOSITORY_ROOT / 'docs' / 'parts' / 'ui' / 'texture-package-census.json'
TEXTURE_PACKAGE_CENSUS_SCHEMA_VERSION = 1
TEXTURE_PACKAGE_PATH_PATTERN = re.compile(r'systextures/[^/]+\.utx', re.IGNORECASE)
HEADER_BYTE_COUNT = 128
CENSUS_FIELDS = ('packages', 'referenceTreeLockSha256', 'schemaVersion')
ROW_FIELDS = ('licensee', 'packageVersion', 'path', 'reason', 'reviewed')
UNSUPPORTED_LICENSEE_REASON_PREFIX = 'texture-licensee-unsupported:'
DECODE_FAILED_REASON_PREFIX = 'decode-failed:'
DECODE_FAILED_REASON_PATTERN = re.compile(r'decode-failed:\w+')
SHA256_PATTERN = re.compile(r'[0-9a-f]{64}')


class TexturePackageCensusError(ValueError):
    pass


def read_package_header(path):
    with open(path, 'rb') as stream:
        return stream.read(HEADER_BYTE_COUNT)


def unsupported_licensee_reason(package_version, licensee):
    return f'{UNSUPPORTED_LICENSEE_REASON_PREFIX}{package_version}/{licensee}'


def texture_package_census_row(client_access, relative_path):
    package_path = client_access.require_equal_file(relative_path)
    header = read_package_header(package_path)
    try:
        package_summary = summary(header, PurePosixPath(relative_path).name)
    except (FormatError, UnicodeError) as error:
        return {'path': relative_path, 'packageVersion': None, 'licensee': None, 'reviewed': False,
            'reason': DECODE_FAILED_REASON_PREFIX + type(error).__name__}
    package_version, licensee = package_summary['version'], package_summary['licenseeVersion']
    reviewed = (package_version, licensee) in REVIEWED_VERSIONS
    return {'path': relative_path, 'packageVersion': package_version, 'licensee': licensee, 'reviewed': reviewed,
        'reason': None if reviewed else unsupported_licensee_reason(package_version, licensee)}


def lock_equal_texture_package_paths(lock):
    paths_by_casefolded_path = {}
    for path, record in lock.records_by_path.items():
        if record['class'] != 'equal' or not TEXTURE_PACKAGE_PATH_PATTERN.fullmatch(path):
            continue
        colliding_path = paths_by_casefolded_path.get(path.casefold())
        if colliding_path is not None:
            raise TexturePackageCensusError(f'reference client lock holds casefold-equal texture package paths {colliding_path} and {path}')
        paths_by_casefolded_path[path.casefold()] = path
    if not paths_by_casefolded_path:
        raise TexturePackageCensusError('reference client lock has no lock-equal systextures/*.utx package')
    return sorted(paths_by_casefolded_path.values(), key=texture_package_sort_key)


def texture_package_sort_key(path):
    return (path.casefold(), path)


def require_integer(value, description):
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise TexturePackageCensusError(f'{description} must be a non-negative integer')


def validate_texture_package_row(row):
    if not isinstance(row, dict) or tuple(sorted(row)) != ROW_FIELDS:
        raise TexturePackageCensusError(f'texture package census row has unexpected fields: {row!r}')
    path = row['path']
    if not isinstance(path, str) or not TEXTURE_PACKAGE_PATH_PATTERN.fullmatch(path):
        raise TexturePackageCensusError(f'texture package census row path is not a systextures package: {path!r}')
    if not isinstance(row['reviewed'], bool):
        raise TexturePackageCensusError(f'reviewed of {path} must be a boolean')
    if row['packageVersion'] is None and row['licensee'] is None:
        if row['reviewed'] or not isinstance(row['reason'], str) or not DECODE_FAILED_REASON_PATTERN.fullmatch(row['reason']):
            raise TexturePackageCensusError(f'undecoded header of {path} must be unreviewed with a decode-failed reason')
        return
    require_integer(row['packageVersion'], f'packageVersion of {path}')
    require_integer(row['licensee'], f'licensee of {path}')
    reviewed = (row['packageVersion'], row['licensee']) in REVIEWED_VERSIONS
    expected_reason = None if reviewed else unsupported_licensee_reason(row['packageVersion'], row['licensee'])
    if row['reviewed'] != reviewed or row['reason'] != expected_reason:
        raise TexturePackageCensusError(f'reviewed decision of {path} does not follow the reviewed texture versions')


def validate_texture_package_census(census):
    if not isinstance(census, dict) or tuple(sorted(census)) != CENSUS_FIELDS:
        raise TexturePackageCensusError('texture package census has unexpected fields')
    if census['schemaVersion'] != TEXTURE_PACKAGE_CENSUS_SCHEMA_VERSION:
        raise TexturePackageCensusError(f'texture package census schemaVersion must be {TEXTURE_PACKAGE_CENSUS_SCHEMA_VERSION}')
    if not isinstance(census['referenceTreeLockSha256'], str) or not SHA256_PATTERN.fullmatch(census['referenceTreeLockSha256']):
        raise TexturePackageCensusError('texture package census referenceTreeLockSha256 must be a sha256 hex digest')
    packages = census['packages']
    if not isinstance(packages, list) or not packages:
        raise TexturePackageCensusError('texture package census has no packages')
    for row in packages:
        validate_texture_package_row(row)
    paths = [row['path'] for row in packages]
    if paths != sorted(paths, key=texture_package_sort_key) or len({path.casefold() for path in paths}) != len(paths):
        raise TexturePackageCensusError('texture package census rows must be casefold-unique and sorted by (casefolded path, path)')
    return census


def build_texture_package_census(client_access, lock):
    package_paths = lock_equal_texture_package_paths(lock)
    return validate_texture_package_census({
        'schemaVersion': TEXTURE_PACKAGE_CENSUS_SCHEMA_VERSION,
        'referenceTreeLockSha256': hashlib.sha256(canonical_json_bytes(lock.document)).hexdigest(),
        'packages': [texture_package_census_row(client_access, path) for path in package_paths],
    })


def texture_package_census_bytes(census):
    return (json.dumps(census, indent=1, sort_keys=True, ensure_ascii=False) + '\n').encode('utf-8')


def main(argv=None):
    parser = argparse.ArgumentParser(description='Write the header-only census of systextures/*.utx packages from the locked reference client tree.')
    parser.add_argument('--client', type=Path, required=True)
    arguments = parser.parse_args(argv)
    try:
        client_access = require_reference_client(arguments.client)
        census = build_texture_package_census(client_access, client_access.lock)
        TEXTURE_PACKAGE_CENSUS_PATH.parent.mkdir(parents=True, exist_ok=True)
        TEXTURE_PACKAGE_CENSUS_PATH.write_bytes(texture_package_census_bytes(census))
    except (OSError, ValueError) as error:
        print(f'Texture package census failed: {error}', file=sys.stderr)
        return 1
    reviewed_count = sum(row['reviewed'] for row in census['packages'])
    print(json.dumps({'output': str(TEXTURE_PACKAGE_CENSUS_PATH), 'packages': len(census['packages']), 'reviewed': reviewed_count}, indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
