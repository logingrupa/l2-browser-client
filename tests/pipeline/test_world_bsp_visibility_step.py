import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_store.gap_rows import validate_gap_row
from native_store.tile_manifest_validation import load_tile_manifest_vocabulary
from support.actor_class_defaults import SyntheticActorClassDefaults
from support.converted_model_fixture import converted_model_glb
from support.bsp_room_fixture import ROOM_ZONES, room_model
from world.bsp_visibility_census import build_bsp_visibility_census
from world.bsp_leaf_membership import INDEX_NONE, leaf_for_point, leaves_for_box, point_check_outside, solidity_disagreements, zones_for_box
from world.bsp_visibility_step import (BSP_VISIBILITY_STEP_ALGORITHM_VERSION, BSP_VISIBILITY_STEP_NAME, load_bsp_visibility_rules,
                                       model_unreadable_reason, solidity_census, solidity_gap_rows, tile_bsp_visibility_row, tile_visibility_payload)
from world.level_model import LevelModelRangeError
from world.tile_manifest_step import tile_resources
from world.typed_payload import ARRAY_NAME_PATTERN, typed_payload_asset
from world.visibility_members import MEMBER_SKY_FLAG, MEMBER_UNBOUNDED_FLAG, STATIC_MESH_MEMBER_KIND, static_mesh_members

TILE_ID = '00_00'
SOURCE_IDENTITY = {'path': f'maps/{TILE_ID}.unr', 'sha256': hashlib.sha256(b'synthetic visibility tile').hexdigest()}
EVIDENCE = f'work/tile__{TILE_ID}/bsp-visibility/receipt.json'
SHARED_STATUSES = {'ue2-data', 'unconfirmed', 'confirmed-interlude', 'corrected-interlude', 'unknown'}
RULE_FIELDS = {'id', 'value', 'provenance', 'status', 'interludeEvidence', 'runtimeDefault'}
_, RULES = load_bsp_visibility_rules()
NOT_CSG_NODE_FLAGS = RULES['point-check-not-csg-node-flags']['runtimeDefault']


class ZoneLocateTests(unittest.TestCase):
    def test_a_point_finds_the_hand_computed_leaf_and_zone(self):
        model = room_model()
        self.assertEqual(leaf_for_point(model, (25.0, 10.0, 25.0)), (0, 1))
        self.assertEqual(leaf_for_point(model, (75.0, 10.0, 25.0)), (1, 2))

    def test_a_point_exactly_on_a_plane_goes_front(self):
        self.assertEqual(leaf_for_point(room_model(), (50.0, 10.0, 25.0)), (1, 2))

    def test_a_point_in_solid_space_has_no_leaf_and_the_zone_of_its_side(self):
        self.assertEqual(leaf_for_point(room_model(), (25.0, 10.0, -5.0)), (INDEX_NONE, 0))

    def test_an_empty_leaf_slot_keeps_index_none_and_the_node_side_zone_with_no_fallback(self):
        model = room_model()
        model.nodes[2].i_leaf = (INDEX_NONE, 1)
        self.assertEqual(leaf_for_point(model, (25.0, 10.0, 25.0)), (INDEX_NONE, 1))

    def test_a_plane_distance_that_rounds_to_float32_zero_goes_front(self):
        self.assertEqual(leaf_for_point(room_model(), (25.0, 10.0, -1e-50)), (0, 1))

    def test_a_box_across_a_plane_collects_both_leaves_and_their_zones(self):
        model = room_model()
        self.assertEqual(leaves_for_box(model, (50.0, 10.0, 25.0), (5.0, 5.0, 5.0)), (0, 1))
        self.assertEqual(zones_for_box(model, (50.0, 10.0, 25.0), (5.0, 5.0, 5.0)), (1 << 1) | (1 << 2))
        self.assertEqual(zones_for_box(model, (25.0, 10.0, 25.0), (5.0, 5.0, 5.0)), 1 << 1)

    def test_a_zero_extent_box_on_a_plane_collects_no_leaf(self):
        self.assertEqual(leaves_for_box(room_model(), (50.0, 10.0, 25.0), (0.0, 0.0, 0.0)), ())


class PointCheckTests(unittest.TestCase):
    def test_point_check_keeps_its_own_tie_and_outside_bit(self):
        model = room_model()
        self.assertTrue(point_check_outside(model, (25.0, 10.0, 25.0), NOT_CSG_NODE_FLAGS))
        self.assertFalse(point_check_outside(model, (25.0, 10.0, -5.0), NOT_CSG_NODE_FLAGS))
        self.assertFalse(point_check_outside(model, (25.0, 10.0, 0.0), NOT_CSG_NODE_FLAGS))
        self.assertEqual(leaf_for_point(model, (25.0, 10.0, 0.0)).leaf, 0)

    def test_a_consistent_tree_has_no_solidity_disagreement(self):
        self.assertEqual(solidity_disagreements(room_model(), (4, 4, 2), NOT_CSG_NODE_FLAGS), [])

    def test_a_csg_partition_with_an_empty_leaf_behind_it_disagrees_at_every_sample_there(self):
        disagreements = solidity_disagreements(room_model(wall_flags=0), (4, 4, 2), NOT_CSG_NODE_FLAGS)
        self.assertEqual(len(disagreements), 16)
        self.assertTrue(all(record.point[0] < 50.0 and record.leaf == 0 and not record.point_check_outside for record in disagreements))


class SolidityCensusTests(unittest.TestCase):
    def test_the_census_samples_the_recipe_grid_and_writes_one_disagreement_gap_row_per_tile(self):
        document = {'censusSampleGrid': {'cellsPerAxis': [4, 4, 2]}}
        self.assertEqual(solidity_gap_rows(TILE_ID, SOURCE_IDENTITY, EVIDENCE, solidity_census(room_model(), document, RULES)), [])
        census = solidity_census(room_model(wall_flags=0), document, RULES)
        self.assertEqual((census['cellsPerAxis'], len(census['disagreements'])), ([4, 4, 2], 16))
        self.assertEqual(census['disagreements'][0], {'point': [12.5, 12.5, 12.5], 'leaf': 0, 'zone': 1, 'pointCheckOutside': False})
        row, = solidity_gap_rows(TILE_ID, SOURCE_IDENTITY, EVIDENCE, census)
        self.assertEqual(validate_gap_row(row)['reason'], 'bsp-visibility-solidity-disagreement')


class VisibilityCensusTests(unittest.TestCase):
    def product(self, disagreements, cells_per_axis=(16, 16, 8)):
        return {'resource': {'sha256': '7' * 64}, 'counts': {'nodes': 3, 'leaves': 2, 'zones': 3, 'portals': 1},
                'members': [{'kind': 'static-mesh'}, {'kind': 'map-emitter'}, {'kind': 'map-emitter'}],
                'solidity': {'cellsPerAxis': list(cells_per_axis), 'disagreements': [{}] * disagreements},
                'gapRows': [{'reason': 'bsp-visibility-solidity-disagreement'}] if disagreements else []}

    def test_the_census_counts_each_tile_in_tile_order(self):
        census = build_bsp_visibility_census({'20_21': self.product(0), '20_20': self.product(12)})
        self.assertEqual(census['sampleCellsPerAxis'], [16, 16, 8])
        self.assertEqual([(row['tileId'], row['staticMeshMembers'], row['emitterPlacements'], row['solidityDisagreements'], row['gapReasons'])
                          for row in census['tiles']],
                         [('20_20', 1, 2, 12, ['bsp-visibility-solidity-disagreement']), ('20_21', 1, 2, 0, [])])

    def test_products_of_two_sample_grids_are_refused(self):
        with self.assertRaises(ValueError):
            build_bsp_visibility_census({'20_21': self.product(0), '20_20': self.product(0, (4, 4, 2))})


class VisibilityPayloadTests(unittest.TestCase):
    def payload(self, model=None, members=()):
        node_ranges = [{'chunk': 0, 'node': 0, 'primitive': 0, 'firstIndex': 0, 'indexCount': 6}]
        return tile_visibility_payload(model or room_model(), ROOM_ZONES, RULES, node_ranges, list(members))

    def test_every_node_leaf_zone_portal_and_node_range_is_written_with_group_names(self):
        arrays, outdoor_zones, counts = self.payload()
        by_name = {array.name: array for array in arrays}
        self.assertTrue(all(ARRAY_NAME_PATTERN.fullmatch(name) for name in by_name))
        self.assertEqual(counts, {'nodes': 3, 'leaves': 2, 'zones': 3, 'bounds': 0, 'portals': 1, 'nodeRanges': 1, 'members': 0})
        self.assertEqual(len(by_name['NODE.plane'].values), 12)
        self.assertEqual(by_name['NODE.leaf'].values, (-1, -1, -1, -1, 0, 1))
        self.assertEqual(by_name['NODE.zoneSet'].values, (0xFFFFFFFF,) * 6)
        self.assertEqual(by_name['LEAF.zone'].values, (1, 2))
        self.assertEqual(by_name['LEAF.pvs'].values, (0b110, 0, 0xFFFFFFFF, 0xFFFFFFFF))
        self.assertEqual(by_name['PORT.node'].values, (2,))
        self.assertEqual(by_name['ZONE.class'].values, (1 | 8, 8, 2))
        self.assertEqual(outdoor_zones, frozenset({0, 1}))
        self.assertEqual(by_name['RNGE.indexCount'].values, (6,))
        self.assertEqual(by_name['MEMB.leafStart'].values, (0,))
        typed_payload_asset(arrays, {'sourceSha256': SOURCE_IDENTITY['sha256'], 'converterVersion': 'bsp_visibility_step.py:1'})

    def test_an_out_of_range_render_bound_is_a_named_unreadable_model_with_no_payload(self):
        with self.assertRaises(LevelModelRangeError) as caught:
            self.payload(room_model(render_bound=3))
        reason = model_unreadable_reason(caught.exception)
        self.assertEqual(reason, 'bsp-visibility-model-unreadable:iRenderBound')
        validate_gap_row(tile_bsp_visibility_row(TILE_ID, SOURCE_IDENTITY, [{'reason': reason}], EVIDENCE))


class StaticMeshMemberTests(unittest.TestCase):
    def placement(self, export_index, actor_name):
        return {'id': f'interlude:{TILE_ID}.{actor_name}', 'exportIndex': export_index, 'sourceActor': f'{TILE_ID}.{actor_name}', 'modelId': 'interlude:Mesh.Box'}

    def actor(self, actor_name, location, class_object='Engine.StaticMeshActor'):
        omitted = {'status': 'omitted-class-default-unresolved'}
        transform = {name: omitted for name in ('Rotation', 'DrawScale', 'DrawScale3D', 'PrePivot')}
        return {'object': f'{TILE_ID}.{actor_name}', 'classObject': class_object,
                'sourceTransform': {**transform, 'Location': {'status': 'serialized', 'value': dict(zip('XYZ', location))}}}

    def test_placements_get_box_leaves_zone_sets_and_a_sky_flag_from_their_own_zone(self):
        placements = [self.placement(9, 'Inside'), self.placement(4, 'Sky'), self.placement(5, 'Brush')]
        actors = {actor['object']: actor for actor in (self.actor('Inside', (40.0, 10.0, 20.0)), self.actor('Sky', (70.0, 10.0, 20.0)),
                                                        self.actor('Brush', (0.0, 0.0, 0.0), 'Engine.Brush'))}
        static_meshes = {'chunks': {'chunk-0-0': {'models': [{'placements': placements}]}}}
        members = static_mesh_members(room_model(), static_meshes, actors, SyntheticActorClassDefaults(), lambda model_id: converted_model_glb([True]),
                                      RULES['static-mesh-margin']['runtimeDefault'], frozenset({2}))
        self.assertEqual([(member.export_index, member.kind, member.flags, member.leaves, member.zone_set) for member in members],
                         [(4, STATIC_MESH_MEMBER_KIND, MEMBER_SKY_FLAG, (1,), 1 << 2), (5, STATIC_MESH_MEMBER_KIND, MEMBER_UNBOUNDED_FLAG, (), 0),
                          (9, STATIC_MESH_MEMBER_KIND, 0, (0,), 1 << 1)])
        for actual, expected in zip(members[2].center, (40.5, 10.0, 21.0)):
            self.assertAlmostEqual(actual, expected, places=5)


class VisibilityRecipeAndRegistrationTests(unittest.TestCase):
    def test_every_rule_row_has_provenance_and_a_shared_status(self):
        document, rules = load_bsp_visibility_rules()
        self.assertTrue(all(set(row) == RULE_FIELDS and row['provenance'] and row['status'] in SHARED_STATUSES for row in document['rows']))
        self.assertEqual(rules['emitter-clipping-range']['runtimeDefault'], 'infinity')
        self.assertEqual(document['censusSampleGrid']['cellsPerAxis'], [16, 16, 8])

    def test_the_kind_is_in_the_vocabulary_and_the_tile_resource_pins_the_typed_payload(self):
        self.assertIn('bsp-visibility', load_tile_manifest_vocabulary().resource_kinds)
        sha256 = '7' * 64
        product = {'resource': {'resource': f'/l2/maps/{sha256}/native-tile-bsp-visibility/asset.json', 'sha256': sha256, 'bytes': 2000}}
        self.assertEqual(tile_resources(None, None, product), [{'kind': 'bsp-visibility', 'manifest': product['resource']['resource'],
                                                                'manifestSha256': sha256, 'manifestBytes': 2000}])

    def test_the_step_name_and_version_are_pinned(self):
        self.assertEqual((BSP_VISIBILITY_STEP_NAME, BSP_VISIBILITY_STEP_ALGORITHM_VERSION), ('bsp-visibility', 3))


if __name__ == '__main__':
    unittest.main()
