from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from side_by_side import build_pair_queue as pair_queue
from side_by_side.build_pair_queue import build_pair_queue, queue_file_path, write_pair_queue
from side_by_side_fixture import write_queue_union

WAITING_RULE_NAMES = ['npc-texture-slot', 'ptds-3', 'ptds-6', 'sky-20-20', 'minimap-projection', 'hair-4dd2', 'statuswnd']


class PairQueueTestCase(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve()

    def queue(self, **union_changes):
        store_root, _, _ = write_queue_union(self.project_root, **union_changes)
        return build_pair_queue(self.project_root, store_root)

    def entries_by_part_and_key(self, queue):
        return {(entry['part'], entry['key']): entry for entry in queue['entries']}

    def test_waiting_rules_come_first_in_rule_order_with_their_key_or_a_reason(self):
        queue = self.queue()
        rules = {rule['rule']: rule for rule in queue['waitingRules']}
        self.assertEqual([rule['rule'] for rule in queue['waitingRules']], WAITING_RULE_NAMES)
        self.assertEqual({name: rules[name]['key'] for name in WAITING_RULE_NAMES},
                         {'npc-texture-slot': 'npc:1002', 'ptds-3': 'skill:1011:1', 'ptds-6': 'skill:1011:2', 'sky-20-20': 'tile:20_20',
                          'minimap-projection': 'tile:20_20', 'hair-4dd2': None, 'statuswnd': 'window:StatusWnd'})
        self.assertEqual((rules['hair-4dd2']['reason'], rules['hair-4dd2']['candidateKey']), ('no-matching-key', None))
        self.assertEqual(rules['minimap-projection']['part'], 'minimap')
        for part in ('world', 'ui', 'npcs', 'skills-effects'):
            part_steps = [entry['step'] for entry in queue['entries'] if entry['part'] == part]
            self.assertEqual(part_steps[0], 'waiting', part)
            self.assertEqual(part_steps, sorted(part_steps, key=['waiting', 'class', 'census'].index), part)

    def test_an_ineligible_waiting_key_is_listed_with_key_null_and_its_reason(self):
        queue = self.queue(load_status_changes={'window:StatusWnd': 'failed'}, census_gap_keys=('npc:1002',))
        rules = {rule['rule']: rule for rule in queue['waitingRules']}
        self.assertEqual((rules['statuswnd']['key'], rules['statuswnd']['candidateKey'], rules['statuswnd']['reason']),
                         (None, 'window:StatusWnd', 'loads-failed'))
        self.assertEqual((rules['npc-texture-slot']['key'], rules['npc-texture-slot']['reason']), (None, 'census-gap'))

    def test_class_step_takes_one_key_per_class_value_not_yet_covered(self):
        queue = self.queue()
        class_entries = [(entry['key'], entry['classValue']) for entry in queue['entries'] if entry['step'] == 'class']
        self.assertEqual(class_entries, [('tile:21_20', 23), ('window:ChatTexture', 'Texture'), ('npc:1001', ['LineageMonsters']),
                                         ('item:57', ['LineageWeapons']), ('item:58', ['DarkElf'])])

    def test_census_step_fills_up_to_the_per_kind_budget_beyond_steps_one_and_two(self):
        with mock.patch.object(pair_queue, 'CENSUS_KEYS_PER_KIND', 1):
            queue = self.queue()
        census_entries = [(entry['part'], entry['key']) for entry in queue['entries'] if entry['step'] == 'census']
        self.assertEqual(census_entries, [('world', 'tile:20_21'), ('ui', 'window:NewRadarWnd'), ('npcs', 'npc:1003')])

    def test_gap_keys_keys_without_a_load_pass_and_character_keys_never_appear(self):
        queue = self.queue(census_gap_keys=('npc:1003',), load_status_changes={'tile:21_20': 'failed'})
        queued_keys = {entry['key'] for entry in queue['entries']}
        self.assertNotIn('npc:1003', queued_keys)
        self.assertNotIn('tile:21_20', queued_keys)
        self.assertFalse(any(entry['part'] == 'player-characters' for entry in queue['entries']))

    def test_session_kind_and_native_selection_per_kind(self):
        entries = self.entries_by_part_and_key(self.queue())
        self.assertEqual({part_and_key: entry['sessionKind'] for part_and_key, entry in entries.items()}, {
            ('world', 'tile:20_20'): 'offline-debug', ('minimap', 'tile:20_20'): 'server', ('world', 'tile:20_21'): 'server',
            ('world', 'tile:21_20'): 'server', ('ui', 'window:StatusWnd'): 'server', ('ui', 'window:ChatTexture'): 'server',
            ('ui', 'window:NewRadarWnd'): 'server', ('npcs', 'npc:1001'): 'offline-debug', ('npcs', 'npc:1002'): 'offline-debug',
            ('npcs', 'npc:1003'): 'offline-debug', ('items', 'item:57'): 'offline-debug', ('items', 'item:58'): 'server',
            ('skills-effects', 'skill:1011:1'): 'offline-debug', ('skills-effects', 'skill:1011:2'): 'offline-debug'})
        self.assertEqual(entries[('world', 'tile:20_20')]['nativeSelection'], {'route': 'offline-debug-startup', 'map': '20_20'})
        self.assertEqual(entries[('world', 'tile:20_21')]['nativeSelection'], {'route': 'server-world', 'map': '20_21'})
        self.assertEqual(entries[('npcs', 'npc:1002')]['nativeSelection'],
                         {'viewer': 'nv', 'searchText': 'Npc 1002', 'expectedMeshText': 'LineageNpcs.npc_1002_m00',
                          'expectedTextureTexts': ['LineageNpcsTex.npc_1002_t00', 'LineageNpcsTex.npc_1002_t01']})
        self.assertEqual(entries[('items', 'item:57')]['nativeSelection'],
                         {'viewer': 'pv', 'itemId': 57, 'expectedMeshTexts': ['LineageWeapons.blade_m00_wp']})
        self.assertEqual(entries[('items', 'item:58')]['nativeSelection'],
                         {'viewer': 'server-world', 'itemId': 58, 'expectedMeshTexts': ['DarkElf.FDarkElf_m001_u']})
        self.assertEqual(entries[('skills-effects', 'skill:1011:2')]['nativeSelection'], {'viewer': 'sv', 'skillId': 1011, 'level': 2})
        self.assertEqual(entries[('ui', 'window:StatusWnd')]['nativeSelection'], {'route': 'server-world', 'window': 'StatusWnd'})

    def test_a_tile_pinning_a_minimap_gets_a_minimap_entry_right_after_it(self):
        queue = self.queue()
        orders = {(entry['part'], entry['key']): entry['order'] for entry in queue['entries']}
        minimap_entry = self.entries_by_part_and_key(queue)[('minimap', 'tile:20_20')]
        self.assertEqual(orders[('minimap', 'tile:20_20')], orders[('world', 'tile:20_20')] + 1)
        self.assertEqual(minimap_entry['nativeSelection'], {'route': 'server-world', 'window': 'NewRadarWnd', 'map': '20_20'})
        self.assertEqual(minimap_entry['rule'], 'minimap-projection')
        self.assertEqual([entry for entry in queue['entries'] if entry['part'] == 'minimap'], [minimap_entry])

    def test_the_same_inputs_give_a_byte_identical_queue_file(self):
        store_root, _, catalog_sha256 = write_queue_union(self.project_root)
        first_path, _ = write_pair_queue(self.project_root, store_root)
        first_bytes = first_path.read_bytes()
        second_path, _ = write_pair_queue(self.project_root, store_root)
        self.assertEqual(first_path, queue_file_path(self.project_root, catalog_sha256))
        self.assertEqual(second_path.read_bytes(), first_bytes)


if __name__ == '__main__':
    unittest.main()
