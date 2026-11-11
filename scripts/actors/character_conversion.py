import json
import shutil
from collections import namedtuple
from pathlib import Path

from actors.actor_census import MESH_PACKAGE_SUFFIXES, TEXTURE_PACKAGE_SUFFIXES, ActorPackageCensus
from actors.actor_unit_inventory import ACTOR_UNIT_CENSUS_RELATIVE_PATH, model_record_capacity, decoded_table_identity
from actors.data_ui_table_manifest import data_ui_table_manifest
from actors.character_requests import (CHARACTER_STEP, CLASSINFO_TABLE_NAME, GAP_STATUS, HAIRGRP_TABLE_NAME, HELMETGRP_TABLE_NAME,
                                       build_character_request, character_gap_rows, character_key, chargrp_row_at, is_padding_row,
                                       resolve_character_actor_class)
from actors.npc_requests import (CONVERTER_REFUSED_REASON_PREFIX, FAILED_STATUS, PASS_STATUS, TRANSIENT_FAILURES,
                                 animation_reference_gap_reason, serialized_animation_reference)
from actors.path_free_messages import path_free_reason
from actors.npc_store_records import (MODEL_ARCHIVE_FILE_NAME, catalog_with_record_replaced, converted_model_store_files_and_record,
                                      file_output_record, write_catalog_without_record)
from data.lane_unit_outcomes import replace_step_gap_row
from native_assets import UMODEL_SHA256, implementation_hash
from native_assets_lib.gltf import json_bytes
from native_store.catalog_writer import read_store_catalog, write_store
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from reference_client_guard import ReferenceClientLockError

CHARACTER_ALGORITHM_VERSION = 1
CHARACTER_LANE_NAME = 'actors'
CHARACTER_MODEL_ID_PREFIX = 'character-model:'
PADDING_STATUS = 'padding'
CharacterSources = namedtuple('CharacterSources', 'chargrp classinfo hairgrp helmetgrp read_class_definition')


class LazyClassDefinitionReader:
    def __init__(self, client_root, work_root):
        self.client_root, self.work_root, self.reader = Path(client_root), Path(work_root), None

    def save(self, relative_path, payload):
        path = self.work_root / 'saved' / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        return relative_path

    def __call__(self, reference):
        if self.reader is None:
            from native_catalog.effects import SourcePackages
            from native_effect_bundle import DefaultReader
            self.reader = DefaultReader(self.client_root, SourcePackages(self.client_root), self.work_root, self.save)
        return self.reader.get(reference)


def read_character_sources(project_root, client_root, decode_table, class_work_root):
    return CharacterSources(decode_table(Path(client_root), 'chargrp'), data_ui_table_manifest(project_root, CLASSINFO_TABLE_NAME),
                            data_ui_table_manifest(project_root, HAIRGRP_TABLE_NAME), data_ui_table_manifest(project_root, HELMETGRP_TABLE_NAME),
                            LazyClassDefinitionReader(client_root, class_work_root))


def model_gap_reason(census_reason, generated):
    if census_reason:
        return census_reason
    return None if generated['request'] else generated['gaps'][0]['reason']


def manifest_source_sha256(manifest):
    return manifest['sourceSha256'] if manifest else None


class CharacterConversionRun:
    def __init__(self, project_root, client_access, converter, ledger_root, store_root, sources):
        self.project_root, self.client_access, self.converter = Path(project_root), client_access, converter
        self.store_root, self.sources = store_root, sources
        self.census = json.loads((self.project_root / ACTOR_UNIT_CENSUS_RELATIVE_PATH).read_bytes())
        self.units_by_key = {unit['key']: unit for unit in self.census['units']}
        self.ledger = UnitLedger(ledger_root, CHARACTER_STEP, CHARACTER_ALGORITHM_VERSION)
        self.package_census = ActorPackageCensus(client_access, [])
        self.table_identity = decoded_table_identity(sources.chargrp)

    def actor_class(self, class_reference):
        if class_reference is None:
            return None
        definition = self.sources.read_class_definition(class_reference)
        return {'class': class_reference, 'packageSha256': definition['source']['packageSha256'], 'properties': definition['properties']}

    def unit_inputs(self, request):
        paths = {self.sources.chargrp['source']}
        for part in (request or {}).get('parts', []):
            paths.update(self.package_census.resolve_package_paths(part['package'] + '.' + part['object'], MESH_PACKAGE_SUFFIXES))
            paths.update(path for material in part['materials']
                         for path in self.package_census.resolve_package_paths(material.split('=', 1)[1], TEXTURE_PACKAGE_SUFFIXES))
        return locked_input_records(sorted(paths))

    def unit_work(self, row_index):
        row = chargrp_row_at(self.sources.chargrp, row_index)
        class_resolution = resolve_character_actor_class(self.sources.classinfo, row_index)
        generated = build_character_request(row, row_index, self.actor_class(class_resolution['class']), self.sources)
        config = {'censusReason': self.units_by_key[character_key(row_index)]['reason'], 'classResolution': class_resolution,
                  'generated': generated, 'converterSha256': implementation_hash(), 'umodelSha256': UMODEL_SHA256,
                  'tableSources': {table: manifest_source_sha256(manifest) for table, manifest in
                                   ((CLASSINFO_TABLE_NAME, self.sources.classinfo), (HAIRGRP_TABLE_NAME, self.sources.hairgrp),
                                    (HELMETGRP_TABLE_NAME, self.sources.helmetgrp))}}
        inputs = self.unit_inputs(generated['request'])
        return generated, config, inputs, self.ledger.unit_fingerprint([record['sha256'] for record in inputs], config)

    def gap_row(self, row_index, reason):
        evidence = self.ledger.unit_step_directory(character_key(row_index)) / RECEIPT_RECORD_NAME
        return character_gap_rows(row_index, CHARACTER_STEP, GAP_STATUS, reason, self.table_identity,
                                  evidence.relative_to(self.ledger.lane_folder).as_posix())[0]

    def converted_model_reason(self, request):
        try:
            first_part = request['parts'][0]
            _, package = self.converter.package(first_part['package'])
            mesh_export = self.converter.select(package, first_part['object'], 'SkeletalMesh')
            animation_reference = serialized_animation_reference(package, mesh_export)
            reason = animation_reference_gap_reason(animation_reference, package.package_name)
            return (reason, None) if reason else (None, self.converter.convert({**request, 'animation': animation_reference}))
        except ReferenceClientLockError:
            raise
        except ValueError as error:
            return CONVERTER_REFUSED_REASON_PREFIX + path_free_reason(str(error), self.client_access.root, self.converter.output), None

    def sealed_outcome(self, row_index):
        receipt = self.ledger.sealed_receipt(character_key(row_index))
        gap_rows = receipt['gapRows']
        replace_step_gap_row(self.project_root, CHARACTER_LANE_NAME, CHARACTER_STEP, character_key(row_index), gap_rows[0] if gap_rows else None)
        return self.outcome(row_index, gap_rows[0]['reason'] if gap_rows else None, True, receipt['outputs'])

    def outcome(self, row_index, reason, cache_hit, outputs):
        return {'key': character_key(row_index), 'chargrpIndex': row_index, 'step': CHARACTER_STEP,
                'status': GAP_STATUS if reason else PASS_STATUS, 'reason': reason, 'cacheHit': cache_hit, 'outputs': list(outputs)}

    def convert(self, row_index):
        if is_padding_row(chargrp_row_at(self.sources.chargrp, row_index)):
            return {'key': None, 'chargrpIndex': row_index, 'step': CHARACTER_STEP, 'status': PADDING_STATUS, 'reason': None,
                    'cacheHit': False, 'outputs': []}
        key = character_key(row_index)
        generated, config, inputs, fingerprint = self.unit_work(row_index)
        if self.ledger.is_sealed(key, fingerprint):
            return self.synchronize_model_record(row_index, self.sealed_outcome(row_index))
        step_directory = self.ledger.begin(key, fingerprint)
        model_reason = model_gap_reason(config['censusReason'], generated)
        outputs = []
        if model_reason is None:
            try:
                model_reason, result = self.converted_model_reason(generated['request'])
            except TRANSIENT_FAILURES as error:
                return {**self.outcome(row_index, path_free_reason(str(error), self.client_access.root, self.converter.output), False, []),
                        'status': FAILED_STATUS}
            if result is not None:
                archive_copy = step_directory / MODEL_ARCHIVE_FILE_NAME
                shutil.copyfile(result['file'], archive_copy)
                outputs.append(file_output_record(self.ledger.lane_folder, archive_copy))
        reason = model_reason or generated['profileFields']['reason']
        gap_row = self.gap_row(row_index, reason) if reason else None
        self.ledger.seal(key, fingerprint, {'config': config, 'inputs': inputs, 'outputs': outputs, 'gapRows': [gap_row] if gap_row else []})
        replace_step_gap_row(self.project_root, CHARACTER_LANE_NAME, CHARACTER_STEP, key, gap_row)
        return self.synchronize_model_record(row_index, self.outcome(row_index, reason, False, outputs))

    def synchronize_model_record(self, row_index, outcome):
        record_id = CHARACTER_MODEL_ID_PREFIX + str(row_index)
        if not outcome['outputs']:
            write_catalog_without_record(self.store_root, 'models', record_id)
            return outcome
        files, record = converted_model_store_files_and_record(record_id, self.ledger.lane_output_path(outcome['outputs'][0]['path']))
        catalog, before = read_store_catalog(self.store_root)
        catalog = catalog_with_record_replaced(catalog, 'models', record, model_record_capacity(self.census))
        catalog['models'] = sorted(catalog['models'], key=lambda existing: existing['id'])
        write_store(self.store_root, files, before, json_bytes(catalog))
        return outcome
