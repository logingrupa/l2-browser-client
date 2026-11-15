from collections import Counter
import re

from world.reader_licensee_layouts import G16_HEIGHTMAP_READER, MAP_READERS

TILE_CENSUS_RELATIVE_PATH = 'docs/parts/world/tile-census.json'
TILE_CENSUS_SCHEMA_VERSION = 1
EXPECTED_TILE_MAP_COUNT = 153
EXPECTED_NON_TILE_MAP_COUNT = 10
TILE_KIND = 'tile'
NON_TILE_KIND = 'non-tile'
GATE_PASS = 'pass'
GATE_FAIL = 'fail'
GATE_MISSING = 'missing'
GATE_NOT_APPLICABLE = 'not-applicable'
TILE_TERRAIN_HEIGHT_GATES = (GATE_PASS, GATE_FAIL, GATE_MISSING)
DECLARED_TERRAIN_MAP_BASIS = 'TerrainInfo.TerrainMap'
PACKAGE_NAME_TERRAIN_MAP_BASIS = 'package-name'
TERRAIN_MAP_PACKAGE_FIELDS = frozenset({'basis', 'object', 'path', 'packageVersion', 'licensee'})
ELIGIBLE_STATUS = 'eligible'
GAP_STATUS = 'gap'
CENSUS_ROW_FIELDS = ('map', 'kind', 'key', 'packageVersion', 'licensee', 'wrapper', 'mapReaderGate', 'terrainHeightGate',
                     'terrainMapPackage', 'status', 'reason')
CENSUS_FIELDS = frozenset({'schemaVersion', 'referenceTreeLockSha256', 'reviewedReaderPairs', 'maps'})
CENSUS_READER_NAMES = (G16_HEIGHTMAP_READER, *MAP_READERS)
SHA256_TEXT_PATTERN = re.compile(r'[0-9a-f]{64}')


class TileCensusError(ValueError):
    pass


def require_reviewed_reader_pairs(reviewed_reader_pairs):
    if not (isinstance(reviewed_reader_pairs, dict) and sorted(reviewed_reader_pairs) == sorted(CENSUS_READER_NAMES)):
        raise TileCensusError(f'tile census reviewedReaderPairs must name exactly the readers {", ".join(sorted(CENSUS_READER_NAMES))}')
    for reader, pairs in reviewed_reader_pairs.items():
        if not (isinstance(pairs, list) and all(isinstance(pair, list) and len(pair) == 2 and all(type(value) is int for value in pair)
                                                for pair in pairs)):
            raise TileCensusError(f'tile census reviewedReaderPairs {reader} must be a list of [version, licensee] integer pairs')
        pair_tuples = [tuple(pair) for pair in pairs]
        if pair_tuples != sorted(set(pair_tuples)):
            raise TileCensusError(f'tile census reviewedReaderPairs {reader} must be sorted with one entry per pair')


def reviewed_pair_sets(reviewed_reader_pairs):
    map_pairs = set.intersection(*({tuple(pair) for pair in reviewed_reader_pairs[reader]} for reader in MAP_READERS))
    return map_pairs, {tuple(pair) for pair in reviewed_reader_pairs[G16_HEIGHTMAP_READER]}


def require_terrain_map_package_rules(row, terrain_pairs):
    terrain_map_package = row['terrainMapPackage']
    if row['kind'] == NON_TILE_KIND:
        if terrain_map_package is not None:
            raise TileCensusError(f'tile census row {row["key"]} is a non-tile map but names a terrainMapPackage')
        return
    if not (isinstance(terrain_map_package, dict) and set(terrain_map_package) == TERRAIN_MAP_PACKAGE_FIELDS):
        raise TileCensusError(f'tile census row {row["key"]} terrainMapPackage must hold exactly {", ".join(sorted(TERRAIN_MAP_PACKAGE_FIELDS))}')
    expected_basis = DECLARED_TERRAIN_MAP_BASIS if row['mapReaderGate'] == GATE_PASS else PACKAGE_NAME_TERRAIN_MAP_BASIS
    if terrain_map_package['basis'] != expected_basis:
        raise TileCensusError(f'tile census row {row["key"]} with map gate {row["mapReaderGate"]} must have terrain gate basis {expected_basis}, '
                              f'not {terrain_map_package["basis"]!r}')
    supported_package = (terrain_map_package['packageVersion'], terrain_map_package['licensee']) in terrain_pairs
    if (row['terrainHeightGate'] == GATE_PASS) != (supported_package and terrain_map_package['path'] is not None):
        raise TileCensusError(f'tile census row {row["key"]} terrain gate {row["terrainHeightGate"]} does not fit its height package '
                              f'{terrain_map_package["path"]!r} {terrain_map_package["packageVersion"]}/{terrain_map_package["licensee"]}')


def require_census_row_rules(row, map_pairs, terrain_pairs):
    if not (isinstance(row, dict) and tuple(sorted(row)) == tuple(sorted(CENSUS_ROW_FIELDS))):
        raise TileCensusError(f'tile census row must hold exactly {", ".join(CENSUS_ROW_FIELDS)}: {row!r}')
    if row['kind'] not in (TILE_KIND, NON_TILE_KIND) or row['status'] not in (ELIGIBLE_STATUS, GAP_STATUS):
        raise TileCensusError(f'tile census row {row["key"]} has an unknown kind or status: {row["kind"]!r} {row["status"]!r}')
    allowed_terrain_gates = TILE_TERRAIN_HEIGHT_GATES if row['kind'] == TILE_KIND else (GATE_NOT_APPLICABLE,)
    if row['mapReaderGate'] not in (GATE_PASS, GATE_FAIL) or row['terrainHeightGate'] not in allowed_terrain_gates:
        raise TileCensusError(f'tile census row {row["key"]} has gates {row["mapReaderGate"]!r}/{row["terrainHeightGate"]!r} outside its kind')
    if (row['mapReaderGate'] == GATE_PASS) != ((row['packageVersion'], row['licensee']) in map_pairs):
        raise TileCensusError(f'tile census row {row["key"]} map gate {row["mapReaderGate"]} does not fit its map package '
                              f'{row["packageVersion"]}/{row["licensee"]} and the reviewed map reader pairs')
    require_terrain_map_package_rules(row, terrain_pairs)
    readable_terrain_gate = GATE_PASS if row['kind'] == TILE_KIND else GATE_NOT_APPLICABLE
    both_gates_pass = row['mapReaderGate'] == GATE_PASS and row['terrainHeightGate'] == readable_terrain_gate
    if (row['status'] == ELIGIBLE_STATUS) != both_gates_pass:
        raise TileCensusError(f'tile census row {row["key"]} is {row["status"]} but its gates are {row["mapReaderGate"]}/{row["terrainHeightGate"]}')
    if (row['reason'] is None) != (row['status'] == ELIGIBLE_STATUS):
        raise TileCensusError(f'tile census row {row["key"]} status {row["status"]} does not fit its reason {row["reason"]!r}')


def validate_tile_census(census):
    if not (isinstance(census, dict) and set(census) == CENSUS_FIELDS and census['schemaVersion'] == TILE_CENSUS_SCHEMA_VERSION):
        raise TileCensusError(f'tile census must be schemaVersion {TILE_CENSUS_SCHEMA_VERSION} with exactly {", ".join(sorted(CENSUS_FIELDS))}')
    if not (isinstance(census['referenceTreeLockSha256'], str) and SHA256_TEXT_PATTERN.fullmatch(census['referenceTreeLockSha256'])):
        raise TileCensusError(f'tile census referenceTreeLockSha256 must be 64 lowercase hex characters: {census["referenceTreeLockSha256"]!r}')
    require_reviewed_reader_pairs(census['reviewedReaderPairs'])
    map_pairs, terrain_pairs = reviewed_pair_sets(census['reviewedReaderPairs'])
    rows = census['maps']
    if not isinstance(rows, list):
        raise TileCensusError('tile census maps must be a list')
    for row in rows:
        require_census_row_rules(row, map_pairs, terrain_pairs)
    kind_counts = Counter(row['kind'] for row in rows)
    if (kind_counts[TILE_KIND], kind_counts[NON_TILE_KIND]) != (EXPECTED_TILE_MAP_COUNT, EXPECTED_NON_TILE_MAP_COUNT):
        raise TileCensusError(f'tile census lists {kind_counts[TILE_KIND]} tiles and {kind_counts[NON_TILE_KIND]} non-tile maps, '
                              f'expected {EXPECTED_TILE_MAP_COUNT} and {EXPECTED_NON_TILE_MAP_COUNT}')
    keys = [row['key'] for row in rows]
    if keys != sorted(set(keys)):
        raise TileCensusError('tile census rows must be sorted by key with one row per key')
    return census
