import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json
import re
import shutil

from actors.actor_census import SOUND_PACKAGE_SUFFIXES, TEXTURE_PACKAGE_SUFFIXES, ActorPackageCensus
from actors.actor_unit_inventory import (ACTOR_UNIT_CENSUS_RELATIVE_PATH, CONVERTIBLE_UNIT_STATUS, NO_MESH_IN_ROW_REASON, NPC_MODEL_UNIT_KIND,
                                         NPC_PART_NAME, conversion_unit_key, decoded_table_identity)
from actors.npc_requests import (ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX, CONVERTER_REFUSED_REASON_PREFIX, FAILED_STATUS, GAP_STATUS,
                                 NPC_NAME_EMPTY_REASON, NPC_NAME_ROW_MISSING_REASON, NPC_PROFILE_STEP, PASS_STATUS, TRANSIENT_FAILURES,
                                 SOUND_PACKAGE_NOT_IN_CLIENT_STATUS, SOUND_PACKAGE_REFUSED_STATUS, animation_reference_gap_reason,
                                 label_npc_sound_identities, npc_effect_binding_record, npc_model_request, npc_profile_recipe,
                                 npc_sound_references, package_stem, serialized_animation_reference)
from actors.npc_batch import (NpcSourceIdentities, npc_batch_plan, printed_batch_plan, read_census_and_npc_tables, run_npc_batch_slice,
                              shared_store_npc_ids)
from actors.npc_store_records import (MODEL_ARCHIVE_FILE_NAME, bundle_output_records, converted_model_store_files_and_record,
                                      PROFILE_MANIFEST_FILE_NAME, file_output_record, profile_bundle_store_files_and_record,
                                      profile_record_npc_ids)
from data.lane_unit_outcomes import replace_step_gap_row
from native_actor_profiles import MAXIMUM_NPC_PROFILE_BUNDLES, migrate_npc_profiles
from native_assets import UMODEL, UMODEL_SHA256, Converter, implementation_hash
from native_assets_lib.gltf import json_bytes
from native_catalog.effects import SourcePackages
from native_catalog.tables import decode_table
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import merge_catalog_slice, read_store_catalog, write_store
from native_store.gap_rows import QUALIFIED_OBJECT_NAME_PATTERN
from native_store.store_paths import REPOSITORY_ROOT, lane_store_root, lane_work_root, require_converter_output
from native_store.unit_ledger import (BATCH_MINIMUM_FREE_BYTES, RECEIPT_RECORD_NAME, UnitLedger, locked_input_records,
                                      require_batch_preflight, run_at_below_normal_priority)
from reference_client_guard import ReferenceClientLockError, require_reference_client

LANE_NAME = 'actors'
NPC_MODEL_STEP = 'npc-model'
NPC_SOUND_IDENTITY_STEP = 'npc-sound-identities'
NPC_MODEL_ALGORITHM_VERSION = 1
NPC_PROFILE_ALGORITHM_VERSION = 1
CONVERTER_WORK_FOLDER = 'converter'
PROFILE_BUNDLE_FOLDER = 'bundle'
IDENTITY_RECORD_NAME = 'sound-and-effect-identities.json'
NPC_ID_PATTERN = re.compile(r'^[0-9]{1,10}$')
MAXIMUM_SAFE_INTEGER = 2 ** 53 - 1
SLICE_LIMIT_PATTERN = re.compile(r'^[1-9][0-9]{0,5}$')
NPC_BATCH_NAME = 'npcs'
CONVERT_ACTORS_DESCRIPTION = ('Convert one NPC id, or the next slice of the NPC batch, from the decoded npcgrp and npcname rows into the '
                              'actors lane store: model units through the pinned Converter and generated profile bundles, each a sealed '
                              'ledger unit. --print-batch-plan prints the batch order and pack layout and writes nothing.')


class ConvertActorsError(ValueError):
    pass


def npc_id_argument(text):
    if not NPC_ID_PATTERN.fullmatch(text) or int(text) > MAXIMUM_SAFE_INTEGER:
        raise argparse.ArgumentTypeError(f'--npc must match {NPC_ID_PATTERN.pattern} within the safe integer range: {text!r}')
    return int(text)


def path_free_reason(message, source_root, output_root):
    for root, placeholder in ((source_root, '<source>'), (output_root, '<output>')):
        for spelling in {str(root), Path(root).as_posix()}:
            message = message.replace(spelling, placeholder)
    return ' '.join(message.split())


class NpcConversionRun:
    def __init__(self, project_root, client_access, converter, ledger_root, store_root):
        self.project_root, self.client_access, self.converter, self.store_root = Path(project_root), client_access, converter, store_root
        self.census, self.npcgrp, self.npcname, self.name_table = read_census_and_npc_tables(self.project_root, client_access.root, decode_table)
        self.units_by_key = {unit['key']: unit for unit in self.census['units']}
        self.model_ledger = UnitLedger(ledger_root, NPC_MODEL_STEP, NPC_MODEL_ALGORITHM_VERSION)
        self.profile_ledger = UnitLedger(ledger_root, NPC_PROFILE_STEP, NPC_PROFILE_ALGORITHM_VERSION)
        self.package_census = ActorPackageCensus(client_access, [])
        self.converter_output = converter.output
        self.converter_implementation_sha256 = implementation_hash()
        self.model_unit_work_by_key = {}

    def path_free_reason(self, error):
        return path_free_reason(str(error), self.client_access.root, self.converter_output)

    def gap_row(self, npc_key, ledger, unit_key, reason, source_identity):
        evidence = ledger.unit_step_directory(unit_key) / RECEIPT_RECORD_NAME
        return {'key': npc_key, 'part': NPC_PART_NAME, 'step': ledger.step, 'status': GAP_STATUS, 'reason': reason,
                'sourceIdentity': source_identity, 'evidence': evidence.relative_to(ledger.lane_folder).as_posix()}

    def seal(self, npc_key, ledger, unit_key, fingerprint, inputs, config, outputs, gap_row, step_gap_rows=()):
        replace_step_gap_row(self.project_root, LANE_NAME, ledger.step, npc_key, gap_row)
        ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': inputs, 'outputs': outputs,
                                            'gapRows': ([gap_row] if gap_row else []) + list(step_gap_rows)})

    def sealed_outcome(self, npc_key, ledger, unit_key):
        receipt = json.loads((ledger.unit_step_directory(unit_key) / RECEIPT_RECORD_NAME).read_bytes())
        step_gap_rows = [row for row in receipt['gapRows'] if row['step'] == ledger.step]
        if step_gap_rows:
            replace_step_gap_row(self.project_root, LANE_NAME, ledger.step, npc_key, {**step_gap_rows[0], 'key': npc_key})
            return {'key': unit_key, 'step': ledger.step, 'status': GAP_STATUS, 'reason': step_gap_rows[0]['reason'], 'cacheHit': True}
        return {'key': unit_key, 'step': ledger.step, 'status': PASS_STATUS, 'reason': None, 'cacheHit': True, 'outputs': receipt['outputs']}

    def unit_outcome(self, ledger, unit_key, status, reason, cache_hit, outputs=()):
        return {'key': unit_key, 'step': ledger.step, 'status': status, 'reason': reason, 'cacheHit': cache_hit, 'outputs': list(outputs)}

    def first_row_index_of_selection(self, selection):
        return next(index for index, row in enumerate(self.npcgrp['data']['npc'])
                    if row['mesh_name'] == selection['mesh'] and [slot['param_texture_name'] for slot in row['texture_name']] == selection['textures'])

    def census_gap_model_outcome(self, npc_key, unit_key, selection, reason, source_identity):
        inputs = locked_input_records([self.npcgrp['source']])
        config = {'selection': selection, 'censusReason': reason}
        fingerprint = self.model_ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
        if self.model_ledger.is_sealed(unit_key, fingerprint):
            return self.sealed_outcome(npc_key, self.model_ledger, unit_key)
        self.model_ledger.begin(unit_key, fingerprint)
        self.seal(npc_key, self.model_ledger, unit_key, fingerprint, inputs, config, [],
                  self.gap_row(npc_key, self.model_ledger, unit_key, reason, source_identity))
        return self.unit_outcome(self.model_ledger, unit_key, GAP_STATUS, reason, False)

    def convertible_model_unit_work(self, unit):
        if unit['key'] not in self.model_unit_work_by_key:
            selection = unit['selection']
            texture_paths = [path for texture in selection['textures'] if texture
                             for path in self.package_census.resolve_package_paths(texture, TEXTURE_PACKAGE_SUFFIXES)]
            inputs = locked_input_records(sorted({self.npcgrp['source'], unit['sourceIdentity']['path'], *texture_paths}))
            request = npc_model_request(unit, self.npcgrp, self.first_row_index_of_selection(selection), None)
            config = {'request': request, 'converterSha256': self.converter_implementation_sha256, 'umodelSha256': UMODEL_SHA256}
            self.model_unit_work_by_key[unit['key']] = (inputs, request, config,
                                                        self.model_ledger.unit_fingerprint([record['sha256'] for record in inputs], config))
        return self.model_unit_work_by_key[unit['key']]

    def is_convertible_model_unit_sealed(self, unit):
        return self.model_ledger.is_sealed(unit['key'], self.convertible_model_unit_work(unit)[3])

    def convert_model(self, npc_key, row):
        selection = {'mesh': row['mesh_name'], 'textures': [slot['param_texture_name'] for slot in row['texture_name']]}
        if not selection['mesh']:
            return self.census_gap_model_outcome(npc_key, npc_key, selection, NO_MESH_IN_ROW_REASON, decoded_table_identity(self.npcgrp))
        unit_key = conversion_unit_key(NPC_MODEL_UNIT_KIND, selection)
        unit = self.units_by_key.get(unit_key)
        if unit is None:
            raise ConvertActorsError(f'{npc_key} names unit {unit_key}, which {ACTOR_UNIT_CENSUS_RELATIVE_PATH} does not hold; rerun actor_census.py')
        if unit['status'] != CONVERTIBLE_UNIT_STATUS:
            return self.census_gap_model_outcome(npc_key, unit_key, selection, unit['reason'], unit['sourceIdentity'])
        inputs, request, config, fingerprint = self.convertible_model_unit_work(unit)
        if self.model_ledger.is_sealed(unit_key, fingerprint):
            return self.sealed_outcome(npc_key, self.model_ledger, unit_key)
        step_directory = self.model_ledger.begin(unit_key, fingerprint)
        try:
            _, package = self.converter.package(request['package'])
            mesh_export = self.converter.select(package, selection['mesh'], 'SkeletalMesh')
            animation_reference = serialized_animation_reference(package, mesh_export)
            reason = animation_reference_gap_reason(animation_reference, package.package_name)
            if reason is None:
                result = self.converter.convert({**request, 'animation': animation_reference})
        except TRANSIENT_FAILURES as error:
            return self.unit_outcome(self.model_ledger, unit_key, FAILED_STATUS, self.path_free_reason(error), False)
        except ReferenceClientLockError:
            raise
        except ValueError as error:
            reason = CONVERTER_REFUSED_REASON_PREFIX + self.path_free_reason(error)
        if reason is not None:
            self.seal(npc_key, self.model_ledger, unit_key, fingerprint, inputs, config, [],
                      self.gap_row(npc_key, self.model_ledger, unit_key, reason, unit['sourceIdentity']))
            return self.unit_outcome(self.model_ledger, unit_key, GAP_STATUS, reason, False)
        archive_copy = step_directory / MODEL_ARCHIVE_FILE_NAME
        shutil.copyfile(result['file'], archive_copy)
        outputs = [file_output_record(self.model_ledger.lane_folder, archive_copy)]
        self.seal(npc_key, self.model_ledger, unit_key, fingerprint, inputs, config, outputs, None)
        return self.unit_outcome(self.model_ledger, unit_key, PASS_STATUS, None, result['cacheHit'], outputs)

    def sound_package_exports(self, npcgrp_row_value):
        exports_by_stem = {}
        for _, _, reference in npc_sound_references(npcgrp_row_value):
            if reference == '' or package_stem(reference) in exports_by_stem:
                continue
            exports_by_stem[package_stem(reference)] = self.sound_exports_of_package(reference)
        return exports_by_stem

    def sound_exports_of_package(self, reference):
        paths = self.package_census.resolve_package_paths(reference, SOUND_PACKAGE_SUFFIXES)
        if len(paths) != 1:
            return SOUND_PACKAGE_NOT_IN_CLIENT_STATUS
        try:
            _, package = self.converter.package(paths[0])
        except ReferenceClientLockError:
            raise
        except ValueError:
            return SOUND_PACKAGE_REFUSED_STATUS
        return [export['object'] for export in package.exports if export['className'] == 'Sound']

    def sound_identity_gap_row(self, npc_key, unit_key, sound_identities):
        unresolved = [label for label in sound_identities['labels'] if label['gapReason']]
        if not unresolved:
            return None
        identity = decoded_table_identity(self.npcgrp)
        if QUALIFIED_OBJECT_NAME_PATTERN.fullmatch(unresolved[0]['reference']):
            identity['object'] = unresolved[0]['reference']
        evidence = self.profile_ledger.unit_step_directory(unit_key) / IDENTITY_RECORD_NAME
        return {'key': npc_key, 'part': NPC_PART_NAME, 'step': NPC_SOUND_IDENTITY_STEP, 'status': GAP_STATUS,
                'reason': unresolved[0]['gapReason'], 'sourceIdentity': identity,
                'evidence': evidence.relative_to(self.profile_ledger.lane_folder).as_posix()}

    def profile_gap_reason_and_identity(self, npc_id, row, model_unit_key, bundle_root):
        name_rows = [name_row for name_row in self.npcname['data']['npc'] if name_row['id'] == npc_id]
        if len(name_rows) > 1:
            raise ConvertActorsError(f'npcname holds {len(name_rows)} rows for npc {npc_id}')
        if not name_rows:
            return NPC_NAME_ROW_MISSING_REASON, decoded_table_identity(self.npcname)
        if not name_rows[0]['name']:
            return NPC_NAME_EMPTY_REASON, decoded_table_identity(self.npcname)
        recipe = npc_profile_recipe(npc_id, name_rows[0], row, model_unit_key, self.name_table)
        class_identity = {**decoded_table_identity(self.npcgrp), 'object': row['class_name']}
        try:
            migrate_npc_profiles(self.client_access.root, recipe, bundle_root)
        except ReferenceClientLockError:
            raise
        except ValueError as error:
            return CONVERTER_REFUSED_REASON_PREFIX + self.path_free_reason(error), class_identity
        excluded_profiles = json.loads((bundle_root / PROFILE_MANIFEST_FILE_NAME).read_bytes())['excludedProfiles']
        if excluded_profiles:
            return ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX + excluded_profiles[0]['field'], class_identity
        return None, None

    def convert_profile(self, npc_id, npc_key, row, model_unit_key, mesh_package_path):
        inputs = locked_input_records(sorted({self.npcgrp['source'], self.npcname['source'], mesh_package_path}))
        config = {'npcId': npc_id, 'modelCatalogId': model_unit_key, 'nameTable': self.name_table}
        fingerprint = self.profile_ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
        if self.profile_ledger.is_sealed(npc_key, fingerprint):
            return self.sealed_outcome(npc_key, self.profile_ledger, npc_key)
        step_directory = self.profile_ledger.begin(npc_key, fingerprint)
        bundle_root = step_directory / PROFILE_BUNDLE_FOLDER
        try:
            sound_identities = label_npc_sound_identities(row, self.sound_package_exports(row))
            reason, source_identity = self.profile_gap_reason_and_identity(npc_id, row, model_unit_key, bundle_root)
        except TRANSIENT_FAILURES as error:
            return self.unit_outcome(self.profile_ledger, npc_key, FAILED_STATUS, self.path_free_reason(error), False)
        identity_path = step_directory / IDENTITY_RECORD_NAME
        identity_path.write_bytes(canonical_json_bytes({'soundIdentities': sound_identities, 'effectBindings': npc_effect_binding_record(row)}))
        outputs = [file_output_record(self.profile_ledger.lane_folder, identity_path)]
        sound_gap_row = self.sound_identity_gap_row(npc_key, npc_key, sound_identities)
        replace_step_gap_row(self.project_root, LANE_NAME, NPC_SOUND_IDENTITY_STEP, npc_key, sound_gap_row)
        step_gap_rows = [sound_gap_row] if sound_gap_row else []
        if reason is not None:
            self.seal(npc_key, self.profile_ledger, npc_key, fingerprint, inputs, config, outputs,
                      self.gap_row(npc_key, self.profile_ledger, npc_key, reason, source_identity), step_gap_rows)
            return self.unit_outcome(self.profile_ledger, npc_key, GAP_STATUS, reason, False)
        outputs += bundle_output_records(self.profile_ledger.lane_folder, bundle_root)
        self.seal(npc_key, self.profile_ledger, npc_key, fingerprint, inputs, config, outputs, None, step_gap_rows)
        return self.unit_outcome(self.profile_ledger, npc_key, PASS_STATUS, None, False, outputs)

    def convertible_npc_model_unit_count(self):
        return sum(1 for unit in self.census['units'] if unit['unitKind'] == NPC_MODEL_UNIT_KIND and unit['status'] == CONVERTIBLE_UNIT_STATUS)

    def write_store_records(self, model_unit_key, npc_key):
        model_receipt_outputs = self.sealed_outcome(npc_key, self.model_ledger, model_unit_key)['outputs']
        model_files, model_record = converted_model_store_files_and_record(
            model_unit_key, self.model_ledger.lane_output_path(model_receipt_outputs[0]['path']))
        profile_files, profile_record = profile_bundle_store_files_and_record(
            self.client_access.root, self.profile_ledger.unit_step_directory(npc_key) / PROFILE_BUNDLE_FOLDER)
        catalog, before = read_store_catalog(self.store_root)
        npc_id = int(npc_key.split(':', 1)[1])
        for record in catalog.get('npcProfiles', []):
            if record['id'] != profile_record['id'] and npc_id in profile_record_npc_ids(self.store_root, record):
                raise ConvertActorsError(f'{npc_key} already has a profile in lane record {record["id"]}; the NPC batch owns it')
        catalog = merge_catalog_slice(catalog, 'models', model_record, self.convertible_npc_model_unit_count())
        catalog = merge_catalog_slice(catalog, 'npcProfiles', profile_record, MAXIMUM_NPC_PROFILE_BUNDLES)
        for slice_name in ('models', 'npcProfiles'):
            catalog[slice_name] = sorted(catalog[slice_name], key=lambda record: record['id'])
        write_store(self.store_root, {**model_files, **profile_files}, before, json_bytes(catalog))


def npcgrp_row_for(npcgrp, npc_id):
    rows = [row for row in npcgrp['data']['npc'] if row['npc_id'] == npc_id]
    if len(rows) != 1:
        raise ConvertActorsError(f'npcgrp holds {len(rows)} rows for npc {npc_id}; the census covers npcgrp rows only')
    return rows[0]


def convert_npc(project_root, client_access, converter, npc_id, ledger_root, store_root=None):
    run = NpcConversionRun(project_root, client_access, converter, ledger_root, store_root or lane_store_root(project_root, LANE_NAME))
    npc_key = f'npc:{npc_id}'
    row = npcgrp_row_for(run.npcgrp, npc_id)
    model_outcome = run.convert_model(npc_key, row)
    if model_outcome['status'] != PASS_STATUS:
        return [model_outcome]
    mesh_package_path = run.units_by_key[model_outcome['key']]['sourceIdentity']['path']
    profile_outcome = run.convert_profile(npc_id, npc_key, row, model_outcome['key'], mesh_package_path)
    if profile_outcome['status'] == PASS_STATUS:
        run.write_store_records(model_outcome['key'], npc_key)
    return [model_outcome, profile_outcome]


def printed_outcome(outcome):
    return {key: outcome[key] for key in ('key', 'step', 'status', 'reason', 'cacheHit')}


def slice_limit_argument(text):
    if not SLICE_LIMIT_PATTERN.fullmatch(text):
        raise argparse.ArgumentTypeError(f'--limit must be an integer of at least 1: {text!r}')
    return int(text)


def batch_plan(census_and_tables, client_root):
    census, npcgrp, npcname, name_table = census_and_tables
    source_identities = NpcSourceIdentities(SourcePackages(client_root))
    return npc_batch_plan(census, npcgrp, npcname, name_table, source_identities, shared_store_npc_ids(REPOSITORY_ROOT))


def print_batch_plan(client_access):
    census_and_tables = read_census_and_npc_tables(REPOSITORY_ROOT, client_access.root, decode_table)
    print(json.dumps(printed_batch_plan(batch_plan(census_and_tables, client_access.root)), indent=2, sort_keys=True), flush=True)


def run_batch_slice(client_access, output_root, converter, limit):
    run = NpcConversionRun(REPOSITORY_ROOT, client_access, converter, lane_work_root(REPOSITORY_ROOT, LANE_NAME), output_root)
    plan = batch_plan((run.census, run.npcgrp, run.npcname, run.name_table), client_access.root)
    report = run_npc_batch_slice(run, plan, limit, lambda: require_batch_preflight(REPOSITORY_ROOT, LANE_NAME, BATCH_MINIMUM_FREE_BYTES))
    outcomes = report['unitOutcomes'] + report['packOutcomes']
    for outcome in outcomes:
        print(json.dumps(printed_outcome(outcome), sort_keys=True), flush=True)
    print(json.dumps({'convertedUnits': report['convertedUnits'], 'stopReason': report['stopReason'], 'store': report['store']},
                     sort_keys=True), flush=True)
    return outcomes


def main(argv=None):
    parser = argparse.ArgumentParser(description=CONVERT_ACTORS_DESCRIPTION)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=REPOSITORY_ROOT / 'artifacts' / 'lane-store' / LANE_NAME / 'l2')
    parser.add_argument('--umodel', type=Path, default=UMODEL)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--npc', type=npc_id_argument)
    mode.add_argument('--batch', choices=[NPC_BATCH_NAME])
    mode.add_argument('--print-batch-plan', action='store_true')
    parser.add_argument('--limit', type=slice_limit_argument)
    arguments = parser.parse_args(argv)
    if (arguments.batch is None) != (arguments.limit is None):
        parser.error('--limit is required with --batch and only valid with --batch')
    try:
        client_access = require_reference_client(arguments.client)
        if arguments.print_batch_plan:
            print_batch_plan(client_access)
            return 0
        output_root = require_converter_output(REPOSITORY_ROOT, arguments.output)
        require_batch_preflight(REPOSITORY_ROOT, LANE_NAME, BATCH_MINIMUM_FREE_BYTES)
        run_at_below_normal_priority()
        converter = Converter(client_access.root, output_root.parent / CONVERTER_WORK_FOLDER, arguments.umodel)
        if arguments.batch:
            outcomes = run_batch_slice(client_access, output_root, converter, arguments.limit)
        else:
            outcomes = convert_npc(REPOSITORY_ROOT, client_access, converter, arguments.npc, lane_work_root(REPOSITORY_ROOT, LANE_NAME), output_root)
            for outcome in outcomes:
                print(json.dumps(printed_outcome(outcome), sort_keys=True), flush=True)
    except (OSError, ValueError) as error:
        print(f'Actor conversion failed: {error}', file=sys.stderr)
        return 1
    return 1 if any(outcome['status'] == FAILED_STATUS for outcome in outcomes) else 0


if __name__ == '__main__':
    raise SystemExit(main())
