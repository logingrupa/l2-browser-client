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
from native_catalog.ue2 import FormatError, Package, summary
from world.map_actor_properties import actor_properties, decode_property, property_value
from native_store.canonical_json import canonical_json_bytes
from native_store.gap_rows import load_gap_reason_patterns, validate_gap_row, write_gap_rows
from native_store.lane_coverage_refresh import lane_coverage_refreshed_at_exit
from native_store.unit_ledger import run_at_below_normal_priority
from reference_client_guard import require_reference_client
from world.committed_world_data import REPOSITORY_ROOT, require_committed_destination, write_committed_world_bytes
from world.tile_census_validation import (DECLARED_TERRAIN_MAP_BASIS, ELIGIBLE_STATUS, GAP_STATUS, GATE_FAIL, GATE_MISSING, GATE_NOT_APPLICABLE,
                                          GATE_PASS, NON_TILE_KIND, PACKAGE_NAME_TERRAIN_MAP_BASIS, SUPPORTED_PACKAGE_LICENSEE,
                                          SUPPORTED_PACKAGE_VERSION, TILE_CENSUS_RELATIVE_PATH, TILE_CENSUS_SCHEMA_VERSION, TILE_KIND,
                                          TileCensusError, validate_tile_census)

DEFAULT_CONVERSION_CLIENT_ROOT = Path('E:/Lineage2-client')
WORLD_LANE_NAME = 'world'
WORLD_PART_NAME = 'world'
CENSUS_STEP = 'census'
PACKAGE_HEADER_PREFIX_BYTES = 128
MAP_PATH_PATTERN = re.compile(r'maps/(?P<stem>[^/]+)\.unr', re.IGNORECASE)
TILE_STEM_PATTERN = re.compile(r'\d{2}_\d{2}')
TERRAIN_HEIGHT_PACKAGE_PATH_FORMAT = 'textures/T_{tile_id}.utx'
TERRAIN_HEIGHT_PACKAGE_SUFFIX = '.utx'
TERRAIN_INFO_CLASS_OBJECT = 'Engine.TerrainInfo'
TERRAIN_MAP_PROPERTY_NAME = 'TerrainMap'
TERRAIN_HEIGHT_PACKAGE_MISSING_REASON = 'terrain-height-package-missing'
ELIGIBLE_GAP_ROW_STATUS = 'pending'
ELIGIBLE_GAP_ROW_REASON = 'step-pending:raw'


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


def terrain_map_package_record(basis, terrain_map_object, package_path, header):
    return {'basis': basis, 'object': terrain_map_object, 'path': package_path,
            'packageVersion': header.get('packageVersion'), 'licensee': header.get('licensee')}


def terrain_height_gate_from_header(package_path, header):
    if 'error' in header:
        raise TileCensusError(f'terrain height package {package_path} header is unreadable ({header["error"]}); no listed gap reason covers it')
    if header['packageVersion'] != SUPPORTED_PACKAGE_VERSION:
        return GATE_FAIL, f'terrain-height-version-unsupported:{header["packageVersion"]}'
    if header['licensee'] != SUPPORTED_PACKAGE_LICENSEE:
        return GATE_FAIL, f'terrain-height-licensee-unsupported:{SUPPORTED_PACKAGE_VERSION}/{header["licensee"]}'
    return GATE_PASS, None


def terrain_height_gate_by_package_name(client_access, lock_records, tile_id):
    terrain_package_path = TERRAIN_HEIGHT_PACKAGE_PATH_FORMAT.format(tile_id=tile_id)
    lock_path = min((path for path in lock_records if path.casefold() == terrain_package_path.casefold()), default=None)
    if lock_path is None:
        return GATE_MISSING, TERRAIN_HEIGHT_PACKAGE_MISSING_REASON, terrain_map_package_record(PACKAGE_NAME_TERRAIN_MAP_BASIS, None, None, {})
    header = read_package_header(client_access, lock_path)
    gate, reason = terrain_height_gate_from_header(lock_path, header)
    return gate, reason, terrain_map_package_record(PACKAGE_NAME_TERRAIN_MAP_BASIS, None, lock_path, header)


def lock_height_package_paths_with_stem(lock_records, package_stem):
    return [path for path in casefolded_unique_paths(lock_records) if path.casefold().endswith(TERRAIN_HEIGHT_PACKAGE_SUFFIX)
            and PurePosixPath(path).stem.casefold() == package_stem.casefold()]


def declared_terrain_map_package(client_access, lock_records, map_relative_path):
    map_path = client_access.require_equal_file(map_relative_path)
    package = Package(map_path.read_bytes(), PurePosixPath(map_relative_path).name)
    terrain_infos = [item for item in package.exports if item['classObject'] == TERRAIN_INFO_CLASS_OBJECT]
    if not terrain_infos:
        return None
    if len(terrain_infos) > 1:
        raise TileCensusError(f'map {map_relative_path} holds {len(terrain_infos)} {TERRAIN_INFO_CLASS_OBJECT} exports '
                              f'({", ".join(item["object"] for item in terrain_infos)}); the census does not pick one')
    properties = actor_properties(package, terrain_infos[0])[0]
    terrain_map = property_value([decode_property(package, prop, map_relative_path) for prop in properties
                                  if prop['name'] == TERRAIN_MAP_PROPERTY_NAME], TERRAIN_MAP_PROPERTY_NAME)
    if terrain_map is None or terrain_map['object'] is None:
        return None
    candidate_paths = lock_height_package_paths_with_stem(lock_records, terrain_map['object'].split('.', 1)[0])
    return {'object': terrain_map['object'], 'path': candidate_paths[0] if len(candidate_paths) == 1 else None}


def terrain_height_gate_from_declared_package(client_access, declaration):
    if declaration is None:
        return GATE_MISSING, TERRAIN_HEIGHT_PACKAGE_MISSING_REASON, terrain_map_package_record(DECLARED_TERRAIN_MAP_BASIS, None, None, {})
    if declaration['path'] is None:
        return (GATE_MISSING, TERRAIN_HEIGHT_PACKAGE_MISSING_REASON,
                terrain_map_package_record(DECLARED_TERRAIN_MAP_BASIS, declaration['object'], None, {}))
    header = read_package_header(client_access, declaration['path'])
    gate, reason = terrain_height_gate_from_header(declaration['path'], header)
    return gate, reason, terrain_map_package_record(DECLARED_TERRAIN_MAP_BASIS, declaration['object'], declaration['path'], header)


def terrain_height_gate_of_readable_tile(client_access, lock_records, map_relative_path):
    try:
        declaration = declared_terrain_map_package(client_access, lock_records, map_relative_path)
    except (FormatError, UnicodeError) as error:
        return GATE_FAIL, f'decode-failed:{error}', terrain_map_package_record(DECLARED_TERRAIN_MAP_BASIS, None, None, {})
    return terrain_height_gate_from_declared_package(client_access, declaration)


def census_row(client_access, lock_records, census_key):
    header = read_package_header(client_access, census_key['map'])
    map_gate, map_reason = map_reader_gate(header)
    if census_key['kind'] == TILE_KIND and map_reason is None:
        terrain_gate, terrain_reason, terrain_map_package = terrain_height_gate_of_readable_tile(client_access, lock_records, census_key['map'])
    elif census_key['kind'] == TILE_KIND:
        terrain_gate, terrain_reason, terrain_map_package = terrain_height_gate_by_package_name(
            client_access, lock_records, census_key['key'].split(':', 1)[1])
    elif map_reason is None:
        raise TileCensusError(f'non-tile map {census_key["map"]} passes the map reader gate; no listed status covers a non-tile map that reads')
    else:
        terrain_gate, terrain_reason, terrain_map_package = GATE_NOT_APPLICABLE, None, None
    reason = map_reason if map_reason is not None else terrain_reason
    return {**census_key, 'packageVersion': header.get('packageVersion'), 'licensee': header.get('licensee'), 'wrapper': header.get('wrapper'),
            'mapReaderGate': map_gate, 'terrainHeightGate': terrain_gate, 'terrainMapPackage': terrain_map_package,
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
        with lane_coverage_refreshed_at_exit(REPOSITORY_ROOT, WORLD_LANE_NAME):
            write_committed_world_bytes(TILE_CENSUS_RELATIVE_PATH, tile_census_bytes(census))
            write_gap_rows(REPOSITORY_ROOT, WORLD_LANE_NAME, CENSUS_STEP, tile_census_gap_rows(census, client_access.lock.records_by_path))
    except (OSError, ValueError) as error:
        print(f'Tile census failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps(tile_census_summary(census), indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
