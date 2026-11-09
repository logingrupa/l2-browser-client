from __future__ import annotations

import re

from native_store.coverage_denominators import UNKNOWN_DENOMINATOR
from native_store.gap_rows import GapRowError, load_gap_reason_patterns, validate_gap_row

GAP_CENSUS_STATUS_PRECEDENCE = ('converted', 'failed', 'gap', 'pending')
GAP_CENSUS_STEP_ORDER = ('census', 'raw', 'chunks', 'terrain', 'manifest', 'meshes', 'bsp', 'collision', 'movers', 'sky', 'audio',
                         'minimap', 'terrain-material', 'decode', 'name-index', 'layout', 'textures', 'field-cp', 'field-mp',
                         'npc-model', 'npc-profile', 'npc-sound-identities')
GAP_CENSUS_LOAD_STATUSES = ('pass', 'failed', 'unverified')
UNVERIFIED_LOAD_STATUS = 'unverified'
CATALOG_KEY_KIND_PARTS = {'table': 'data', 'tile': 'world', 'map': 'world', 'character': 'player-characters', 'window': 'ui',
                          'npc': 'npcs', 'item': 'items', 'skill': 'skills-effects'}
SKILL_ROW_AMBIGUOUS_REASON_PATTERN = re.compile(r'^skill-row-ambiguous:(?P<count>[1-9]\d{0,8})$')
NAMED_MISSING_KEY_LIMIT = 5


class GapCensusIncompleteError(ValueError):
    pass


def catalog_key_part(key):
    return CATALOG_KEY_KIND_PARTS[key.split(':', 1)[0]]


def first_keys_text(keys):
    ordered_keys = sorted(keys)
    shown_keys = ', '.join(ordered_keys[:NAMED_MISSING_KEY_LIMIT])
    return shown_keys if len(ordered_keys) <= NAMED_MISSING_KEY_LIMIT else f'{shown_keys} and {len(ordered_keys) - NAMED_MISSING_KEY_LIMIT} more'


def census_gap_row(row, reason_patterns):
    part = row.get('part') if isinstance(row, dict) else None
    try:
        validate_gap_row(row, reason_patterns)
    except GapRowError as error:
        raise GapCensusIncompleteError(f'part {part}: gap row refused by the census: {error}') from error
    if row['step'] not in GAP_CENSUS_STEP_ORDER:
        raise GapCensusIncompleteError(f'part {part}: gap row {row["key"]} names step {row["step"]}, which is not in GAP_CENSUS_STEP_ORDER')
    return row


def gap_rows_by_part(gap_rows):
    reason_patterns = load_gap_reason_patterns()
    rows_by_part = {}
    for row in gap_rows:
        census_gap_row(row, reason_patterns)
        rows_by_part.setdefault(row['part'], []).append(row)
    return rows_by_part


def declared_ambiguous_row_difference(part, part_rows):
    row_count_by_key = {}
    for row in part_rows:
        match = SKILL_ROW_AMBIGUOUS_REASON_PATTERN.fullmatch(row['reason'] or '')
        if match is None:
            continue
        if row_count_by_key.setdefault(row['key'], int(match['count'])) != int(match['count']):
            raise GapCensusIncompleteError(f'part {part}: {row["key"]} declares two different ambiguous row counts')
    return sum(row_count - 1 for row_count in row_count_by_key.values())


def census_part_keys(part, denominator, part_rows, converted_part_keys):
    listed_keys = {row['key'] for row in part_rows} | converted_part_keys
    if denominator['count'] == UNKNOWN_DENOMINATOR:
        if listed_keys:
            raise GapCensusIncompleteError(f'part {part} has rows but its denominator is unknown ({denominator["source"]}): '
                                           f'{first_keys_text(listed_keys)}')
        return ()
    if denominator['keys'] is None:
        keys = listed_keys
    else:
        keys = set(denominator['keys'])
        outside_keys = listed_keys - keys
        if outside_keys:
            raise GapCensusIncompleteError(f'part {part}: keys belong to no denominator ({denominator["source"]}): '
                                           f'{first_keys_text(outside_keys)}')
    declared_difference = declared_ambiguous_row_difference(part, part_rows)
    if len(keys) + declared_difference != denominator['count']:
        raise GapCensusIncompleteError(f'part {part}: {len(keys)} keys plus {declared_difference} declared ambiguous rows differ from '
                                       f'the denominator {denominator["count"]} ({denominator["source"]})')
    return tuple(sorted(keys))


def deciding_row(rows):
    for status in GAP_CENSUS_STATUS_PRECEDENCE[1:]:
        status_rows = [row for row in rows if row['status'] == status]
        if status_rows:
            return min(status_rows, key=lambda row: (-GAP_CENSUS_STEP_ORDER.index(row['step']), row['reason'],
                                                     row['sourceIdentity']['path'], row['sourceIdentity'].get('object', '')))
    return None


def census_row(part, key, converted, rows, load_status):
    if converted:
        status, reason = 'converted', None
    else:
        row = deciding_row(rows)
        status, reason = row['status'], row['reason']
    return {'key': key, 'part': part, 'status': status, 'reason': reason, 'converted': converted, 'loads': load_status}


def require_every_key_stated(part, denominator, keys, rows_by_key, converted_part_keys):
    unstated_keys = [key for key in keys if key not in converted_part_keys and deciding_row(rows_by_key.get(key, [])) is None]
    if unstated_keys:
        raise GapCensusIncompleteError(f'part {part}: {len(unstated_keys)} denominator keys ({denominator["source"]}) have no failed, gap or '
                                       f'pending row and no converted entry: {first_keys_text(unstated_keys)}')


def require_load_statuses(load_checks):
    for key, load_status in load_checks.items():
        if load_status not in GAP_CENSUS_LOAD_STATUSES[:2]:
            raise GapCensusIncompleteError(f'load check of {key} must be pass or failed: {load_status!r}')


def build_gap_census(denominators, gap_rows, catalog_index_keys, load_checks):
    require_load_statuses(load_checks)
    rows_by_part = gap_rows_by_part(gap_rows)
    stray_parts = sorted(set(rows_by_part) - set(denominators))
    if stray_parts:
        raise GapCensusIncompleteError(f'part {stray_parts[0]}: rows belong to no denominator: '
                                       f'{first_keys_text(row["key"] for row in rows_by_part[stray_parts[0]])}')
    census_rows = []
    for part, denominator in denominators.items():
        part_rows = rows_by_part.get(part, [])
        converted_part_keys = {key for key in catalog_index_keys if catalog_key_part(key) == part}
        keys = census_part_keys(part, denominator, part_rows, converted_part_keys)
        rows_by_key = {}
        for row in part_rows:
            rows_by_key.setdefault(row['key'], []).append(row)
        require_every_key_stated(part, denominator, keys, rows_by_key, converted_part_keys)
        census_rows.extend(census_row(part, key, key in converted_part_keys, rows_by_key.get(key, []),
                                      load_checks.get(key, UNVERIFIED_LOAD_STATUS)) for key in keys)
    return census_rows
