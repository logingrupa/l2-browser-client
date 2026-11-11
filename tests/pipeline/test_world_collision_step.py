import ast
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_catalog.ue2 import FormatError
from native_store.gap_rows import validate_gap_row
from native_store.tile_manifest_validation import load_tile_manifest_vocabulary, validate_tile_chunk_manifest
from support.converted_model_fixture import converted_model_glb
from support.actor_class_defaults import ACTOR_DEFAULTS, SYNTHETIC_ACTOR_CLASS_DEFAULTS, SyntheticActorClassDefaults
from support.level_model_fixture import build_synthetic_level_model, square_points, synthetic_polygon
from support.water_volume_fixture import (BLOCKING_VOLUME_CLASS, MUSIC_VOLUME_CLASS, PHYSICS_VOLUME_CLASS, STATIC_MESH_ACTOR_CLASS, SYNTHETIC_CHUNK_ID,
                                          SYNTHETIC_GRAVITY, SYNTHETIC_TERMINAL_VELOCITY, UNREADABLE_CLASS, WATER_VOLUME_CLASS, read_synthetic_volume_chain,
                                          synthetic_volume_actor, synthetic_volume_context, synthetic_volume_map)
from synthetic_terrain_fixture import synthetic_native_terrain
from world.blocking_volume_geometry import read_volume
from world.collision_payload_groups import bspt_arrays, plac_arrays, vols_arrays
from world import collision_step
from world.collision_step import COLLISION_STEP_ALGORITHM_VERSION, CollisionUnit, gap_reason_of, run_collision_step, unsupported_placement_class_records, volume_records
from world.level_model import LevelModelLayoutError
from world.light_actors import ClassChains
from world.static_collision_sources import decide_placement_collision, load_collision_rules, static_mesh_collision_triangles
from world.terrain_collision_source import read_terrain_collision
from world.tile_manifest_step import build_tile_chunk_manifest, tile_resources

RULES = load_collision_rules()
TILE_ID = '00_00'
SOURCE_IDENTITY = {'path': f'maps/{TILE_ID}.unr', 'sha256': hashlib.sha256(b'synthetic collision tile').hexdigest()}
EVIDENCE = f'work/tile__{TILE_ID}/collision/receipt.json'
OMITTED = {'status': 'omitted-class-default-unresolved'}


def actor(class_object='Engine.StaticMeshActor', collision=None, properties=(), transform=None, export_index=7):
    source_transform = {name: OMITTED for name in ('Location', 'Rotation', 'DrawScale', 'DrawScale3D', 'PrePivot')}
    source_transform.update(transform or {})
    return {'id': f'interlude:{TILE_ID}.Actor{export_index}', 'object': f'{TILE_ID}.Actor{export_index}', 'exportIndex': export_index,
            'classObject': class_object, 'collision': {field: {'status': 'serialized', 'value': value} for field, value in (collision or {}).items()},
            'properties': [{'name': name, 'status': 'decoded', 'value': value} for name, value in properties], 'sourceTransform': source_transform}


def serialized(value):
    return {'status': 'serialized', 'value': value}


class PlacementDecisionTests(unittest.TestCase):
    def decide(self, placement, slots=({'EnableCollision': True},), selectors=None, defaults=None):
        return decide_placement_collision(placement, SyntheticActorClassDefaults(defaults), None if slots is None else list(slots),
                                          selectors or {}, RULES)

    def test_a_false_collide_or_block_players_flag_is_declared_none(self):
        for flags in ({'bCollideActors': False}, {'bBlockPlayers': False}):
            record = self.decide(actor(collision=flags))
            self.assertEqual((record['decision'], record['slots']), ('declared-none', []))
            self.assertEqual(record['provenance'][next(iter(flags))], 'authored')

    def test_an_unresolved_flag_is_a_gap_naming_the_field_and_never_false(self):
        defaults = {'Engine.StaticMeshActor': {key: value for key, value in SYNTHETIC_ACTOR_CLASS_DEFAULTS['Engine.StaticMeshActor'].items()
                                               if key != 'bBlockPlayers'}}
        record = self.decide(actor(), defaults=defaults)
        self.assertEqual((record['decision'], record['evidence']), ('gap', ['field:bBlockPlayers']))
        self.assertIsNone(record['provenance']['bBlockPlayers'])

    def test_every_resolved_flag_records_authored_class_default_or_ue_zero(self):
        record = self.decide(actor(collision={'bCollideActors': True}, properties=[('bStatic', True)]))
        self.assertEqual(record['provenance'], {'bCollideActors': 'authored', 'bBlockPlayers': 'class-default', 'bStatic': 'authored',
                                                'bBlockActors': 'class-default', 'bBlockNonZeroExtentTraces': 'class-default'})
        defaults = {'Engine.StaticMeshActor': {**SYNTHETIC_ACTOR_CLASS_DEFAULTS['Engine.StaticMeshActor'], 'bBlockActors': ACTOR_DEFAULTS['bBlockActors']}}
        disagreeing = self.decide(actor(), defaults=defaults)
        self.assertEqual((disagreeing['decision'], disagreeing['evidence'], disagreeing['provenance']['bBlockActors']),
                         ('gap', ['rule-disagreement:bBlockActors'], 'ue-zero'))

    def test_a_blocking_placement_lists_only_slots_whose_enable_collision_is_true(self):
        record = self.decide(actor(), slots=({'EnableCollision': True}, {'EnableCollision': False}, {'EnableCollision': True}))
        self.assertEqual((record['decision'], record['slots']), ('slots', [0, 2]))
        self.assertEqual(record['evidence'], ['selectors:unresolved-intrinsic:UseSimpleLineCollision,UseSimpleBoxCollision,UseSimpleKarmaCollision,CollisionModel'])

    def test_a_slot_without_enable_collision_or_a_missing_model_is_unreadable(self):
        self.assertEqual(self.decide(actor(), slots=({'EnableCollision': True}, {}))['evidence'], ['field:EnableCollision'])
        self.assertEqual(self.decide(actor(), slots=None)['evidence'], ['field:nativeSlotProperties'])
        self.assertEqual(self.decide(actor(), selectors={'UseSimpleBoxCollision': True})['evidence'], ['field:UseSimpleBoxCollision'])
        self.assertEqual(self.decide(actor(), selectors={'CollisionModel': {'index': 4, 'object': 'Fixture.Model1'}})['evidence'], ['field:CollisionModel'])

    def test_gap_reasons_name_the_unreadable_transform_field(self):
        self.assertEqual(gap_reason_of(['transform-field:DrawScale3D']), 'collision-transform-field-unreadable:DrawScale3D')
        self.assertEqual(gap_reason_of(['field:bBlockPlayers']), 'collision-unreadable')
        for reason in ('collision-transform-field-unreadable:DrawScale3D', 'collision-unreadable'):
            validate_gap_row({'key': f'tile:{TILE_ID}', 'part': 'world', 'step': 'collision', 'status': 'gap', 'reason': reason,
                              'sourceIdentity': SOURCE_IDENTITY, 'evidence': EVIDENCE})


class StaticMeshTriangleTests(unittest.TestCase):
    def test_triangles_of_collision_slots_return_to_mesh_local_source_units(self):
        positions, indices = static_mesh_collision_triangles(converted_model_glb([True, False]), {0})
        self.assertEqual(len(positions), 3)
        self.assertAlmostEqual(positions[1][0], 1.0, places=5)
        self.assertAlmostEqual(positions[2][2], 2.0, places=5)
        self.assertEqual(indices, [0, 2, 1])

    def test_the_gltf_float_component_has_one_owner_in_the_world_lane(self):
        owners = sorted(path.name for path in (ROOT / 'scripts' / 'world').glob('*.py')
                        for statement in ast.parse(path.read_text(encoding='utf-8')).body
                        if isinstance(statement, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'GLTF_FLOAT_COMPONENT'
                                                                     for target in statement.targets))
        self.assertEqual(owners, ['gltf_builder.py'])


class VolumeTests(unittest.TestCase):
    def test_a_volume_keeps_rotation_draw_scale_draw_scale_3d_and_pre_pivot(self):
        brush = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 64))], root_outside=1)
        reader = SimpleNamespace(_read_model=lambda adapter, export, layout: brush, validate_graph=lambda nodes: len(nodes))
        package = SimpleNamespace(exports=[{'classObject': 'Engine.Model', 'object': 'Fixture.Model1'}])
        transform = {'Location': serialized({'X': 10.0, 'Y': 20.0, 'Z': 30.0}), 'Rotation': serialized({'Pitch': 0, 'Yaw': 16384, 'Roll': 0}),
                     'DrawScale': serialized(2.0), 'DrawScale3D': serialized({'X': 1.0, 'Y': 3.0, 'Z': 1.0}),
                     'PrePivot': serialized({'X': 4.0, 'Y': 5.0, 'Z': 6.0})}
        volume = read_volume(package, SimpleNamespace(exports=[object()]), reader,
                             actor('Engine.BlockingVolume', properties=[('Brush', {'index': 1, 'object': 'Fixture.Model1'})], transform=transform),
                             SyntheticActorClassDefaults(), RULES)
        self.assertEqual((volume['decision'], volume['rootOutside'], len(volume['nodes'])), ('blocking', 1, 1))
        unresolved = {'field': None, 'value': None, 'provenance': 'unresolved'}
        arrays = {array.name: array.values for array in vols_arrays([{**volume, 'kind': 'blocking',
                                                                      'physicsFields': dict.fromkeys(('water', 'priority', 'gravity', 'terminalVelocity'), unresolved)}])}
        self.assertEqual(arrays['VOLS.rotation'], (0, 16384, 0))
        self.assertEqual((arrays['VOLS.drawScale'], arrays['VOLS.drawScale3D'], arrays['VOLS.prePivot']), ((2.0,), (1.0, 3.0, 1.0), (4.0, 5.0, 6.0)))
        self.assertEqual(arrays['VOLS.transformProvenance'], (0, 0, 0, 0, 0))

    def test_a_volume_without_a_brush_is_declared_none_and_zero_volumes_write_empty_groups(self):
        volume = read_volume(SimpleNamespace(exports=[]), SimpleNamespace(exports=[]), None, actor('Engine.PhysicsVolume'), SyntheticActorClassDefaults(), RULES)
        self.assertEqual((volume['decision'], volume['evidence']), ('declared-none', ['field:Brush:none']))
        self.assertTrue(all(array.values == () for array in vols_arrays([])))


class VolumeAdmissionTests(unittest.TestCase):
    def admitted(self, actors):
        package, level, rectangles = synthetic_volume_map()
        volumes_by_chunk, records = volume_records(synthetic_volume_context(), package, level, actors, rectangles)
        return volumes_by_chunk, {record['exportIndex']: record for record in records}

    def test_a_water_volume_whose_chain_reaches_physics_volume_is_one_physics_record_with_its_declared_water_flag(self):
        volumes_by_chunk, records = self.admitted([synthetic_volume_actor(WATER_VOLUME_CLASS, 9)])
        self.assertEqual(list(records), [9])
        water_volume = records[9]
        self.assertEqual((water_volume['classObject'], water_volume['kind'], water_volume['chunkId']), (WATER_VOLUME_CLASS, 'physics', SYNTHETIC_CHUNK_ID))
        self.assertEqual(water_volume['physicsFields'], {
            'water': {'field': 'bL2WaterVolume', 'value': True, 'provenance': 'class-default'},
            'priority': {'field': 'Priority', 'value': 0, 'provenance': 'ue-zero'},
            'gravity': {'field': 'Gravity', 'value': SYNTHETIC_GRAVITY, 'provenance': 'class-default'},
            'terminalVelocity': {'field': 'TerminalVelocity', 'value': SYNTHETIC_TERMINAL_VELOCITY, 'provenance': 'class-default'}})
        arrays = {array.name: array.values for array in vols_arrays(volumes_by_chunk[SYNTHETIC_CHUNK_ID])}
        self.assertEqual((arrays['VOLS.exportIndex'], arrays['VOLS.kind'], arrays['VOLS.water'], arrays['VOLS.priority']), ((9,), (1,), (1,), (0,)))
        self.assertEqual((arrays['VOLS.gravity'], arrays['VOLS.terminalVelocity']),
                         (tuple(SYNTHETIC_GRAVITY[axis] for axis in ('X', 'Y', 'Z')), (SYNTHETIC_TERMINAL_VELOCITY,)))
        self.assertEqual(arrays['VOLS.physicsFieldProvenance'], (1, 2, 1, 1))

    def test_an_authored_physics_field_wins_over_the_class_default(self):
        _, records = self.admitted([synthetic_volume_actor(PHYSICS_VOLUME_CLASS, 3, properties=[('Priority', -7), ('bL2WaterVolume', True)])])
        self.assertEqual(records[3]['kind'], 'physics')
        self.assertEqual((records[3]['physicsFields']['priority'], records[3]['physicsFields']['water']),
                         ({'field': 'Priority', 'value': -7, 'provenance': 'authored'}, {'field': 'bL2WaterVolume', 'value': True, 'provenance': 'authored'}))

    def test_a_blocking_volume_is_kind_blocking_and_its_undeclared_physics_fields_stay_unresolved(self):
        volumes_by_chunk, records = self.admitted([synthetic_volume_actor(BLOCKING_VOLUME_CLASS, 4)])
        self.assertEqual((records[4]['kind'], {record['provenance'] for record in records[4]['physicsFields'].values()}), ('blocking', {'unresolved'}))
        arrays = {array.name: array.values for array in vols_arrays(volumes_by_chunk[SYNTHETIC_CHUNK_ID])}
        self.assertEqual((arrays['VOLS.kind'], arrays['VOLS.water'], arrays['VOLS.physicsFieldProvenance']), ((0,), (0,), (3, 3, 3, 3)))

    def test_a_declared_field_whose_type_differs_from_the_recipe_is_unresolved_and_never_defaulted(self):
        def read_chain_with_float_priority(class_name):
            return [{**definition, 'declaredFields': [{**declared, 'type': 'float'} if declared['name'] == 'Priority' else declared
                                                      for declared in definition['declaredFields']]}
                    for definition in read_synthetic_volume_chain(class_name)]
        context = {**synthetic_volume_context(), 'classChains': ClassChains(None, read_chain_with_float_priority)}
        package, level, rectangles = synthetic_volume_map()
        _, records = volume_records(context, package, level, [synthetic_volume_actor(WATER_VOLUME_CLASS, 9)], rectangles)
        self.assertEqual(records[0]['physicsFields']['priority'], {'field': 'Priority', 'value': None, 'provenance': 'unresolved'})

    def test_an_actor_outside_both_chains_or_with_an_unreadable_chain_is_not_a_vols_volume(self):
        _, records = self.admitted([synthetic_volume_actor(MUSIC_VOLUME_CLASS, 5), synthetic_volume_actor(STATIC_MESH_ACTOR_CLASS, 6),
                                    synthetic_volume_actor(UNREADABLE_CLASS, 7), synthetic_volume_actor(WATER_VOLUME_CLASS, 8)])
        self.assertEqual(list(records), [8])


class UnsupportedPlacementClassTests(unittest.TestCase):
    def test_a_static_mesh_actor_subclass_is_a_collision_gap_row_naming_its_class(self):
        actors = [actor('Engine.MovableStaticMeshActor', export_index=9), actor('Engine.StaticMeshActor', export_index=4),
                  actor('Gameplay.WaterVolume', export_index=3), actor('Synthetic.UnreadableClass', export_index=5)]
        records = unsupported_placement_class_records(ClassChains(None, read_synthetic_volume_chain), actors)
        self.assertEqual([(record['object'], record['decision']) for record in records], [(f'{TILE_ID}.Actor9', 'gap')])
        reason = gap_reason_of(records[0]['evidence'])
        self.assertEqual(reason, 'placement-class-unsupported:Engine.MovableStaticMeshActor')
        validate_gap_row({'key': f'tile:{TILE_ID}', 'part': 'world', 'step': 'collision', 'status': 'gap', 'reason': reason,
                          'sourceIdentity': {**SOURCE_IDENTITY, 'object': records[0]['object']}, 'evidence': EVIDENCE})


class TreeAndTerrainTests(unittest.TestCase):
    def test_the_bspt_group_is_the_stored_tree_and_poly_flags_never_change_solidity(self):
        polygons = [synthetic_polygon(square_points(0, 0, 10), front=1, back=-1, collision_bound=0, node_flags=1),
                    synthetic_polygon(square_points(20, 0, 10), coplanar=0, surface_flags=0x04000000)]
        model = build_synthetic_level_model(polygons, leaf_hulls=[1, -1, 0, 0, 0, 0, 0, 0], root_outside=1)
        arrays = {array.name: array.values for array in bspt_arrays(model, lambda node: model.surfs[node.i_surf].flags)}
        self.assertEqual((arrays['BSPT.front'], arrays['BSPT.back'], arrays['BSPT.coplanar']), ((1, -1), (-1, -1), (-1, 0)))
        self.assertEqual((arrays['BSPT.nodeFlags'], arrays['BSPT.numVertices'], arrays['BSPT.collisionBound']), ((1, 0), (4, 4), (0, -1)))
        self.assertEqual((arrays['BSPT.leafHulls'], arrays['BSPT.rootOutside']), ((1, -1, 0, 0, 0, 0, 0, 0), (1,)))
        self.assertEqual(arrays['BSPT.planes'], tuple(value for node in model.nodes for value in node.plane))
        without_flags = {array.name: array.values for array in bspt_arrays(model, lambda node: 0)}
        self.assertEqual({name: values for name, values in arrays.items() if name != 'BSPT.surfaceFlags'},
                         {name: values for name, values in without_flags.items() if name != 'BSPT.surfaceFlags'})

    def test_the_terr_group_holds_the_chunk_heightmap_bitmaps_scale_and_location(self):
        native = synthetic_native_terrain(2, 1)
        samples = list(range(native['width'] * native['height']))
        words = {'QuadVisibilityBitmap': [0b10], 'EdgeTurnBitmap': [0b1]}
        chunk = {'chunkId': 'chunk-0-0', 'sectorRectangle': {'minOffset': [0, 0], 'maxOffset': [2, 0]}}
        terrain_actor = {'sourceTransform': {'Location': serialized({'X': 1.0, 'Y': 2.0, 'Z': 3.0})}}
        terrain = read_terrain_collision(native, samples, words, {'terrainScale': {'X': 128.0, 'Y': 128.0, 'Z': 76.0}}, terrain_actor, chunk)
        self.assertEqual((terrain['location'], terrain['terrainScale'], terrain['vertexRectangle']), ([1.0, 2.0, 3.0], [128.0, 128.0, 76.0], [0, 0, 5, 3]))
        self.assertEqual(terrain['heights'], samples)
        self.assertEqual((terrain['quadVisibility'][:2], terrain['edgeTurn'][:2]), ([False, True], [True, False]))


class CollisionStepOrderTests(unittest.TestCase):
    def run_with_unsealed_bsp(self, level_model_outcome):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        lane_folder = Path(temporary.name)
        raw_products = lane_folder / 'raw'
        raw_products.mkdir()
        (raw_products / 'actors.json').write_text('[]', encoding='utf-8')
        ledger = SimpleNamespace(lane_folder=lane_folder, is_sealed=lambda unit_key, fingerprint: False,
                                 unit_step_directory=lambda unit_key: lane_folder / 'work' / 'tile__00_00' / 'collision')
        unit = CollisionUnit(ledger, f'tile:{TILE_ID}', 'f' * 64, {'bspFingerprint': None}, [], raw_products, {'chunks': []}, {'chunks': {}},
                             {}, {'movers': []})
        with patch.object(collision_step, 'read_tile_map_lock_record', return_value={'eSha256': SOURCE_IDENTITY['sha256']}), \
                patch.object(collision_step, 'collision_unit', return_value=unit), \
                patch.object(collision_step, 'read_locked_map_package', return_value=SimpleNamespace()), \
                patch.object(collision_step, 'read_level_model', side_effect=level_model_outcome), \
                patch.object(collision_step, 'native_terrain', return_value=None), \
                patch.object(collision_step, 'chunk_rectangles', return_value={}):
            return run_collision_step(ROOT, ROOT, TILE_ID)

    def test_a_level_model_layout_gap_is_the_collision_gap_even_without_a_bsp_seal(self):
        row = self.run_with_unsealed_bsp(LevelModelLayoutError('map-licensee-unsupported:123/25', 'Level.Model layout of 123/25 is unreviewed'))
        self.assertEqual((row['status'], row['reason']), ('gap', 'map-licensee-unsupported:123/25'))
        validate_gap_row(row)

    def test_a_readable_level_model_without_a_bsp_seal_names_only_the_bsp_step(self):
        with self.assertRaises(FormatError) as refusal:
            self.run_with_unsealed_bsp([SimpleNamespace()])
        self.assertIn('needs a sealed bsp unit; run --step bsp first', str(refusal.exception))


class CollisionManifestTests(unittest.TestCase):
    def test_the_chunk_collision_field_and_the_tile_resource_follow_the_manifest_shapes(self):
        sha = 'f' * 64
        collision = {'chunks': {'chunk-0-0': {'resource': f'/l2/maps/{sha}/native-tile-chunk-collision/asset.json', 'sha256': sha, 'gapRows': []}},
                     'tile': {'resource': f'/l2/maps/{sha}/native-tile-collision/asset.json', 'sha256': sha, 'bytes': 2197}, 'gapRows': []}
        chunk_plan_entry = {'chunkId': 'chunk-0-0', 'sectorRange': {'firstColumn': 0, 'lastColumn': 3, 'firstRow': 0, 'lastRow': 3},
                            'sectorObjects': ['00_00.TerrainSector0']}
        terrain_record = {'chunkId': 'chunk-0-0', 'terrain': {'sha256': 'b' * 64}, 'maskUvRule': 'extrapolated', 'gapRows': []}
        manifest = build_tile_chunk_manifest(TILE_ID, terrain_record, chunk_plan_entry, SOURCE_IDENTITY, EVIDENCE, collision=collision)
        self.assertEqual(set(manifest['collision']), {'resource', 'sha256'})
        validate_tile_chunk_manifest(manifest)
        self.assertEqual(tile_resources(collision, None)[0]['kind'], 'native-tile-collision')
        self.assertIn('native-tile-collision', load_tile_manifest_vocabulary().resource_kinds)
        self.assertEqual(COLLISION_STEP_ALGORITHM_VERSION, 5)

    def test_every_rule_row_has_provenance_and_a_shared_status(self):
        document = json.loads((ROOT / 'recipes/world/collision-declaration-rules.json').read_text(encoding='utf-8'))
        for row in document['rules']:
            self.assertTrue(row['provenance'])
            self.assertIn(row['status'], ('ue2-data', 'unconfirmed', 'confirmed-interlude', 'corrected-interlude', 'unknown'))

    def test_a_rules_recipe_whose_volume_kinds_or_physics_fields_differ_from_the_vols_arrays_is_rejected(self):
        document = json.loads((ROOT / 'recipes/world/collision-declaration-rules.json').read_text(encoding='utf-8'))
        for name, value, message in (('volumeKinds', document['volumeKinds'][:1], 'differ from the VOLS.kind codes'),
                                     ('physicsVolumeFields', document['physicsVolumeFields'][1:], 'differ from the VOLS physics arrays'),
                                     ('volumeKinds', [{'kind': 'physics'}], 'must be a non-empty list')):
            with self.subTest(field=name, message=message), tempfile.TemporaryDirectory() as folder:
                recipe_path = Path(folder) / 'collision-declaration-rules.json'
                recipe_path.write_text(json.dumps({**document, name: value}), encoding='utf-8')
                with self.assertRaisesRegex(FormatError, message):
                    load_collision_rules(recipe_path)

    def test_a_rules_recipe_naming_a_field_no_collision_step_reads_is_rejected(self):
        document = json.loads((ROOT / 'recipes/world/collision-declaration-rules.json').read_text(encoding='utf-8'))
        for ungoverned_field, value in (('placementClass', 'Engine.MovableStaticMeshActor'), ('transformFields', ['Location'])):
            with self.subTest(field=ungoverned_field), tempfile.TemporaryDirectory() as folder:
                recipe_path = Path(folder) / 'collision-declaration-rules.json'
                recipe_path.write_text(json.dumps({**document, ungoverned_field: value}), encoding='utf-8')
                with self.assertRaisesRegex(FormatError, 'differ from the fields the collision steps read'):
                    load_collision_rules(recipe_path)

    def test_placement_records_keep_their_export_order_and_mesh_links(self):
        arrays = {array.name: array.values for array in plac_arrays([
            {'exportIndex': 3, 'decision': 'slots', 'mesh': 0, 'matrix': [[1.0, 0.0, 0.0, 0.0]] * 4},
            {'exportIndex': 9, 'decision': 'declared-none', 'mesh': -1, 'matrix': [[0.0] * 4] * 4}])}
        self.assertEqual((arrays['PLAC.exportIndex'], arrays['PLAC.decision'], arrays['PLAC.mesh']), ((3, 9), (1, 0), (0, -1)))
        self.assertEqual(len(arrays['PLAC.matrix']), 32)


if __name__ == '__main__':
    unittest.main()
