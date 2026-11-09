import hashlib
import json
from pathlib import Path, PurePosixPath
from typing import NamedTuple

from actors.actor_unit_inventory import (ACTOR_UNIT_CENSUS_RELATIVE_PATH, CONVERTIBLE_UNIT_STATUS, NPC_MODEL_UNIT_KIND, NPC_PART_NAME,
                                         conversion_unit_key, decoded_table_identity)
from actors.effect_bundle_packing import native_class_closure, pack_items_by_class_closure
from actors.npc_requests import (ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX, CONVERTER_REFUSED_REASON_PREFIX, FAILED_STATUS, GAP_STATUS,
                                 NPC_NAME_EMPTY_REASON, NPC_NAME_ROW_MISSING_REASON, NPC_PROFILE_RECIPE_ID_PREFIX, PASS_STATUS,
                                 TRANSIENT_FAILURES, npc_profile_selection, npc_profiles_recipe)
from actors.npc_store_records import (PROFILE_MANIFEST_FILE_NAME, bundle_output_records, catalog_with_record_replaced,
                                      converted_model_store_files_and_record, profile_bundle_store_files_and_record)
from native_actor_profiles import (MAXIMUM_NPC_PROFILE_BUNDLES, MAXIMUM_PROFILES_PER_BUNDLE, UnresolvedActorDefaultError, migrate_npc_profiles,
                                   npc_profile_tool_pins)
from native_assets_lib.gltf import json_bytes
from native_effect_bundle import MAX_CLASSES
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import read_store_catalog, write_store
from native_store.gap_rows import read_gap_rows, sorted_gap_rows, write_gap_rows
from native_store.unit_ledger import RECEIPT_RECORD_NAME, BatchPreflightRefusedError, UnitLedger, locked_input_records
from reference_client_guard import ReferenceClientLockError

SHARED_STORE_NPC_PROFILE_RECIPE_RELATIVE_PATH = 'recipes/native-npc-profiles.json'
FIRST_BATCH_MESH_PACKAGE_PATH = 'animations/LineageMonsters.ukx'
NPC_PROFILE_PACK_ID_PREFIX = 'interlude:npc-profiles:pack-'
NPC_PROFILE_PACK_ID_HEX_LENGTH = 16
NPC_PROFILE_PACK_STEP = 'npc-profile-pack'
NPC_PROFILE_PACK_ALGORITHM_VERSION = 1
PROFILE_BUNDLE_FOLDER = 'bundle'
CLASS_CLOSURE_OVER_LIMIT_REASON_PREFIX = 'class-closure-over-limit:'
PROFILE_BUNDLE_CAPACITY_EXCEEDED_REASON = 'profile-bundle-capacity-exceeded'
LANE_NAME = 'actors'


class NpcBatchError(ValueError):
    pass


class ScheduledNpcRow(NamedTuple):
    npc_id: int
    row_index: int


class ScheduledNpcUnit(NamedTuple):
    unit: dict
    rows: tuple


class NpcPackRow(NamedTuple):
    npc_id: int
    unit_key: str
    npcgrp_row: dict
    npcname_row: dict


class NpcProfilePack(NamedTuple):
    pack_id: str
    rows: tuple
    class_closure: tuple
    recipe: dict


class NpcPlanningGap(NamedTuple):
    npc_id: int
    reason: str
    class_name: str | None


class NpcBatchPlan(NamedTuple):
    units: tuple
    packs: tuple
    planning_gaps: tuple


def read_census_and_npc_tables(project_root, client_root, decode_table):
    census = json.loads((Path(project_root) / ACTOR_UNIT_CENSUS_RELATIVE_PATH).read_bytes())
    table_paths = {table['table']: table['path'] for table in census['tables']}
    census_sha256s = {table['table']: table['sha256'] for table in census['tables']}
    name_table = PurePosixPath(table_paths['npcname']).name
    npcgrp = decode_table(client_root, 'npcgrp')
    npcname = decode_table(client_root, 'npcname', source_filename=name_table)
    for name, table in (('npcgrp', npcgrp), ('npcname', npcname)):
        if table['source'] != table_paths[name] or table['sourceSha256'] != census_sha256s[name]:
            raise NpcBatchError(f'{ACTOR_UNIT_CENSUS_RELATIVE_PATH} was built from another {name}; rerun actor_census.py')
    return census, npcgrp, npcname, name_table


def shared_store_npc_ids(project_root):
    recipe_path = Path(project_root) / SHARED_STORE_NPC_PROFILE_RECIPE_RELATIVE_PATH
    try:
        recipe = json.loads(recipe_path.read_bytes())
    except (OSError, ValueError) as error:
        raise NpcBatchError(f'shared-store NPC profile recipe cannot be read: {recipe_path}') from error
    profiles = recipe.get('profiles') if isinstance(recipe, dict) else None
    if not (isinstance(profiles, list) and profiles and all(isinstance(profile, dict) and type(profile.get('npcId')) is int
                                                            for profile in profiles)):
        raise NpcBatchError(f'shared-store NPC profile recipe holds no list of integer npcId profiles: {recipe_path}')
    return tuple(sorted(profile['npcId'] for profile in profiles))


def npc_row_selection(npcgrp_row):
    return {'mesh': npcgrp_row['mesh_name'], 'textures': [slot['param_texture_name'] for slot in npcgrp_row['texture_name']]}


def npc_batch_unit_order_key(unit):
    package_path = unit['sourceIdentity']['path']
    return (package_path != FIRST_BATCH_MESH_PACKAGE_PATH, package_path, unit['key'])


def npc_batch_order(census, npcgrp_rows, excluded_npc_ids):
    excluded = frozenset(excluded_npc_ids)
    convertible_units = {unit['key']: unit for unit in census['units']
                         if unit['unitKind'] == NPC_MODEL_UNIT_KIND and unit['status'] == CONVERTIBLE_UNIT_STATUS}
    rows_by_unit_key = {}
    for row_index, npcgrp_row in enumerate(npcgrp_rows):
        if not npcgrp_row['mesh_name'] or npcgrp_row['npc_id'] in excluded:
            continue
        unit_key = conversion_unit_key(NPC_MODEL_UNIT_KIND, npc_row_selection(npcgrp_row))
        if unit_key in convertible_units:
            rows_by_unit_key.setdefault(unit_key, []).append(ScheduledNpcRow(npcgrp_row['npc_id'], row_index))
    ordered_keys = sorted(rows_by_unit_key, key=lambda unit_key: npc_batch_unit_order_key(convertible_units[unit_key]))
    return tuple(ScheduledNpcUnit(convertible_units[unit_key], tuple(sorted(rows_by_unit_key[unit_key]))) for unit_key in ordered_keys)


def npc_profile_pack_id(npc_ids):
    return NPC_PROFILE_PACK_ID_PREFIX + hashlib.sha256(canonical_json_bytes(sorted(npc_ids))).hexdigest()[:NPC_PROFILE_PACK_ID_HEX_LENGTH]


def npc_profile_packs(ordered_rows, closure_of, name_table):
    packing = pack_items_by_class_closure(ordered_rows, closure_of, MAX_CLASSES, MAXIMUM_PROFILES_PER_BUNDLE)
    gaps = [NpcPlanningGap(row.npc_id, f'{CLASS_CLOSURE_OVER_LIMIT_REASON_PREFIX}{len(closure_of(row))}', row.npcgrp_row['class_name'])
            for row in packing.over_limit_items]
    packs = []
    for pack_index, pack in enumerate(packing.packs):
        if pack_index >= MAXIMUM_NPC_PROFILE_BUNDLES:
            gaps += [NpcPlanningGap(row.npc_id, PROFILE_BUNDLE_CAPACITY_EXCEEDED_REASON, row.npcgrp_row['class_name']) for row in pack.items]
            continue
        pack_id = npc_profile_pack_id([row.npc_id for row in pack.items])
        selections = [npc_profile_selection(row.npc_id, row.npcname_row, row.npcgrp_row, row.unit_key) for row in pack.items]
        packs.append(NpcProfilePack(pack_id, pack.items, pack.class_closure, npc_profiles_recipe(pack_id, selections, name_table)))
    return tuple(packs), tuple(gaps)


class CachedClassClosures:
    def __init__(self, packages):
        self.packages, self.closures_by_reference = packages, {}

    def closure(self, class_reference):
        if class_reference not in self.closures_by_reference:
            self.closures_by_reference[class_reference] = native_class_closure(self.packages, class_reference)
        return self.closures_by_reference[class_reference]


def npc_batch_plan(census, npcgrp, npcname, name_table, class_closure, excluded_npc_ids):
    npcgrp_rows = npcgrp['data']['npc']
    names_by_id = {}
    for name_row in npcname['data']['npc']:
        names_by_id.setdefault(name_row['id'], []).append(name_row)
    units = npc_batch_order(census, npcgrp_rows, excluded_npc_ids)
    planning_gaps, pack_rows, closures_by_npc_id = [], [], {}
    for scheduled in units:
        for scheduled_row in scheduled.rows:
            npcgrp_row = npcgrp_rows[scheduled_row.row_index]
            name_rows = names_by_id.get(scheduled_row.npc_id, [])
            if len(name_rows) > 1:
                raise NpcBatchError(f'npcname holds {len(name_rows)} rows for npc {scheduled_row.npc_id}')
            if not name_rows or not name_rows[0]['name']:
                reason = NPC_NAME_EMPTY_REASON if name_rows else NPC_NAME_ROW_MISSING_REASON
                planning_gaps.append(NpcPlanningGap(scheduled_row.npc_id, reason, None))
                continue
            try:
                closures_by_npc_id[scheduled_row.npc_id] = class_closure(npcgrp_row['class_name'])
            except ReferenceClientLockError:
                raise
            except ValueError as error:
                planning_gaps.append(NpcPlanningGap(scheduled_row.npc_id, CONVERTER_REFUSED_REASON_PREFIX + ' '.join(str(error).split()),
                                                    npcgrp_row['class_name']))
                continue
            pack_rows.append(NpcPackRow(scheduled_row.npc_id, scheduled.unit['key'], npcgrp_row, name_rows[0]))
    packs, packing_gaps = npc_profile_packs(pack_rows, lambda row: closures_by_npc_id[row.npc_id], name_table)
    return NpcBatchPlan(units, packs, tuple(planning_gaps) + packing_gaps)


def printed_batch_plan(plan):
    return {'units': [{'key': scheduled.unit['key'], 'package': scheduled.unit['sourceIdentity']['path'],
                       'npcIds': [row.npc_id for row in scheduled.rows]} for scheduled in plan.units],
            'packs': [{'id': pack.pack_id, 'npcIds': [row.npc_id for row in pack.rows], 'unitKeys': sorted({row.unit_key for row in pack.rows}),
                       'classClosureSize': len(pack.class_closure), 'classClosureLimit': MAX_CLASSES} for pack in plan.packs],
            'planningGaps': [{'key': f'npc:{gap.npc_id}', 'reason': gap.reason} for gap in plan.planning_gaps]}


def planning_gap_row(gap, npcgrp, npcname):
    identity = decoded_table_identity(npcgrp if gap.class_name else npcname)
    if gap.class_name:
        identity['object'] = gap.class_name
    return {'key': f'npc:{gap.npc_id}', 'part': NPC_PART_NAME, 'step': NPC_PROFILE_PACK_STEP, 'status': 'gap', 'reason': gap.reason,
            'sourceIdentity': identity, 'evidence': ACTOR_UNIT_CENSUS_RELATIVE_PATH}


def replace_step_gap_rows_when_changed(project_root, step, replaced_keys, gap_rows):
    current_rows = sorted_gap_rows(row for row in read_gap_rows(project_root, LANE_NAME) if row['step'] == step)
    kept_rows = [row for row in current_rows if row['key'] not in replaced_keys]
    desired_rows = sorted_gap_rows(kept_rows + list(gap_rows))
    if desired_rows != current_rows:
        write_gap_rows(project_root, LANE_NAME, step, desired_rows)
    return desired_rows


def sealed_receipt(ledger, unit_key):
    return json.loads((ledger.unit_step_directory(unit_key) / RECEIPT_RECORD_NAME).read_bytes())


class NpcBatchSlice:
    def __init__(self, run, plan, preflight, profile_tool_pins=npc_profile_tool_pins):
        self.run, self.plan, self.preflight = run, plan, preflight
        self.pack_ledger = UnitLedger(run.model_ledger.work_root, NPC_PROFILE_PACK_STEP, NPC_PROFILE_PACK_ALGORITHM_VERSION)
        self.profile_tool_pins = profile_tool_pins()
        self.stop_reason = None

    def refused_by_preflight(self):
        try:
            self.preflight()
        except BatchPreflightRefusedError as error:
            self.stop_reason = str(error)
            return True
        return False

    def model_gap_rows(self, unit_key):
        return [row for row in sealed_receipt(self.run.model_ledger, unit_key)['gapRows'] if row['step'] == self.run.model_ledger.step]

    def convert_units(self, limit):
        outcomes = []
        for scheduled in self.plan.units:
            if self.run.is_convertible_model_unit_sealed(scheduled.unit):
                continue
            if len(outcomes) >= limit or self.refused_by_preflight():
                break
            first_row = scheduled.rows[0]
            outcomes.append(self.run.convert_model(f'npc:{first_row.npc_id}', self.run.npcgrp['data']['npc'][first_row.row_index]))
        return outcomes

    def synchronize_model_gap_rows(self):
        replaced_keys, gap_rows = set(), []
        for scheduled in self.plan.units:
            if not self.run.is_convertible_model_unit_sealed(scheduled.unit):
                continue
            row_keys = [f'npc:{row.npc_id}' for row in scheduled.rows]
            replaced_keys.update(row_keys)
            unit_gap_rows = self.model_gap_rows(scheduled.unit['key'])
            gap_rows += [{**unit_gap_rows[0], 'key': row_key} for row_key in row_keys] if unit_gap_rows else []
        replace_step_gap_rows_when_changed(self.run.project_root, self.run.model_ledger.step, replaced_keys, gap_rows)

    def pack_gap_row(self, pack_id, row, reason):
        evidence = self.pack_ledger.unit_step_directory(pack_unit_key(pack_id)) / RECEIPT_RECORD_NAME
        return {'key': f'npc:{row.npc_id}', 'part': NPC_PART_NAME, 'step': NPC_PROFILE_PACK_STEP, 'status': 'gap', 'reason': reason,
                'sourceIdentity': {**decoded_table_identity(self.run.npcgrp), 'object': row.npcgrp_row['class_name']},
                'evidence': evidence.relative_to(self.pack_ledger.lane_folder).as_posix()}

    def pack_work(self, pack):
        unit_keys = sorted({row.unit_key for row in pack.rows})
        if not all(self.run.is_convertible_model_unit_sealed(self.run.units_by_key[unit_key]) for unit_key in unit_keys):
            return None
        passed_unit_keys = {unit_key for unit_key in unit_keys if not self.model_gap_rows(unit_key)}
        resolvable_rows = [row for row in pack.rows if row.unit_key in passed_unit_keys]
        resolvable_npc_ids = {row.npc_id for row in resolvable_rows}
        recipe = {**pack.recipe, 'profiles': [profile for profile in pack.recipe['profiles'] if profile['npcId'] in resolvable_npc_ids]}
        mesh_paths = {self.run.units_by_key[unit_key]['sourceIdentity']['path'] for unit_key in passed_unit_keys}
        inputs = locked_input_records(sorted({self.run.npcgrp['source'], self.run.npcname['source'], *mesh_paths}))
        config = {'packNpcIds': [row.npc_id for row in pack.rows], 'recipe': recipe, 'profileToolPins': self.profile_tool_pins}
        fingerprint = self.pack_ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
        return resolvable_rows, recipe, inputs, config, fingerprint

    def convert_pack(self, pack):
        pack_key = pack_unit_key(pack.pack_id)
        work = self.pack_work(pack)
        if work is None:
            return {'key': pack_key, 'step': NPC_PROFILE_PACK_STEP, 'status': 'pending', 'reason': None, 'cacheHit': False}
        resolvable_rows, recipe, inputs, config, fingerprint = work
        if self.pack_ledger.is_sealed(pack_key, fingerprint):
            return {'key': pack_key, 'step': NPC_PROFILE_PACK_STEP, 'status': PASS_STATUS, 'reason': None, 'cacheHit': True}
        if self.refused_by_preflight():
            return None
        step_directory = self.pack_ledger.begin(pack_key, fingerprint)
        bundle_root = step_directory / PROFILE_BUNDLE_FOLDER
        reason, gap_rows, outputs = None, [], []
        if resolvable_rows:
            try:
                migrate_npc_profiles(self.run.client_access.root, recipe, bundle_root)
            except TRANSIENT_FAILURES as error:
                return {'key': pack_key, 'step': NPC_PROFILE_PACK_STEP, 'status': FAILED_STATUS, 'reason': self.run.path_free_reason(error),
                        'cacheHit': False}
            except ReferenceClientLockError:
                raise
            except UnresolvedActorDefaultError as error:
                reason = ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX + error.field
            except ValueError as error:
                reason = CONVERTER_REFUSED_REASON_PREFIX + self.run.path_free_reason(error)
        if reason is not None:
            gap_rows = [self.pack_gap_row(pack.pack_id, row, reason) for row in resolvable_rows]
        elif resolvable_rows:
            outputs = bundle_output_records(self.pack_ledger.lane_folder, bundle_root)
        self.pack_ledger.seal(pack_key, fingerprint, {'config': config, 'inputs': inputs, 'outputs': outputs, 'gapRows': gap_rows})
        return {'key': pack_key, 'step': NPC_PROFILE_PACK_STEP, 'status': GAP_STATUS if reason else PASS_STATUS, 'reason': reason,
                'cacheHit': False}

    def sealed_pack_receipts(self):
        receipts = []
        for pack in self.plan.packs:
            work = self.pack_work(pack)
            if work is not None and self.pack_ledger.is_sealed(pack_unit_key(pack.pack_id), work[4]):
                receipts.append((pack, sealed_receipt(self.pack_ledger, pack_unit_key(pack.pack_id))))
        return receipts

    def synchronize_pack_gap_rows(self, sealed_packs):
        planning_rows = [planning_gap_row(gap, self.run.npcgrp, self.run.npcname) for gap in self.plan.planning_gaps]
        replaced_keys = {row['key'] for row in planning_rows} | {f'npc:{row.npc_id}' for pack, _ in sealed_packs for row in pack.rows}
        pack_rows = [row for _, receipt in sealed_packs for row in receipt['gapRows']]
        replace_step_gap_rows_when_changed(self.run.project_root, NPC_PROFILE_PACK_STEP, replaced_keys, planning_rows + pack_rows)

    def write_store_records(self, sealed_packs):
        catalog, before = read_store_catalog(self.run.store_root)
        files = {}
        for pack, receipt in sealed_packs:
            if not receipt['outputs']:
                continue
            bundle_root = self.pack_ledger.unit_step_directory(pack_unit_key(pack.pack_id)) / PROFILE_BUNDLE_FOLDER
            profile_files, profile_record = profile_bundle_store_files_and_record(self.run.client_access.root, bundle_root)
            files.update(profile_files)
            bundle_npc_ids = [profile['npcId'] for profile in json.loads((bundle_root / PROFILE_MANIFEST_FILE_NAME).read_bytes())['profiles']]
            for unit_key in sorted({row.unit_key for row in pack.rows if row.npc_id in bundle_npc_ids}):
                model_outputs = sealed_receipt(self.run.model_ledger, unit_key)['outputs']
                model_files, model_record = converted_model_store_files_and_record(
                    unit_key, self.run.model_ledger.lane_output_path(model_outputs[0]['path']))
                files.update(model_files)
                catalog = catalog_with_record_replaced(catalog, 'models', model_record, self.run.convertible_npc_model_unit_count())
            superseded_ids = {f'{NPC_PROFILE_RECIPE_ID_PREFIX}{npc_id}' for npc_id in bundle_npc_ids}
            catalog = {**catalog, 'npcProfiles': [record for record in catalog.get('npcProfiles', []) if record['id'] not in superseded_ids]}
            catalog = catalog_with_record_replaced(catalog, 'npcProfiles', profile_record, MAXIMUM_NPC_PROFILE_BUNDLES)
        for slice_name in ('models', 'npcProfiles'):
            if slice_name in catalog:
                catalog[slice_name] = sorted(catalog[slice_name], key=lambda record: record['id'])
        return write_store(self.run.store_root, files, before, json_bytes(catalog))


def pack_unit_key(pack_id):
    return NPC_PROFILE_PACK_STEP + ':' + pack_id[len(NPC_PROFILE_PACK_ID_PREFIX):]


def run_npc_batch_slice(run, plan, limit, preflight, profile_tool_pins=npc_profile_tool_pins):
    if type(limit) is not int or limit < 1:
        raise NpcBatchError(f'the slice limit must be an integer of at least 1: {limit!r}')
    batch_slice = NpcBatchSlice(run, plan, preflight, profile_tool_pins)
    unit_outcomes = batch_slice.convert_units(limit)
    pack_outcomes, store = [], None
    if batch_slice.stop_reason is None:
        batch_slice.synchronize_model_gap_rows()
        for pack in plan.packs:
            outcome = batch_slice.convert_pack(pack)
            if outcome is None:
                break
            pack_outcomes.append(outcome)
    if batch_slice.stop_reason is None:
        sealed_packs = batch_slice.sealed_pack_receipts()
        batch_slice.synchronize_pack_gap_rows(sealed_packs)
        store = batch_slice.write_store_records(sealed_packs)
    return {'unitOutcomes': unit_outcomes, 'packOutcomes': pack_outcomes, 'convertedUnits': len(unit_outcomes),
            'stopReason': batch_slice.stop_reason, 'store': store}
