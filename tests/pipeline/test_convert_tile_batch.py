import contextlib
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib.gltf import json_bytes
from native_store.gap_rows import read_gap_rows
from native_store.store_paths import lane_work_root
from native_store.unit_ledger import (RUNNING_MARKER_NAME, SEAL_RECORD_NAME, FreeDiskFloorRefusedError, MachineWindowRefusedError,
                                      UnitLedger)
from world import convert_tile_batch
from world.convert_tile_batch import (BATCH_EXIT_DISK_FLOOR, BATCH_EXIT_DONE, BATCH_EXIT_ERROR, BATCH_EXIT_MACHINE_WINDOW,
                                      NOTHING_TO_DO_MESSAGE, TileBatchUsageError, run_tile_batch)
from world.eligible_tile_selection import SealedTileStep, select_eligible_tiles, step_level_rows
from world.raw_map_step import tile_step_row
from world.tile_census_validation import TILE_CENSUS_RELATIVE_PATH, TileCensusError
from world.tile_step_registry import TILE_STEP_NAMES

SYNTHETIC_STEP_NAMES = ('raw', 'chunks', 'meshes', 'manifest')
SYNTHETIC_MAP_SHA256 = 'a' * 64
SYNTHETIC_ALGORITHM_VERSION = 1
FIRST_TILE_COLUMN = 10
TILE_COLUMN_COUNT = 17
TILE_ROW_COUNT = 9
NON_TILE_MAP_COUNT = 10
SYNTHETIC_OBJECT_GAP_REASON = 'decode-failed:synthetic unreadable object'
WORLD_GAP_ROWS_FOLDER = Path('artifacts/lane-store/world/gap-rows')


class SimulatedProcessKill(BaseException):
    pass


def census_tile_ids():
    return [f'{column:02d}_{row:02d}' for column in range(FIRST_TILE_COLUMN, FIRST_TILE_COLUMN + TILE_COLUMN_COUNT)
            for row in range(FIRST_TILE_COLUMN, FIRST_TILE_COLUMN + TILE_ROW_COUNT)]


def eligible_census_row(tile_id):
    return {'map': f'maps/{tile_id}.unr', 'kind': 'tile', 'key': f'tile:{tile_id}', 'packageVersion': 123, 'licensee': 28,
            'wrapper': 'UnrealPackage', 'mapReaderGate': 'pass', 'terrainHeightGate': 'pass',
            'terrainMapPackage': {'basis': 'TerrainInfo.TerrainMap', 'object': 'Terrain.Height', 'path': f'textures/T_{tile_id}.utx',
                                  'packageVersion': 123, 'licensee': 28},
            'status': 'eligible', 'reason': None}


def gap_census_row(key, map_path, kind):
    terrain_map_package = None if kind == 'non-tile' else {'basis': 'package-name', 'object': None, 'path': None, 'packageVersion': None,
                                                             'licensee': None}
    return {'map': map_path, 'kind': kind, 'key': key, 'packageVersion': 118, 'licensee': 0, 'wrapper': 'UnrealPackage',
            'mapReaderGate': 'fail', 'terrainHeightGate': 'not-applicable' if kind == 'non-tile' else 'missing',
            'terrainMapPackage': terrain_map_package, 'status': 'gap', 'reason': 'map-version-unsupported:118'}


def synthetic_census(eligible_tile_ids, schema_version=1):
    tile_rows = [eligible_census_row(tile_id) if tile_id in eligible_tile_ids else gap_census_row(f'tile:{tile_id}', f'maps/{tile_id}.unr', 'tile')
                 for tile_id in census_tile_ids()]
    non_tile_rows = [gap_census_row(f'map:Synthetic{index}', f'maps/Synthetic{index}.unr', 'non-tile') for index in range(NON_TILE_MAP_COUNT)]
    return {'schemaVersion': schema_version, 'referenceTreeLockSha256': 'b' * 64,
            'maps': sorted([*non_tile_rows, *tile_rows], key=lambda row: row['key'])}


def synthetic_source_identity(tile_id):
    return {'path': f'maps/{tile_id}.unr', 'sha256': SYNTHETIC_MAP_SHA256}


class LedgerBackedSteps:
    def __init__(self, project_root, failing=(), object_gaps=None, killed_at=None):
        self.project_root, self.failing, self.object_gaps, self.killed_at = project_root, set(failing), object_gaps or {}, killed_at
        self.calls, self.begun = [], []

    def ledger(self, step):
        return UnitLedger(lane_work_root(self.project_root, 'world'), step, SYNTHETIC_ALGORITHM_VERSION)

    def __call__(self, step, tile_id):
        self.calls.append((tile_id, step))
        ledger, unit_key = self.ledger(step), f'tile:{tile_id}'
        fingerprint = ledger.unit_fingerprint([SYNTHETIC_MAP_SHA256], {'tile': tile_id})
        receipt_evidence = f'work/tile__{tile_id}/{step}/receipt.json'
        if ledger.is_sealed(unit_key, fingerprint):
            return [tile_step_row(tile_id, step, 'pass', None, synthetic_source_identity(tile_id), receipt_evidence)]
        if (tile_id, step) in self.failing:
            raise ValueError('synthetic decode failure\nsecond line')
        self.begun.append((tile_id, step))
        step_directory = ledger.begin(unit_key, fingerprint)
        if (tile_id, step) == self.killed_at:
            raise SimulatedProcessKill()
        product_path = step_directory / 'product.json'
        product_bytes = json_bytes({'tile': tile_id, 'step': step})
        product_path.write_bytes(product_bytes)
        object_gap_rows = [tile_step_row(tile_id, step, 'gap', SYNTHETIC_OBJECT_GAP_REASON,
                                         {**synthetic_source_identity(tile_id), 'object': f'Synthetic.Object{index}'}, receipt_evidence)
                           for index in range(self.object_gaps.get((tile_id, step), 0))]
        ledger.seal(unit_key, fingerprint, {
            'config': {'tile': tile_id}, 'inputs': [synthetic_source_identity(tile_id)], 'gapRows': object_gap_rows,
            'outputs': [{'path': product_path.relative_to(ledger.lane_folder).as_posix(),
                         'sha256': hashlib.sha256(product_bytes).hexdigest(), 'bytes': len(product_bytes)}]})
        return [tile_step_row(tile_id, step, 'pass', None, synthetic_source_identity(tile_id), receipt_evidence)]


class RecordingPreflight:
    def __init__(self, refusals=None):
        self.refusals, self.calls = dict(refusals or {}), 0

    def __call__(self):
        self.calls += 1
        refusal = self.refusals.pop(self.calls, None)
        if refusal is not None:
            raise refusal
        return {'rigaTime': '2026-11-10T12:00:00+02:00', 'freeBytes': 10 * 1024 ** 3}


class TileBatchTestCase(unittest.TestCase):
    eligible_tile_ids = ('10_11', '12_13', '14_15')

    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve() / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        census_path = self.project_root / TILE_CENSUS_RELATIVE_PATH
        census_path.parent.mkdir(parents=True)
        census_path.write_text(json.dumps(synthetic_census(self.eligible_tile_ids)), encoding='utf-8')

    def run_batch(self, steps, limit=1, preflight=None, step_names=SYNTHETIC_STEP_NAMES):
        return run_tile_batch(self.project_root, limit, steps, preflight or RecordingPreflight(), step_names=step_names,
                              tile_source_identity=synthetic_source_identity)

    def rows_by_tile_and_step(self):
        return {(row['key'], row['step']): row for row in read_gap_rows(self.project_root, 'world')}

    def gap_row_file_bytes(self):
        return {path.name: path.read_bytes() for path in sorted((self.project_root / WORLD_GAP_ROWS_FOLDER).glob('*.json'))}


class EligibleTileSelectionTests(unittest.TestCase):
    def test_selects_eligible_tile_rows_in_census_order(self):
        self.assertEqual(select_eligible_tiles(synthetic_census({'14_15', '10_11', '12_13'})), ['10_11', '12_13', '14_15'])

    def test_refuses_a_census_whose_schema_version_is_not_one(self):
        with self.assertRaises(TileCensusError):
            select_eligible_tiles(synthetic_census({'10_11'}, schema_version=2))

    def test_refuses_an_eligible_row_that_names_another_map(self):
        census = synthetic_census({'10_11'})
        [row] = [row for row in census['maps'] if row['key'] == 'tile:10_11']
        row['map'] = 'maps/10_12.unr'
        with self.assertRaises(TileCensusError):
            select_eligible_tiles(census)

    def test_step_level_rows_from_seals_and_unreached_steps(self):
        identity = synthetic_source_identity('10_11')
        object_row = tile_step_row('10_11', 'meshes', 'gap', SYNTHETIC_OBJECT_GAP_REASON, {**identity, 'object': 'Synthetic.Rock'}, 'evidence.json')
        step_row = tile_step_row('10_11', 'chunks', 'gap', 'bsp-chunk-without-nodes', identity, 'evidence.json')
        rows = step_level_rows('10_11', identity, ('raw', 'chunks', 'meshes', 'manifest'), {}, {
            'raw': SealedTileStep([], 'work/tile__10_11/raw/receipt.json'),
            'chunks': SealedTileStep([step_row], 'work/tile__10_11/chunks/receipt.json'),
            'meshes': SealedTileStep([object_row, object_row], 'work/tile__10_11/meshes/receipt.json')})
        self.assertEqual([(row['step'], row['status'], row['reason']) for row in rows],
                         [('raw', 'pass', None), ('chunks', 'gap', 'bsp-chunk-without-nodes'), ('meshes', 'gap', 'object-gaps:2'),
                          ('manifest', 'pending', 'batch-pending')])
        self.assertTrue(all('object' not in row['sourceIdentity'] for row in rows))
        self.assertEqual(rows[3]['evidence'], TILE_CENSUS_RELATIVE_PATH)


class TileBatchOrderTests(TileBatchTestCase):
    def test_runs_registry_steps_in_order_on_the_first_unsealed_tile_and_marks_the_rest_pending(self):
        steps = LedgerBackedSteps(self.project_root, object_gaps={('10_11', 'meshes'): 3})
        outcome = self.run_batch(steps)
        self.assertEqual(outcome.exit_code, BATCH_EXIT_DONE)
        self.assertEqual(outcome.attempted_tile_ids, ['10_11'])
        self.assertEqual(steps.calls, [('10_11', step) for step in SYNTHETIC_STEP_NAMES])
        rows = self.rows_by_tile_and_step()
        self.assertEqual(len(rows), len(self.eligible_tile_ids) * len(SYNTHETIC_STEP_NAMES))
        self.assertEqual(rows[('tile:10_11', 'meshes')]['reason'], 'object-gaps:3')
        self.assertEqual(rows[('tile:10_11', 'raw')]['status'], 'pass')
        self.assertEqual({rows[('tile:12_13', step)]['reason'] for step in SYNTHETIC_STEP_NAMES}, {'batch-pending'})

    def test_a_sealed_tile_is_not_counted_and_none_of_its_steps_run_again(self):
        steps = LedgerBackedSteps(self.project_root)
        self.run_batch(steps)
        steps.calls.clear()
        outcome = self.run_batch(steps)
        self.assertEqual(outcome.attempted_tile_ids, ['12_13'])
        self.assertEqual(steps.calls, [('12_13', step) for step in SYNTHETIC_STEP_NAMES])
        self.assertEqual(self.rows_by_tile_and_step()[('tile:10_11', 'manifest')]['status'], 'pass')

    def test_a_partly_sealed_tile_reruns_only_its_unsealed_units(self):
        steps = LedgerBackedSteps(self.project_root)
        for step in ('raw', 'chunks'):
            steps(step, '10_11')
        steps.begun.clear()
        self.run_batch(steps)
        self.assertEqual(steps.begun, [('10_11', 'meshes'), ('10_11', 'manifest')])

    def test_a_raising_step_fails_its_row_cascades_pending_and_the_next_tile_runs(self):
        steps = LedgerBackedSteps(self.project_root, failing={('10_11', 'chunks')})
        outcome = self.run_batch(steps, limit=2)
        self.assertEqual(outcome.attempted_tile_ids, ['10_11', '12_13'])
        rows = self.rows_by_tile_and_step()
        self.assertEqual((rows[('tile:10_11', 'chunks')]['status'], rows[('tile:10_11', 'chunks')]['reason']),
                         ('failed', 'decode-failed:ValueError:synthetic decode failure'))
        self.assertEqual(rows[('tile:10_11', 'meshes')]['reason'], 'upstream-step-failed:chunks')
        self.assertIn(('10_11', 'manifest'), steps.calls)
        self.assertNotIn(('10_11', 'meshes'), steps.calls)
        self.assertEqual(rows[('tile:12_13', 'manifest')]['status'], 'pass')

    def test_a_recorded_failure_settles_its_tile_until_the_failed_step_seals(self):
        steps = LedgerBackedSteps(self.project_root, failing={('10_11', 'chunks')})
        self.run_batch(steps)
        failed_rows = self.gap_row_file_bytes()
        steps.calls.clear()
        outcome = self.run_batch(steps)
        self.assertEqual(outcome.attempted_tile_ids, ['12_13'])
        self.assertNotIn(('10_11', 'chunks'), steps.calls)
        self.assertEqual(self.rows_by_tile_and_step()[('tile:10_11', 'chunks')]['reason'], 'decode-failed:ValueError:synthetic decode failure')
        self.assertNotEqual(self.gap_row_file_bytes(), failed_rows)
        steps.failing.clear()
        steps('chunks', '10_11')
        retried = self.run_batch(steps)
        self.assertEqual(retried.attempted_tile_ids, ['10_11'])
        self.assertEqual(self.rows_by_tile_and_step()[('tile:10_11', 'manifest')]['status'], 'pass')

    def test_two_runs_over_the_same_sealed_state_write_byte_identical_rows(self):
        steps = LedgerBackedSteps(self.project_root, object_gaps={('10_11', 'raw'): 1})
        self.run_batch(steps, limit=3)
        first_bytes = self.gap_row_file_bytes()
        self.run_batch(steps, limit=3)
        self.assertEqual(self.gap_row_file_bytes(), first_bytes)
        self.assertEqual(sorted(first_bytes), sorted(f'{step}.json' for step in SYNTHETIC_STEP_NAMES))

    def test_refuses_a_limit_below_one(self):
        with self.assertRaises(TileBatchUsageError):
            self.run_batch(LedgerBackedSteps(self.project_root), limit=0)


class TileBatchInterruptionTests(TileBatchTestCase):
    def test_a_killed_step_leaves_a_running_marker_and_the_next_run_redoes_only_that_step(self):
        steps = LedgerBackedSteps(self.project_root, killed_at=('10_11', 'chunks'))
        with self.assertRaises(SimulatedProcessKill):
            self.run_batch(steps)
        chunks_directory = lane_work_root(self.project_root, 'world') / 'tile__10_11' / 'chunks'
        self.assertTrue((chunks_directory / RUNNING_MARKER_NAME).is_file())
        self.assertFalse((chunks_directory / SEAL_RECORD_NAME).exists())
        steps.killed_at, steps.begun = None, []
        self.run_batch(steps)
        self.assertEqual(steps.begun, [('10_11', 'chunks'), ('10_11', 'meshes'), ('10_11', 'manifest')])

    def assert_refusal_stops_at_the_step_boundary(self, refusal, expected_exit_code):
        steps = LedgerBackedSteps(self.project_root)
        outcome = self.run_batch(steps, preflight=RecordingPreflight({3: refusal}))
        self.assertEqual(outcome.exit_code, expected_exit_code)
        self.assertEqual((outcome.stop.tile_id, outcome.stop.step), ('10_11', 'meshes'))
        self.assertEqual(steps.begun, [('10_11', 'raw'), ('10_11', 'chunks')])
        rows = self.rows_by_tile_and_step()
        self.assertEqual([rows[('tile:10_11', step)]['status'] for step in SYNTHETIC_STEP_NAMES], ['pass', 'pass', 'pending', 'pending'])
        self.assertEqual(len(rows), len(self.eligible_tile_ids) * len(SYNTHETIC_STEP_NAMES))
        steps.begun = []
        resumed = self.run_batch(steps)
        self.assertEqual(resumed.exit_code, BATCH_EXIT_DONE)
        self.assertEqual(steps.begun, [('10_11', 'meshes'), ('10_11', 'manifest')])

    def test_a_machine_window_returns_exit_two_with_sealed_steps_and_flushed_rows(self):
        self.assert_refusal_stops_at_the_step_boundary(MachineWindowRefusedError('inside nightly backup window'), BATCH_EXIT_MACHINE_WINDOW)

    def test_a_disk_floor_refusal_returns_exit_three_the_same_way(self):
        self.assert_refusal_stops_at_the_step_boundary(FreeDiskFloorRefusedError('free disk 1 bytes is below the batch floor'),
                                                       BATCH_EXIT_DISK_FLOOR)


class TileBatchCommandLineTests(TileBatchTestCase):
    eligible_tile_ids = ('10_11',)

    def run_main(self, arguments, step_runner=None):
        printed, errors = io.StringIO(), io.StringIO()
        refused_step_runner = step_runner or (lambda *step_arguments: self.fail(f'no step may run: {step_arguments}'))
        with (patch.object(convert_tile_batch, 'REPOSITORY_ROOT', self.project_root),
              patch.object(convert_tile_batch, 'require_reference_client'),
              patch.object(convert_tile_batch, 'world_batch_preflight', lambda project_root: RecordingPreflight()),
              patch.object(convert_tile_batch, 'locked_tile_source_identity', synthetic_source_identity),
              patch.object(convert_tile_batch, 'refresh_world_lane_outputs', lambda project_root: {'refreshed': True}),
              patch.object(convert_tile_batch, 'run_tile_step', refused_step_runner),
              contextlib.redirect_stdout(printed), contextlib.redirect_stderr(errors)):
            exit_code = convert_tile_batch.main(arguments)
        return exit_code, printed.getvalue(), errors.getvalue()

    def test_limit_zero_and_a_missing_eligible_flag_are_usage_errors(self):
        for arguments in (['--eligible', '--limit', '0'], ['--limit', '1']):
            with self.subTest(arguments=arguments):
                exit_code, _, errors = self.run_main(arguments)
                self.assertEqual(exit_code, BATCH_EXIT_ERROR)
                self.assertIn('error:', errors)

    def test_a_census_with_every_eligible_tile_sealed_prints_nothing_to_do_and_exits_zero(self):
        steps = LedgerBackedSteps(self.project_root)
        for step in TILE_STEP_NAMES:
            steps(step, '10_11')
        exit_code, printed, _ = self.run_main(['--eligible', '--limit', '1'])
        self.assertEqual(exit_code, BATCH_EXIT_DONE)
        self.assertTrue(printed.startswith(NOTHING_TO_DO_MESSAGE))
        self.assertEqual(json.loads(printed[len(NOTHING_TO_DO_MESSAGE):])['laneOutputs'], {'refreshed': True})

    def test_a_machine_window_skips_the_lane_catalog_refresh(self):
        machine_window_preflight = RecordingPreflight({1: MachineWindowRefusedError('inside nightly backup window')})
        with patch.object(convert_tile_batch, 'world_batch_preflight', lambda project_root: machine_window_preflight):
            with (patch.object(convert_tile_batch, 'REPOSITORY_ROOT', self.project_root),
                  patch.object(convert_tile_batch, 'require_reference_client'),
                  patch.object(convert_tile_batch, 'locked_tile_source_identity', synthetic_source_identity),
                  patch.object(convert_tile_batch, 'refresh_world_lane_outputs', lambda project_root: self.fail('refresh in a machine window')),
                  contextlib.redirect_stdout(io.StringIO()) as printed):
                exit_code = convert_tile_batch.main(['--eligible', '--limit', '1'])
        self.assertEqual(exit_code, BATCH_EXIT_MACHINE_WINDOW)
        self.assertIsNone(json.loads(printed.getvalue())['laneOutputs'])


if __name__ == '__main__':
    unittest.main()
