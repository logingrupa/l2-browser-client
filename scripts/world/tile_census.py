from pathlib import Path, PurePosixPath
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
from collections import Counter
import hashlib
import json
import re

from hash_reference_client_tree import canonical_json_bytes as lock_canonical_json_bytes
from native_catalog.ue2 import FormatError, summary
from native_store.canonical_json import canonical_json_bytes
from native_store.gap_rows import load_gap_reason_patterns, validate_gap_row, write_gap_rows
from native_store.unit_ledger import run_at_below_normal_priority
from reference_client_guard import require_reference_client
from world.committed_world_data import REPOSITORY_ROOT, require_committed_destination, write_committed_world_bytes

TILE_CENSUS_RELATIVE_PATH = 'docs/parts/world/tile-census.json'
TILE_CENSUS_SCHEMA_VERSION = 1
DEFAULT_CONVERSION_CLIENT_ROOT = Path('E:/Lineage2-client')
WORLD_LANE_NAME = 'world'
WORLD_PART_NAME = 'world'
CENSUS_STEP = 'census'
PACKAGE_HEADER_PREFIX_BYTES = 128
SUPPORTED_PACKAGE_VERSION = 123
SUPPORTED_PACKAGE_LICENSEE = 28
EXPECTED_TILE_MAP_COUNT = 153
EXPECTED_NON_TILE_MAP_COUNT = 10
MAP_PATH_PATTERN = re.compile(r'maps/(?P<stem>[^/]+)\.unr', re.IGNORECASE)
TILE_STEM_PATTERN = re.compile(r'\d{2}_\d{2}')
TILE_KIND = 'tile'
NON_TILE_KIND = 'non-tile'
GATE_PASS = 'pass'
GATE_FAIL = 'fail'
GATE_MISSING = 'missing'
GATE_NOT_APPLICABLE = 'not-applicable'
TILE_TERRAIN_HEIGHT_GATES = (GATE_PASS, GATE_FAIL, GATE_MISSING)
TERRAIN_HEIGHT_PACKAGE_PATH_FORMAT ='textures/T_{tile_id}.utx'
TERRAIN_HEIGHT_PACKAGE_MISSING_REASON = 'terrain-height-package-missing'
ELIGIBLE_STATUS = 'eligible'
GAP_STATUS = 'gap'
ELIGIBLE_GAP_ROW_STATUS = 'pending'
ELIGIBLE_GAP_ROW_REASON = 'step-pending:raw'
CENSUS_ROW_FIELDS = ('map', 'kind', 'key', 'packageVersion', 'licensee', 'wrapper', 'mapReaderGate', 'terrainHeightGate',
                     'terrainMapPackage', 'status', 'reason')
CENSUS_FIELDS = frozenset({'schemaVersion', 'referenceTreeLockSha256', 'maps'})
SHA256_TEXT_PATTERN = re.compile(r'[0-9a-f]{64}')


class TileCensusError(ValueError):
    pass


def casefolded_unique_paths(lock_records):
    paths_by_casefolded_path = {}
    for path in sorted(lock_records):
        paths_by_casefolded_path.setdefault(path.casefold(), path)
    return sorted(paths_by_casefolded_path.values())


def map_census_keys(lock_records):
    census_keys = []
    for path in casefolded_unique_paths(lock_records):
        match = MAP_PATH_PATTERN.fullmatch(path)
        if match is None:
            continue
        stem = match['stem']
        if TILE_STEM_PATTERN.fullmatch(stem):
            census_keys.append({'map': path, 'kind': TILE_KIND, 'key': f'tile:{stem}'})
        else:
            census_keys.append({'map': path, 'kind': NON_TILE_KIND, 'key': f'map:{stem}'})
    if not any(census_key['kind'] == TILE_KIND for census_key in census_keys):
        raise TileCensusError('reference client lock lists no tile maps maps/XX_YY.unr; the census needs at least one')
    keys = [census_key['key'] for census_key in census_keys]
    if len(set(keys)) != len(keys):
        raise TileCensusError(f'reference client lock maps give repeated census keys: {sorted(key for key in keys if keys.count(key) > 1)}')
    return sorted(census_keys, key=lambda census_key: census_key['key'])


def read_package_header(client_access, relative_path):
    path = client_access.require_equal_file(relative_path)
    with open(path, 'rb') as stream:
        prefix = stream.read(PACKAGE_HEADER_PREFIX_BYTES)
    try:
        package_summary = summary(prefix, PurePosixPath(relative_path).name)
    except (FormatError, UnicodeError) as error:
        return {'error': str(error)}
    return {'packageVersion': package_summary['version'], 'licensee': package_summary['licenseeVersion'], 'wrapper': package_summary['wrapper']}


def map_reader_gate(header):
    if 'error' in header:
        return GATE_FAIL, f'decode-failed:{header["error"]}'
    if header['packageVersion'] != SUPPORTED_PACKAGE_VERSION:
        return GATE_FAIL, f'map-version-unsupported:{header["packageVersion"]}'
    if header['licensee'] != SUPPORTED_PACKAGE_LICENSEE:
        return GATE_FAIL, f'map-licensee-unsupported:{SUPPORTED_PACKAGE_VERSION}/{header["licensee"]}'
    return GATE_PASS, None


def terrain_height_gate_by_package_name(client_access, lock_records, tile_id):
    terrain_package_path = TERRAIN_HEIGHT_PACKAGE_PATH_FORMAT.format(tile_id=tile_id)
    lock_path = min((path for path in lock_records if path.casefold() == terrain_package_path.casefold()), default=None)
    if lock_path is None:
        return GATE_MISSING, TERRAIN_HEIGHT_PACKAGE_MISSING_REASON
    header = read_package_header(client_access, lock_path)
    if 'error' in header:
        raise TileCensusError(f'terrain height package {lock_path} header is unreadable ({header["error"]}); no listed gap reason covers it')
    if header['packageVersion'] != SUPPORTED_PACKAGE_VERSION:
        return GATE_FAIL, f'terrain-height-version-unsupported:{header["packageVersion"]}'
    if header['licensee'] != SUPPORTED_PACKAGE_LICENSEE:
        return GATE_FAIL, f'terrain-height-licensee-unsupported:{SUPPORTED_PACKAGE_VERSION}/{header["licensee"]}'
    return GATE_PASS, None


def census_row(client_access, lock_records, census_key):
    header = read_package_header(client_access, census_key['map'])
    map_gate, map_reason = map_reader_gate(header)
    if census_key['kind'] == TILE_KIND:
        terrain_gate, terrain_reason = terrain_height_gate_by_package_name(client_access, lock_records, census_key['key'].split(':', 1)[1])
    elif map_reason is None:
        raise TileCensusError(f'non-tile map {census_key["map"]} passes the map reader gate; no listed status covers a non-tile map that reads')
    else:
        terrain_gate, terrain_reason = GATE_NOT_APPLICABLE, None
    reason = map_reason if map_reason is not None else terrain_reason
    return {**census_key, 'packageVersion': header.get('packageVersion'), 'licensee': header.get('licensee'), 'wrapper': header.get('wrapper'),
            'mapReaderGate': map_gate, 'terrainHeightGate': terrain_gate, 'terrainMapPackage': None,
            'status': ELIGIBLE_STATUS if reason is None and terrain_gate == GATE_PASS else GAP_STATUS, 'reason': reason}


def census_gap_row(row, lock_records):
    eligible = row['status'] == ELIGIBLE_STATUS
    return {'key': row['key'], 'part': WORLD_PART_NAME, 'step': CENSUS_STEP,
            'status': ELIGIBLE_GAP_ROW_STATUS if eligible else GAP_STATUS,
            'reason': ELIGIBLE_GAP_ROW_REASON if eligible else row['reason'],
            'sourceIdentity': {'path': row['map'], 'sha256': lock_records[row['map']]['eSha256']},
            'evidence': TILE_CENSUS_RELATIVE_PATH}


def tile_census_gap_rows(census, lock_records):
    reason_patterns = load_gap_reason_patterns()
    return [validate_gap_row(census_gap_row(row, lock_records), reason_patterns) for row in census['maps']]


def reference_tree_lock_sha256(lock):
    return hashlib.sha256(lock_canonical_json_bytes(lock)).hexdigest()


def build_tile_census(client_access, lock, lock_records):
    rows = [census_row(client_access, lock_records, census_key) for census_key in map_census_keys(lock_records)]
    census = {'schemaVersion': TILE_CENSUS_SCHEMA_VERSION, 'referenceTreeLockSha256': reference_tree_lock_sha256(lock), 'maps': rows}
    tile_census_gap_rows(census, lock_records)
    return census


def require_census_row_rules(row):
    if not (isinstance(row, dict) and tuple(sorted(row)) == tuple(sorted(CENSUS_ROW_FIELDS))):
        raise TileCensusError(f'tile census row must hold exactly {", ".join(CENSUS_ROW_FIELDS)}: {row!r}')
    if row['kind'] not in (TILE_KIND, NON_TILE_KIND) or row['status'] not in (ELIGIBLE_STATUS, GAP_STATUS):
        raise TileCensusError(f'tile census row {row["key"]} has an unknown kind or status: {row["kind"]!r} {row["status"]!r}')
    allowed_terrain_gates = TILE_TERRAIN_HEIGHT_GATES if row['kind'] == TILE_KIND else (GATE_NOT_APPLICABLE,)
    if row['mapReaderGate'] not in (GATE_PASS, GATE_FAIL) or row['terrainHeightGate'] not in allowed_terrain_gates:
        raise TileCensusError(f'tile census row {row["key"]} has gates {row["mapReaderGate"]!r}/{row["terrainHeightGate"]!r} outside its kind')
    if row['terrainMapPackage'] is not None:
        raise TileCensusError(f'tile census row {row["key"]} names a terrainMapPackage, but the terrain gate is by package name only')
    both_gates_pass = row['mapReaderGate'] == GATE_PASS and row['terrainHeightGate'] == GATE_PASS
    if (row['status'] == ELIGIBLE_STATUS) != both_gates_pass:
        raise TileCensusError(f'tile census row {row["key"]} is {row["status"]} but its gates are {row["mapReaderGate"]}/{row["terrainHeightGate"]}')
    if (row['reason'] is None) != (row['status'] == ELIGIBLE_STATUS):
        raise TileCensusError(f'tile census row {row["key"]} status {row["status"]} does not fit its reason {row["reason"]!r}')


def validate_tile_census(census):
    if not (isinstance(census, dict) and set(census) == CENSUS_FIELDS and census['schemaVersion'] == TILE_CENSUS_SCHEMA_VERSION):
        raise TileCensusError(f'tile census must be schemaVersion {TILE_CENSUS_SCHEMA_VERSION} with exactly {", ".join(sorted(CENSUS_FIELDS))}')
    if not (isinstance(census['referenceTreeLockSha256'], str) and SHA256_TEXT_PATTERN.fullmatch(census['referenceTreeLockSha256'])):
        raise TileCensusError(f'tile census referenceTreeLockSha256 must be 64 lowercase hex characters: {census["referenceTreeLockSha256"]!r}')
    rows = census['maps']
    if not isinstance(rows, list):
        raise TileCensusError('tile census maps must be a list')
    for row in rows:
        require_census_row_rules(row)
    kind_counts = Counter(row['kind'] for row in rows)
    if (kind_counts[TILE_KIND], kind_counts[NON_TILE_KIND]) != (EXPECTED_TILE_MAP_COUNT, EXPECTED_NON_TILE_MAP_COUNT):
        raise TileCensusError(f'tile census lists {kind_counts[TILE_KIND]} tiles and {kind_counts[NON_TILE_KIND]} non-tile maps, '
                              f'expected {EXPECTED_TILE_MAP_COUNT} and {EXPECTED_NON_TILE_MAP_COUNT}')
    keys = [row['key'] for row in rows]
    if keys != sorted(set(keys)):
        raise TileCensusError('tile census rows must be sorted by key with one row per key')
    return census


def tile_census_bytes(census):
    return canonical_json_bytes(census)


def tile_census_summary(census):
    tile_rows = [row for row in census['maps'] if row['kind'] == TILE_KIND]
    return {'output': TILE_CENSUS_RELATIVE_PATH, 'referenceTreeLockSha256': census['referenceTreeLockSha256'],
            'maps': len(census['maps']), 'statuses': dict(sorted(Counter(row['status'] for row in census['maps']).items())),
            'tileLicensees': {str(licensee): count for licensee, count in sorted(Counter(row['licensee'] for row in tile_rows).items(), key=str)},
            'reasons': dict(sorted(Counter(row['reason'] for row in census['maps'] if row['reason'] is not None).items())),
            'censusSha256': hashlib.sha256(tile_census_bytes(census)).hexdigest()}


def main(argv=None):
    parser = argparse.ArgumentParser(description='Census the map package headers of every maps/*.unr in the locked reference client tree.')
    parser.add_argument('--client', type=Path, default=DEFAULT_CONVERSION_CLIENT_ROOT)
    arguments = parser.parse_args(argv)
    try:
        client_access = require_reference_client(arguments.client)
        run_at_below_normal_priority()
        require_committed_destination(TILE_CENSUS_RELATIVE_PATH)
        census = validate_tile_census(build_tile_census(client_access, client_access.lock.document, client_access.lock.records_by_path))
        write_committed_world_bytes(TILE_CENSUS_RELATIVE_PATH, tile_census_bytes(census))
        write_gap_rows(REPOSITORY_ROOT, WORLD_LANE_NAME, CENSUS_STEP, tile_census_gap_rows(census, client_access.lock.records_by_path))
    except (OSError, ValueError) as error:
        print(f'Tile census failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps(tile_census_summary(census), indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
