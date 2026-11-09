import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parent
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
from collections import Counter
import hashlib
from pathlib import PurePosixPath
import re

from native_assets_lib.asset_manifest import reference_client_build
from native_assets_lib.static_materials import (REVIEWED_VERSIONS, STATIC_MATERIAL_PACKAGE_VERSION, STATIC_MESH_CLASS_OBJECT,
                                                static_material_layout_unreviewed_reason)
from native_catalog.ue2 import FormatError, read_package_index, summary
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import replace_file
from native_store.store_paths import refuse_reparse_points
from native_store.unit_ledger import BATCH_MINIMUM_FREE_BYTES, require_batch_preflight, run_at_below_normal_priority
from reference_client_guard import require_reference_client

REPOSITORY_ROOT = SCRIPTS_ROOT.parent
CENSUS_OUTPUT_DIRECTORY_RELATIVE_PATH = 'docs/parts/adapter-dispatch'
STATIC_MESH_PACKAGE_CENSUS_RELATIVE_PATH = f'{CENSUS_OUTPUT_DIRECTORY_RELATIVE_PATH}/static-mesh-package-census.json'
STATIC_MESH_PACKAGE_CENSUS_SCHEMA_VERSION = 1
STATIC_MESH_PACKAGE_SUFFIX = '.usx'
PACKAGE_SUMMARY_BYTES = 128
RESEARCH_UNREVIEWED_PACKAGE_COUNT = 56
RESEARCH_PACKAGE_COUNT = 212
INTEGRATION_LANE_NAME = 'integration'
CENSUS_FIELDS = ('packages', 'referenceTreeLockSha256', 'reviewedVersions', 'schemaVersion')
PACKAGE_ROW_FIELDS = ('licensee', 'packageVersion', 'path', 'reason', 'reviewed', 'sha256', 'staticMeshExportCount')
SHA256_PATTERN = re.compile(r'[0-9a-f]{64}')


class StaticMeshPackageCensusError(ValueError):
    pass


def census_sort_key(path):
    return (path.casefold(), path)


def lock_equal_static_mesh_package_paths(lock):
    paths_by_casefolded_path = {}
    for path, record in lock.records_by_path.items():
        if record['class'] != 'equal' or PurePosixPath(path).suffix.lower() != STATIC_MESH_PACKAGE_SUFFIX:
            continue
        if path.casefold() in paths_by_casefolded_path:
            raise StaticMeshPackageCensusError(f'reference client lock holds casefold-equal paths {paths_by_casefolded_path[path.casefold()]} and {path}')
        paths_by_casefolded_path[path.casefold()] = path
    return sorted(paths_by_casefolded_path.values(), key=census_sort_key)


def static_mesh_package_row(client_access, relative_path):
    package_path = client_access.require_equal_file(relative_path)
    try:
        package_index = read_package_index(package_path)
    except FormatError:
        package_index = None
    if package_index is None:
        data = package_path.read_bytes()
        header = summary(data[:PACKAGE_SUMMARY_BYTES], package_path.name)
        sha256, static_mesh_export_count = hashlib.sha256(data).hexdigest(), None
    else:
        header, sha256 = package_index['summary'], package_index['sourceSha256']
        static_mesh_export_count = sum(1 for export in package_index['exports'] if export['classObject'] == STATIC_MESH_CLASS_OBJECT)
    version = (header['version'], header['licenseeVersion'])
    reviewed = version in REVIEWED_VERSIONS
    return {'path': relative_path, 'sha256': sha256, 'packageVersion': version[0], 'licensee': version[1], 'reviewed': reviewed,
            'staticMeshExportCount': static_mesh_export_count,
            'reason': None if reviewed else static_material_layout_unreviewed_reason(*version)}


def build_static_mesh_package_census(client_access):
    return validate_static_mesh_package_census({
        'schemaVersion': STATIC_MESH_PACKAGE_CENSUS_SCHEMA_VERSION,
        'referenceTreeLockSha256': reference_client_build(client_access.lock)['referenceTreeLockSha256'],
        'reviewedVersions': [list(version) for version in sorted(REVIEWED_VERSIONS)],
        'packages': [static_mesh_package_row(client_access, relative_path)
                     for relative_path in lock_equal_static_mesh_package_paths(client_access.lock)],
    })


def require_package_row(row):
    if not (isinstance(row, dict) and tuple(sorted(row)) == PACKAGE_ROW_FIELDS):
        raise StaticMeshPackageCensusError(f'static mesh package census row has unexpected fields: {row!r}')
    if not (isinstance(row['sha256'], str) and SHA256_PATTERN.fullmatch(row['sha256'])):
        raise StaticMeshPackageCensusError(f'sha256 of {row["path"]} must be a SHA-256 hex digest')
    version = (row['packageVersion'], row['licensee'])
    if row['reviewed'] != (version in REVIEWED_VERSIONS):
        raise StaticMeshPackageCensusError(f'reviewed flag of {row["path"]} does not follow the reviewed static material versions')
    expected_reason = None if row['reviewed'] else static_material_layout_unreviewed_reason(*version)
    if row['reason'] != expected_reason:
        raise StaticMeshPackageCensusError(f'reason of {row["path"]} must be {expected_reason}')
    count = row['staticMeshExportCount']
    if count is None and row['packageVersion'] == STATIC_MATERIAL_PACKAGE_VERSION:
        raise StaticMeshPackageCensusError(f'StaticMesh export count of UE{STATIC_MATERIAL_PACKAGE_VERSION} package {row["path"]} is missing')
    if count is not None and not (type(count) is int and count >= 0):
        raise StaticMeshPackageCensusError(f'StaticMesh export count of {row["path"]} must be a non-negative integer')


def validate_static_mesh_package_census(census):
    if not (isinstance(census, dict) and tuple(sorted(census)) == CENSUS_FIELDS):
        raise StaticMeshPackageCensusError('static mesh package census has unexpected fields')
    if census['schemaVersion'] != STATIC_MESH_PACKAGE_CENSUS_SCHEMA_VERSION:
        raise StaticMeshPackageCensusError(f'static mesh package census schemaVersion must be {STATIC_MESH_PACKAGE_CENSUS_SCHEMA_VERSION}')
    if not (isinstance(census['referenceTreeLockSha256'], str) and SHA256_PATTERN.fullmatch(census['referenceTreeLockSha256'])):
        raise StaticMeshPackageCensusError('static mesh package census referenceTreeLockSha256 must be a SHA-256 hex digest')
    if census['reviewedVersions'] != [list(version) for version in sorted(REVIEWED_VERSIONS)]:
        raise StaticMeshPackageCensusError('static mesh package census reviewedVersions differ from the reviewed static material versions')
    for row in census['packages']:
        require_package_row(row)
    paths = [row['path'] for row in census['packages']]
    if paths != sorted(paths, key=census_sort_key) or len({path.casefold() for path in paths}) != len(paths):
        raise StaticMeshPackageCensusError('static mesh package census rows must be unique and sorted by path')
    return census


def unreviewed_versions_by_static_mesh_count(census):
    package_counts, static_mesh_counts = Counter(), Counter()
    for row in census['packages']:
        if row['reviewed']:
            continue
        version = (row['packageVersion'], row['licensee'])
        package_counts[version] += 1
        static_mesh_counts[version] += row['staticMeshExportCount'] or 0
    return [{'version': f'{version[0]}/{version[1]}', 'packages': package_counts[version], 'staticMeshExports': static_mesh_counts[version]}
            for version in sorted(package_counts, key=lambda version: (-static_mesh_counts[version], version))]


def require_census_output_path(output_path):
    output_directory = (REPOSITORY_ROOT / CENSUS_OUTPUT_DIRECTORY_RELATIVE_PATH).resolve()
    resolved_output_path = Path(output_path).resolve()
    if resolved_output_path.parent != output_directory:
        raise StaticMeshPackageCensusError(f'static mesh package census output must lie in {CENSUS_OUTPUT_DIRECTORY_RELATIVE_PATH}/, '
                                           f'not {resolved_output_path.as_posix()}')
    return resolved_output_path


def write_static_mesh_package_census(census, output_path):
    resolved_output_path = require_census_output_path(output_path)
    refuse_reparse_points(resolved_output_path.parent)
    replace_file(resolved_output_path, canonical_json_bytes(validate_static_mesh_package_census(census)))


def main(argv=None):
    parser = argparse.ArgumentParser(description='List the header version and StaticMesh export count of every lock-equal .usx package.')
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=REPOSITORY_ROOT / STATIC_MESH_PACKAGE_CENSUS_RELATIVE_PATH)
    arguments = parser.parse_args(argv)
    try:
        require_census_output_path(arguments.output)
        client_access = require_reference_client(arguments.client)
        require_batch_preflight(REPOSITORY_ROOT, INTEGRATION_LANE_NAME, BATCH_MINIMUM_FREE_BYTES)
        run_at_below_normal_priority()
        census = build_static_mesh_package_census(client_access)
        write_static_mesh_package_census(census, arguments.output)
    except (OSError, ValueError) as error:
        print(f'Static mesh package census failed: {error}', file=sys.stderr)
        return 1
    unreviewed = unreviewed_versions_by_static_mesh_count(census)
    print(canonical_json_bytes({
        'output': Path(arguments.output).resolve().as_posix(),
        'packages': len(census['packages']),
        'unreviewedPackages': sum(row['packages'] for row in unreviewed),
        'researchUnreviewedPackages': f'{RESEARCH_UNREVIEWED_PACKAGE_COUNT} of {RESEARCH_PACKAGE_COUNT}',
        'unreviewedVersionsByStaticMeshExports': unreviewed,
    }).decode())
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
