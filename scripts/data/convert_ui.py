import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json
import struct

from hash_reference_client_tree import canonical_json_bytes
from interface_layout_adapter import (ELBERA_INTERFACE_JSON_PATH, ELBERA_PARSE_XDAT_PATH, ELBERA_PARSE_XDAT_SHA256, INTERFACE_XDAT_PATH,
                                      decode_interface_layout, elbera_interface_cross_check, interface_layout_json_bytes,
                                      interface_window_census, window_identifiers, window_layout_manifest)
from lane_unit_outcomes import seal_unit_decode_failure, seal_unit_manifest, write_pinned_manifest_to_store
from native_assets import UMODEL, UMODEL_SHA256, Converter, implementation_hash
from native_store.catalog_writer import read_store_catalog, replace_file, sha256_hex, validate_catalog_record
from native_store.lane_coverage_refresh import lane_coverage_refreshed_at_exit
from native_store.store_paths import REPOSITORY_ROOT, confined_child_path, lane_store_root, lane_work_root, require_converter_output
from native_store.unit_ledger import (BATCH_MINIMUM_FREE_BYTES, UnitLedger, locked_input_records, require_batch_preflight,
                                      run_at_below_normal_priority)
from pinned_elbera_module import ELBERA_ROOT, load_pinned_elbera_module, resolve_elbera_path
import reference_client_guard
from reference_client_guard import require_reference_client
from ui_texture_step import (TEXTURES_STEP, UI_TEXTURE_ALGORITHM_VERSION, convert_window_textures, ui_texture_recipe_bytes,
                             ui_texture_requests)

LAYOUT_ALGORITHM_VERSION = 1
LANE_NAME = 'data-ui'
PART_NAME = 'ui'
LAYOUT_STEP = 'layout'
WINDOWS_CATALOG_SLICE = 'windows'
WINDOW_MANIFEST_FILE_NAME = 'window.json'
LAYOUT_DECODE_ERRORS = (ValueError, IndexError, KeyError, TypeError, struct.error)
INTERFACE_WINDOW_CENSUS_PATH = REPOSITORY_ROOT / 'docs' / 'parts' / 'ui' / 'interface-window-census.json'
TEXTURE_PACKAGE_CENSUS_PATH = REPOSITORY_ROOT / 'docs' / 'parts' / 'ui' / 'texture-package-census.json'
UI_TEXTURE_RECIPE_PATH = REPOSITORY_ROOT / 'recipes' / 'data' / 'ui-textures.json'
WINDOW_FIELD_BINDINGS_PATH = REPOSITORY_ROOT / 'recipes' / 'data' / 'window-field-bindings.json'
UI_TEXTURE_CONVERTER_FOLDER = 'ui-texture-converter'
NATIVE_RESOURCE_PREFIX = '/l2/'


class ConvertUiError(ValueError):
    pass


class LayoutUnitPlan:
    def __init__(self, project_root, output_root, ledger, inputs):
        self.project_root = project_root
        self.output_root = output_root
        self.ledger = ledger
        self.inputs = inputs
        self.config = {'elberaParseXdatSha256': ELBERA_PARSE_XDAT_SHA256}
        self.fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], self.config)


def write_window_to_store(output_root, window_id, manifest_bytes, capacity):
    manifest_sha256 = sha256_hex(manifest_bytes)
    manifest_relative = f'{WINDOWS_CATALOG_SLICE}/{manifest_sha256}/{WINDOW_MANIFEST_FILE_NAME}'
    record = validate_catalog_record(WINDOWS_CATALOG_SLICE, {
        'id': window_id, 'manifest': f'/l2/{manifest_relative}', 'manifestSha256': manifest_sha256,
        'manifestBytes': len(manifest_bytes)})
    return record, write_pinned_manifest_to_store(output_root, WINDOWS_CATALOG_SLICE, record, manifest_relative, manifest_bytes, capacity)


def convert_window_unit(unit_plan, layout, window_id, root_node, data):
    unit_key = f'window:{window_id}'
    if unit_plan.ledger.is_sealed(unit_key, unit_plan.fingerprint):
        return {'unit': unit_key, 'status': 'skipped-sealed'}
    unit_plan.ledger.begin(unit_key, unit_plan.fingerprint)
    manifest_bytes = canonical_json_bytes(window_layout_manifest(window_id, root_node, layout.record_of_node, data))
    record, manifest_path = write_window_to_store(unit_plan.output_root, window_id, manifest_bytes, len(layout.roots))
    seal_unit_manifest(unit_plan.project_root, unit_plan.ledger, unit_key, unit_plan.fingerprint, unit_plan.inputs, unit_plan.config,
                       manifest_path, record)
    return {'unit': unit_key, 'status': 'decoded', 'manifest': record['manifest']}


def seal_layout_decode_failure(unit_plan, window_ids, error):
    results = []
    for window_id in window_ids:
        unit_key = f'window:{window_id}'
        if unit_plan.ledger.is_sealed(unit_key, unit_plan.fingerprint):
            results.append({'unit': unit_key, 'status': 'skipped-sealed'})
            continue
        step_directory = unit_plan.ledger.begin(unit_key, unit_plan.fingerprint)
        results.append(seal_unit_decode_failure(unit_plan.project_root, unit_plan.ledger, unit_key, unit_plan.fingerprint, step_directory,
                                                PART_NAME, unit_plan.inputs, unit_plan.config, error))
    return results


def selected_windows(layout, requested_window_ids, limit):
    windows_by_id = dict(zip(window_identifiers(layout.roots), layout.roots))
    if requested_window_ids is None:
        return list(windows_by_id.items())[:limit]
    missing = [window_id for window_id in requested_window_ids if window_id not in windows_by_id]
    if missing:
        raise ConvertUiError(f'{INTERFACE_XDAT_PATH} has no root window {", ".join(missing)}')
    return [(window_id, windows_by_id[window_id]) for window_id in requested_window_ids]


def convert_layout_step(unit_plan, data, parse_xdat_module, requested_window_ids, limit):
    try:
        layout = decode_interface_layout(data, parse_xdat_module)
    except LAYOUT_DECODE_ERRORS as error:
        if requested_window_ids is None:
            raise ConvertUiError(f'{INTERFACE_XDAT_PATH} does not decode ({type(error).__name__}): {error}') from error
        return seal_layout_decode_failure(unit_plan, requested_window_ids, error), None
    results = []
    for window_id, root_node in selected_windows(layout, requested_window_ids, len(layout.roots)):
        if len([result for result in results if result['status'] != 'skipped-sealed']) >= limit:
            break
        results.append(convert_window_unit(unit_plan, layout, window_id, root_node, data))
    return results, layout


def write_interface_window_census(layout, elbera_root):
    elbera_interface_json_path = resolve_elbera_path(ELBERA_INTERFACE_JSON_PATH, elbera_root)
    cross_check = elbera_interface_cross_check(elbera_interface_json_path.read_bytes(), elbera_interface_json_path.as_posix())
    census = interface_window_census(layout, ELBERA_PARSE_XDAT_SHA256, cross_check)
    replace_file(INTERFACE_WINDOW_CENSUS_PATH, interface_layout_json_bytes(census))


def decoded_window_manifests(output_root):
    catalog, _ = read_store_catalog(output_root)
    manifests = []
    for record in catalog.get(WINDOWS_CATALOG_SLICE, []):
        manifest_bytes = confined_child_path(output_root, record['manifest'].removeprefix(NATIVE_RESOURCE_PREFIX)).read_bytes()
        if (sha256_hex(manifest_bytes), len(manifest_bytes)) != (record['manifestSha256'], record['manifestBytes']):
            raise ConvertUiError(f'window manifest {record["manifest"]} differs from its catalog SHA-256 or byte length')
        manifests.append(json.loads(manifest_bytes))
    if not manifests:
        raise ConvertUiError(f'{output_root} has no decoded windows; run --step layout first')
    return manifests


def selected_texture_window_ids(manifests, requested_window_ids, limit):
    window_ids = [manifest['windowId'] for manifest in manifests]
    if requested_window_ids is None:
        return window_ids[:limit]
    missing = [window_id for window_id in requested_window_ids if window_id not in window_ids]
    if missing:
        raise ConvertUiError(f'the data-ui lane store has no decoded window {", ".join(missing)}')
    return requested_window_ids


def convert_textures_step(client, client_access, output_root, requested_window_ids, limit):
    manifests = decoded_window_manifests(output_root)
    texture_census = json.loads(TEXTURE_PACKAGE_CENSUS_PATH.read_bytes())
    requests = ui_texture_requests(manifests, texture_census, client_access.lock)
    replace_file(UI_TEXTURE_RECIPE_PATH, ui_texture_recipe_bytes(requests))
    field_bindings_document = json.loads(WINDOW_FIELD_BINDINGS_PATH.read_bytes())
    work_root = lane_work_root(REPOSITORY_ROOT, LANE_NAME)
    converter = Converter(client, work_root / UI_TEXTURE_CONVERTER_FOLDER, UMODEL)
    converter_identity = {'implementation': implementation_hash(), 'umodel': UMODEL_SHA256}
    ledger = UnitLedger(work_root, TEXTURES_STEP, UI_TEXTURE_ALGORITHM_VERSION)
    return [convert_window_textures(REPOSITORY_ROOT, window_id, requests, converter, ledger, output_root,
                                    converter_identity=converter_identity, field_bindings_document=field_bindings_document)
            for window_id in selected_texture_window_ids(manifests, requested_window_ids, limit)]


def convert_layout_step_from_client(client_access, output_root, elbera_root, requested_window_ids, limit):
    data = client_access.require_equal_file(INTERFACE_XDAT_PATH).read_bytes()
    parse_xdat_module = load_pinned_elbera_module(ELBERA_PARSE_XDAT_PATH, ELBERA_PARSE_XDAT_SHA256, elbera_root=elbera_root)
    ledger = UnitLedger(lane_work_root(REPOSITORY_ROOT, LANE_NAME), LAYOUT_STEP, LAYOUT_ALGORITHM_VERSION)
    unit_plan = LayoutUnitPlan(REPOSITORY_ROOT, output_root, ledger,
                               locked_input_records([INTERFACE_XDAT_PATH], reference_client_guard.REFERENCE_CLIENT_LOCK_PATH))
    results, layout = convert_layout_step(unit_plan, data, parse_xdat_module, requested_window_ids, limit)
    if requested_window_ids is None:
        write_interface_window_census(layout, elbera_root)
        results.append({'census': INTERFACE_WINDOW_CENSUS_PATH.relative_to(REPOSITORY_ROOT).as_posix(), 'rootWindowCount': len(layout.roots)})
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description='Convert the Interlude interface into the data-ui lane store, one sealed unit per root window.')
    parser.add_argument('--step', choices=(LAYOUT_STEP, TEXTURES_STEP), required=True)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--elbera-root', type=Path, default=ELBERA_ROOT)
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument('--window', action='append')
    selection.add_argument('--batch', choices=(WINDOWS_CATALOG_SLICE,))
    parser.add_argument('--limit', type=int)
    arguments = parser.parse_args(argv)
    if arguments.batch and not (arguments.limit and arguments.limit > 0):
        parser.error('--batch windows needs --limit with a positive unit count')
    try:
        client_access = require_reference_client(arguments.client)
        output_root = require_converter_output(REPOSITORY_ROOT, arguments.output or lane_store_root(REPOSITORY_ROOT, LANE_NAME))
        require_batch_preflight(REPOSITORY_ROOT, LANE_NAME, BATCH_MINIMUM_FREE_BYTES)
        run_at_below_normal_priority()
        requested_window_ids = list(dict.fromkeys(arguments.window)) if arguments.window else None
        limit = arguments.limit or sys.maxsize
        with lane_coverage_refreshed_at_exit(REPOSITORY_ROOT, LANE_NAME):
            if arguments.step == TEXTURES_STEP:
                results = convert_textures_step(arguments.client, client_access, output_root, requested_window_ids, limit)
            else:
                results = convert_layout_step_from_client(client_access, output_root, arguments.elbera_root, requested_window_ids, limit)
        for result in results:
            print(json.dumps(result, sort_keys=True), flush=True)
    except (OSError, ValueError) as error:
        print(f'UI conversion failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
