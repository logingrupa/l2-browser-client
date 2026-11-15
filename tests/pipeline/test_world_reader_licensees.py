import copy
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from data.pinned_elbera_module import ELBERA_ROOT, PinnedElberaModuleError, resolve_elbera_path
from native_assets_lib.lineage_material_prefix import lineage_material_prefix
from native_catalog.ue2 import FormatError, Package
from world.raw_map_extraction import build_map
from reference_client_guard import ReferenceClientLockError, require_reference_client
from world import elbera_reader_cross_check
from world.elbera_reader_cross_check import (ElberaCrossCheckError, elbera_actor_properties, elbera_terrain_sector_properties,
                                             elbera_texture_mip_bytes, elbera_tool_record)
from world.map_actor_properties import actor_properties, decode_property, property_value
from world.map_sources import MapSources
from world.native_terrain_sectors import native_terrain
from native_store.store_paths import lane_work_root
from native_store.unit_ledger import (BATCH_MINIMUM_FREE_BYTES, BatchPreflightRefusedError, UnitLedger, require_batch_preflight,
                                      run_at_below_normal_priority)
from world.raw_map_step import (RAW_MAP_STEP_ALGORITHM_VERSION, RAW_STEP_NAME, SOURCE_DEPENDENCIES_PRODUCT_NAME, raw_map_recipe,
                                read_tile_map_lock_record)
from world.reader_cross_check_rows import (build_map_into_temporary_directory, canonical_json_sha256, declared_terrain_map_reference,
                                           our_actor_property_projection, our_terrain_sector_projection, read_cross_check_rows,
                                           reader_cross_check_row)
from world.tile_census import WORLD_LANE_NAME
from world.reader_licensee_layouts import (BASELINE_LICENSEE, G16_HEIGHTMAP_READER, MAP_ACTOR_READER, MAP_READERS, RAW_MAP_READER,
                                           READER_LICENSEE_LAYOUTS, REVIEWED_PACKAGE_VERSION, TERRAIN_INFO_READER,
                                           require_reviewed_reader_layout, reviewed_reader_pairs)
from world.terrain_height_texture import read_g16
from reference_client_lock_fixture import lock_client_as_checked_conversion_root
from world_reader_fixture_packages import (g16_heightmap_package_bytes, map_package_bytes, read_world_reader_fixture,
                                           world_reader_fixture_names)

EVIDENCE_FIELDS = {'source', 'commit', 'file', 'sha256', 'section'}
SHA256_PATTERN = re.compile(r'^[0-9a-f]{64}$')
ELBERA_SOURCE_NAME = 'Elbera'
SYNTHETIC_TERRAIN_PACKAGE = 'textures/T_FixtureTerrain.utx'
SYNTHETIC_TERRAIN_OBJECT = 'T_FixtureTerrain.HeightFixture'
BOUNDARY_LICENSEE_RANGE = range(0, 32)
GATE_FILES = ('scripts/world/raw_map_extraction.py', 'scripts/world/terrain_height_texture.py', 'scripts/world/map_actor_properties.py',
              'scripts/world/native_terrain_sectors.py')
SCATTERED_LICENSEE_CHECK = re.compile(r"\(123, ?28\)|licenseeVersion'\]\)? *(==|!=)")
REAL_CLIENT_ROOT = Path('E:/Lineage2-client')
SEALED_RAW_UNIT = Path('artifacts/lane-store/world/work/tile__20_21/raw')
SEALED_PRODUCTS_PREFIX = 'work/tile__20_21/raw/products/'


def expected_gap_reason(reader, licensee):
    prefix = 'terrain-height-licensee-unsupported' if reader == G16_HEIGHTMAP_READER else 'map-licensee-unsupported'
    return f'{prefix}:{REVIEWED_PACKAGE_VERSION}/{licensee}'


def package_summary(licensee):
    return {'version': REVIEWED_PACKAGE_VERSION, 'licenseeVersion': licensee}


def reviewed_licensees(reader):
    return {licensee for _, licensee in reviewed_reader_pairs(reader)}


def layout_completeness_problems(layouts, rows):
    problems = []
    rows_by_identity = {(row['reader'], row['version'], row['licensee']): row for row in rows}
    for reader, records in layouts.items():
        for (version, licensee), record in records.items():
            label = f'{reader} {version}/{licensee}'
            evidence = record.get('evidence') or []
            if not evidence:
                problems.append(f'{label}: no evidence')
            for entry in evidence:
                if set(entry) != EVIDENCE_FIELDS or not SHA256_PATTERN.fullmatch(entry['sha256']) or not entry['section']:
                    problems.append(f'{label}: incomplete evidence {entry}')
                elif ':' in entry['file'] or entry['file'].startswith('/') or '\\' in entry['file']:
                    problems.append(f'{label}: evidence file is not relative {entry["file"]}')
            if not isinstance(record.get('differencesFrom123_28'), list):
                problems.append(f'{label}: no difference list')
            fixture_path = ROOT / record.get('fixture', 'missing-fixture.json')
            if not fixture_path.is_file():
                problems.append(f'{label}: fixture {record.get("fixture")} is missing')
            else:
                fixture = json.loads(fixture_path.read_text(encoding='utf-8'))
                if (fixture['packageVersion'], fixture['licenseeVersion']) != (version, licensee):
                    problems.append(f'{label}: fixture holds another version or licensee')
            row = rows_by_identity.get((reader, version, licensee))
            if row is None or not row['equal'] or row['ourDecodeSha256'] != row['crossCheckDecodeSha256']:
                problems.append(f'{label}: no equal cross-check row')
            elif row['tile'] != record['crossCheck']['tile'] or row['tool'] != elbera_tool_record():
                problems.append(f'{label}: cross-check row tile or tool differs from the record')
    return problems


class ReaderGateTests(unittest.TestCase):
    def test_terrain_licensee_25_is_reviewed_and_24_and_26_are_refused_with_their_gap_reasons(self):
        record = require_reviewed_reader_layout('g16-heightmap', package_summary(25))
        self.assertIs(record, READER_LICENSEE_LAYOUTS[G16_HEIGHTMAP_READER][(123, 25)])
        for licensee in (24, 26):
            with self.subTest(licensee=licensee), self.assertRaisesRegex(FormatError, f'^terrain-height-licensee-unsupported:123/{licensee}$'):
                require_reviewed_reader_layout('g16-heightmap', package_summary(licensee))

    def test_every_licensee_without_a_record_is_refused_with_the_exact_gap_reason_of_its_reader(self):
        for reader in READER_LICENSEE_LAYOUTS:
            for licensee in BOUNDARY_LICENSEE_RANGE:
                with self.subTest(reader=reader, licensee=licensee):
                    if licensee in reviewed_licensees(reader):
                        self.assertIn('evidence', require_reviewed_reader_layout(reader, package_summary(licensee)))
                    else:
                        with self.assertRaises(FormatError) as raised:
                            require_reviewed_reader_layout(reader, package_summary(licensee))
                        self.assertEqual(str(raised.exception), expected_gap_reason(reader, licensee))

    def test_an_unreviewed_version_names_the_version_and_an_unknown_reader_is_refused(self):
        with self.assertRaisesRegex(FormatError, '^map-version-unsupported:118$'):
            require_reviewed_reader_layout('raw-map', {'version': 118, 'licenseeVersion': 0})
        with self.assertRaisesRegex(FormatError, '^terrain-height-version-unsupported:118$'):
            require_reviewed_reader_layout('g16-heightmap', {'version': 118, 'licenseeVersion': 28})
        with self.assertRaisesRegex(ValueError, 'unknown world reader'):
            require_reviewed_reader_layout('static-mesh', package_summary(28))

    def test_reviewed_pairs_are_sorted_and_always_include_the_baseline(self):
        for reader in READER_LICENSEE_LAYOUTS:
            pairs = reviewed_reader_pairs(reader)
            self.assertEqual(pairs, sorted(pairs))
            self.assertIn((REVIEWED_PACKAGE_VERSION, BASELINE_LICENSEE), pairs)

    def test_no_gate_file_keeps_its_own_licensee_check(self):
        for relative_path in GATE_FILES:
            with self.subTest(path=relative_path):
                self.assertIsNone(SCATTERED_LICENSEE_CHECK.search((ROOT / relative_path).read_text(encoding='utf-8')))


class LayoutEvidenceTests(unittest.TestCase):
    def test_every_reviewed_pair_has_cited_evidence_a_fixture_and_an_equal_cross_check_row(self):
        self.assertEqual(layout_completeness_problems(READER_LICENSEE_LAYOUTS, read_cross_check_rows(ROOT)), [])

    def test_removing_the_evidence_the_fixture_or_the_cross_check_row_of_a_pair_is_detected(self):
        rows = read_cross_check_rows(ROOT)
        pair = (123, 25)
        without_evidence = copy.deepcopy(READER_LICENSEE_LAYOUTS)
        without_evidence[G16_HEIGHTMAP_READER][pair]['evidence'] = []
        without_fixture = copy.deepcopy(READER_LICENSEE_LAYOUTS)
        without_fixture[G16_HEIGHTMAP_READER][pair]['fixture'] = 'tests/fixtures/world-readers/absent.json'
        without_row = [row for row in rows if (row['reader'], row['licensee']) != (G16_HEIGHTMAP_READER, 25)]
        unequal_row = [{**row, 'equal': False} if (row['reader'], row['licensee']) == (G16_HEIGHTMAP_READER, 25) else row for row in rows]
        for name, layouts, cross_check_rows in (('evidence', without_evidence, rows), ('fixture', without_fixture, rows),
                                               ('row', READER_LICENSEE_LAYOUTS, without_row),
                                               ('unequal row', READER_LICENSEE_LAYOUTS, unequal_row)):
            with self.subTest(removed=name):
                self.assertNotEqual(layout_completeness_problems(layouts, cross_check_rows), [])

    def test_heightmap_records_follow_the_cited_lineage_material_prefix_rule(self):
        for (version, licensee), record in READER_LICENSEE_LAYOUTS[G16_HEIGHTMAP_READER].items():
            with self.subTest(licensee=licensee):
                self.assertEqual(record['materialPrefix'], lineage_material_prefix(version, licensee))
                self.assertEqual(record['differencesFrom123_28'] == [],
                                 record['materialPrefix'] == lineage_material_prefix(version, BASELINE_LICENSEE))
        self.assertEqual([lineage_material_prefix(123, licensee) for licensee in (12, 15, 16, 28, 29, 30, 36, 37)],
                         ['none', 'none', 'reserved-int32', 'reserved-int32', 'reserved-int32', 'reserved-int32-and-shader-block',
                          'reserved-int32-and-shader-block', 'none'])

    @unittest.skipUnless(ELBERA_ROOT.is_dir(), 'the pinned Elbera checkout is absent on this host')
    def test_every_cited_elbera_file_matches_its_recorded_sha256(self):
        for reader, records in READER_LICENSEE_LAYOUTS.items():
            for pair, record in records.items():
                for entry in record['evidence']:
                    if entry['source'] == ELBERA_SOURCE_NAME:
                        with self.subTest(reader=reader, pair=pair, file=entry['file']):
                            self.assertEqual(hashlib.sha256(resolve_elbera_path(entry['file']).read_bytes()).hexdigest(), entry['sha256'])

    def test_fixtures_hold_no_binary_runs(self):
        for path in sorted((ROOT / 'tests/fixtures/world-readers').glob('*.json')):
            with self.subTest(path=path.name):
                self.assertIsNone(re.search(r'[A-Fa-f0-9]{129,}|[A-Za-z0-9+/=]{129,}', path.read_text(encoding='utf-8')))


class SyntheticClientTestCase(unittest.TestCase):
    def synthetic_client(self, files):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        client = Path(temporary.name) / 'client'
        for relative_path, payload in files.items():
            (client / relative_path).parent.mkdir(parents=True, exist_ok=True)
            (client / relative_path).write_bytes(payload)
        lock_client_as_checked_conversion_root(self, client, Path(temporary.name) / 'reference', sorted(files))
        return client


class HeightmapFixtureTests(SyntheticClientTestCase):
    def fixture_package(self, fixture, licensee=None):
        package = Package(g16_heightmap_package_bytes(fixture, licensee), fixture['package'])
        return package, package.exports[0]

    def test_each_reviewed_heightmap_fixture_decodes_to_exactly_the_samples_written_into_it(self):
        for name in world_reader_fixture_names('g16-heightmap'):
            fixture = read_world_reader_fixture(name)
            with self.subTest(fixture=name):
                self.assertEqual(fixture['texture']['materialPrefix'], lineage_material_prefix(123, fixture['licenseeVersion']))
                package, item = self.fixture_package(fixture)
                height = read_g16(package, item)
                mip = height['mips'][0]
                self.assertEqual(list(struct.unpack(f'<{len(mip["raw"]) // 2}H', mip['raw'])), fixture['texture']['samples'])
                self.assertEqual((mip['width'], mip['height'], mip['uBits'], mip['vBits']), (4, 4, 2, 2))
                self.assertEqual(height['reservedNativeInt'], fixture['texture']['reservedInt32'])

    def test_the_same_fixture_bytes_under_an_unreviewed_licensee_are_refused(self):
        fixture = read_world_reader_fixture('g16-heightmap-123-25.json')
        for licensee in sorted(set(BOUNDARY_LICENSEE_RANGE) - reviewed_licensees(G16_HEIGHTMAP_READER)):
            with self.subTest(licensee=licensee), self.assertRaisesRegex(FormatError, f'^{expected_gap_reason(G16_HEIGHTMAP_READER, licensee)}$'):
                read_g16(*self.fixture_package(fixture, licensee))

    def test_fixture_bytes_under_a_reviewed_licensee_with_another_prefix_rule_do_not_decode(self):
        for name in world_reader_fixture_names('g16-heightmap'):
            fixture = read_world_reader_fixture(name)
            for _, licensee in reviewed_reader_pairs(G16_HEIGHTMAP_READER):
                if lineage_material_prefix(123, licensee) == fixture['texture']['materialPrefix']:
                    continue
                with self.subTest(fixture=name, licensee=licensee), self.assertRaises(FormatError):
                    read_g16(*self.fixture_package(fixture, licensee))

    @unittest.skipUnless(ELBERA_ROOT.is_dir(), 'the pinned Elbera checkout is absent on this host')
    def test_the_pinned_elbera_reader_decodes_each_fixture_to_the_same_mip_bytes(self):
        for name in world_reader_fixture_names('g16-heightmap'):
            fixture = read_world_reader_fixture(name)
            with self.subTest(fixture=name):
                client = self.synthetic_client({SYNTHETIC_TERRAIN_PACKAGE: g16_heightmap_package_bytes(fixture)})
                mip_bytes = elbera_texture_mip_bytes(require_reference_client(client), SYNTHETIC_TERRAIN_PACKAGE, SYNTHETIC_TERRAIN_OBJECT)
                self.assertEqual(mip_bytes, struct.pack('<16H', *fixture['texture']['samples']))


class MapFixtureTests(SyntheticClientTestCase):
    def map_fixture_client(self, fixture):
        terrain_fixture = read_world_reader_fixture(f'g16-heightmap-123-{BASELINE_LICENSEE}.json')
        return self.synthetic_client({fixture['map']: map_package_bytes(fixture),
                                      SYNTHETIC_TERRAIN_PACKAGE: g16_heightmap_package_bytes(terrain_fixture)})

    def map_package(self, fixture, licensee=None):
        return Package(map_package_bytes(fixture, licensee), Path(fixture['map']).name)

    def assert_actor_properties_decode(self, fixture):
        package = self.map_package(fixture)
        properties, _, state, _ = actor_properties(package, package.exports[0])
        location = decode_property(package, properties[0], 'raw/map.unwrapped.bin')['value']
        self.assertEqual([location[axis] for axis in 'XYZ'], fixture['staticMeshActor']['location'])
        self.assertEqual(state['nodeIndex'], 0)
        self.assertEqual(declared_terrain_map_reference(package), fixture['terrainInfo']['terrainMap'])

    def assert_terrain_info_decodes(self, fixture):
        terrain = fixture['terrainInfo']
        native = native_terrain(self.map_package(fixture))
        self.assertEqual(([native['width'], native['height']], [native['sectorsX'], native['sectorsY']]),
                         (terrain['heightmapSize'], terrain['sectorCounts']))
        self.assertEqual([native['toWorld']['origin'], *native['toWorld']['axes']], terrain['toWorld'])
        self.assertEqual([native['toHeightmap']['origin'], *native['toHeightmap']['axes']], terrain['toHeightmap'])
        self.assertEqual([(sector['offset'], sector['quads'], sector['bounds']) for sector in native['sectors']],
                         [(terrain['sector']['offset'], terrain['sector']['quads'], terrain['sector']['bounds'])])
        self.assertEqual(native['vertexColorsBGRA'], bytes(terrain['vertexColorsBGRA']))

    def assert_raw_map_builds(self, fixture):
        files = {}
        manifest, _ = build_map(self.map_fixture_client(fixture), {'schemaVersion': 1, 'kind': 'native-map-raw', 'map': fixture['map']},
                                files.__setitem__)
        self.assertEqual((manifest['support'], manifest['unsupported']), ('raw-data-extracted', []))
        coverage = manifest['coverage']
        self.assertEqual((coverage['actorsDecoded'], coverage['terrainInfosDecoded'], coverage['terrainHeightsDecoded']), (2, 1, 1))
        material = [export for export in json.loads(files['exports.json'])['exports'] if export['name'] == fixture['materialExport']['name']]
        self.assertEqual(len(material), 1)
        self.assertEqual(material[0]['nativePayload']['bytes'], material[0]['size'])

    def test_each_map_fixture_decodes_exactly_through_every_reader_it_names_and_is_refused_by_the_rest(self):
        decoders = {MAP_ACTOR_READER: self.assert_actor_properties_decode, TERRAIN_INFO_READER: self.assert_terrain_info_decodes,
                    RAW_MAP_READER: self.assert_raw_map_builds}
        for name in world_reader_fixture_names('map'):
            fixture = read_world_reader_fixture(name)
            self.assertEqual(fixture['materialExport']['materialPrefix'], lineage_material_prefix(123, fixture['licenseeVersion']))
            for reader in MAP_READERS:
                with self.subTest(fixture=name, reader=reader):
                    if reader in fixture['readers']:
                        self.assertIn(fixture['licenseeVersion'], reviewed_licensees(reader))
                        decoders[reader](fixture)
                    else:
                        with self.assertRaisesRegex(FormatError, f'^{expected_gap_reason(reader, fixture["licenseeVersion"])}$'):
                            require_reviewed_reader_layout(reader, package_summary(fixture['licenseeVersion']))

    def test_map_fixture_bytes_under_an_unreviewed_licensee_are_refused_by_every_map_reader(self):
        fixture = read_world_reader_fixture(f'map-123-{BASELINE_LICENSEE}.json')
        for licensee in sorted(set(BOUNDARY_LICENSEE_RANGE) - reviewed_licensees(MAP_ACTOR_READER)):
            package = self.map_package(fixture, licensee)
            with self.subTest(licensee=licensee), self.assertRaisesRegex(FormatError, f'^{expected_gap_reason(MAP_ACTOR_READER, licensee)}$'):
                actor_properties(package, package.exports[0])

    @unittest.skipUnless(ELBERA_ROOT.is_dir(), 'the pinned Elbera checkout is absent on this host')
    def test_the_pinned_elbera_reader_agrees_with_our_projection_of_each_map_fixture(self):
        for name in world_reader_fixture_names('map'):
            fixture = read_world_reader_fixture(name)
            with self.subTest(fixture=name):
                access = require_reference_client(self.map_fixture_client(fixture))
                package = self.map_package(fixture)
                self.assertEqual(canonical_json_sha256(our_actor_property_projection(package)),
                                 canonical_json_sha256(elbera_actor_properties(access, fixture['map'])))
                if TERRAIN_INFO_READER in fixture['readers']:
                    self.assertEqual(our_terrain_sector_projection(package), elbera_terrain_sector_properties(access, fixture['map']))


class EmptyExportEdgeTests(SyntheticClientTestCase):
    def test_a_map_without_terrain_info_raises_a_named_error_instead_of_an_empty_pass(self):
        fixture = read_world_reader_fixture(f'map-123-{BASELINE_LICENSEE}.json')
        package = Package(map_package_bytes(fixture, include_terrain_info=False), '90_90.unr')
        with self.assertRaisesRegex(FormatError, 'Expected exactly one Engine.TerrainInfo'):
            native_terrain(package)
        with self.assertRaisesRegex(FormatError, '0 TerrainInfo exports'):
            declared_terrain_map_reference(package)

    @unittest.skipUnless(ELBERA_ROOT.is_dir(), 'the pinned Elbera checkout is absent on this host')
    def test_a_terrain_package_without_the_declared_texture_raises_named_errors_in_both_readers(self):
        fixture = copy.deepcopy(read_world_reader_fixture('g16-heightmap-123-25.json'))
        fixture['texture']['name'] = 'OtherTexture'
        client = self.synthetic_client({SYNTHETIC_TERRAIN_PACKAGE: g16_heightmap_package_bytes(fixture)})
        with self.assertRaisesRegex(FormatError, 'Exact qualified object/class unresolved'):
            MapSources(client).resolve(SYNTHETIC_TERRAIN_OBJECT, 'Texture')
        with self.assertRaisesRegex(ElberaCrossCheckError, 'finds 0 exports named'):
            elbera_texture_mip_bytes(require_reference_client(client), SYNTHETIC_TERRAIN_PACKAGE, SYNTHETIC_TERRAIN_OBJECT)


class ElberaGuardTests(SyntheticClientTestCase):
    def test_the_cross_check_refuses_anything_but_a_guard_access_and_a_confined_relative_path(self):
        fixture = read_world_reader_fixture('g16-heightmap-123-25.json')
        client = self.synthetic_client({SYNTHETIC_TERRAIN_PACKAGE: g16_heightmap_package_bytes(fixture)})
        with self.assertRaisesRegex(ElberaCrossCheckError, 'only through a reference client guard access'):
            elbera_texture_mip_bytes(client, SYNTHETIC_TERRAIN_PACKAGE, SYNTHETIC_TERRAIN_OBJECT)
        with self.assertRaises(ReferenceClientLockError):
            elbera_texture_mip_bytes(require_reference_client(client), (client / SYNTHETIC_TERRAIN_PACKAGE).as_posix(), SYNTHETIC_TERRAIN_OBJECT)

    @unittest.skipUnless(ELBERA_ROOT.is_dir(), 'the pinned Elbera checkout is absent on this host')
    def test_an_elbera_module_off_its_pin_is_refused_before_it_runs(self):
        elbera_reader_cross_check.elbera_ue2package_module.cache_clear()
        self.addCleanup(elbera_reader_cross_check.elbera_ue2package_module.cache_clear)
        wrong_pins = {path: '0' * 64 for path in elbera_reader_cross_check.ELBERA_L2LIB_PINS}
        with patch.dict(elbera_reader_cross_check.ELBERA_L2LIB_PINS, wrong_pins), self.assertRaisesRegex(PinnedElberaModuleError, 'differs from its pin'):
            elbera_reader_cross_check.elbera_ue2package_module()


@unittest.skipUnless((REAL_CLIENT_ROOT / 'maps/20_21.unr').is_file(), 'the conversion client E:/Lineage2-client is absent on this host')
@unittest.skipUnless(ELBERA_ROOT.is_dir(), 'the pinned Elbera checkout is absent on this host')
class RealClientCrossCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            require_batch_preflight(ROOT, WORLD_LANE_NAME, BATCH_MINIMUM_FREE_BYTES)
        except BatchPreflightRefusedError as error:
            raise unittest.SkipTest(f'real-client cross-checks wait for the batch preflight: {error}')
        run_at_below_normal_priority()

    def test_every_recorded_cross_check_row_reproduces_exactly_on_its_tile(self):
        for row in read_cross_check_rows(ROOT):
            with self.subTest(reader=row['reader'], licensee=row['licensee'], tile=row['tile']):
                self.assertEqual(reader_cross_check_row(REAL_CLIENT_ROOT, row['reader'], row['licensee'], row['tile']), row)

    def test_build_map_completes_for_every_heightmap_cross_check_tile_and_decodes_its_height(self):
        for row in read_cross_check_rows(ROOT):
            if row['reader'] != G16_HEIGHTMAP_READER:
                continue
            with self.subTest(licensee=row['licensee'], tile=row['tile']):
                manifest, _ = build_map_into_temporary_directory(REAL_CLIENT_ROOT, row['tile'])
                self.assertEqual(manifest['coverage']['terrainHeightsDecoded'], 1)


@unittest.skipUnless((REAL_CLIENT_ROOT / 'maps/20_21.unr').is_file(), 'the conversion client E:/Lineage2-client is absent on this host')
@unittest.skipUnless((ROOT / SEALED_RAW_UNIT / 'complete.json').is_file(), 'the real 20_21 raw unit has not been sealed in this checkout')
class BaselineRawOutputRegressionTests(unittest.TestCase):
    def test_build_map_on_20_21_writes_the_sealed_raw_products_byte_for_byte_and_keeps_the_fingerprint(self):
        run_at_below_normal_priority()
        receipt = json.loads((ROOT / SEALED_RAW_UNIT / 'receipt.json').read_text(encoding='utf-8'))
        seal = json.loads((ROOT / SEALED_RAW_UNIT / 'complete.json').read_text(encoding='utf-8'))
        lock_record = read_tile_map_lock_record('20_21')
        ledger = UnitLedger(lane_work_root(ROOT, WORLD_LANE_NAME), RAW_STEP_NAME, RAW_MAP_STEP_ALGORITHM_VERSION)
        self.assertEqual(ledger.unit_fingerprint([lock_record['eSha256']], raw_map_recipe('20_21', lock_record)), seal['fingerprint'])
        written = {}
        build_map(REAL_CLIENT_ROOT.resolve(), raw_map_recipe('20_21', lock_record),
                  lambda relative_path, payload: written.__setitem__(relative_path, hashlib.sha256(payload).hexdigest()))
        sealed = {output['path'].removeprefix(SEALED_PRODUCTS_PREFIX): output['sha256'] for output in receipt['outputs']}
        sealed.pop(SOURCE_DEPENDENCIES_PRODUCT_NAME)
        self.assertEqual(written, sealed)


if __name__ == '__main__':
    unittest.main()
