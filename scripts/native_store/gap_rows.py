from __future__ import annotations

import json
from pathlib import Path
import re
import tempfile

from native_store.canonical_json import canonical_json_bytes
from native_store.store_paths import (REPOSITORY_ROOT, SHA256_PATTERN, STEP_NAME_PATTERN, StorePathError, lane_gap_rows_folder,
                                      lane_gap_rows_path, read_lane_parts_by_name, require_portable_relative_path)

GAP_ROW_FILE_SCHEMA_VERSION = 1
GAP_REASON_LIST_SCHEMA_VERSION = 1
GAP_ROW_STATUSES = ('pass', 'gap', 'pending', 'failed')
GAP_ROW_FIELDS = ('key', 'part', 'step', 'status', 'reason', 'sourceIdentity', 'evidence')
SOURCE_IDENTITY_REQUIRED_FIELDS = frozenset({'path', 'sha256'})
SOURCE_IDENTITY_OPTIONAL_FIELDS = frozenset({'object'})
QUALIFIED_OBJECT_NAME_PATTERN = re.compile(r'^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$')
CATALOG_KEY_PATTERNS = {
    'tile': re.compile(r'^tile:\d{2}_\d{2}$'),
    'map': re.compile(r'^map:[A-Za-z][A-Za-z0-9_]{0,63}$'),
    'npc': re.compile(r'^npc:\d{1,9}$'),
    'item': re.compile(r'^item:\d{1,9}$'),
    'skill': re.compile(r'^skill:\d{1,9}:[1-9]\d{0,3}$'),
    'table': re.compile(r'^table:[a-z][a-z0-9_]*(?:-[a-z])?$'),
    'window': re.compile(r'^window:[A-Za-z][A-Za-z0-9_]{0,63}(?:#[1-9]\d{0,3})?$'),
    'character': re.compile(r'^character:\d{1,4}$'),
}
SEED_GAP_REASONS_PATH = REPOSITORY_ROOT / 'scripts' / 'native_store' / 'gap_reasons.json'
SEED_GAP_REASON_LIST_NAME = 'seed'
LANE_GAP_REASON_FILES = {
    'world': 'recipes/world/gap-reasons.json',
    'actors': 'recipes/actors/gap-reasons.json',
    'data-ui': 'recipes/data/gap-reasons.json',
}
REASON_PLACEHOLDER_PATTERN = re.compile(r'<[A-Za-z][A-Za-z0-9]*>')
REASON_PLACEHOLDER_VALUE_EXPRESSION = r'[^\n]+'
REASON_LITERAL_PATTERN = re.compile(r'^[a-z0-9][a-z0-9:/_.-]*$')


class GapRowError(ValueError):
    pass


def read_gap_reason_list(path):
    try:
        document = json.loads(path.read_text(encoding='utf-8'))
    except ValueError as error:
        raise GapRowError(f'gap reason list is not JSON: {path}') from error
    if not (isinstance(document, dict) and set(document) == {'schemaVersion', 'listVersion', 'reasons'}
            and document['schemaVersion'] == GAP_REASON_LIST_SCHEMA_VERSION):
        raise GapRowError(f'gap reason list must be {{schemaVersion {GAP_REASON_LIST_SCHEMA_VERSION}, listVersion, reasons}}: {path}')
    if not (type(document['listVersion']) is int and document['listVersion'] >= 1):
        raise GapRowError(f'gap reason list listVersion must be an integer of at least 1: {path}')
    reasons = document['reasons']
    if not (isinstance(reasons, list) and reasons and all(isinstance(reason, str) for reason in reasons)):
        raise GapRowError(f'gap reason list needs a non-empty list of reason patterns: {path}')
    for reason in reasons:
        if not REASON_LITERAL_PATTERN.fullmatch(REASON_PLACEHOLDER_PATTERN.sub('x', reason)):
            raise GapRowError(f'gap reason pattern {reason!r} must be lowercase literal text with <name> placeholders: {path}')
    return document


def read_gap_reason_lists(repository_root=REPOSITORY_ROOT):
    lists_by_name = {SEED_GAP_REASON_LIST_NAME: read_gap_reason_list(SEED_GAP_REASONS_PATH)}
    for lane_name, relative_path in LANE_GAP_REASON_FILES.items():
        lane_reasons_path = Path(repository_root) / relative_path
        if lane_reasons_path.is_file():
            lists_by_name[lane_name] = read_gap_reason_list(lane_reasons_path)
    return lists_by_name


def compile_gap_reason_pattern(pattern):
    literal_parts = REASON_PLACEHOLDER_PATTERN.split(pattern)
    return re.compile(REASON_PLACEHOLDER_VALUE_EXPRESSION.join(re.escape(part) for part in literal_parts))


def load_gap_reason_patterns(repository_root=REPOSITORY_ROOT):
    list_name_by_pattern = {}
    for list_name, document in read_gap_reason_lists(repository_root).items():
        for pattern in document['reasons']:
            if pattern in list_name_by_pattern:
                raise GapRowError(f'gap reason {pattern} is listed by {list_name_by_pattern[pattern]} and {list_name}')
            list_name_by_pattern[pattern] = list_name
    return {pattern: compile_gap_reason_pattern(pattern) for pattern in list_name_by_pattern}


def gap_reason_list_versions(repository_root=REPOSITORY_ROOT):
    return {list_name: document['listVersion'] for list_name, document in read_gap_reason_lists(repository_root).items()}


def stage_a_part_names():
    parts_by_lane_name = read_lane_parts_by_name()
    return frozenset(part for lane_name in LANE_GAP_REASON_FILES for part in parts_by_lane_name[lane_name])


def is_portable_relative_path(value):
    try:
        require_portable_relative_path(value)
    except StorePathError:
        return False
    return True


def is_valid_source_identity(source_identity):
    if not (isinstance(source_identity, dict) and SOURCE_IDENTITY_REQUIRED_FIELDS <= set(source_identity)
            <= SOURCE_IDENTITY_REQUIRED_FIELDS | SOURCE_IDENTITY_OPTIONAL_FIELDS):
        return False
    object_name = source_identity.get('object')
    return (is_portable_relative_path(source_identity['path']) and isinstance(source_identity['sha256'], str)
            and bool(SHA256_PATTERN.fullmatch(source_identity['sha256']))
            and (object_name is None or (isinstance(object_name, str) and bool(QUALIFIED_OBJECT_NAME_PATTERN.fullmatch(object_name)))))


def is_listed_reason(reason, reason_patterns):
    return isinstance(reason, str) and any(pattern.fullmatch(reason) for pattern in reason_patterns.values())


def validate_gap_row(row, reason_patterns=None):
    if not (isinstance(row, dict) and set(row) == set(GAP_ROW_FIELDS)):
        raise GapRowError(f'gap row must hold exactly {", ".join(GAP_ROW_FIELDS)}: {row!r}')
    key = row['key']
    if not (isinstance(key, str) and any(pattern.fullmatch(key) for pattern in CATALOG_KEY_PATTERNS.values())):
        raise GapRowError(f'gap row key is not a catalog key ({", ".join(CATALOG_KEY_PATTERNS)}): {key!r}')
    if not (isinstance(row['part'], str) and row['part'] in stage_a_part_names()):
        raise GapRowError(f'gap row {key} part is not a Stage A part: {row["part"]!r}')
    if not (isinstance(row['step'], str) and STEP_NAME_PATTERN.fullmatch(row['step'])):
        raise GapRowError(f'gap row {key} step must match {STEP_NAME_PATTERN.pattern}: {row["step"]!r}')
    if row['status'] not in GAP_ROW_STATUSES:
        raise GapRowError(f'gap row {key} status must be one of {", ".join(GAP_ROW_STATUSES)}: {row["status"]!r}')
    if row['status'] == 'pass':
        if row['reason'] is not None:
            raise GapRowError(f'gap row {key} passes and must have no reason: {row["reason"]!r}')
    elif not is_listed_reason(row['reason'], load_gap_reason_patterns() if reason_patterns is None else reason_patterns):
        raise GapRowError(f'gap row {key} status {row["status"]} needs a listed reason: {row["reason"]!r}')
    if not is_valid_source_identity(row['sourceIdentity']):
        raise GapRowError(f'gap row {key} sourceIdentity must be {{path, sha256, object?}} with a relative path: {row["sourceIdentity"]!r}')
    if not is_portable_relative_path(row['evidence']):
        raise GapRowError(f'gap row {key} evidence must be a repository- or lane-relative path: {row["evidence"]!r}')
    return row


def sorted_gap_rows(rows):
    return sorted(rows, key=lambda row: (row['key'], row['step']))


def write_gap_rows(project_root, lane_name, step, rows):
    gap_rows_path = lane_gap_rows_path(project_root, lane_name, step)
    reason_patterns = load_gap_reason_patterns()
    lane_parts = read_lane_parts_by_name()[lane_name]
    seen_keys = set()
    for row in rows:
        validate_gap_row(row, reason_patterns)
        if row['step'] != step:
            raise GapRowError(f'gap row {row["key"]} belongs to step {row["step"]}, not {step}')
        if row['part'] not in lane_parts:
            raise GapRowError(f'gap row {row["key"]} part {row["part"]} is not owned by lane {lane_name}')
        if row['key'] in seen_keys:
            raise GapRowError(f'gap row key {row["key"]} repeats in step {step}')
        seen_keys.add(row['key'])
    document = {'schemaVersion': GAP_ROW_FILE_SCHEMA_VERSION, 'lane': lane_name, 'step': step,
                'reasonListVersions': gap_reason_list_versions(), 'rows': sorted_gap_rows(rows)}
    gap_rows_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=gap_rows_path.parent, prefix=f'.{step}.', suffix='.tmp', delete=False) as stream:
        stream.write(canonical_json_bytes(document))
        temporary_path = Path(stream.name)
    try:
        temporary_path.replace(gap_rows_path)
    except OSError:
        temporary_path.unlink(missing_ok=True)
        raise
    return document


def read_gap_rows(project_root, lane_name):
    gap_rows_folder = lane_gap_rows_folder(project_root, lane_name)
    if not gap_rows_folder.is_dir():
        return []
    reason_patterns = load_gap_reason_patterns()
    rows = []
    for gap_rows_path in sorted(gap_rows_folder.glob('*.json')):
        document = json.loads(gap_rows_path.read_text(encoding='utf-8'))
        if not (isinstance(document, dict) and document.get('schemaVersion') == GAP_ROW_FILE_SCHEMA_VERSION
                and document.get('lane') == lane_name and document.get('step') == gap_rows_path.stem
                and isinstance(document.get('rows'), list)):
            raise GapRowError(f'gap row file does not match lane {lane_name} and step {gap_rows_path.stem}: {gap_rows_path}')
        for row in document['rows']:
            if validate_gap_row(row, reason_patterns)['step'] != gap_rows_path.stem:
                raise GapRowError(f'gap row {row["key"]} sits in the file of another step: {gap_rows_path}')
            rows.append(row)
    return sorted_gap_rows(rows)
