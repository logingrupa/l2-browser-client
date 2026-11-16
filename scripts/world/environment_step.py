from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json
import subprocess
from typing import NamedTuple

from actors.npc_store_records import catalog_with_records_replaced
from native_assets_lib.gltf import json_bytes
from native_environment import DEFAULT_FILES, IMPLEMENTATION_FILES, convert
from native_store.catalog_writer import add_store_file, read_store_catalog, sha256_hex, sha256_of_file, validate_catalog_record, write_store
from native_store.interprocess_lock import LaneInUseError, lane_batch_lock
from native_store.store_paths import REPOSITORY_ROOT, lane_store_root, lane_work_root
from native_store.unit_ledger import UnitLedger, locked_input_records, run_at_below_normal_priority
from reference_client_guard import require_reference_client
from world.raw_map_step import PRODUCTS_FOLDER_NAME
from world.tile_census import WORLD_LANE_NAME

ENVIRONMENT_STEP_NAME = 'environment'
ENVIRONMENT_STEP_ALGORITHM_VERSION = 1
ENVIRONMENT_UNIT_KEY = 'environment:interlude'
ENVIRONMENT_RECORD_ID = 'interlude'
ENVIRONMENTS_CATALOG_SLICE = 'environments'
ENVIRONMENT_CATALOG_CAPACITY = 1
ENVIRONMENT_SOURCE_FOLDER = 'system'
ENVIRONMENT_INPUT_PATHS = tuple(f'{ENVIRONMENT_SOURCE_FOLDER}/{name}' for name in DEFAULT_FILES)
ENVIRONMENT_STAGE_SCRIPT_PATH = SCRIPTS_ROOT / 'stage-native-environment.mjs'
ENVIRONMENT_STEP_IMPLEMENTATION_PATHS = (*(SCRIPTS_ROOT / name for name in IMPLEMENTATION_FILES), ENVIRONMENT_STAGE_SCRIPT_PATH, Path(__file__).resolve())
ENVIRONMENT_PRODUCT_NAME = 'environment.json'
BROWSER_MANIFEST_NAME = 'manifest.json'
SOURCE_COPIES_FOLDER_NAME = 'sources'
EXPORT_FOLDER_NAME = 'export'
STAGED_FOLDER_NAME = 'staged'
STAGED_STATUS = 'staged'


class EnvironmentStepError(ValueError):
    pass


class CurrentEnvironment(NamedTuple):
    fingerprint: str
    product: dict | None


def environment_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), ENVIRONMENT_STEP_NAME, ENVIRONMENT_STEP_ALGORITHM_VERSION)


def environment_config():
    return {'implementationSha256s': {path.relative_to(SCRIPTS_ROOT).as_posix(): sha256_of_file(path) for path in ENVIRONMENT_STEP_IMPLEMENTATION_PATHS}}


def environment_inputs():
    return locked_input_records(ENVIRONMENT_INPUT_PATHS)


def environment_product_path(ledger):
    return ledger.unit_step_directory(ENVIRONMENT_UNIT_KEY) / PRODUCTS_FOLDER_NAME / ENVIRONMENT_PRODUCT_NAME


def current_environment(project_root):
    ledger = environment_ledger(project_root)
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in environment_inputs()], environment_config())
    if not ledger.is_sealed(ENVIRONMENT_UNIT_KEY, fingerprint):
        return CurrentEnvironment(fingerprint, None)
    return CurrentEnvironment(fingerprint, json.loads(environment_product_path(ledger).read_text(encoding='utf-8')))


def copy_locked_sources(client, sources_folder):
    sources_folder.mkdir()
    for relative_path in ENVIRONMENT_INPUT_PATHS:
        path, locked_sha256 = client.require_equal_file_with_sha256(relative_path)
        payload = path.read_bytes()
        if sha256_hex(payload) != locked_sha256:
            raise EnvironmentStepError(f'{relative_path} changed while it was read: SHA-256 {sha256_hex(payload)}, lock {locked_sha256}')
        (sources_folder / Path(relative_path).name).write_bytes(payload)


def stage_environment_with_node(export_folder, staged_folder):
    completed = subprocess.run(['node', str(ENVIRONMENT_STAGE_SCRIPT_PATH), '--input', str(export_folder), '--output', str(staged_folder)],
                               capture_output=True, text=True, encoding='utf-8', check=False)
    if completed.returncode != 0:
        raise EnvironmentStepError(f'stage-native-environment.mjs exited {completed.returncode}: {completed.stderr.strip()}')
    return json.loads(completed.stdout)


def staged_store_files(stage_receipt):
    if stage_receipt.get('status') != STAGED_STATUS:
        raise EnvironmentStepError(f'stage-native-environment.mjs reported {stage_receipt.get("status")!r}, not {STAGED_STATUS}')
    bundle_folder = Path(stage_receipt['outputDir'])
    browser_manifest_sha256 = stage_receipt['browserManifestSha256']
    if bundle_folder.name != browser_manifest_sha256:
        raise EnvironmentStepError(f'staged bundle folder {bundle_folder.name} is not its browser manifest SHA-256 {browser_manifest_sha256}')
    files = {}
    for staged_file in stage_receipt['files']:
        payload = (bundle_folder / staged_file['file']).read_bytes()
        if sha256_hex(payload) != staged_file['sha256'] or len(payload) != staged_file['bytes']:
            raise EnvironmentStepError(f'staged {staged_file["file"]} differs from the stage receipt')
        files[f'{ENVIRONMENTS_CATALOG_SLICE}/{browser_manifest_sha256}/{staged_file["file"]}'] = payload
    return browser_manifest_sha256, files


def write_environment_to_store(store_root, browser_manifest_sha256, files):
    manifest_relative = f'{ENVIRONMENTS_CATALOG_SLICE}/{browser_manifest_sha256}/{BROWSER_MANIFEST_NAME}'
    record = validate_catalog_record(ENVIRONMENTS_CATALOG_SLICE, {
        'id': ENVIRONMENT_RECORD_ID, 'manifest': f'/l2/{manifest_relative}', 'manifestSha256': browser_manifest_sha256,
        'manifestBytes': len(files[manifest_relative])})
    catalog, before = read_store_catalog(store_root)
    catalog = catalog_with_records_replaced(catalog, ENVIRONMENTS_CATALOG_SLICE, [record], ENVIRONMENT_CATALOG_CAPACITY)
    store_files = {}
    for relative, payload in files.items():
        add_store_file(store_files, relative, payload)
    write_store(store_root, store_files, before, json_bytes(catalog))
    return record, [{'path': f'l2/{relative}', 'sha256': sha256_hex(payload), 'bytes': len(payload)} for relative, payload in sorted(files.items())]


def run_environment_step(project_root, client_root, stage_environment=stage_environment_with_node):
    project_root = Path(project_root)
    ledger = environment_ledger(project_root)
    current = current_environment(project_root)
    if current.product is not None:
        return {'unitKey': ENVIRONMENT_UNIT_KEY, 'status': 'sealed', 'fingerprint': current.fingerprint, **current.product}
    client = require_reference_client(Path(client_root).resolve())
    step_directory = ledger.begin(ENVIRONMENT_UNIT_KEY, current.fingerprint)
    copy_locked_sources(client, step_directory / SOURCE_COPIES_FOLDER_NAME)
    export = convert(step_directory / SOURCE_COPIES_FOLDER_NAME, step_directory / EXPORT_FOLDER_NAME)
    browser_manifest_sha256, files = staged_store_files(stage_environment(step_directory / EXPORT_FOLDER_NAME, step_directory / STAGED_FOLDER_NAME))
    record, store_outputs = write_environment_to_store(lane_store_root(project_root, WORLD_LANE_NAME), browser_manifest_sha256, files)
    product = {'record': record, 'typedComplete': export['typedComplete'], 'unresolved': export['unresolved'], 'tables': export['tables'],
               'rows': export['rows']}
    products_directory = step_directory / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    product_payload = json_bytes(product)
    product_path = products_directory / ENVIRONMENT_PRODUCT_NAME
    product_path.write_bytes(product_payload)
    outputs = [*store_outputs, {'path': product_path.relative_to(ledger.lane_folder).as_posix(), 'sha256': sha256_hex(product_payload),
                                'bytes': len(product_payload)}]
    ledger.seal(ENVIRONMENT_UNIT_KEY, current.fingerprint, {'config': environment_config(), 'inputs': environment_inputs(), 'outputs': outputs,
                                                            'gapRows': []})
    return {'unitKey': ENVIRONMENT_UNIT_KEY, 'status': 'converted', 'fingerprint': current.fingerprint, **product}


def main(argv=None):
    parser = argparse.ArgumentParser(description='Convert Env.int and timeenv0..3 once and stage the time tables in the world lane store.')
    parser.add_argument('--client', type=Path, required=True)
    arguments = parser.parse_args(argv)
    run_at_below_normal_priority()
    try:
        client_access = require_reference_client(arguments.client)
        with lane_batch_lock(lane_work_root(REPOSITORY_ROOT, WORLD_LANE_NAME)):
            result = run_environment_step(REPOSITORY_ROOT, client_access.root)
    except (OSError, ValueError, LaneInUseError) as error:
        print(json.dumps({'unitKey': ENVIRONMENT_UNIT_KEY, 'status': 'failed', 'error': f'{type(error).__name__}: {error}'}))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
