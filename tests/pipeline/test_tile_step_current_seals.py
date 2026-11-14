from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from minimap_route_fixture import seal_synthetic_minimap_route
from tile_step_seal_fixture import (LOCKED_TILE_ID, object_gap_rows, seal_raw_unit, seal_unit, tile_map_inputs, unpinned_music_encoder,
                                    write_single_tile_census)
from native_store.unit_ledger import locked_input_records
from world import convert_tile_batch, eligible_tile_selection, tile_manifest_step, tile_step_current_seals, world_audio_step
from world.bsp_step import BSP_STEP_NAME
from world.bsp_visibility_step import BSP_VISIBILITY_STEP_NAME
from world.collision_step import COLLISION_STEP_NAME
from world.eligible_tile_selection import SealedTileStep, sealed_unit_step
from world.lighting_step import LIGHTING_STEP_NAME
from world.map_emitter_step import MAP_EMITTER_STEP_NAME
from world.minimap_step import MINIMAP_STEP_NAME, minimap_input_records
from world.mover_step import MOVER_STEP_NAME
from world.raw_map_step import (RAW_MAP_STEP_ALGORITHM_VERSION, RAW_STEP_NAME, raw_map_recipe, read_tile_map_lock_record, tile_map_path,
                                tile_step_row, tile_unit_key)
from world.sky_step import SKY_STEP_NAME
from world.static_mesh_step import STATIC_MESH_STEP_NAME
from world.terrain_chunk_step import TERRAIN_STEP_NAME, TerrainChunkStepError
from world.tile_census_validation import TILE_CENSUS_RELATIVE_PATH
from world.tile_chunk_plan import CHUNK_PLAN_STEP_NAME, CHUNK_PLAN_STEP_ALGORITHM_VERSION, ChunkPlanStepError, chunk_plan_unit_config
from world.tile_manifest_step import TILE_MANIFEST_STEP_NAME, tile_manifest_unit_config
from world.tile_music import pinned_music_encoder
from world.tile_step_current_seals import (CURRENT_SEAL_STATE, PENDING_SEAL_STATE, STALE_SEAL_STATE, TILE_STEP_SEAL_CHECKS, UNSEALED_STATE,
                                           unit_step_seal)
from world.tile_step_registry import TILE_STEP_NAMES, TileStepRegistryError, registered_tile_step_names
from world.world_audio_step import WORLD_AUDIO_STEP_NAME, world_audio_unit_config

CURRENT_WORLD_AUDIO_VERSION = 3
CURRENT_UPSTREAM_FINGERPRINT = 'e' * 64
OLDER_UPSTREAM_FINGERPRINT = 'f' * 64
DISCOVERED_INPUT_PATH = 'system/Core.dll'
UNIT_FINGERPRINT_STEP_UNITS = {TERRAIN_STEP_NAME: 'terrain_unit', STATIC_MESH_STEP_NAME: 'static_mesh_unit', COLLISION_STEP_NAME: 'collision_unit',
                               MAP_EMITTER_STEP_NAME: 'map_emitter_unit', BSP_VISIBILITY_STEP_NAME: 'bsp_visibility_unit',
                               LIGHTING_STEP_NAME: 'lighting_unit'}
UPSTREAM_SEALED_TILE_MANIFEST_STEPS = (STATIC_MESH_STEP_NAME, BSP_STEP_NAME, COLLISION_STEP_NAME, MOVER_STEP_NAME, BSP_VISIBILITY_STEP_NAME,
                                       MAP_EMITTER_STEP_NAME, SKY_STEP_NAME, WORLD_AUDIO_STEP_NAME, LIGHTING_STEP_NAME, MINIMAP_STEP_NAME)


def upstream_config(fingerprint):
    return {'upstreamFingerprint': fingerprint}


def unit_with_fingerprint_of(step, config):
    def step_unit(project_root, tile_id, lock_record):
        ledger = TILE_STEP_SEAL_CHECKS[step].step_ledger(project_root)
        return SimpleNamespace(fingerprint=ledger.unit_fingerprint([lock_record['eSha256']], config))
    return step_unit


def raising(error):
    def raise_error(*arguments):
        raise error
    return raise_error


def discovered_inputs(discovered_input_sha256=None):
    discovered_record = locked_input_records([DISCOVERED_INPUT_PATH])[0]
    if discovered_input_sha256 is not None:
        discovered_record = {**discovered_record, 'sha256': discovered_input_sha256}
    return sorted([*tile_map_inputs(LOCKED_TILE_ID), discovered_record], key=lambda record: record['path'])


class CurrentSealTestCase(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve() / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        write_single_tile_census(self.project_root, LOCKED_TILE_ID)
        self.enterContext(unpinned_music_encoder())
        self.enterContext(patch.object(world_audio_step, 'WORLD_AUDIO_STEP_ALGORITHM_VERSION', CURRENT_WORLD_AUDIO_VERSION))
        self.unit_key = tile_unit_key(LOCKED_TILE_ID)

    def seal_state(self, step):
        return unit_step_seal(self.project_root, self.unit_key, step, TILE_STEP_SEAL_CHECKS)

    def current_version(self, step):
        return TILE_STEP_SEAL_CHECKS[step].step_ledger(self.project_root).algorithm_version

    def seal_step(self, step, config, inputs=None, algorithm_version=None):
        return seal_unit(self.project_root, step, algorithm_version or self.current_version(step), self.unit_key, config,
                         inputs or tile_map_inputs(LOCKED_TILE_ID))

    def assert_seal_states(self, step, expected_states):
        self.assertEqual([state for state, _ in expected_states], [expected for _, expected in expected_states], step)


class RegistryCoverageTests(unittest.TestCase):
    def test_every_registered_tile_step_has_one_current_seal_check(self):
        self.assertEqual(set(TILE_STEP_SEAL_CHECKS), set(TILE_STEP_NAMES))
        self.assertEqual(len(TILE_STEP_NAMES), 14)

    def test_a_registered_step_without_a_current_seal_check_refuses_the_registry(self):
        checks_without_sky = {step: check for step, check in TILE_STEP_SEAL_CHECKS.items() if step != SKY_STEP_NAME}
        with self.assertRaises(TileStepRegistryError):
            registered_tile_step_names(checks_without_sky)

    def test_the_version_one_seal_inspection_is_gone(self):
        for module in (eligible_tile_selection, tile_step_current_seals, convert_tile_batch):
            self.assertFalse(hasattr(module, 'seal_inspection_ledger'), module.__name__)
            self.assertFalse(hasattr(module, 'SEAL_INSPECTION_ALGORITHM_VERSION'), module.__name__)


class WorldAudioCurrentSealTests(CurrentSealTestCase):
    def current_world_audio_config(self):
        return world_audio_unit_config(self.project_root, LOCKED_TILE_ID, read_tile_map_lock_record(LOCKED_TILE_ID), pinned_music_encoder())

    def seal_world_audio(self, algorithm_version, config, gap_rows=()):
        seal_unit(self.project_root, WORLD_AUDIO_STEP_NAME, algorithm_version, self.unit_key, config, tile_map_inputs(LOCKED_TILE_ID), gap_rows)

    def test_a_receipt_two_versions_below_the_step_is_stale(self):
        seal_raw_unit(self.project_root, LOCKED_TILE_ID)
        self.seal_world_audio(CURRENT_WORLD_AUDIO_VERSION - 2, self.current_world_audio_config())
        seal = self.seal_state(WORLD_AUDIO_STEP_NAME)
        self.assertEqual((seal.state, seal.receipt), (STALE_SEAL_STATE, None))
        self.assertIsNone(sealed_unit_step(self.project_root, self.unit_key, WORLD_AUDIO_STEP_NAME, TILE_STEP_SEAL_CHECKS))

    def test_a_receipt_with_the_current_version_config_and_inputs_is_current(self):
        seal_raw_unit(self.project_root, LOCKED_TILE_ID)
        gap_rows = object_gap_rows(LOCKED_TILE_ID, WORLD_AUDIO_STEP_NAME, 1)
        self.seal_world_audio(CURRENT_WORLD_AUDIO_VERSION, self.current_world_audio_config(), gap_rows)
        seal = self.seal_state(WORLD_AUDIO_STEP_NAME)
        self.assertEqual((seal.state, seal.receipt['algorithmVersion']), (CURRENT_SEAL_STATE, CURRENT_WORLD_AUDIO_VERSION))
        self.assertEqual(sealed_unit_step(self.project_root, self.unit_key, WORLD_AUDIO_STEP_NAME, TILE_STEP_SEAL_CHECKS),
                         SealedTileStep(gap_rows, f'work/tile__{LOCKED_TILE_ID}/audio/receipt.json'))

    def test_a_receipt_holding_an_older_raw_fingerprint_than_the_raw_seal_is_stale(self):
        seal_raw_unit(self.project_root, LOCKED_TILE_ID)
        self.seal_world_audio(CURRENT_WORLD_AUDIO_VERSION, {**self.current_world_audio_config(), 'rawFingerprint': OLDER_UPSTREAM_FINGERPRINT})
        self.assertEqual(self.seal_state(WORLD_AUDIO_STEP_NAME).state, STALE_SEAL_STATE)

    def test_a_receipt_whose_raw_unit_is_unsealed_answers_pending(self):
        self.seal_world_audio(CURRENT_WORLD_AUDIO_VERSION, {'rawFingerprint': OLDER_UPSTREAM_FINGERPRINT})
        self.assertEqual(self.seal_state(WORLD_AUDIO_STEP_NAME), (PENDING_SEAL_STATE, None, f'work/tile__{LOCKED_TILE_ID}/audio/receipt.json'))

    def test_a_step_without_a_seal_answers_unsealed(self):
        self.assertEqual(self.seal_state(WORLD_AUDIO_STEP_NAME).state, UNSEALED_STATE)

    def test_a_stale_receipt_writes_its_step_pending_instead_of_its_recorded_gap_row(self):
        seal_raw_unit(self.project_root, LOCKED_TILE_ID)
        gap_rows = object_gap_rows(LOCKED_TILE_ID, WORLD_AUDIO_STEP_NAME, 2)
        self.seal_world_audio(CURRENT_WORLD_AUDIO_VERSION - 2, self.current_world_audio_config(), gap_rows)
        source_identity = {'path': tile_map_path(LOCKED_TILE_ID), 'sha256': read_tile_map_lock_record(LOCKED_TILE_ID)['eSha256']}
        recorded_gap_row = tile_step_row(LOCKED_TILE_ID, WORLD_AUDIO_STEP_NAME, 'gap', 'object-gaps:2', source_identity, 'evidence.json')
        rows = convert_tile_batch.tile_rows(self.project_root, LOCKED_TILE_ID, source_identity, (WORLD_AUDIO_STEP_NAME,), {},
                                            {(self.unit_key, WORLD_AUDIO_STEP_NAME): recorded_gap_row}, TILE_STEP_SEAL_CHECKS)
        self.assertEqual([(row['status'], row['reason'], row['evidence']) for row in rows], [('pending', 'batch-pending', TILE_CENSUS_RELATIVE_PATH)])


class RawAndChunkPlanCurrentSealTests(CurrentSealTestCase):
    def test_a_raw_receipt_under_an_older_raw_version_is_stale_and_the_current_one_is_current(self):
        recipe = raw_map_recipe(LOCKED_TILE_ID, read_tile_map_lock_record(LOCKED_TILE_ID))
        self.seal_step(RAW_STEP_NAME, recipe, algorithm_version=RAW_MAP_STEP_ALGORITHM_VERSION - 1)
        stale_state = self.seal_state(RAW_STEP_NAME).state
        seal_raw_unit(self.project_root, LOCKED_TILE_ID)
        self.assert_seal_states(RAW_STEP_NAME, [(stale_state, STALE_SEAL_STATE), (self.seal_state(RAW_STEP_NAME).state, CURRENT_SEAL_STATE)])

    def test_a_chunk_plan_receipt_answers_current_stale_and_pending_on_its_raw_seal(self):
        self.seal_step(CHUNK_PLAN_STEP_NAME, chunk_plan_unit_config(OLDER_UPSTREAM_FINGERPRINT))
        pending_state = self.seal_state(CHUNK_PLAN_STEP_NAME).state
        raw_fingerprint = seal_raw_unit(self.project_root, LOCKED_TILE_ID)
        stale_state = self.seal_state(CHUNK_PLAN_STEP_NAME).state
        self.seal_step(CHUNK_PLAN_STEP_NAME, chunk_plan_unit_config(raw_fingerprint), algorithm_version=CHUNK_PLAN_STEP_ALGORITHM_VERSION)
        self.assert_seal_states(CHUNK_PLAN_STEP_NAME, [(pending_state, PENDING_SEAL_STATE), (stale_state, STALE_SEAL_STATE),
                                                       (self.seal_state(CHUNK_PLAN_STEP_NAME).state, CURRENT_SEAL_STATE)])


class UnitFingerprintStepCurrentSealTests(CurrentSealTestCase):
    def test_every_unit_fingerprint_step_answers_current_stale_and_pending(self):
        for step, unit_function_name in UNIT_FINGERPRINT_STEP_UNITS.items():
            with self.subTest(step=step):
                current_config = upstream_config(CURRENT_UPSTREAM_FINGERPRINT)
                with patch.object(tile_step_current_seals, unit_function_name, unit_with_fingerprint_of(step, current_config)):
                    self.seal_step(step, current_config)
                    states = [(self.seal_state(step).state, CURRENT_SEAL_STATE)]
                    self.seal_step(step, upstream_config(OLDER_UPSTREAM_FINGERPRINT))
                    states.append((self.seal_state(step).state, STALE_SEAL_STATE))
                    if self.current_version(step) > 1:
                        self.seal_step(step, current_config, algorithm_version=self.current_version(step) - 1)
                        states.append((self.seal_state(step).state, STALE_SEAL_STATE))
                with patch.object(tile_step_current_seals, unit_function_name, raising(ChunkPlanStepError('chunk plan is not sealed'))):
                    states.append((self.seal_state(step).state, PENDING_SEAL_STATE))
                self.assert_seal_states(step, states)


class LockedInputConfigStepCurrentSealTests(CurrentSealTestCase):
    def assert_locked_input_config_states(self, step, current_config):
        self.seal_step(step, current_config, discovered_inputs())
        states = [(self.seal_state(step).state, CURRENT_SEAL_STATE)]
        self.seal_step(step, current_config, discovered_inputs(OLDER_UPSTREAM_FINGERPRINT))
        states.append((self.seal_state(step).state, STALE_SEAL_STATE))
        self.seal_step(step, {**current_config, 'rawFingerprint': OLDER_UPSTREAM_FINGERPRINT}, discovered_inputs())
        states.append((self.seal_state(step).state, STALE_SEAL_STATE))
        if self.current_version(step) > 1:
            self.seal_step(step, current_config, discovered_inputs(), algorithm_version=self.current_version(step) - 1)
            states.append((self.seal_state(step).state, STALE_SEAL_STATE))
        self.assert_seal_states(step, states)

    def test_a_bsp_receipt_answers_on_its_config_its_discovered_input_lock_records_and_its_chunk_plan(self):
        current_config = upstream_config(CURRENT_UPSTREAM_FINGERPRINT)
        with patch.object(tile_step_current_seals, 'sealed_bsp_unit_config', lambda *arguments: current_config):
            self.assert_locked_input_config_states(BSP_STEP_NAME, current_config)
        with patch.object(tile_step_current_seals, 'sealed_bsp_unit_config', raising(ChunkPlanStepError('chunk plan is not sealed'))):
            self.assertEqual(self.seal_state(BSP_STEP_NAME).state, PENDING_SEAL_STATE)

    def test_a_sky_receipt_answers_on_its_raw_seal_and_its_discovered_input_lock_records(self):
        self.seal_step(SKY_STEP_NAME, {'rawFingerprint': OLDER_UPSTREAM_FINGERPRINT}, discovered_inputs())
        self.assertEqual(self.seal_state(SKY_STEP_NAME).state, PENDING_SEAL_STATE)
        self.assert_locked_input_config_states(SKY_STEP_NAME, {'rawFingerprint': seal_raw_unit(self.project_root, LOCKED_TILE_ID)})

    def test_a_mover_receipt_answers_on_its_config_and_waits_for_the_mover_class_receipt(self):
        current_config = upstream_config(CURRENT_UPSTREAM_FINGERPRINT)
        with patch.object(tile_step_current_seals, 'sealed_mover_unit_config', lambda *arguments: current_config):
            self.assert_locked_input_config_states(MOVER_STEP_NAME, current_config)
        for pending_config in (lambda *arguments: None, raising(ChunkPlanStepError('chunk plan is not sealed'))):
            with patch.object(tile_step_current_seals, 'sealed_mover_unit_config', pending_config):
                self.assertEqual(self.seal_state(MOVER_STEP_NAME).state, PENDING_SEAL_STATE)


class MinimapAndTileManifestCurrentSealTests(CurrentSealTestCase):
    def test_a_minimap_receipt_answers_on_its_upstream_config_and_route_and_waits_for_its_upstream_units(self):
        current_config = upstream_config(CURRENT_UPSTREAM_FINGERPRINT)
        inputs = minimap_input_records(LOCKED_TILE_ID)
        with patch.object(tile_step_current_seals, 'upstream_sealed_fingerprints', lambda *arguments: (None, (current_config, None))):
            self.seal_step(MINIMAP_STEP_NAME, current_config, inputs)
            states = [(self.seal_state(MINIMAP_STEP_NAME).state, STALE_SEAL_STATE)]
            seal_synthetic_minimap_route(self.project_root)
            states.append((self.seal_state(MINIMAP_STEP_NAME).state, CURRENT_SEAL_STATE))
            self.seal_step(MINIMAP_STEP_NAME, upstream_config(OLDER_UPSTREAM_FINGERPRINT), inputs)
            states.append((self.seal_state(MINIMAP_STEP_NAME).state, STALE_SEAL_STATE))
        with patch.object(tile_step_current_seals, 'upstream_sealed_fingerprints', lambda *arguments: (RAW_STEP_NAME, None)):
            states.append((self.seal_state(MINIMAP_STEP_NAME).state, PENDING_SEAL_STATE))
        self.assert_seal_states(MINIMAP_STEP_NAME, states)

    def test_a_tile_manifest_receipt_is_stale_when_any_upstream_fingerprint_differs_from_its_current_seal(self):
        terrain = SimpleNamespace(chunks_fingerprint=CURRENT_UPSTREAM_FINGERPRINT, fingerprint=CURRENT_UPSTREAM_FINGERPRINT)
        current_upstream = {step: (CURRENT_UPSTREAM_FINGERPRINT, None) for step in UPSTREAM_SEALED_TILE_MANIFEST_STEPS}
        with patch.object(tile_step_current_seals, 'sealed_terrain_chunks', lambda *arguments: (terrain, [], None)), \
                patch.object(tile_manifest_step, 'sealed_tile_manifest_upstream', lambda *arguments: current_upstream):
            self.seal_step(TILE_MANIFEST_STEP_NAME, tile_manifest_unit_config(terrain, current_upstream))
            states = [(self.seal_state(TILE_MANIFEST_STEP_NAME).state, CURRENT_SEAL_STATE)]
            for step in UPSTREAM_SEALED_TILE_MANIFEST_STEPS:
                self.seal_step(TILE_MANIFEST_STEP_NAME, tile_manifest_unit_config(terrain, {**current_upstream, step: (OLDER_UPSTREAM_FINGERPRINT, None)}))
                states.append((self.seal_state(TILE_MANIFEST_STEP_NAME).state, STALE_SEAL_STATE))
        for pending_error in (TerrainChunkStepError('terrain is not sealed'), ChunkPlanStepError('chunk plan is not sealed')):
            with patch.object(tile_step_current_seals, 'sealed_terrain_chunks', raising(pending_error)):
                states.append((self.seal_state(TILE_MANIFEST_STEP_NAME).state, PENDING_SEAL_STATE))
        self.assert_seal_states(TILE_MANIFEST_STEP_NAME, states)


if __name__ == '__main__':
    unittest.main()
