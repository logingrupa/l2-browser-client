import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
from collections import Counter
import hashlib
import json

from actors.skill_animation_notify_recipe import animation_notify_section
from actors.skill_dispatch_candidates import (CANDIDATE_CAST_STYLE_GATES, SKILL_DISPATCH_CANDIDATES_RELATIVE_PATH, inclusive_level_runs,
                                              read_strict_json_bytes, require)
from actors.skill_dispatch_recipe_sources import (ANIMATION_NOTIFY_SOURCE_FILE_NAME, DISPATCH_FACTS_FILE_NAME,
                                                  DISPATCH_REPLAY_REPORT_RELATIVE_PATH, R2_ARCHIVE_SHA256, REPLAY_SHA256, read_pinned_json,
                                                  require_locked_source, verification_folder_of, verified_facts_identity)
from native_catalog.tables import decode_table
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import replace_file
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, read_reference_client_lock, require_reference_client

REPOSITORY_ROOT = SCRIPTS_ROOT.parent
ENGINE_RELATIVE_PATH = 'system/engine.dll'
SOULSHOT_RELATIVE_PATH = 'system/soulshot.int'
SKILLGRP_RELATIVE_PATH = 'system/skillgrp.dat'
EXPECTED_BINDING_COUNT = 1483
EXPECTED_CANDIDATE_ROW_COUNT = 11211
EXPECTED_UNRESOLVED_ROW_COUNT = 6365
EXPECTED_CLASS_COUNT = 234
CONFIG_DERIVED_CLASS_REFERENCE = 'config-derived-class-name'
FORMATTED_NAME_CLASS_REFERENCE = 'formatted-name-load'
CLASS_LITERAL_REFERENCE = 'class-literal'
SKILL_DISPATCH_CANDIDATE_RECIPE_DESCRIPTION = (
    'Generate recipes/actors/skill-dispatch-candidates.json from the pinned R2 skill dispatch replay and the pinned animation notify '
    'bindings, checked against the reference client lock and the decoded skillgrp rows. --check compares and writes nothing.')


def instruction_records(replay_entries, engine_sha256):
    require(all(entry['fileSha256'] == engine_sha256 for entry in replay_entries), 'an instruction replay names another engine')
    return [{'va': entry['va'], 'bytesHex': entry['bytesHex']} for entry in replay_entries]


def evidence_instruction_records(evidence):
    return [{'va': entry['va'], 'bytesHex': entry['bytes']} for entry in evidence]


def table_slice_record(entry):
    payload = bytes.fromhex(entry['bytesHex'])
    first_index = entry['firstSelectorIndex'] if entry['kind'] == 'selector-bytes' else entry['firstCaseIndex']
    return {'va': entry['va'], 'kind': entry['kind'], 'firstIndex': first_index, 'length': len(payload),
            'sha256': hashlib.sha256(payload).hexdigest()}


def table_record(record, engine_sha256):
    r2 = record['r2']
    require([entry['va'] for entry in record['replay']] == [entry['va'] for entry in r2['guardEvidence']],
            f'{record["id"]} replays other guard instructions than it cites')
    require(all(entry['kind'] in ('selector-bytes', 'jump-targets') for entry in record['dataReplay']), f'{record["id"]} holds an unknown slice')
    return {'id': record['id'], 'stage': r2['stage'], 'selectorField': r2['selectorField'], 'switchVA': r2['switchVA'],
            'jumpVA': r2.get('jumpVA'), 'selectorBase': r2['selectorBase'], 'selectorTableVA': r2.get('selectorTable'),
            'targetTableVA': r2['targetTable'], 'defaultVA': r2['defaultVA'],
            'guard': instruction_records(record['replay'], engine_sha256),
            'slices': [table_slice_record(entry) for entry in record['dataReplay']]}


def dispatch_record(record, engine_sha256):
    return {'id': record['id'], 'stage': record['stage'], 'dispatchKind': record['r2']['dispatchKind'], 'tableId': record['tableRecordId'],
            'caseVA': record['caseVA'], 'instructions': instruction_records(record['replay'], engine_sha256),
            'branches': [{'va': step['va'], 'taken': step['taken'], 'targetVA': step['targetVA']} for step in record['r2']['dispatchPath']]}


def skill_in_ranges(skill_id, ranges):
    return any(low <= skill_id <= high for low, high in ranges or [])


def covering_transient_dispatch_id(records, route):
    transient_case = route['transientDispatch']['caseVA']
    covering = sorted(record_id for record_id, record in records.items()
                      if record_id.startswith('dispatch:') and record['stage'] == 'transient' and record['caseVA'] == transient_case
                      and skill_in_ranges(route['skillId'], record['skillIdRanges']))
    require(len(covering) == 1, f'helper route {route["routeId"]} has {len(covering)} covering transient dispatch records')
    return covering[0]


def helper_route_record(records, record_id):
    route = records[record_id]['r2']
    return {'id': record_id, 'routeId': route['routeId'], 'kind': route['kind'], 'skillId': route['skillId'],
            'transientDispatchId': covering_transient_dispatch_id(records, route), 'transientCaseVA': route['transientDispatch']['caseVA'],
            'cubicType': route.get('cubicType'), 'skillPredicate': evidence_instruction_records(route.get('skillPredicateEvidence', [])),
            'resolvedCaseVA': route.get('resolvedCaseVA'), 'conditions': route['conditions']}


def entry_gate_of(cast_style):
    require(cast_style is None or cast_style in CANDIDATE_CAST_STYLE_GATES.values(), f'cast style {cast_style!r} is outside null, 0 and 12')
    return next((gate for gate, style in CANDIDATE_CAST_STYLE_GATES.items() if style == cast_style), 'none')


def config_class_reference(binding_r2, class_record, soulshot_sha256):
    [value_replay] = [entry for entry in class_record['dataReplay'] if entry['file'].casefold().endswith('soulshot.int')]
    section_replay = value_replay['sectionReplay']
    require(value_replay['fileSha256'] == section_replay['fileSha256'] == soulshot_sha256, 'a soulshot replay names another soulshot.int')
    require(value_replay['decodedValues']['key'] == binding_r2['configKey'] and value_replay['decodedValues']['value'] == binding_r2['effectObject'],
            f'soulshot replay of {binding_r2["effectObject"]} differs from its binding')
    return {'kind': CONFIG_DERIVED_CLASS_REFERENCE, 'configKey': binding_r2['configKey'], 'configSection': binding_r2['configEvidence']['section'],
            'valueByteOffset': value_replay['byteOffset'], 'valueByteCount': len(bytes.fromhex(value_replay['bytesHex'])),
            'sectionByteOffset': section_replay['byteOffset'], 'sectionByteCount': len(bytes.fromhex(section_replay['bytesHex']))}


def class_reference(binding_r2, class_record, soulshot_sha256):
    kind = binding_r2.get('classReferenceKind')
    if kind is None:
        return {'kind': CLASS_LITERAL_REFERENCE}
    if kind == FORMATTED_NAME_CLASS_REFERENCE:
        return {'kind': kind, **{field: binding_r2[field] for field in ('formatPushVA', 'formatLiteralVA', 'formatText', 'formatArgument')}}
    require(kind == CONFIG_DERIVED_CLASS_REFERENCE, f'class reference kind {kind!r} is unknown')
    return config_class_reference(binding_r2, class_record, soulshot_sha256)


def level_table_of(binding_r2, records):
    if not binding_r2.get('skillLevelSwitchVA'):
        return None
    [table_id] = [record_id for record_id in records if record_id.startswith('level-table:')
                  and records[record_id]['r2']['switchVA'] == binding_r2['skillLevelSwitchVA']]
    entries = records[table_id]['r2']['entries']
    cases = []
    for level in binding_r2['skillLevelValues']:
        [entry] = [entry for entry in entries if entry['skillLevel'] == level
                   and binding_r2['classPushVA'] in [reference['classPushVA'] for reference in entry['effectReferences']]]
        cases.append({'level': level, 'caseVA': entry['caseVA']})
    return {'tableId': table_id, 'cases': cases}


def records_of_kind(binding, kind):
    return [record_id for record_id in binding['replayRecordIds'] if record_id.startswith(kind + ':')]


def table_id_of_switch(records, switch_va):
    if switch_va is None:
        return None
    [table_id] = [record_id for record_id in records if record_id.split(':')[0] in ('selector-table', 'level-table')
                  and records[record_id]['r2']['switchVA'] == switch_va]
    return table_id


def binding_record(binding, records, soulshot_sha256):
    r2 = binding['r2']
    missing = [record_id for record_id in binding['replayRecordIds'] if record_id not in records]
    require(not missing, f'binding {binding["r2BindingIndex"]} cites unresolved replay records {missing}')
    require(binding['skillId'] == r2['skillId'] and binding['stage'] == r2['stage'], f'binding {binding["r2BindingIndex"]} wraps another row')
    gate = entry_gate_of(r2['requiredCastStyle'])
    gate_records = records_of_kind(binding, 'entry-gate')
    require(gate_records == ([] if gate == 'none' else [f'entry-gate:{gate}']), f'binding {binding["r2BindingIndex"]} cites gates {gate_records}')
    [class_record_id] = records_of_kind(binding, 'class-reference')
    dispatch_ids, route_ids = records_of_kind(binding, 'dispatch'), records_of_kind(binding, 'helper-route')
    require(len(dispatch_ids) + len(route_ids) == 1, f'binding {binding["r2BindingIndex"]} needs one dispatch or one helper route')
    return {'index': binding['r2BindingIndex'], 'stage': r2['stage'], 'skillId': r2['skillId'],
            'levelRuns': inclusive_level_runs(r2['emptyDescriptionLevels']),
            'dispatchId': dispatch_ids[0] if dispatch_ids else None, 'routeId': route_ids[0] if route_ids else None,
            'tableId': table_id_of_switch(records, r2['switchVA']), 'dispatchKind': r2['dispatchKind'],
            'selectorIndex': r2['selectorIndex'], 'caseIndex': r2['caseIndex'], 'caseVA': r2['caseVA'],
            'selectorValue': r2.get('selectorValue'), 'resolvedCaseVA': r2.get('resolvedCaseVA'), 'helperCaseVA': r2.get('helperCaseVA'),
            'levelTable': level_table_of(r2, records), 'effectObject': r2['effectObject'], 'classPushVA': r2['classPushVA'],
            'classLiteralVA': r2['classLiteralVA'], 'classReference': class_reference(r2, records[class_record_id], soulshot_sha256),
            'entryGate': gate, 'status': r2['status']}


def class_records(bindings):
    pins = {}
    for binding in bindings:
        r2 = binding['r2']
        pins.setdefault(r2['effectObject'], set()).add((r2['classEvidence']['packageSha256'], r2['nativeSuperClass']))
    doubled = sorted(name for name, values in pins.items() if len(values) != 1)
    require(not doubled, f'classes with more than one package pin: {doubled}')
    return [{'effectObject': name, 'packageSha256': package_sha256, 'nativeSuperClass': native_super_class}
            for name, [(package_sha256, native_super_class)] in sorted(pins.items())]


def candidate_rows(bindings):
    return {(binding['skillId'], level) for binding in bindings for level in binding['r2']['emptyDescriptionLevels']}


def require_replay_counts(replay, rows):
    coverage = replay['coverage']
    require(len(replay['candidateBindings']) == coverage['candidateBindingsMapped'] == EXPECTED_BINDING_COUNT,
            f'replay holds {len(replay["candidateBindings"])} bindings, coverage {coverage["candidateBindingsMapped"]}')
    require(len(rows) == coverage['candidateRowsUnchanged'] == EXPECTED_CANDIDATE_ROW_COUNT, f'bindings name {len(rows)} rows')
    require(coverage['unresolvedRowsUnchanged'] == EXPECTED_UNRESOLVED_ROW_COUNT, 'coverage names another unresolved row count')
    require(len(rows) + EXPECTED_UNRESOLVED_ROW_COUNT == coverage['emptyDescriptionRows'], 'candidate and unresolved rows miss the empty rows')
    require(len({binding['r2']['effectObject'] for binding in replay['candidateBindings']}) == EXPECTED_CLASS_COUNT, 'bindings name another class count')


def empty_description_rows(client_root):
    table = decode_table(Path(client_root), 'skillgrp')
    rows_by_key = Counter()
    empty_keys = set()
    for row in table['data']['skill']:
        rows_by_key[(row['skill_id'], row['skill_level'])] += 1
        if not row['description']:
            empty_keys.add((row['skill_id'], row['skill_level']))
    empty_row_count = sum(1 for row in table['data']['skill'] if not row['description'])
    return table['sourceSha256'], empty_row_count, {key for key in empty_keys if rows_by_key[key] == 1}


def require_candidate_rows_decode(client_root, skillgrp_sha256, rows, unresolved_row_count):
    decoded_sha256, empty_row_count, single_empty_keys = empty_description_rows(client_root)
    require(decoded_sha256 == skillgrp_sha256, 'the decoded skillgrp differs from the replay skillgrp pin')
    require(empty_row_count == len(rows) + unresolved_row_count, f'skillgrp decodes {empty_row_count} empty-description rows')
    outside = sorted(rows - single_empty_keys)
    require(not outside, f'candidate rows that are not one empty-description skillgrp row: {outside[:5]}')
    return single_empty_keys


def verification_record(verification_folder, report):
    facts = verified_facts_identity(verification_folder / DISPATCH_FACTS_FILE_NAME)
    instructions, slices, bindings = report['instructionReplays'], report['dataReplays'], report['bindings']
    require(instructions['matched'] == instructions['occurrences'] and slices['matched'] == slices['all']
            and bindings['reproduced'] == bindings['checked'] == EXPECTED_BINDING_COUNT, 'the replay report records a mismatch')
    return {**facts, 'instructionOccurrences': {'checked': instructions['occurrences'], 'matched': instructions['matched']},
            'dataSlices': {'checked': slices['all'], 'matched': slices['matched']},
            'bindings': {'checked': bindings['checked'], 'reproduced': bindings['reproduced']}}


def skill_dispatch_candidate_document(replay_path, client_root, lock_path=REFERENCE_CLIENT_LOCK_PATH):
    replay = read_pinned_json(replay_path, REPLAY_SHA256, 'replay')
    lock = read_reference_client_lock(Path(lock_path))
    sources = replay['sources']
    engine = require_locked_source(lock, ENGINE_RELATIVE_PATH, sources['engine']['file'], sources['engine']['fileSha256'])
    soulshot = require_locked_source(lock, SOULSHOT_RELATIVE_PATH, sources['soulshot']['file'], sources['soulshot']['fileSha256'])
    skillgrp = require_locked_source(lock, SKILLGRP_RELATIVE_PATH, sources['skillgrp']['file'], sources['skillgrp']['fileSha256'])
    require(sources['r2Archive']['fileSha256'] == R2_ARCHIVE_SHA256, 'the replay names another R2 archive')
    bindings, records = replay['candidateBindings'], replay['replayRecords']
    rows = candidate_rows(bindings)
    require_replay_counts(replay, rows)
    single_empty_keys = require_candidate_rows_decode(client_root, skillgrp['sha256'], rows, EXPECTED_UNRESOLVED_ROW_COUNT)
    verification_folder = verification_folder_of(Path(replay_path))
    report = read_strict_json_bytes((verification_folder / DISPATCH_REPLAY_REPORT_RELATIVE_PATH).read_bytes(), 'replay report')
    binding_records = [binding_record(binding, records, soulshot['sha256']) for binding in bindings]
    dispatch_ids = {record['dispatchId'] for record in binding_records if record['dispatchId']}
    route_ids = sorted({record['routeId'] for record in binding_records if record['routeId']})
    routes = [helper_route_record(records, route_id) for route_id in route_ids]
    dispatch_ids |= {route['transientDispatchId'] for route in routes}
    notify = animation_notify_section(Path(replay_path).parent / ANIMATION_NOTIFY_SOURCE_FILE_NAME, verification_folder, lock,
                                      engine['sha256'], rows, single_empty_keys, EXPECTED_UNRESOLVED_ROW_COUNT)
    return {
        'schemaVersion': 1, 'kind': 'skill-dispatch-candidates',
        'engine': {**engine, 'imageBase': sources['engine']['imageBase']},
        'replay': {'sha256': REPLAY_SHA256, 'r2ArchiveSha256': R2_ARCHIVE_SHA256, 'verification': verification_record(verification_folder, report)},
        'sources': {'soulshot': soulshot, 'skillgrp': skillgrp},
        'stages': [{'stage': records[stage_id]['stage'], 'skillIdFieldOffset': records[stage_id]['r2']['skillIdFieldOffset']}
                   for stage_id in replay['stageRecordIds']],
        'tables': [table_record(records[table_id], engine['sha256']) for table_id in replay['tableRecordIds']],
        'dispatches': [dispatch_record(records[dispatch_id], engine['sha256']) for dispatch_id in sorted(dispatch_ids)],
        'helperRoutes': routes,
        'entryGates': [{'gate': gate, 'requiredCastStyle': style} for gate, style in sorted(CANDIDATE_CAST_STYLE_GATES.items())],
        'classes': class_records(bindings),
        'bindings': binding_records,
        'animationNotify': notify}


def write_skill_dispatch_candidates(project_root, replay_path, client_root, check):
    payload = canonical_json_bytes(skill_dispatch_candidate_document(replay_path, client_root))
    recipe_path = Path(project_root) / SKILL_DISPATCH_CANDIDATES_RELATIVE_PATH
    if check:
        require(recipe_path.is_file() and recipe_path.read_bytes() == payload, 'differs from its generated bytes; rerun without --check')
        return payload
    replace_file(recipe_path, payload)
    return payload


def main(argv=None):
    parser = argparse.ArgumentParser(description=SKILL_DISPATCH_CANDIDATE_RECIPE_DESCRIPTION)
    parser.add_argument('--replay', type=Path, required=True)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    arguments = parser.parse_args(argv)
    try:
        client_access = require_reference_client(arguments.client)
        payload = write_skill_dispatch_candidates(REPOSITORY_ROOT, arguments.replay, client_access.root, arguments.check)
    except (OSError, ValueError, KeyError) as error:
        print(f'Skill dispatch candidate recipe failed: {error}', file=sys.stderr)
        return 1
    document = json.loads(payload)
    print(json.dumps({'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest(), 'bindings': len(document['bindings']),
                      'classes': len(document['classes']), 'animationNotifyBindings': len(document['animationNotify']['bindings']),
                      'animationNotifyClasses': len(document['animationNotify']['classes'])},
                     sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
