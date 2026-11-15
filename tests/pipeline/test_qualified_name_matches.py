from pathlib import Path
import sys
import unittest

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / 'scripts'))

from native_actor_profiles import UNMATCHED_ACTOR_CLASS_MESSAGE
from native_assets_lib.qualified_export_names import (CASE_INSENSITIVE_SPELLING_MATCH, EXACT_SPELLING_MATCH, QualifiedNameMatch,
                                                      is_actor_class_chain, package_export_objects, unique_qualified_export_match)
from native_catalog.ue2 import FormatError
from test_npc_batch import NpcBatchFixture, SyntheticSourcePackages, synthetic_closure


class UniqueQualifiedExportMatchTests(unittest.TestCase):
    def setUp(self):
        self.export_objects = package_export_objects(
            SyntheticSourcePackages(['LineageNPC.Exact', 'lineagenpc.lowercase_export', 'LineageNPC.Twice', 'LINEAGENPC.TWICE']), 'LineageNPC.Exact')

    def test_an_exact_spelling_matches_itself(self):
        self.assertEqual(unique_qualified_export_match(self.export_objects, 'LineageNPC.Exact', UNMATCHED_ACTOR_CLASS_MESSAGE),
                         QualifiedNameMatch('LineageNPC.Exact', 'LineageNPC.Exact', EXACT_SPELLING_MATCH))

    def test_one_export_equal_ignoring_case_matches_and_keeps_both_spellings(self):
        self.assertEqual(unique_qualified_export_match(self.export_objects, 'LineageNPC.Lowercase_Export', UNMATCHED_ACTOR_CLASS_MESSAGE),
                         QualifiedNameMatch('LineageNPC.Lowercase_Export', 'lineagenpc.lowercase_export', CASE_INSENSITIVE_SPELLING_MATCH))

    def test_two_exports_equal_ignoring_case_are_refused_naming_both(self):
        with self.assertRaisesRegex(FormatError, '^Qualified name matches two or more exports ignoring case: LineageNPC.twice matches '
                                                 'LINEAGENPC.TWICE and LineageNPC.Twice$'):
            unique_qualified_export_match(self.export_objects, 'LineageNPC.twice', UNMATCHED_ACTOR_CLASS_MESSAGE)

    def test_no_export_equal_ignoring_case_is_refused_with_the_caller_message(self):
        with self.assertRaisesRegex(FormatError, f'^{UNMATCHED_ACTOR_CLASS_MESSAGE}$'):
            unique_qualified_export_match(self.export_objects, 'LineageNPC.Absent', UNMATCHED_ACTOR_CLASS_MESSAGE)

    def test_an_actor_class_chain_names_engine_actor_and_core_object_in_any_case(self):
        self.assertTrue(is_actor_class_chain(['lineagenpc.guard', 'engine.actor', 'CORE.OBJECT']))
        self.assertFalse(is_actor_class_chain(['LineageNPC.Guard', 'Core.Object']))


class NpcBatchQualifiedNameTests(NpcBatchFixture):
    def test_a_class_that_matches_one_export_only_ignoring_case_joins_its_pack(self):
        requested_class = self.npcgrp['data']['npc'][2]['class_name']
        plan = self.batch_plan(self.source_identities(self.export_objects_with({requested_class: [requested_class.upper()]})))
        self.assertEqual(plan.planning_gaps, ())
        self.assertIn(20, [row.npc_id for pack in plan.packs for row in pack.rows])

    def test_a_class_that_matches_two_exports_ignoring_case_is_a_planning_gap_outside_every_pack(self):
        requested_class = self.npcgrp['data']['npc'][2]['class_name']
        plan = self.batch_plan(self.source_identities(self.export_objects_with({requested_class: [requested_class, requested_class.upper()]})))
        self.assertEqual([(gap.npc_id, gap.reason) for gap in plan.planning_gaps],
                         [(20, f'converter-refused:Qualified name matches two or more exports ignoring case: {requested_class} matches '
                               f'{requested_class.upper()} and {requested_class}')])
        self.assertNotIn(20, [row.npc_id for pack in plan.packs for row in pack.rows])

    def test_a_class_that_matches_no_export_is_a_planning_gap_outside_every_pack(self):
        requested_class = self.npcgrp['data']['npc'][2]['class_name']
        plan = self.batch_plan(self.source_identities(self.export_objects_with({requested_class: []})))
        self.assertEqual([(gap.npc_id, gap.reason) for gap in plan.planning_gaps],
                         [(20, 'converter-refused:Actor class matches no qualified class export, even ignoring case')])

    def test_a_class_outside_engine_actor_is_a_planning_gap_outside_every_pack(self):
        object_class = self.npcgrp['data']['npc'][1]['class_name']
        plan = self.batch_plan(self.source_identities(
            closure_of=lambda class_name: ('Core.Object', class_name) if class_name == object_class else synthetic_closure(class_name)))
        self.assertEqual([(gap.npc_id, gap.reason) for gap in plan.planning_gaps],
                         [(11, 'converter-refused:NPC actor class inheritance must resolve through Engine.Actor to Core.Object')])

    def test_a_mesh_that_matches_one_export_only_ignoring_case_joins_its_pack(self):
        requested_mesh = self.npcgrp['data']['npc'][0]['mesh_name']
        plan = self.batch_plan(self.source_identities(self.export_objects_with({requested_mesh: [requested_mesh.upper()]})))
        self.assertEqual(plan.planning_gaps, ())
        self.assertIn(30, [row.npc_id for pack in plan.packs for row in pack.rows])

    def test_a_mesh_that_matches_two_exports_ignoring_case_is_a_planning_gap_outside_every_pack(self):
        requested_mesh = self.npcgrp['data']['npc'][0]['mesh_name']
        plan = self.batch_plan(self.source_identities(self.export_objects_with({requested_mesh: [requested_mesh, requested_mesh.upper()]})))
        self.assertEqual([(gap.npc_id, gap.reason) for gap in plan.planning_gaps],
                         [(30, f'converter-refused:Qualified name matches two or more exports ignoring case: {requested_mesh} matches '
                               f'{requested_mesh.upper()} and {requested_mesh}')])
        self.assertNotIn(30, [row.npc_id for pack in plan.packs for row in pack.rows])

    def test_a_mesh_that_matches_no_export_is_a_planning_gap_outside_every_pack(self):
        requested_mesh = self.npcgrp['data']['npc'][0]['mesh_name']
        plan = self.batch_plan(self.source_identities(self.export_objects_with({requested_mesh: []})))
        self.assertEqual([(gap.npc_id, gap.reason) for gap in plan.planning_gaps],
                         [(30, 'converter-refused:NPC mesh matches no qualified skeletal mesh export, even ignoring case')])




if __name__ == '__main__':
    unittest.main()
