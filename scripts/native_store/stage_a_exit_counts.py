from __future__ import annotations

from functools import cached_property
from pathlib import Path

from native_store.coverage_denominators import COVERAGE_PART_ORDER, CoverageReportError
from native_store.side_by_side_check_halves import SIDE_BY_SIDE_ARTIFACTS_FOLDER, is_non_negative_integer, is_sha256, key_file_stem
from native_store.side_by_side_check_records import (COMPUTED_UNVERIFIED_REASONS, STORED_UNVERIFIED_REASONS, decode_side_by_side_document,
                                                     read_side_by_side_records)
from native_store.side_by_side_key_digest import key_content_sha256_by_key

STAGE_A_COUNT_FIELDS = ('checked', 'pass', 'mismatch', 'unverified', 'recordsWithoutDenominator')
STAGE_A_FIELDS = frozenset({'converted', 'loadsPass', 'unverifiedByReason', *STAGE_A_COUNT_FIELDS})
STAGE_A_REASONS = STORED_UNVERIFIED_REASONS + COMPUTED_UNVERIFIED_REASONS
JUDGED_VERDICTS = ('pass', 'mismatch')
UNVERIFIED_VERDICT = 'unverified'
STALE_AFTER_FIX_REASON = 'stale-after-fix'
SANDBOX_CAPTURE_FAILED_REASON = 'sandbox-capture-failed'
LOADS_FAILED_REASON = 'loads-failed'
LOADS_UNRECORDED_REASON = 'loads-unrecorded'
NOT_YET_QUEUED_REASON = 'not-yet-queued'
CONVERTED_CENSUS_STATUS = 'pass'
CAPTURE_FAILURES_FOLDER_NAME = 'failures'
STAGE_A_RULE_TEXT = ('Checked counts only judged pairs (pass or mismatch) on the key content digest of this catalog; every other converted key '
                     'is unverified with one reason, so converted equals checked plus unverified and checked equals pass plus mismatch. '
                     'Loads pass counts only load records on this catalog.')
STAGE_A_TABLE_HEADER = ('| Part | Converted | Loads pass | Checked | Pass | Mismatch | Unverified | Unverified by reason | Gap | Pending |\n'
                        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n')


class StageAExitCountsError(CoverageReportError):
    pass


def record_outcome(record, current_key_content_sha256):
    if record['sandboxHalf']['keyContentSha256'] != current_key_content_sha256:
        return UNVERIFIED_VERDICT, STALE_AFTER_FIX_REASON
    if record['verdict'] in JUDGED_VERDICTS:
        return record['verdict'], None
    return UNVERIFIED_VERDICT, record['reason']


class StageAExitInputs:
    def __init__(self, project_root, store_root, catalog, load_status_by_key):
        self.project_root = Path(project_root)
        self.store_root = Path(store_root)
        self.catalog = catalog
        self.load_status_by_key = load_status_by_key

    @cached_property
    def records_by_part(self):
        return {part: read_side_by_side_records(self.project_root, part) for part in COVERAGE_PART_ORDER}

    @cached_property
    def key_content_sha256_by_key(self):
        return key_content_sha256_by_key(self.store_root, self.catalog, self.project_root / 'public' / 'l2')

    def record_outcome(self, record):
        return record_outcome(record, self.key_content_sha256_by_key.get(record['key']))

    def records_by_key(self, part):
        return {record['key']: record for record in self.records_by_part[part]}

    def capture_failure_key_content_sha256(self, part, key):
        path = self.project_root.joinpath(*SIDE_BY_SIDE_ARTIFACTS_FOLDER, part, CAPTURE_FAILURES_FOLDER_NAME, f'{key_file_stem(key)}.json')
        if not path.is_file():
            return None
        failure = decode_side_by_side_document(path)
        if not (isinstance(failure, dict) and failure.get('key') == key and is_sha256(failure.get('keyContentSha256'))):
            raise StageAExitCountsError(f'capture failure file must name key {key} and its keyContentSha256: {path}')
        return failure['keyContentSha256']

    def key_outcome(self, part, key, records_by_key):
        if key in records_by_key:
            return self.record_outcome(records_by_key[key])
        failure_sha256 = self.capture_failure_key_content_sha256(part, key)
        if failure_sha256 is not None and failure_sha256 == self.key_content_sha256_by_key.get(key):
            return UNVERIFIED_VERDICT, SANDBOX_CAPTURE_FAILED_REASON
        load_status = self.load_status_by_key.get(key)
        if load_status is None:
            return UNVERIFIED_VERDICT, LOADS_UNRECORDED_REASON
        return UNVERIFIED_VERDICT, LOADS_FAILED_REASON if load_status == 'failed' else NOT_YET_QUEUED_REASON


def stage_a_counts_of_outcomes(outcomes, converted, loads_pass, records_without_denominator):
    reason_counts = {}
    for _, reason in outcomes:
        if reason is not None:
            reason_counts[reason] = reason_counts.get(reason, 0) + 1
    passed = sum(1 for verdict, _ in outcomes if verdict == 'pass')
    mismatched = sum(1 for verdict, _ in outcomes if verdict == 'mismatch')
    return {'converted': converted, 'loadsPass': loads_pass, 'checked': passed + mismatched, 'pass': passed, 'mismatch': mismatched,
            'unverified': sum(reason_counts.values()), 'unverifiedByReason': dict(sorted(reason_counts.items())),
            'recordsWithoutDenominator': records_without_denominator}


def converted_part_keys(part_rows):
    return [row['key'] for row in part_rows if row['status'] == CONVERTED_CENSUS_STATUS]


def stage_a_part_counts(exit_inputs, part_rows, part):
    keys = converted_part_keys(part_rows)
    records_by_key = exit_inputs.records_by_key(part)
    loads_pass = sum(1 for key in keys if exit_inputs.load_status_by_key.get(key) == 'pass')
    return stage_a_counts_of_outcomes([exit_inputs.key_outcome(part, key, records_by_key) for key in keys], len(keys), loads_pass, 0)


def require_stage_a_reason_counts(part, reason_counts):
    if not (isinstance(reason_counts, dict) and all(reason in STAGE_A_REASONS and is_non_negative_integer(count) and count > 0
                                                   for reason, count in reason_counts.items())):
        raise StageAExitCountsError(f'stage A unverifiedByReason of {part} must map listed reasons to positive counts: {reason_counts!r}')


def validate_stage_a_counts(part, stage_a, part_rows):
    if not (isinstance(stage_a, dict) and set(stage_a) == STAGE_A_FIELDS):
        raise StageAExitCountsError(f'stage A counts of {part} must hold exactly {", ".join(sorted(STAGE_A_FIELDS))}: {stage_a!r}')
    require_stage_a_reason_counts(part, stage_a['unverifiedByReason'])
    if not all(is_non_negative_integer(stage_a[field]) for field in STAGE_A_COUNT_FIELDS):
        raise StageAExitCountsError(f'stage A counts of {part} must be non-negative integers: {stage_a!r}')
    if stage_a['checked'] != stage_a['pass'] + stage_a['mismatch'] or stage_a['unverified'] != sum(stage_a['unverifiedByReason'].values()):
        raise StageAExitCountsError(f'stage A counts of {part} do not balance checked and unverified: {stage_a!r}')
    converted = len(converted_part_keys(part_rows))
    balanced = (stage_a['converted'] == converted == stage_a['checked'] + stage_a['unverified'] and stage_a['recordsWithoutDenominator'] == 0
                and is_non_negative_integer(stage_a['loadsPass']) and stage_a['loadsPass'] <= converted)
    if not balanced:
        raise StageAExitCountsError(f'stage A counts of {part} do not balance converted with checked plus unverified: {stage_a!r}')


def unverified_by_reason_text(reason_counts):
    return ', '.join(f'`{reason}` {count}' for reason, count in reason_counts.items()) or 'none'


def stage_a_markdown_row(part, counts):
    stage_a = counts['stageA']
    cells = (part, stage_a['converted'], stage_a['loadsPass'], stage_a['checked'], stage_a['pass'], stage_a['mismatch'], stage_a['unverified'],
             unverified_by_reason_text(stage_a['unverifiedByReason']), counts['gap'], counts['pending'])
    return '| ' + ' | '.join(str(cell) for cell in cells) + ' |\n'


def stage_a_markdown(report):
    table_rows = ''.join(stage_a_markdown_row(part, counts) for part, counts in report['parts'].items())
    return f'## Stage A exit\n\n{STAGE_A_TABLE_HEADER}{table_rows}\n{STAGE_A_RULE_TEXT}\n'
