from native_store.gap_rows import QUALIFIED_OBJECT_NAME_PATTERN
from world.raw_map_step import tile_step_row
from world.tile_census_validation import GAP_STATUS

PENDING_STATUS = 'pending'
FAILED_STATUS = 'failed'
UPSTREAM_BLOCKING_STATUSES = (FAILED_STATUS, GAP_STATUS)
UPSTREAM_STEP_FAILED_REASON_PREFIX = 'upstream-step-failed:'
UPSTREAM_STEP_GAP_REASON_PREFIX = 'upstream-step-gap:'


class TileStepGapRows:
    def __init__(self, tile_id, step, source_identity, evidence):
        self.tile_id, self.step, self.source_identity, self.evidence = tile_id, step, source_identity, evidence
        self.rows_by_identity = {}

    def add(self, status, reason, object_name=None):
        named_object = object_name if isinstance(object_name, str) and QUALIFIED_OBJECT_NAME_PATTERN.fullmatch(object_name) else None
        identity = self.source_identity if named_object is None else {**self.source_identity, 'object': named_object}
        self.rows_by_identity.setdefault((reason, named_object or ''), tile_step_row(self.tile_id, self.step, status, reason, identity, self.evidence))

    def rows(self):
        return [self.rows_by_identity[key] for key in sorted(self.rows_by_identity, key=lambda key: (key[1].casefold(), key[0]))]

    def rows_for_objects(self, object_names):
        folded = {name.casefold() for name in object_names}
        return [row for row in self.rows() if row['sourceIdentity'].get('object', '').casefold() in folded]


def upstream_failed_row(tile_id, step, source_identity, failed_step, evidence):
    return tile_step_row(tile_id, step, PENDING_STATUS, f'{UPSTREAM_STEP_FAILED_REASON_PREFIX}{failed_step}', source_identity, evidence)


def inherited_upstream_row(tile_id, step, source_identity, blocking_row, evidence):
    if blocking_row['status'] == GAP_STATUS:
        return tile_step_row(tile_id, step, GAP_STATUS, f'{UPSTREAM_STEP_GAP_REASON_PREFIX}{blocking_row["step"]}', source_identity, evidence)
    return upstream_failed_row(tile_id, step, source_identity, blocking_row['step'], evidence)


def first_blocking_row(step_names, step_results):
    return next((step_results[step] for step in step_names if step in step_results and step_results[step]['status'] in UPSTREAM_BLOCKING_STATUSES),
                None)


def tile_step_summary_row(tile_id, step, source_identity, gap_rows, evidence):
    if gap_rows:
        return tile_step_row(tile_id, step, gap_rows[0]['status'], gap_rows[0]['reason'], source_identity, evidence)
    return tile_step_row(tile_id, step, 'pass', None, source_identity, evidence)
