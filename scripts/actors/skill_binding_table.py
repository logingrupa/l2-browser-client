import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
from collections import Counter, defaultdict
import json
from typing import NamedTuple

from actors.actor_unit_inventory import CONVERSION_PENDING_REASON, decoded_table_identity, decoded_table_rows
from actors.skill_dispatch_candidates import (SKILL_DISPATCH_CANDIDATE_RUNTIME_UNRESOLVED_REASON, SKILL_DISPATCH_CANDIDATES_RELATIVE_PATH,
                                              animation_notify_candidates_by_skill_key, dispatch_candidate_census,
                                              dispatch_candidates_by_skill_key, read_skill_dispatch_candidates)
from actors.skill_unit_inventory import NATIVE_SKILL_DISPATCH_REQUIRED_REASON, SKILL_PART_NAME
from native_catalog.tables import decode_table
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import replace_file
from native_store.gap_rows import QUALIFIED_OBJECT_NAME_PATTERN
from native_store.unit_ledger import run_at_below_normal_priority
from reference_client_guard import require_reference_client

REPOSITORY_ROOT = SCRIPTS_ROOT.parent
SKILL_BINDING_STATUSES = ('visual-root', 'reviewed-source-dispatch', 'reviewed-native-dispatch-candidates', 'reviewed-animation-notify-candidates',
                          'gap')
(VISUAL_ROOT_STATUS, REVIEWED_SOURCE_DISPATCH_STATUS, REVIEWED_NATIVE_DISPATCH_CANDIDATES_STATUS, REVIEWED_ANIMATION_NOTIFY_CANDIDATES_STATUS,
 BINDING_GAP_STATUS) = SKILL_BINDING_STATUSES
DISPATCH_CANDIDATE_STATUSES = (REVIEWED_NATIVE_DISPATCH_CANDIDATES_STATUS, REVIEWED_ANIMATION_NOTIFY_CANDIDATES_STATUS)
SKILL_BINDING_ROW_FIELDS = ('key', 'skillId', 'level', 'status', 'visualRoot', 'dispatchCandidates', 'soundRowOrdinal', 'soundReason', 'reason')
SKILL_BINDING_ANOMALY_FIELDS = ('rowOrdinal', 'reason')
SKILLS_GAP_ROW_STEP = 'skills'
NO_EXACT_SKILLSOUND_ROW_REASON = 'no-exact-skillsound-row'
SKILL_VISUAL_REFERENCE_UNQUALIFIED_REASON = 'skill-visual-reference-unqualified'
EMITTER_CLASS_UNPORTED_REASON_PREFIX = 'emitter-class-unported:'
EFFECT_BUNDLE_CLASS_LIMIT_REASON_PREFIX = 'effect-bundle-class-limit:'
SKILL_ROW_AMBIGUOUS_REASON_PREFIX = 'skill-row-ambiguous:'
SKILL_LEVEL_BELOW_ONE_ANOMALY = 'skill-level-below-one'
SKILL_ID_NOT_NON_NEGATIVE_INTEGER_ANOMALY = 'skill-id-not-a-non-negative-integer'
SKILL_TABLE_NAME = 'skillgrp'
SKILL_SOUND_TABLE_NAME = 'skillsoundgrp'
SKILL_BINDING_CENSUS_RELATIVE_PATH = 'docs/parts/skills-effects/skill-binding-census.json'
SKILL_BINDING_CENSUS_SCHEMA_VERSION = 1
SKILL_BINDING_CENSUS_FIELDS = ('schemaVersion', 'sources', 'rowCount', 'distinctSkillIds', 'keys', 'sound', 'visualRoots', 'dispatchCandidates',
                               'anomalies')
CENSUS_KEY_BY_STATUS = {VISUAL_ROOT_STATUS: 'visualRoot', REVIEWED_SOURCE_DISPATCH_STATUS: 'reviewedSourceDispatch',
                        REVIEWED_NATIVE_DISPATCH_CANDIDATES_STATUS: 'reviewedNativeDispatchCandidates',
                        REVIEWED_ANIMATION_NOTIFY_CANDIDATES_STATUS: 'reviewedAnimationNotifyCandidates'}
REVIEWED_SOURCE_DISPATCH_RECIPE_PATHS = ('recipes/native-power-strike.json',)
SKILL_BINDING_DESCRIPTION = ('Bind every decoded skillgrp row to one visual root, reviewed source dispatch, reviewed dispatch or animation notify '
                             'candidates or listed gap, and every skill key to its exact skillsoundgrp row, then write the committed binding '
                             'census. --check compares and writes nothing.')


class SkillBindingTableError(ValueError):
    pass


class SkillDispatchCandidateRows(NamedTuple):
    native_dispatch: dict
    animation_notify: dict


def skill_binding_key(skill_id, level):
    return f'skill:{skill_id}:{level}'


def skill_dispatch_candidate_rows(document):
    return SkillDispatchCandidateRows(
        *({skill_binding_key(skill_id, level): entries for (skill_id, level), entries in by_skill_key(document).items()}
          for by_skill_key in (dispatch_candidates_by_skill_key, animation_notify_candidates_by_skill_key)))


def is_non_negative_integer(value):
    return type(value) is int and value >= 0


def skill_binding_anomaly_reason(skill_row):
    if not is_non_negative_integer(skill_row['skill_id']):
        return SKILL_ID_NOT_NON_NEGATIVE_INTEGER_ANOMALY
    if type(skill_row['skill_level']) is not int or skill_row['skill_level'] < 1:
        return SKILL_LEVEL_BELOW_ONE_ANOMALY
    return None


def skill_binding_anomalies(skill_rows):
    return [{'rowOrdinal': ordinal, 'reason': reason} for ordinal, row in enumerate(skill_rows)
            if (reason := skill_binding_anomaly_reason(row)) is not None]


def sound_row_ordinals_by_skill_key(sound_rows):
    ordinals = defaultdict(list)
    for ordinal, row in enumerate(sound_rows):
        ordinals[(row['skill_id'], row['skill_level'])].append(ordinal)
    return ordinals


def exact_sound_binding(sound_ordinals):
    if len(sound_ordinals) == 1:
        return sound_ordinals[0], None
    return None, NO_EXACT_SKILLSOUND_ROW_REASON


def empty_description_binding(skill_key, reviewed_dispatch_keys, candidate_rows):
    if skill_key in reviewed_dispatch_keys:
        return REVIEWED_SOURCE_DISPATCH_STATUS, None, None, None
    if skill_key in candidate_rows.native_dispatch:
        return REVIEWED_NATIVE_DISPATCH_CANDIDATES_STATUS, None, candidate_rows.native_dispatch[skill_key], None
    if skill_key in candidate_rows.animation_notify:
        return REVIEWED_ANIMATION_NOTIFY_CANDIDATES_STATUS, None, candidate_rows.animation_notify[skill_key], None
    return BINDING_GAP_STATUS, None, None, NATIVE_SKILL_DISPATCH_REQUIRED_REASON


def visual_binding(skill_rows, skill_key, reviewed_dispatch_keys, candidate_rows):
    if len(skill_rows) > 1:
        return BINDING_GAP_STATUS, None, None, f'{SKILL_ROW_AMBIGUOUS_REASON_PREFIX}{len(skill_rows)}'
    description = skill_rows[0]['description']
    if not description:
        return empty_description_binding(skill_key, reviewed_dispatch_keys, candidate_rows)
    if not (isinstance(description, str) and QUALIFIED_OBJECT_NAME_PATTERN.fullmatch(description)):
        return BINDING_GAP_STATUS, None, None, SKILL_VISUAL_REFERENCE_UNQUALIFIED_REASON
    return VISUAL_ROOT_STATUS, description, None, None


def skill_binding_row(skill_id, level, skill_rows, sound_ordinals, reviewed_dispatch_keys, candidate_rows):
    key = skill_binding_key(skill_id, level)
    status, visual_root, dispatch_candidates, reason = visual_binding(skill_rows, key, reviewed_dispatch_keys, candidate_rows)
    sound_row_ordinal, sound_reason = exact_sound_binding(sound_ordinals)
    return {'key': key, 'skillId': skill_id, 'level': level, 'status': status, 'visualRoot': visual_root,
            'dispatchCandidates': dispatch_candidates, 'soundRowOrdinal': sound_row_ordinal, 'soundReason': sound_reason, 'reason': reason}


def build_skill_binding_rows(skill_rows, sound_rows, reviewed_dispatch_keys, candidate_rows):
    rows_by_skill_key = defaultdict(list)
    for row in skill_rows:
        if skill_binding_anomaly_reason(row) is None:
            rows_by_skill_key[(row['skill_id'], row['skill_level'])].append(row)
    sound_ordinals = sound_row_ordinals_by_skill_key(sound_rows)
    return [skill_binding_row(skill_id, level, rows_by_skill_key[(skill_id, level)], sound_ordinals.get((skill_id, level), []),
                              frozenset(reviewed_dispatch_keys), candidate_rows)
            for skill_id, level in sorted(rows_by_skill_key)]


def skill_bindings_by_visual_root(binding_rows):
    keys_by_root = defaultdict(list)
    for row in binding_rows:
        if row['status'] == VISUAL_ROOT_STATUS:
            keys_by_root[row['visualRoot']].append(row)
    return dict(keys_by_root)


def visual_roots_in_first_key_order(binding_rows):
    roots = skill_bindings_by_visual_root(binding_rows)
    return sorted(roots, key=lambda root: (roots[root][0]['skillId'], roots[root][0]['level']))


def representative_skill_binding(root_bindings):
    return next((row for row in root_bindings if row['soundRowOrdinal'] is not None), None)


def emitter_class_root_outcome(emitter_classes, simulated_emitter_classes):
    unported = sorted(set(emitter_classes) - set(simulated_emitter_classes))
    if unported:
        return 'gap', EMITTER_CLASS_UNPORTED_REASON_PREFIX + unported[0]
    return 'pass', None


def skill_binding_gap_row(binding_row, root_outcomes, source_identity, census_evidence):
    if binding_row['status'] == BINDING_GAP_STATUS:
        status, reason, evidence = 'gap', binding_row['reason'], census_evidence
    elif binding_row['status'] in DISPATCH_CANDIDATE_STATUSES:
        status, reason, evidence = 'gap', SKILL_DISPATCH_CANDIDATE_RUNTIME_UNRESOLVED_REASON, SKILL_DISPATCH_CANDIDATES_RELATIVE_PATH
    elif binding_row['status'] == VISUAL_ROOT_STATUS and binding_row['visualRoot'] in root_outcomes:
        outcome = root_outcomes[binding_row['visualRoot']]
        status, reason, evidence = outcome['status'], outcome['reason'], outcome['evidence']
    else:
        status, reason, evidence = 'pending', CONVERSION_PENDING_REASON, census_evidence
    return {'key': binding_row['key'], 'part': SKILL_PART_NAME, 'step': SKILLS_GAP_ROW_STEP, 'status': status, 'reason': reason,
            'sourceIdentity': source_identity, 'evidence': evidence}


def skill_binding_gap_rows(binding_rows, root_outcomes, source_identity):
    return [skill_binding_gap_row(row, root_outcomes, source_identity, SKILL_BINDING_CENSUS_RELATIVE_PATH) for row in binding_rows]


def skill_rows_covered_by_binding(binding_row):
    reason = binding_row['reason'] or ''
    return int(reason[len(SKILL_ROW_AMBIGUOUS_REASON_PREFIX):]) if reason.startswith(SKILL_ROW_AMBIGUOUS_REASON_PREFIX) else 1


def skill_binding_census(skill_table, sound_table, binding_rows, anomalies, dispatch_candidates):
    skill_rows = decoded_table_rows(skill_table)
    status_rows = Counter()
    gap_rows_by_reason = Counter()
    for row in binding_rows:
        covered_rows = skill_rows_covered_by_binding(row)
        if row['status'] == BINDING_GAP_STATUS:
            gap_rows_by_reason[row['reason']] += covered_rows
        else:
            status_rows[row['status']] += covered_rows
    census = {
        'schemaVersion': SKILL_BINDING_CENSUS_SCHEMA_VERSION,
        'sources': {SKILL_TABLE_NAME: skill_table['sourceSha256'], SKILL_SOUND_TABLE_NAME: sound_table['sourceSha256']},
        'rowCount': len(skill_rows),
        'distinctSkillIds': len({row['skillId'] for row in binding_rows}),
        'keys': {**{key: status_rows[status] for status, key in CENSUS_KEY_BY_STATUS.items()}, 'gap': dict(sorted(gap_rows_by_reason.items()))},
        'sound': {'exactRow': sum(1 for row in binding_rows if row['soundRowOrdinal'] is not None),
                  'noExactRow': sum(1 for row in binding_rows if row['soundRowOrdinal'] is None)},
        'visualRoots': len(skill_bindings_by_visual_root(binding_rows)),
        'dispatchCandidates': dispatch_candidates,
        'anomalies': list(anomalies)}
    require_census_totals(census)
    return census


def require_census_totals(census):
    keys = census['keys']
    total = sum(keys[key] for key in CENSUS_KEY_BY_STATUS.values()) + sum(keys['gap'].values()) + len(census['anomalies'])
    if total != census['rowCount']:
        raise SkillBindingTableError(f'skill binding census covers {total} rows, but skillgrp decodes {census["rowCount"]}')


def reviewed_source_dispatch_keys(project_root):
    keys = set()
    for relative_path in REVIEWED_SOURCE_DISPATCH_RECIPE_PATHS:
        recipe = json.loads((Path(project_root) / relative_path).read_text(encoding='utf-8-sig'))
        if 'sourceDispatch' not in recipe:
            raise SkillBindingTableError(f'{relative_path} is listed as a reviewed source dispatch recipe but has no sourceDispatch')
        keys.add(skill_binding_key(recipe['skillId'], recipe['level']))
    return frozenset(keys)


class DecodedSkillTables:
    def __init__(self, project_root, client_root, decode=decode_table):
        self.skill_table = decode(Path(client_root), SKILL_TABLE_NAME)
        self.sound_table = decode(Path(client_root), SKILL_SOUND_TABLE_NAME)
        self.skill_rows = decoded_table_rows(self.skill_table)
        self.sound_rows = decoded_table_rows(self.sound_table)
        self.dispatch_candidates = read_skill_dispatch_candidates(project_root)
        self.candidate_rows = skill_dispatch_candidate_rows(self.dispatch_candidates['document'])
        self.binding_rows = build_skill_binding_rows(self.skill_rows, self.sound_rows, reviewed_source_dispatch_keys(project_root),
                                                     self.candidate_rows)
        self.anomalies = skill_binding_anomalies(self.skill_rows)
        self.skill_table_identity = decoded_table_identity(self.skill_table)

    def census(self):
        return skill_binding_census(self.skill_table, self.sound_table, self.binding_rows, self.anomalies,
                                    dispatch_candidate_census(self.dispatch_candidates))


def write_skill_binding_census(project_root, client_root, check):
    census_bytes = canonical_json_bytes(DecodedSkillTables(project_root, client_root).census())
    census_path = Path(project_root) / SKILL_BINDING_CENSUS_RELATIVE_PATH
    if check:
        if not census_path.is_file() or json.loads(census_path.read_bytes()) != json.loads(census_bytes):
            raise SkillBindingTableError(f'{SKILL_BINDING_CENSUS_RELATIVE_PATH} differs from the decoded tables; rerun without --check')
        return census_bytes
    census_path.parent.mkdir(parents=True, exist_ok=True)
    replace_file(census_path, census_bytes)
    return census_bytes


def main(argv=None):
    parser = argparse.ArgumentParser(description=SKILL_BINDING_DESCRIPTION)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    arguments = parser.parse_args(argv)
    try:
        client_access = require_reference_client(arguments.client)
        run_at_below_normal_priority()
        census = json.loads(write_skill_binding_census(REPOSITORY_ROOT, client_access.root, arguments.check))
    except (OSError, ValueError) as error:
        print(f'Skill binding census failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps({key: census[key] for key in ('rowCount', 'distinctSkillIds', 'keys', 'sound', 'visualRoots', 'dispatchCandidates')},
                     sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
