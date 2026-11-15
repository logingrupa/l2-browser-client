from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_ROOT))

from native_assets_lib.gltf import json_bytes
from native_store.catalog_index_keys import catalog_record_unit, require_npc_profiles_join_models_of_their_mesh
from native_store.catalog_writer import (KNOWN_CATALOG_SLICES, empty_store_catalog, merge_catalog_slice_records, read_store_catalog,
                                         sha256_hex, sha256_of_file, validate_catalog_record, write_store)
from native_store.gap_rows import read_gap_rows
from native_store.lane_coverage_refresh import refresh_lane_coverage
from native_store.merge_lane_store import main_checkout_root
from native_store.pinned_store_verification import PINNED_STORE_VERIFICATION_WORKER_COUNT, verify_pinned_store_files
from native_store.store_file_copy import add_store_file_source, copy_store_files, missing_store_file_sources
from native_store.store_paths import REPOSITORY_ROOT, confined_child_path, lane_store_root, read_lane_parts_by_name, refuse_reparse_points
from native_store.unit_ledger import run_at_below_normal_priority

LANE_CATALOG_DESCRIPTION = ('Pin a lane store catalog to the SHA-256 of the shared public/l2 catalog it was built on, '
                            'union other lane stores into it, or print the exact restage command with --plan.')
UNION_EXCLUDED_STORE_FILES = ('catalog.json', 'coverage.json')
MERGE_LANE_STORE_SCRIPT = Path(__file__).resolve().parent / 'merge_lane_store.py'
MAIN_CHECKOUT_STORE_TARGET = 'public/l2'
UNION_CATALOG_FIELDS = frozenset({'schemaVersion', 'sourceCatalogSha256', *KNOWN_CATALOG_SLICES})
RETIRING_GAP_ROW_STATUS = 'gap'


class LaneCatalogError(ValueError):
    pass


def shared_store_root(project_root):
    return Path(project_root) / 'public' / 'l2'


def base_catalog_sha256(project_root):
    base_catalog_path = shared_store_root(project_root) / 'catalog.json'
    if not base_catalog_path.is_file():
        raise LaneCatalogError(f'base catalog is missing: {base_catalog_path}')
    return sha256_of_file(base_catalog_path)


def records_by_slice(catalog):
    return {slice_name: len(catalog[slice_name]) for slice_name in KNOWN_CATALOG_SLICES if slice_name in catalog}


def union_lane_store_relative_paths(union_store_root):
    if not union_store_root.is_dir():
        return []
    relative_paths = (path.relative_to(union_store_root).as_posix() for path in union_store_root.rglob('*') if path.is_file())
    return sorted(relative for relative in relative_paths if relative not in UNION_EXCLUDED_STORE_FILES)


def require_known_catalog_fields(catalog_label, catalog):
    unknown_fields = sorted(set(catalog) - UNION_CATALOG_FIELDS)
    if unknown_fields:
        raise LaneCatalogError(f'{catalog_label} catalog holds unknown fields {", ".join(unknown_fields)}; preserved')
    for slice_name in KNOWN_CATALOG_SLICES:
        if not isinstance(catalog.get(slice_name, []), list):
            raise LaneCatalogError(f'{catalog_label} catalog {slice_name} is not a list; preserved')


def require_union_lanes_agree(union_lane_name, slice_name, incoming_records, owner_and_record_by_record_key):
    for record in incoming_records:
        record_id = validate_catalog_record(slice_name, record)['id']
        owner_lane_name, owned_record = owner_and_record_by_record_key.setdefault((slice_name, record_id), (union_lane_name, record))
        if owned_record != record:
            raise LaneCatalogError(f'catalog {slice_name} record {record_id} differs between union lanes {owner_lane_name} and '
                                   f'{union_lane_name}; preserved')


def merge_union_lane(project_root, union_lane_name, base_sha256, catalog, store_file_sources, owner_and_record_by_record_key):
    union_store_root = lane_store_root(project_root, union_lane_name)
    union_catalog, union_catalog_bytes = read_store_catalog(union_store_root)
    if union_catalog_bytes is None:
        raise LaneCatalogError(f'union lane {union_lane_name} has no catalog: {union_store_root / "catalog.json"}')
    require_known_catalog_fields(f'union lane {union_lane_name}', union_catalog)
    union_base_sha256 = union_catalog.get('sourceCatalogSha256')
    if union_base_sha256 != base_sha256:
        raise LaneCatalogError(f'union lane {union_lane_name} was built on base catalog sha256 {union_base_sha256}; '
                               f'the current base catalog sha256 is {base_sha256}')
    verified_store_file_by_key = verify_pinned_store_files(union_store_root, union_catalog, PINNED_STORE_VERIFICATION_WORKER_COUNT)
    require_npc_profiles_join_models_of_their_mesh(union_store_root, union_catalog, shared_store_root(project_root))
    for relative in union_lane_store_relative_paths(union_store_root):
        add_store_file_source(store_file_sources, relative, confined_child_path(union_store_root, relative), verified_store_file_by_key)
    for slice_name in KNOWN_CATALOG_SLICES:
        incoming_records = union_catalog.get(slice_name, [])
        if incoming_records:
            require_union_lanes_agree(union_lane_name, slice_name, incoming_records, owner_and_record_by_record_key)
            catalog = merge_catalog_slice_records(catalog, slice_name, incoming_records, len(catalog.get(slice_name, [])) + len(incoming_records))
    return catalog


def unowned_earlier_records(earlier_catalog, union_catalog):
    unowned = []
    for slice_name in KNOWN_CATALOG_SLICES:
        union_record_ids = {record['id'] for record in union_catalog.get(slice_name, [])}
        for earlier_record in earlier_catalog.get(slice_name, []):
            earlier_record_id = validate_catalog_record(slice_name, earlier_record)['id']
            if earlier_record_id not in union_record_ids:
                unowned.append((slice_name, earlier_record))
    return unowned


def owned_gap_rows_by_unit_key_and_step(project_root, union_lane_names):
    parts_by_lane_name = read_lane_parts_by_name()
    owned_rows_by_unit_key_and_step = {}
    for union_lane_name in union_lane_names:
        for row in read_gap_rows(project_root, union_lane_name):
            if row['part'] in parts_by_lane_name[union_lane_name]:
                owned_rows_by_unit_key_and_step.setdefault((row['key'], row['step']), []).append((union_lane_name, row))
    return owned_rows_by_unit_key_and_step


def owning_step_gap_row(lane_name, slice_name, record_id, owned_rows_by_unit_key_and_step):
    refused_record = f'lane {lane_name} catalog {slice_name} record {record_id} is owned by no union lane'
    unit = catalog_record_unit(slice_name, record_id)
    if unit is None:
        raise LaneCatalogError(f'{refused_record}, and its id maps to no unit key; preserved')
    owning_step_rows = owned_rows_by_unit_key_and_step.get((unit.key, unit.owning_step), [])
    if not owning_step_rows:
        raise LaneCatalogError(f'{refused_record}, and no union lane {unit.owning_step} row records its unit {unit.key}; preserved')
    for owning_lane_name, row in owning_step_rows:
        if row['status'] != RETIRING_GAP_ROW_STATUS:
            raise LaneCatalogError(f'{refused_record}, and union lane {owning_lane_name} records its unit {unit.key} at step '
                                   f'{unit.owning_step} as {row["status"]}; only a {RETIRING_GAP_ROW_STATUS} row of that step retires it; '
                                   'preserved')
    return unit, owning_step_rows[0]


def store_files_pinned_by_record(store_root, slice_name, record):
    return verify_pinned_store_files(store_root, {slice_name: [record]}, PINNED_STORE_VERIFICATION_WORKER_COUNT)


def retired_earlier_records(project_root, lane_name, union_lane_names, earlier_catalog, union_catalog, store_file_sources):
    unowned = unowned_earlier_records(earlier_catalog, union_catalog)
    if not unowned:
        return []
    owned_rows_by_unit_key_and_step = owned_gap_rows_by_unit_key_and_step(project_root, union_lane_names)
    store_root = lane_store_root(project_root, lane_name)
    retired = []
    for slice_name, record in unowned:
        unit, (owning_lane_name, row) = owning_step_gap_row(lane_name, slice_name, record['id'], owned_rows_by_unit_key_and_step)
        pinned_store_file_by_key = store_files_pinned_by_record(store_root, slice_name, record)
        removed_store_files = sorted(store_file.relative for key, store_file in pinned_store_file_by_key.items() if key not in store_file_sources)
        retired.append({'slice': slice_name, 'id': record['id'], 'unitKey': unit.key, 'lane': owning_lane_name, 'step': row['step'],
                        'status': row['status'], 'reason': row['reason'], 'removedStoreFiles': removed_store_files})
    return retired


def remove_retired_store_files(store_root, retired_records):
    root = refuse_reparse_points(store_root)
    for relative in sorted({relative for retired_record in retired_records for relative in retired_record['removedStoreFiles']}):
        store_file = confined_child_path(root, relative)
        store_file.unlink()
        folder = store_file.parent
        while folder != root and not any(folder.iterdir()):
            folder.rmdir()
            folder = folder.parent


def union_catalog_of_lanes(project_root, lane_name, union_lane_names, base_sha256, earlier_catalog, store_file_sources):
    require_known_catalog_fields(f'lane {lane_name}', earlier_catalog)
    union_catalog = empty_store_catalog()
    owner_and_record_by_record_key = {}
    for union_lane_name in union_lane_names:
        union_catalog = merge_union_lane(project_root, union_lane_name, base_sha256, union_catalog, store_file_sources,
                                         owner_and_record_by_record_key)
    retired_records = retired_earlier_records(project_root, lane_name, union_lane_names, earlier_catalog, union_catalog, store_file_sources)
    return union_catalog, retired_records


def require_distinct_union_lanes(lane_name, union_lane_names):
    if lane_name in union_lane_names:
        raise LaneCatalogError(f'target lane {lane_name} cannot also be a union lane')
    for union_lane_name in union_lane_names:
        if union_lane_names.count(union_lane_name) > 1:
            raise LaneCatalogError(f'union lane {union_lane_name} is listed twice')


def restage_command(project_root, lane_name, base_sha256):
    main_checkout, merge_script, lane_store = (main_checkout_root(project_root).as_posix(), MERGE_LANE_STORE_SCRIPT.as_posix(),
                                               lane_store_root(project_root, lane_name).as_posix())
    if any(character.isspace() for path in (main_checkout, merge_script, lane_store) for character in path):
        raise LaneCatalogError(f'a restage command path holds whitespace and would not run unquoted: {main_checkout}, {merge_script}, {lane_store}')
    return (f'cd {main_checkout} && python -B {merge_script} --lane-store {lane_store} --target {MAIN_CHECKOUT_STORE_TARGET} '
            f'--expected-base-catalog-sha256 {base_sha256}')


def write_lane_catalog(project_root, lane_name, union_lane_names=(), plan_only=False):
    union_lane_names = list(union_lane_names)
    require_distinct_union_lanes(lane_name, union_lane_names)
    store_root = lane_store_root(project_root, lane_name)
    base_sha256 = base_catalog_sha256(project_root)
    catalog, before = read_store_catalog(store_root)
    if plan_only and before is None:
        raise LaneCatalogError(f'lane {lane_name} has no catalog: {store_root / "catalog.json"}')
    store_file_sources = {}
    union_report = {}
    if union_lane_names:
        catalog, retired_records = union_catalog_of_lanes(project_root, lane_name, union_lane_names, base_sha256, catalog, store_file_sources)
        union_report = {'retiredRecords': retired_records}
    else:
        verify_pinned_store_files(store_root, catalog, PINNED_STORE_VERIFICATION_WORKER_COUNT)
        require_npc_profiles_join_models_of_their_mesh(store_root, catalog, shared_store_root(project_root))
    catalog['sourceCatalogSha256'] = base_sha256
    after = json_bytes(catalog)
    summary = {'lane': lane_name, 'laneStoreRoot': store_root.as_posix(), 'catalogSha256': sha256_hex(after),
               'sourceCatalogSha256': base_sha256, 'recordsBySlice': records_by_slice(catalog), **union_report}
    if plan_only:
        if missing_store_file_sources(store_root, store_file_sources) or after != before:
            raise LaneCatalogError(f'lane {lane_name} is not written yet; run write_lane_catalog.py without --plan first')
        return {**summary, 'filesWritten': 0,
                'restageCommand': restage_command(project_root, lane_name, base_sha256)}
    if union_lane_names:
        files_written = copy_store_files(store_root, store_file_sources, before, after)['filesWritten']
        remove_retired_store_files(store_root, union_report['retiredRecords'])
    else:
        files_written = write_store(store_root, {}, before, after)['filesWritten']
    refresh_lane_coverage(project_root, lane_name)
    return {**summary, 'filesWritten': files_written}


def main(argv=None):
    lane_names = sorted(read_lane_parts_by_name())
    parser = argparse.ArgumentParser(description=LANE_CATALOG_DESCRIPTION)
    parser.add_argument('--lane', required=True, choices=lane_names)
    parser.add_argument('--union', action='append', default=[], choices=lane_names)
    parser.add_argument('--plan', action='store_true')
    arguments = parser.parse_args(argv)
    try:
        run_at_below_normal_priority()
        summary = write_lane_catalog(REPOSITORY_ROOT, arguments.lane, arguments.union, plan_only=arguments.plan)
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(summary['restageCommand'] if arguments.plan else json.dumps(summary, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
