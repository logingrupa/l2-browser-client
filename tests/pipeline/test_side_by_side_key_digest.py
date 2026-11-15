from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from native_store.catalog_index_keys import catalog_index_keys
from native_store.coverage_denominators import CoverageReportError
from native_store.side_by_side_key_digest import key_content_sha256_by_key
from side_by_side_fixture import (CHARACTER_CHARGRP_INDEX, FIRST_NPC_ID, ONE_PART_ITEM_ID, SECOND_NPC_ID, SKILL_ID, TWO_PART_ITEM_ID,
                                  UPPER_ITEM_ID, actor_models, skill_effect_components, unverified_tile_record, with_changed_pin,
                                  write_actor_store, write_player_store, write_single_record_store)

FIRST_NPC_KEY = f'npc:{FIRST_NPC_ID}'
SECOND_NPC_KEY = f'npc:{SECOND_NPC_ID}'
TWO_PART_ITEM_KEY = f'item:{TWO_PART_ITEM_ID}'
ONE_PART_ITEM_KEY = f'item:{ONE_PART_ITEM_ID}'
LEVEL_TEN_SKILL_KEY = f'skill:{SKILL_ID}:10'
LEVEL_ELEVEN_SKILL_KEY = f'skill:{SKILL_ID}:11'


class KeyContentDigestTest(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.temporary_root = Path(temporary_directory.name).resolve()

    def store_root(self, name):
        return self.temporary_root / name / 'l2'

    def actor_digests(self, name, **catalog_changes):
        store_root = self.store_root(name)
        return key_content_sha256_by_key(store_root, write_actor_store(store_root, **catalog_changes))

    def assert_changed_only(self, before, after, changed_keys):
        self.assertEqual(set(before), set(after))
        self.assertEqual({key for key in before if before[key] != after[key]}, set(changed_keys))

    def test_tile_window_and_table_digests_equal_their_manifest_sha256(self):
        store_root = self.store_root('single')
        catalog = write_single_record_store(store_root)
        digests = key_content_sha256_by_key(store_root, catalog)
        self.assertEqual(digests, {'table:itemname-e': catalog['tables'][0]['manifestSha256'],
                                   'tile:20_20': catalog['tiles'][0]['manifestSha256'],
                                   'window:StatusWnd': catalog['windows'][0]['manifestSha256']})

    def test_every_catalog_index_key_has_a_digest(self):
        store_root = self.store_root('actors')
        catalog = write_actor_store(store_root)
        digests = key_content_sha256_by_key(store_root, catalog)
        self.assertEqual(tuple(digests), catalog_index_keys(store_root, catalog))
        self.assertTrue({FIRST_NPC_KEY, SECOND_NPC_KEY, TWO_PART_ITEM_KEY, ONE_PART_ITEM_KEY, LEVEL_TEN_SKILL_KEY,
                         LEVEL_ELEVEN_SKILL_KEY} <= set(digests))

    def test_byte_identical_catalogs_give_identical_digests(self):
        self.assertEqual(self.actor_digests('first'), self.actor_digests('second'))

    def test_npc_digest_follows_its_profile_pack_manifest(self):
        before = self.actor_digests('before')
        after = self.actor_digests('after', first_npc_name='First renamed')
        self.assert_changed_only(before, after, {FIRST_NPC_KEY, SECOND_NPC_KEY})

    def test_npc_digest_follows_its_joined_model_and_not_another_npc_model(self):
        before = self.actor_digests('before')
        after = self.actor_digests('after', models=with_changed_pin(actor_models(), 'npc-model:second', 'archiveSha256'))
        self.assert_changed_only(before, after, {SECOND_NPC_KEY})

    def test_item_digest_covers_every_body_part_model_record_of_the_item(self):
        before = self.actor_digests('before')
        after = self.actor_digests('after', models=with_changed_pin(actor_models(), f'interlude:item:{TWO_PART_ITEM_ID}:body-part:1:armor:3',
                                                                    'archiveSha256'))
        self.assert_changed_only(before, after, {TWO_PART_ITEM_KEY})

    def test_skill_digest_covers_every_effect_component_of_the_skill_level(self):
        before = self.actor_digests('before')
        after = self.actor_digests('after', effect_components=with_changed_pin(
            skill_effect_components(), f'interlude:skill:{SKILL_ID}:level:10:impact', 'manifestSha256'))
        self.assert_changed_only(before, after, {LEVEL_TEN_SKILL_KEY})

    def test_character_digest_follows_its_model_and_upper_item_digest_follows_its_model(self):
        before_root, after_root = self.store_root('before'), self.store_root('after')
        before = key_content_sha256_by_key(before_root, write_player_store(before_root))
        after = key_content_sha256_by_key(after_root, write_player_store(after_root, upper_item_model_id='character-model:0'))
        self.assertEqual(set(before), {f'character:{CHARACTER_CHARGRP_INDEX}', f'item:{UPPER_ITEM_ID}'})
        self.assert_changed_only(before, after, {f'character:{CHARACTER_CHARGRP_INDEX}', f'item:{UPPER_ITEM_ID}'})

    def test_record_without_a_pinned_sha256_is_refused(self):
        models = actor_models()
        del models[0]['archiveSha256']
        with self.assertRaisesRegex(CoverageReportError, 'npc-model:first has no pinned SHA-256'):
            self.actor_digests('unpinned', models=models)

    def test_sandbox_half_on_another_digest_is_stale_by_plain_equality(self):
        before = self.actor_digests('before')
        after = self.actor_digests('after', models=with_changed_pin(actor_models(), 'npc-model:first', 'archiveSha256'))
        record = unverified_tile_record(key_content_sha256=before[FIRST_NPC_KEY])
        self.assertEqual(record['sandboxHalf']['keyContentSha256'], before[FIRST_NPC_KEY])
        self.assertNotEqual(record['sandboxHalf']['keyContentSha256'], after[FIRST_NPC_KEY])
        self.assertEqual(before[SECOND_NPC_KEY], after[SECOND_NPC_KEY])


if __name__ == '__main__':
    unittest.main()
