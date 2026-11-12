import json
from collections import Counter

from actors.actor_unit_inventory import ARMOR_MESH_UNIT_KIND, WEAPON_MESH_UNIT_KIND
from actors.item_conversion import ETCITEM_TABLE_NAME, ITEM_LANE_NAME, ITEMNAME_TABLE_NAME, ItemConversionRun, read_item_sources
from actors.item_requests import (ARMORGRP_TABLE_NAME, ITEM_CENSUS_RELATIVE_PATH, ITEM_STEP, PASS_STATUS, PENDING_STATUS, WEAPONGRP_TABLE_NAME,
                                  grouped_item_status, item_gap_rows, ungrouped_item_reason)
from actors.item_unit_workers import outcomes_converted_by_workers
from native_store.gap_rows import write_gap_rows
from native_store.store_paths import lane_work_root

ITEM_CENSUS_SCHEMA_VERSION = 1
ITEM_BATCH_NAME = 'items'
UNIT_KIND_NAMES = {WEAPON_MESH_UNIT_KIND: 'weapon', ARMOR_MESH_UNIT_KIND: 'armor'}


class ItemBatchError(ValueError):
    pass


def unit_status_counts(units, sealed_outcomes):
    counts = {name: {'convertible': 0, 'converted': 0, 'gap': 0, 'pending': 0} for name in UNIT_KIND_NAMES.values()}
    for unit in units:
        kind_counts = counts[UNIT_KIND_NAMES[unit['unitKind']]]
        kind_counts['convertible'] += 1
        outcome = sealed_outcomes.get(unit['unitKey'])
        kind_counts['pending' if outcome is None else 'converted' if outcome['status'] == PASS_STATUS else 'gap'] += 1
    return counts


def item_status_counts(run, sealed_outcomes):
    grouped_ids = set(run.grouped_items)
    converted, pending, gap_reasons = 0, 0, Counter()
    for item_id in run.sources.itemname_ids:
        if item_id not in grouped_ids:
            gap_reasons[ungrouped_item_reason(item_id, run.sources.etcitem_ids)] += 1
            continue
        status, reason = grouped_item_status(run.grouped_items[item_id]['entries'], run.census_units_by_key, sealed_outcomes)
        if status == PASS_STATUS:
            converted += 1
        elif status == PENDING_STATUS:
            pending += 1
        else:
            gap_reasons[reason] += 1
    return {'converted': converted, 'gap': dict(sorted(gap_reasons.items())), 'pending': pending}


def sealed_unit_rows(run, sealed_outcomes):
    return [{'unitKey': unit['unitKey'], 'unitKind': UNIT_KIND_NAMES[unit['unitKind']], 'status': sealed_outcomes[unit['unitKey']]['status'],
             'reason': sealed_outcomes[unit['unitKey']]['reason'], 'itemIds': sorted({entry['itemId'] for entry in unit['entries']}),
             'recordIds': sorted(entry['recordId'] for entry in unit['entries'])}
            for unit in run.units if unit['unitKey'] in sealed_outcomes]


def item_census(run, slice_limit):
    sealed_outcomes = run.sealed_outcomes_by_unit_key()
    sources = {table: run.sources.identities[table]['sha256'] for table in (WEAPONGRP_TABLE_NAME, ARMORGRP_TABLE_NAME, ITEMNAME_TABLE_NAME,
                                                                             ETCITEM_TABLE_NAME)}
    return {'schemaVersion': ITEM_CENSUS_SCHEMA_VERSION, 'sources': sources, 'denominator': len(run.sources.itemname_ids),
            'units': unit_status_counts(run.units, sealed_outcomes), 'items': item_status_counts(run, sealed_outcomes),
            'sealedUnits': sealed_unit_rows(run, sealed_outcomes), 'sliceLimit': slice_limit}


def write_item_census_and_gap_rows(run, slice_limit):
    sealed_outcomes = run.sealed_outcomes_by_unit_key()
    write_gap_rows(run.project_root, ITEM_LANE_NAME, ITEM_STEP,
                   item_gap_rows(run.grouped_items, run.census_units_by_key, sealed_outcomes, run.sources.identities))
    path = run.project_root / ITEM_CENSUS_RELATIVE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((json.dumps(item_census(run, slice_limit), indent=1, sort_keys=True, ensure_ascii=True) + '\n').encode('ascii'))
    return path


def selected_slice_units(run, limit):
    sealed_outcomes = run.sealed_outcomes_by_unit_key()
    slice_units, unsealed_units = [], []
    for unit in run.units:
        if len(unsealed_units) >= limit:
            break
        slice_units.append(unit)
        if unit['unitKey'] not in sealed_outcomes:
            unsealed_units.append(unit)
    return slice_units, unsealed_units


def written_slice_outcomes(run, slice_units, unsealed_units, converted_outcomes):
    converted_outcomes_by_unit_key = {unit['unitKey']: outcome for unit, outcome in zip(unsealed_units, converted_outcomes, strict=True)}
    sealed_outcomes = run.sealed_outcomes_by_unit_key()
    outcomes = [converted_outcomes_by_unit_key[unit['unitKey']] if unit['unitKey'] in converted_outcomes_by_unit_key
                else sealed_outcomes[unit['unitKey']] for unit in slice_units]
    run.write_item_records(outcomes)
    return outcomes


def run_item_batch(run, limit, preflight):
    slice_units, unsealed_units = selected_slice_units(run, limit)
    converted_outcomes = []
    for unit in unsealed_units:
        preflight()
        converted_outcomes.append(run.convert(unit))
    return written_slice_outcomes(run, slice_units, unsealed_units, converted_outcomes)


def run_pooled_item_batch(run, limit, preflight, worker_count, worker_run_factory, worker_run_arguments):
    slice_units, unsealed_units = selected_slice_units(run, limit)
    converted_outcomes = outcomes_converted_by_workers([unit['unitKey'] for unit in unsealed_units], worker_count, worker_run_factory,
                                                       worker_run_arguments, preflight)
    for unit, outcome in zip(unsealed_units, converted_outcomes, strict=True):
        run.add_sealed_outcome_of_converted_unit(unit, outcome)
    return written_slice_outcomes(run, slice_units, unsealed_units, converted_outcomes)


def item_units(run, item_id):
    if item_id not in run.grouped_items:
        raise ItemBatchError(f'item {item_id} has no weapongrp or armorgrp row')
    return [unit for unit in run.units if any(entry['itemId'] == item_id for entry in unit['entries'])]


def run_item_conversion(project_root, client_access, converter, output_root, decode_table, arguments, preflight):
    sources = read_item_sources(project_root, client_access.root, decode_table)
    run = ItemConversionRun(project_root, client_access, converter, lane_work_root(project_root, ITEM_LANE_NAME), output_root, sources)
    if arguments.batch == ITEM_BATCH_NAME:
        outcomes = run_item_batch(run, arguments.limit, preflight)
    else:
        outcomes = [run.convert(unit) for unit in item_units(run, arguments.item)]
        run.write_item_records(outcomes)
    write_item_census_and_gap_rows(run, arguments.limit)
    return outcomes
