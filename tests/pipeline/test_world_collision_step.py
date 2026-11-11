import ast
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_store.gap_rows import validate_gap_row
from native_store.tile_manifest_validation import load_tile_manifest_vocabulary, validate_tile_chunk_manifest
from support.converted_model_fixture import converted_model_glb
from support.actor_class_defaults import ACTOR_DEFAULTS, SYNTHETIC_ACTOR_CLASS_DEFAULTS, SyntheticActorClassDefaults
from support.level_model_fixture import build_synthetic_level_model, square_points, synthetic_polygon
from synthetic_terrain_fixture import synthetic_native_terrain
from world.blocking_volume_geometry import read_volume
from world.collision_payload_groups import bspt_arrays, plac_arrays, vols_arrays
from world.collision_step import COLLISION_STEP_ALGORITHM_VERSION, gap_reason_of
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
        arrays = {array.name: array.values for array in vols_arrays([volume])}
        self.assertEqual(arrays['VOLS.rotation'], (0, 16384, 0))
        self.assertEqual((arrays['VOLS.drawScale'], arrays['VOLS.drawScale3D'], arrays['VOLS.prePivot']), ((2.0,), (1.0, 3.0, 1.0), (4.0, 5.0, 6.0)))
        self.assertEqual(arrays['VOLS.transformProvenance'], (0, 0, 0, 0, 0))

    def test_a_volume_without_a_brush_is_declared_none_and_zero_volumes_write_empty_groups(self):
        volume = read_volume(SimpleNamespace(exports=[]), SimpleNamespace(exports=[]), None, actor('Engine.PhysicsVolume'), SyntheticActorClassDefaults(), RULES)
        self.assertEqual((volume['decision'], volume['evidence']), ('declared-none', ['field:Brush:none']))
        self.assertTrue(all(array.values == () for array in vols_arrays([])))


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
        self.assertEqual(COLLISION_STEP_ALGORITHM_VERSION, 2)

    def test_every_rule_row_has_provenance_and_a_shared_status(self):
        document = json.loads((ROOT / 'recipes/world/collision-declaration-rules.json').read_text(encoding='utf-8'))
        self.assertEqual(len(RULES.rows), len(document['rules']))
        for row in document['rules']:
            self.assertTrue(row['provenance'])
            self.assertIn(row['status'], ('ue2-data', 'unconfirmed', 'confirmed-interlude', 'corrected-interlude', 'unknown'))

    def test_placement_records_keep_their_export_order_and_mesh_links(self):
        arrays = {array.name: array.values for array in plac_arrays([
            {'exportIndex': 3, 'decision': 'slots', 'mesh': 0, 'matrix': [[1.0, 0.0, 0.0, 0.0]] * 4},
            {'exportIndex': 9, 'decision': 'declared-none', 'mesh': -1, 'matrix': [[0.0] * 4] * 4}])}
        self.assertEqual((arrays['PLAC.exportIndex'], arrays['PLAC.decision'], arrays['PLAC.mesh']), ((3, 9), (1, 0), (0, -1)))
        self.assertEqual(len(arrays['PLAC.matrix']), 32)


if __name__ == '__main__':
    unittest.main()
