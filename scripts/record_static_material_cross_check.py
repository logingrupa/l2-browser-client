import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parent
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json

from native_assets_lib.static_material_cross_check import static_material_cross_check_row, static_mesh_exports
from native_assets_lib.static_materials import (STATIC_MATERIAL_CROSS_CHECKS_PATH, STATIC_MATERIAL_PACKAGE_VERSION,
                                                STATIC_MATERIAL_REAL_CLIENT_CASES_PATH, package_static_material_version,
                                                read_static_material_slots)
from native_catalog.ue2 import Package
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import replace_file
from native_store.unit_ledger import BATCH_MINIMUM_FREE_BYTES, require_batch_preflight, run_at_below_normal_priority
from reference_client_guard import require_reference_client
from static_material_package_census import STATIC_MESH_PACKAGE_CENSUS_RELATIVE_PATH, validate_static_mesh_package_census

REPOSITORY_ROOT = SCRIPTS_ROOT.parent
INTEGRATION_LANE_NAME = 'integration'
CROSS_CHECKS_SCHEMA_VERSION = 1


class StaticMaterialCrossCheckRecordError(ValueError):
    pass


def first_census_package_of_version(census, version):
    for row in census['packages']:
        if (row['packageVersion'], row['licensee']) == version:
            return row
    raise StaticMaterialCrossCheckRecordError(f'the static mesh package census lists no package of version {version[0]}/{version[1]}')


def real_client_cases(reference_access, relative_path):
    path = reference_access.require_equal_file(relative_path)
    package = Package(path.read_bytes(), path.name)
    licensee = package_static_material_version(package)[1]
    cases = []
    for item in static_mesh_exports(package):
        result = read_static_material_slots(package, item)
        slots = result['slots']
        cases.append({'package': relative_path, 'packageSha256': package.source_hash, 'object': item['object'],
                      'licenseeVersion': licensee, 'materialIndices': [slot['nativeObjectIndex'] for slot in slots],
                      'slotByteSha256s': [slot['raw']['sha256'] for slot in slots],
                      'materialsPayloadSha256': result['materialsPayload']['sha256'] if 'materialsPayload' in result else None})
    return cases


def read_json_document(relative_path, empty_document):
    path = REPOSITORY_ROOT / relative_path
    return json.loads(path.read_bytes()) if path.is_file() else empty_document


def write_json_document(relative_path, document):
    path = REPOSITORY_ROOT / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    replace_file(path, (json.dumps(document, indent=2, ensure_ascii=True, allow_nan=False) + '\n').encode())


def record_cross_check_row(row):
    document = read_json_document(STATIC_MATERIAL_CROSS_CHECKS_PATH, {'schemaVersion': CROSS_CHECKS_SCHEMA_VERSION, 'rows': []})
    rows = [existing for existing in document['rows'] if existing['version'] != row['version']] + [row]
    document['rows'] = sorted(rows, key=lambda existing: existing['version'])
    write_json_document(STATIC_MATERIAL_CROSS_CHECKS_PATH, document)


def record_real_client_cases(relative_path, cases):
    document = read_json_document(STATIC_MATERIAL_REAL_CLIENT_CASES_PATH, None)
    if document is None:
        raise StaticMaterialCrossCheckRecordError(f'{STATIC_MATERIAL_REAL_CLIENT_CASES_PATH} is missing')
    document['cases'] = [case for case in document['cases'] if case['package'] != relative_path] + cases
    write_json_document(STATIC_MATERIAL_REAL_CLIENT_CASES_PATH, document)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Compare our static material slots with Elbera l2lib on the first census package of one licensee.')
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--licensee', type=int, required=True)
    arguments = parser.parse_args(argv)
    version = (STATIC_MATERIAL_PACKAGE_VERSION, arguments.licensee)
    try:
        census = validate_static_mesh_package_census(json.loads((REPOSITORY_ROOT / STATIC_MESH_PACKAGE_CENSUS_RELATIVE_PATH).read_bytes()))
        relative_path = first_census_package_of_version(census, version)['path']
        reference_access = require_reference_client(arguments.client)
        require_batch_preflight(REPOSITORY_ROOT, INTEGRATION_LANE_NAME, BATCH_MINIMUM_FREE_BYTES)
        run_at_below_normal_priority()
        row = static_material_cross_check_row(reference_access, relative_path)
        record_cross_check_row(row)
        if row['equal']:
            record_real_client_cases(relative_path, real_client_cases(reference_access, relative_path))
    except (OSError, ValueError) as error:
        print(f'Static material cross-check failed: {error}', file=sys.stderr)
        return 1
    print(canonical_json_bytes(row).decode())
    return 0 if row['equal'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
