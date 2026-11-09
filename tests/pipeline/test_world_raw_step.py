import contextlib
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_store.gap_rows import read_gap_rows, write_gap_rows
from world import convert_tile
from world.convert_tile import record_tile_step_gap_row
from world.map_actor_properties import HAS_STACK
from world.raw_map_extraction import build_map
from world.raw_map_step import RAW_MAP_STEP_ALGORITHM_VERSION, raw_map_recipe, run_raw_map_step
from reference_client_lock_fixture import lock_client_as_checked_conversion_root
from ue2_package_fixture import compact, package_bytes, tag

TILE_ID = '20_21'
TILE_KEY = 'tile:20_21'
MAP_PATH = 'maps/20_21.unr'
GAP_TILE_ID = '17_23'
GAP_TILE_REASON = 'map-licensee-unsupported:123/25'
UNREVIEWED_MAP_LICENSEE = 27
MESH_PACKAGE_PATH = 'staticmeshes/SyntheticMeshes.usx'
UNIT_STEP_FOLDER = Path('artifacts/lane-store/world/work/tile__20_21/raw')
SYNTHETIC_CENSUS_LOCK_SHA256 = '0' * 64
REAL_CLIENT_ROOT = Path('E:/Lineage2-client')
REAL_TILE_MAP_SHA256 = 'e123be27672ce30235829fc09a3da0aa381e7be14add0fe30ce15f1dd4379f93'
MAP_IMPORTS = [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'StaticMeshActor'),
               ('Core', 'Package', 0, 'SyntheticMeshes'), ('Engine', 'StaticMesh', -3, 'Rock'),
               ('Core', 'Class', -1, 'Brush')]
STATIC_MESH_ACTOR_CLASS_INDEX = -2
ROCK_MESH_IMPORT_INDEX = -4
BRUSH_CLASS_INDEX = -5


def static_mesh_actor_body(location):
    def body(offset, names):
        empty_state_frame = compact(0) + compact(0) + struct.pack('<QI', 0, 0)
        mesh = tag(names, 'StaticMesh', 5, compact(ROCK_MESH_IMPORT_INDEX))
        position = tag(names, 'Location', 10, struct.pack('<3f', *location), 'Vector')
        return empty_state_frame + mesh + position + compact(names['None'])
    return body


def truncated_state_frame_body(offset, names):
    return compact(0)


def terminated_property_body(offset, names):
    return compact(names['None'])


def static_mesh_actor_export(name, body):
    return {'name': name, 'class': STATIC_MESH_ACTOR_CLASS_INDEX, 'flags': HAS_STACK, 'body': body}


def synthetic_map_bytes(exports, licensee=28):
    data = bytearray(package_bytes(['StaticMesh', 'Location', 'Vector'], MAP_IMPORTS, exports))
    struct.pack_into('<H', data, 6, licensee)
    return bytes(data)


def two_actors_sharing_one_mesh():
    return [static_mesh_actor_export('StaticMeshActor0', static_mesh_actor_body((1, 2, 3))),
            static_mesh_actor_export('StaticMeshActor1', static_mesh_actor_body((4, 5, 6)))]


def synthetic_mesh_package_bytes():
    imports = [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'StaticMesh')]
    return package_bytes([], imports, [{'name': 'Rock', 'class': -2, 'body': terminated_property_body}])


def lock_record(sha256):
    return ['equal', 1, sha256, 1, sha256, 0]


def snapshot_of_files(folder):
    return {path.relative_to(folder).as_posix(): (path.stat().st_size, path.stat().st_mtime_ns, hashlib.sha256(path.read_bytes()).hexdigest())
            for path in sorted(folder.rglob('*')) if path.is_file()}


def product_bytes_by_path(folder):
    return {path: digest for path, (_, _, digest) in snapshot_of_files(folder / 'products').items()}


class SyntheticTileTestCase(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.project_root = Path(temporary.name) / 'project'
        self.client = Path(temporary.name) / 'client'
        (self.project_root / 'artifacts').mkdir(parents=True)
        (self.client / 'maps').mkdir(parents=True)
        (self.client / 'staticmeshes').mkdir(parents=True)
        self.step_folder = self.project_root / UNIT_STEP_FOLDER

    def write_client(self, map_exports, licensee=28):
        (self.client / MAP_PATH).write_bytes(synthetic_map_bytes(map_exports, licensee))
        (self.client / MESH_PACKAGE_PATH).write_bytes(synthetic_mesh_package_bytes())
        lock_path = lock_client_as_checked_conversion_root(self, self.client, self.client.parent / 'reference', [MAP_PATH, MESH_PACKAGE_PATH])
        lock = json.loads(lock_path.read_text(encoding='utf-8'))
        lock['files'][f'maps/{GAP_TILE_ID}.unr'] = lock_record('1' * 64)
        lock_path.write_text(json.dumps(lock), encoding='utf-8')
        self.map_sha256 = hashlib.sha256((self.client / MAP_PATH).read_bytes()).hexdigest()
        self.write_census()

    def write_census(self):
        rows = [{'key': f'tile:{GAP_TILE_ID}', 'map': f'maps/{GAP_TILE_ID}.unr', 'status': 'gap', 'reason': GAP_TILE_REASON},
                {'key': TILE_KEY, 'map': MAP_PATH, 'status': 'eligible', 'reason': None}]
        census_path = self.project_root / 'docs/parts/world/tile-census.json'
        census_path.parent.mkdir(parents=True, exist_ok=True)
        census_path.write_text(json.dumps({'schemaVersion': 1, 'referenceTreeLockSha256': SYNTHETIC_CENSUS_LOCK_SHA256, 'maps': rows}),
                               encoding='utf-8')

    def run_step(self, tile_id=TILE_ID):
        return run_raw_map_step(self.project_root, self.client, tile_id)

    def read_product(self, name):
        return json.loads((self.step_folder / 'products' / name).read_text(encoding='utf-8'))

    def read_receipt(self):
        return json.loads((self.step_folder / 'receipt.json').read_text(encoding='utf-8'))


class RawRecipeWithoutSectionTests(SyntheticTileTestCase):
    def test_the_raw_recipe_names_the_tile_map_and_its_lock_hash_without_a_section(self):
        self.assertEqual(raw_map_recipe(TILE_ID, {'eSha256': REAL_TILE_MAP_SHA256}),
                         {'schemaVersion': 1, 'kind': 'native-map-raw', 'map': MAP_PATH, 'sourceSha256': REAL_TILE_MAP_SHA256})

    def test_whole_tile_build_requests_every_mesh_reference_and_reports_whole_tile_coverage(self):
        self.write_client(two_actors_sharing_one_mesh())
        files = {}
        manifest, _ = build_map(self.client, raw_map_recipe(TILE_ID, {'eSha256': self.map_sha256}), files.__setitem__)
        actors = json.loads(files['actors.json'])
        self.assertEqual([actor['object'] for actor in actors], ['20_21.StaticMeshActor0', '20_21.StaticMeshActor1'])
        self.assertTrue(all('sectionOriginSelected' not in actor for actor in actors))
        self.assertEqual(json.loads(files['static-mesh-requests.json']),
                         [{'kind': 'model', 'package': MESH_PACKAGE_PATH, 'object': 'SyntheticMeshes.Rock'}])
        self.assertEqual(json.loads(files['section-bindings.json']),
                         [{'sourceObject': 'SyntheticMeshes.Rock', 'assetId': 'interlude:SyntheticMeshes.Rock',
                           'actors': ['interlude:20_21.StaticMeshActor0', 'interlude:20_21.StaticMeshActor1']}])
        coverage = manifest['coverage']
        self.assertEqual((coverage['staticMeshActorsWithMesh'], coverage['uniqueStaticMeshes'], coverage['staticMeshRequests']), (2, 1, 1))
        for section_counter in ('sectionActors', 'sectionStaticMeshActors', 'sectionUniqueStaticMeshes', 'sectionActorsWithoutSerializedLocation'):
            self.assertNotIn(section_counter, coverage)


class RawMapStepTests(SyntheticTileTestCase):
    def test_an_eligible_tile_writes_products_seals_the_unit_and_returns_a_pass_row(self):
        self.write_client(two_actors_sharing_one_mesh())
        row = self.run_step()
        self.assertEqual(row, {'key': TILE_KEY, 'part': 'world', 'step': 'raw', 'status': 'pass', 'reason': None,
                               'sourceIdentity': {'path': MAP_PATH, 'sha256': self.map_sha256},
                               'evidence': 'work/tile__20_21/raw/receipt.json'})
        receipt = self.read_receipt()
        seal = json.loads((self.step_folder / 'complete.json').read_text(encoding='utf-8'))
        self.assertEqual(seal['fingerprint'], receipt['fingerprint'])
        self.assertEqual(seal['receiptSha256'], hashlib.sha256((self.step_folder / 'receipt.json').read_bytes()).hexdigest())
        self.assertEqual(receipt['algorithmVersion'], RAW_MAP_STEP_ALGORITHM_VERSION)
        self.assertEqual(receipt['inputs'], [{'path': MAP_PATH, 'sha256': self.map_sha256}])
        self.assertEqual(receipt['config'], raw_map_recipe(TILE_ID, {'eSha256': self.map_sha256}))
        self.assertEqual(receipt['gapRows'], [])
        self.assertFalse((self.step_folder / '.running.json').exists())
        output_paths = {output['path'] for output in receipt['outputs']}
        self.assertIn('work/tile__20_21/raw/products/manifest.json', output_paths)
        self.assertIn('work/tile__20_21/raw/products/raw/map.unwrapped.bin', output_paths)
        self.assertEqual(self.read_product('source-dependencies.json'), [
            {'path': MAP_PATH, 'sha256': self.map_sha256, 'bytes': (self.client / MAP_PATH).stat().st_size},
            {'path': MESH_PACKAGE_PATH, 'sha256': hashlib.sha256((self.client / MESH_PACKAGE_PATH).read_bytes()).hexdigest(),
             'bytes': (self.client / MESH_PACKAGE_PATH).stat().st_size}])
        self.assertEqual(len(self.read_product('static-mesh-requests.json')), 1)

    def test_a_sealed_unit_returns_its_pass_row_without_reading_the_client_or_rewriting_a_file(self):
        self.write_client(two_actors_sharing_one_mesh())
        first_row = self.run_step()
        before = snapshot_of_files(self.step_folder)
        with patch('world.raw_map_step.build_map', side_effect=AssertionError('sealed unit rebuilt')) as rebuild:
            self.assertEqual(self.run_step(), first_row)
        rebuild.assert_not_called()
        self.assertEqual(snapshot_of_files(self.step_folder), before)

    def test_a_unit_left_running_without_a_seal_is_cleared_and_redone_with_identical_products(self):
        self.write_client(two_actors_sharing_one_mesh())
        self.run_step()
        first_products = product_bytes_by_path(self.step_folder)
        (self.step_folder / 'complete.json').unlink()
        (self.step_folder / '.running.json').write_text('{}', encoding='utf-8')
        (self.step_folder / 'products/stale-partial.bin').write_bytes(b'interrupted')
        self.assertEqual(self.run_step()['status'], 'pass')
        self.assertTrue((self.step_folder / 'complete.json').is_file())
        self.assertFalse((self.step_folder / '.running.json').exists())
        self.assertEqual(product_bytes_by_path(self.step_folder), first_products)

    def test_a_census_gap_tile_returns_the_census_reason_without_touching_the_client(self):
        self.write_client(two_actors_sharing_one_mesh())
        with patch('world.raw_map_step.build_map', side_effect=AssertionError('client read for a census gap')) as build:
            row = run_raw_map_step(self.project_root, self.client / 'absent-client', GAP_TILE_ID)
        build.assert_not_called()
        self.assertEqual(row, {'key': f'tile:{GAP_TILE_ID}', 'part': 'world', 'step': 'raw', 'status': 'gap', 'reason': GAP_TILE_REASON,
                               'sourceIdentity': {'path': f'maps/{GAP_TILE_ID}.unr', 'sha256': '1' * 64},
                               'evidence': 'docs/parts/world/tile-census.json'})
        self.assertFalse((self.project_root / 'artifacts/lane-store/world/work').exists())

    def test_a_map_at_an_unsupported_licensee_fails_with_its_decode_message_and_no_seal(self):
        self.write_client(two_actors_sharing_one_mesh(), licensee=UNREVIEWED_MAP_LICENSEE)
        row = self.run_step()
        self.assertEqual((row['status'], row['reason']), ('failed', f'decode-failed:map-licensee-unsupported:123/{UNREVIEWED_MAP_LICENSEE}'))
        self.assertFalse((self.step_folder / 'complete.json').exists())

    def test_per_object_decode_errors_stay_in_the_receipt_and_the_step_file_holds_one_row_per_tile(self):
        self.write_client([static_mesh_actor_export('BrokenActor0', truncated_state_frame_body),
                           static_mesh_actor_export('BrokenActor1', truncated_state_frame_body)])
        row = self.run_step()
        self.assertEqual(row['status'], 'pass')
        gap_rows = self.read_receipt()['gapRows']
        self.assertEqual([gap_row['sourceIdentity']['object'] for gap_row in gap_rows], ['20_21.BrokenActor0', '20_21.BrokenActor1'])
        self.assertTrue(all(gap_row['key'] == TILE_KEY and gap_row['status'] == 'gap' and gap_row['reason'].startswith('decode-failed:')
                            for gap_row in gap_rows))
        record_tile_step_gap_row(self.project_root, row)
        self.assertEqual([(gap_row['key'], gap_row['status']) for gap_row in read_gap_rows(self.project_root, 'world')], [(TILE_KEY, 'pass')])

    def test_a_map_without_static_mesh_actors_gives_empty_requests_and_a_pass_row(self):
        self.write_client([{'name': 'Brush0', 'class': BRUSH_CLASS_INDEX, 'body': terminated_property_body}])
        self.assertEqual(self.run_step()['status'], 'pass')
        self.assertEqual(self.read_product('static-mesh-requests.json'), [])
        self.assertEqual(self.read_product('section-bindings.json'), [])


class TileStepGapRowRecorderTests(SyntheticTileTestCase):
    def row(self, key, status, reason):
        return {'key': key, 'part': 'world', 'step': 'raw', 'status': status, 'reason': reason,
                'sourceIdentity': {'path': 'maps/20_20.unr', 'sha256': '2' * 64}, 'evidence': 'docs/parts/world/tile-census.json'}

    def test_recording_a_tile_row_keeps_other_tiles_and_replaces_only_its_own_row(self):
        census_row = {**self.row('tile:20_20', 'pending', 'step-pending:raw'), 'step': 'census'}
        write_gap_rows(self.project_root, 'world', 'census', [census_row])
        write_gap_rows(self.project_root, 'world', 'raw', [self.row('tile:20_20', 'pass', None),
                                                         self.row(TILE_KEY, 'failed', 'decode-failed:earlier attempt')])
        record_tile_step_gap_row(self.project_root, self.row(TILE_KEY, 'pass', None))
        rows = read_gap_rows(self.project_root, 'world')
        self.assertEqual([(row['key'], row['step'], row['status']) for row in rows],
                         [('tile:20_20', 'census', 'pending'), ('tile:20_20', 'raw', 'pass'), (TILE_KEY, 'raw', 'pass')])


class ConvertTileCommandTests(SyntheticTileTestCase):
    def run_command(self, arguments):
        output = io.StringIO()
        with patch.object(convert_tile, 'REPOSITORY_ROOT', self.project_root), \
                patch.object(convert_tile, 'require_batch_preflight') as preflight, \
                patch.object(convert_tile, 'run_at_below_normal_priority') as priority, \
                contextlib.redirect_stdout(output):
            exit_code = convert_tile.main(arguments)
        preflight.assert_called_once()
        priority.assert_called_once()
        return exit_code, json.loads(output.getvalue())

    def test_the_command_records_the_step_row_and_exits_one_on_a_failed_tile(self):
        self.write_client(two_actors_sharing_one_mesh(), licensee=UNREVIEWED_MAP_LICENSEE)
        exit_code, printed_rows = self.run_command(['--client', str(self.client), '--map', TILE_ID, '--step', 'raw'])
        self.assertEqual((exit_code, [row['status'] for row in printed_rows]), (1, ['failed']))
        self.assertEqual(read_gap_rows(self.project_root, 'world'), printed_rows)

    def test_the_command_refuses_a_map_argument_that_is_not_a_tile_id(self):
        self.write_client(two_actors_sharing_one_mesh())
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            convert_tile.main(['--client', str(self.client), '--map', '../20_21', '--step', 'raw'])


@unittest.skipUnless((REAL_CLIENT_ROOT / MAP_PATH).is_file(), 'the conversion client E:/Lineage2-client is absent on this host')
@unittest.skipUnless((ROOT / UNIT_STEP_FOLDER / 'complete.json').is_file(), 'the real 20_21 raw unit has not been sealed in this checkout')
class RealTileRawUnitTests(unittest.TestCase):
    def test_the_sealed_20_21_unit_returns_pass_with_its_lock_identity_and_whole_terrain(self):
        with patch('world.raw_map_step.build_map', side_effect=AssertionError('sealed 20_21 unit rebuilt')):
            row = run_raw_map_step(ROOT, REAL_CLIENT_ROOT, TILE_ID)
        self.assertEqual(row['status'], 'pass')
        step_folder = ROOT / UNIT_STEP_FOLDER
        receipt_bytes = (step_folder / 'receipt.json').read_bytes()
        receipt = json.loads(receipt_bytes)
        seal = json.loads((step_folder / 'complete.json').read_text(encoding='utf-8'))
        self.assertEqual(seal['receiptSha256'], hashlib.sha256(receipt_bytes).hexdigest())
        self.assertEqual(seal['fingerprint'], receipt['fingerprint'])
        self.assertEqual(receipt['inputs'], [{'path': MAP_PATH, 'sha256': REAL_TILE_MAP_SHA256}])
        coverage = json.loads((step_folder / 'products/manifest.json').read_text(encoding='utf-8'))['coverage']
        self.assertEqual((coverage['terrainInfosDecoded'], coverage['terrainHeightsDecoded']), (1, 1))
        self.assertEqual(coverage['exportsPreservedRaw'], coverage['exports'])


if __name__ == '__main__':
    unittest.main()
