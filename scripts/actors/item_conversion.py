import json
import shutil
from collections import namedtuple
from pathlib import Path

from actors.actor_census import MESH_PACKAGE_SUFFIXES, TEXTURE_PACKAGE_SUFFIXES, ActorPackageCensus
from actors.actor_unit_inventory import (ACTOR_UNIT_CENSUS_RELATIVE_PATH, ARMOR_MESH_UNIT_KIND, CONVERTIBLE_UNIT_STATUS, decoded_table_identity,
                                         model_record_capacity)
from actors.item_requests import (ARMORGRP_TABLE_NAME, GAP_STATUS, ITEM_STEP, PASS_STATUS, WEAPONGRP_TABLE_NAME, build_armor_unit_requests,
                                  build_weapon_unit_request, item_gap_row)
from actors.item_unit_inventory import armorgrp_mtx_column_names
from actors.npc_requests import (CONVERTER_REFUSED_REASON_PREFIX, FAILED_STATUS, TRANSIENT_FAILURES, animation_reference_gap_reason,
                                 serialized_animation_reference)
from actors.npc_store_records import (MODEL_ARCHIVE_FILE_NAME, catalog_with_records_replaced, catalog_without_records,
                                      converted_model_store_files_and_record, file_output_record)
from actors.path_free_messages import path_free_reason
from native_assets import UMODEL_SHA256, implementation_hash
from native_assets_lib.gltf import json_bytes
from native_store.catalog_writer import read_store_catalog, write_store
from native_store.data_ui_table_manifest import data_ui_table_manifest
from native_store.gap_census_denominators import decoded_item_ids
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from reference_client_guard import ReferenceClientLockError

ITEM_ALGORITHM_VERSION = 1
ITEM_LANE_NAME = 'actors'
ITEMNAME_TABLE_NAME = 'itemname-e'
ETCITEM_TABLE_NAME = 'etcitemgrp'
ItemSources = namedtuple('ItemSources', 'weapongrp armorgrp armor_columns itemname_ids etcitem_ids identities')


class ItemConversionError(ValueError):
    pass


def required_data_ui_manifest(project_root, table_name):
    manifest = data_ui_table_manifest(project_root, table_name)
    if manifest is None:
        raise ItemConversionError(f'the data-ui lane store has no decoded {table_name} manifest; the item key denominator needs it')
    return manifest


def read_item_sources(project_root, client_root, decode_table):
    weapongrp, armorgrp = decode_table(Path(client_root), WEAPONGRP_TABLE_NAME), decode_table(Path(client_root), ARMORGRP_TABLE_NAME)
    itemname, etcitem = required_data_ui_manifest(project_root, ITEMNAME_TABLE_NAME), required_data_ui_manifest(project_root, ETCITEM_TABLE_NAME)
    identities = {WEAPONGRP_TABLE_NAME: decoded_table_identity(weapongrp), ARMORGRP_TABLE_NAME: decoded_table_identity(armorgrp),
                  ITEMNAME_TABLE_NAME: {'path': itemname['sourcePath'], 'sha256': itemname['sourceSha256']},
                  ETCITEM_TABLE_NAME: {'path': etcitem['sourcePath'], 'sha256': etcitem['sourceSha256']}}
    return ItemSources(weapongrp, armorgrp, armorgrp_mtx_column_names(armorgrp), decoded_item_ids(itemname, ITEMNAME_TABLE_NAME),
                       frozenset(decoded_item_ids(etcitem, ETCITEM_TABLE_NAME)), identities)


def grouped_item_entries(sources):
    grouped = {}
    for table_name, table, entries_of_row in (
            (WEAPONGRP_TABLE_NAME, sources.weapongrp, lambda index: [build_weapon_unit_request(sources.weapongrp, index)]),
            (ARMORGRP_TABLE_NAME, sources.armorgrp, lambda index: build_armor_unit_requests(sources.armorgrp, index, sources.armor_columns))):
        for row_index, row in enumerate(table['data']['item']):
            if row['object_id'] in grouped:
                raise ItemConversionError(f'item {row["object_id"]} has more than one weapongrp or armorgrp row')
            grouped[row['object_id']] = {'bodyPart': row['body_part'], 'table': table_name, 'entries': entries_of_row(row_index)}
    return dict(sorted(grouped.items()))


def conversion_units(grouped_items, census_units_by_key):
    units = {}
    for item_id, grouped in grouped_items.items():
        for entry in grouped['entries']:
            census_unit = census_units_by_key.get(entry['unitKey']) if entry['reason'] is None else None
            if census_unit is None or census_unit['status'] != CONVERTIBLE_UNIT_STATUS:
                continue
            unit = units.setdefault(entry['unitKey'], {'unitKey': entry['unitKey'], 'unitKind': entry['unitKind'], 'request': entry['request'],
                                                       'firstItemId': item_id, 'entries': []})
            unit['entries'].append(entry)
    return list(units.values())


class ItemConversionRun:
    def __init__(self, project_root, client_access, converter, ledger_root, store_root, sources):
        self.project_root, self.client_access, self.converter, self.store_root = Path(project_root), client_access, converter, store_root
        self.sources = sources
        self.census = json.loads((self.project_root / ACTOR_UNIT_CENSUS_RELATIVE_PATH).read_bytes())
        self.census_units_by_key = {unit['key']: unit for unit in self.census['units']}
        self.ledger = UnitLedger(ledger_root, ITEM_STEP, ITEM_ALGORITHM_VERSION)
        self.package_census = ActorPackageCensus(client_access, [])
        self.grouped_items = grouped_item_entries(sources)
        self.units = conversion_units(self.grouped_items, self.census_units_by_key)
        self.units_by_key = {unit['unitKey']: unit for unit in self.units}
        self.converter_implementation_sha256 = implementation_hash()
        self.input_paths_by_unit_key = {unit['unitKey']: self.unit_input_paths(unit) for unit in self.units}
        self.input_records_by_path = {record['path']: record for record in
                                      locked_input_records(sorted({path for paths in self.input_paths_by_unit_key.values() for path in paths}))}
        self.sealed_outcomes = None

    def unit_input_paths(self, unit):
        request = unit['request']
        paths = {self.sources.identities[self.item_table_of(unit)]['path']}
        paths.update(self.package_census.resolve_package_paths(request['package'] + '.' + request['object'], MESH_PACKAGE_SUFFIXES))
        paths.update(path for material in request['materials']
                     for path in self.package_census.resolve_package_paths(material.split('=', 1)[1], TEXTURE_PACKAGE_SUFFIXES))
        return sorted(paths)

    def unit_work(self, unit):
        inputs = [self.input_records_by_path[path] for path in self.input_paths_by_unit_key[unit['unitKey']]]
        config = {'request': unit['request'], 'converterSha256': self.converter_implementation_sha256, 'umodelSha256': UMODEL_SHA256}
        return inputs, config, self.ledger.unit_fingerprint([record['sha256'] for record in inputs], config)

    def item_table_of(self, unit):
        return self.grouped_items[unit['firstItemId']]['table']

    def outcome(self, unit, status, reason, cache_hit, outputs):
        return {'key': unit['unitKey'], 'step': ITEM_STEP, 'itemIds': sorted({entry['itemId'] for entry in unit['entries']}),
                'status': status, 'reason': reason, 'cacheHit': cache_hit, 'outputs': list(outputs)}

    def receipt_outcome(self, unit, receipt):
        gap_rows = receipt['gapRows']
        return self.outcome(unit, GAP_STATUS if gap_rows else PASS_STATUS, gap_rows[0]['reason'] if gap_rows else None, True, receipt['outputs'])

    def sealed_outcomes_by_unit_key(self):
        if self.sealed_outcomes is None:
            sealed_outcomes = {}
            for unit in self.units:
                receipt = self.ledger.sealed_receipt(unit['unitKey'])
                if receipt is not None and receipt['fingerprint'] == self.unit_work(unit)[2]:
                    sealed_outcomes[unit['unitKey']] = self.receipt_outcome(unit, receipt)
            self.sealed_outcomes = sealed_outcomes
        return self.sealed_outcomes

    def converted_model_reason(self, unit):
        request = unit['request']
        try:
            _, package = self.converter.package(request['package'])
            if unit['unitKind'] == ARMOR_MESH_UNIT_KIND:
                animation_reference = serialized_animation_reference(package, self.converter.select(package, request['object'], 'SkeletalMesh'))
                reason = animation_reference_gap_reason(animation_reference, package.package_name)
                if reason:
                    return reason, None
                request = {**request, 'animation': animation_reference}
            return None, self.converter.convert(request)
        except ReferenceClientLockError:
            raise
        except ValueError as error:
            return CONVERTER_REFUSED_REASON_PREFIX + path_free_reason(str(error), self.client_access.root, self.converter.output), None

    def convert(self, unit):
        sealed_outcomes = self.sealed_outcomes_by_unit_key()
        if unit['unitKey'] in sealed_outcomes:
            return sealed_outcomes[unit['unitKey']]
        inputs, config, fingerprint = self.unit_work(unit)
        step_directory = self.ledger.begin(unit['unitKey'], fingerprint)
        try:
            reason, result = self.converted_model_reason(unit)
        except TRANSIENT_FAILURES as error:
            return self.outcome(unit, FAILED_STATUS, path_free_reason(str(error), self.client_access.root, self.converter.output), False, [])
        outputs = []
        if result is not None:
            archive_copy = step_directory / MODEL_ARCHIVE_FILE_NAME
            shutil.copyfile(result['file'], archive_copy)
            outputs.append(file_output_record(self.ledger.lane_folder, archive_copy))
        evidence = (step_directory / RECEIPT_RECORD_NAME).relative_to(self.ledger.lane_folder).as_posix()
        gap_rows = [{**item_gap_row(unit['firstItemId'], GAP_STATUS, reason, self.sources.identities[self.item_table_of(unit)]),
                     'evidence': evidence}] if reason else []
        self.ledger.seal(unit['unitKey'], fingerprint, {'config': config, 'inputs': inputs, 'outputs': outputs, 'gapRows': gap_rows})
        sealed_outcomes[unit['unitKey']] = self.receipt_outcome(unit, self.ledger.sealed_receipt(unit['unitKey']))
        return self.outcome(unit, GAP_STATUS if reason else PASS_STATUS, reason, False, outputs)

    def write_item_records(self, outcomes):
        catalog, before = read_store_catalog(self.store_root)
        present_ids = {record['id'] for record in catalog.get('models', [])}
        unchanged_catalog_bytes = json_bytes(catalog) if before is None else before
        removed_record_ids, incoming_records, catalog_changed = set(), [], False
        for outcome in outcomes:
            unit = self.units_by_key[outcome['key']]
            record_ids = [entry['recordId'] for entry in unit['entries']]
            if outcome['status'] == GAP_STATUS:
                catalog_changed = catalog_changed or any(record_id in present_ids for record_id in record_ids)
                removed_record_ids.update(record_ids)
                continue
            if outcome['status'] != PASS_STATUS or (outcome['cacheHit'] and all(record_id in present_ids for record_id in record_ids)):
                continue
            unit_files, unit_record = converted_model_store_files_and_record(record_ids[0],
                                                                             self.ledger.lane_output_path(outcome['outputs'][0]['path']))
            write_store(self.store_root, unit_files, before, unchanged_catalog_bytes)
            before = unchanged_catalog_bytes
            incoming_records.extend({**unit_record, 'id': record_id} for record_id in record_ids)
            catalog_changed = True
        if not catalog_changed:
            return
        catalog = catalog_with_records_replaced(catalog_without_records(catalog, 'models', removed_record_ids), 'models', incoming_records,
                                                model_record_capacity(self.census))
        catalog['models'] = sorted(catalog['models'], key=lambda existing: existing['id'])
        write_store(self.store_root, {}, before, json_bytes(catalog))
