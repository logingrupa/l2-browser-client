from native_store.gap_rows import QUALIFIED_OBJECT_NAME_PATTERN
from world.raw_map_step import tile_step_row


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


def tile_step_summary_row(tile_id, step, source_identity, gap_rows, evidence):
    if gap_rows:
        return tile_step_row(tile_id, step, gap_rows[0]['status'], gap_rows[0]['reason'], source_identity, evidence)
    return tile_step_row(tile_id, step, 'pass', None, source_identity, evidence)
