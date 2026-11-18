import copy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_catalog.ue2 import FormatError
from synthetic_class_scripts import scratch_work_root
from world import unverified_level_tails
from world.level_model import require_unverified_level_tail_length
from world.reader_licensee_layouts import LEVEL_MODEL_READER, READER_LICENSEE_LAYOUTS
from world.shared_sky_step import shared_sky_config
from world.unverified_level_tails import (UNVERIFIED_LEVEL_TAILS_RELATIVE_PATH, UnverifiedLevelTailsError, read_unverified_level_tails,
                                          reviewed_unverified_level_tail_bytes, unverified_level_tail_entry,
                                          validate_unverified_level_tails_document, write_unverified_level_tail)

SHARED_SKY_PAIR = (118, 0)
SHARED_SKY_SUMMARY = {'version': SHARED_SKY_PAIR[0], 'licenseeVersion': SHARED_SKY_PAIR[1]}
SHARED_SKY_LAYOUT = READER_LICENSEE_LAYOUTS[LEVEL_MODEL_READER][SHARED_SKY_PAIR]
SHARED_SKY_FIXTURE = json.loads((ROOT / SHARED_SKY_LAYOUT['fixture']).read_text(encoding='utf-8'))


class UnverifiedLevelTailRecipeTests(unittest.TestCase):
    def test_the_recipe_entry_of_the_shared_sky_pair_is_the_level_binding_of_its_reviewed_fixture(self):
        [entry] = [entry for entry in read_unverified_level_tails()['document']['tails']
                   if (entry['packageVersion'], entry['licenseeVersion']) == SHARED_SKY_PAIR]
        self.assertEqual(entry, unverified_level_tail_entry(SHARED_SKY_FIXTURE))
        self.assertEqual(reviewed_unverified_level_tail_bytes(*SHARED_SKY_PAIR), SHARED_SKY_FIXTURE['levelBinding']['remainingTailBytes'])

    def test_the_tail_check_follows_the_recipe_and_not_the_test_fixture(self):
        reviewed_tail = SHARED_SKY_FIXTURE['levelBinding']['remainingTailBytes']
        recipe = read_unverified_level_tails()
        changed = copy.deepcopy(recipe)
        for entry in changed['document']['tails']:
            entry['remainingTailBytes'] = reviewed_tail + 1
        require_unverified_level_tail_length(SHARED_SKY_LAYOUT, SHARED_SKY_SUMMARY, {'remainingTailBytes': reviewed_tail}, 'skylevel.unr')
        with patch.object(unverified_level_tails, 'read_unverified_level_tails', lambda: changed):
            with self.assertRaisesRegex(FormatError, f'^skylevel.unr Level tail after the Model reference is {reviewed_tail} bytes, not the '
                                                     f'reviewed {reviewed_tail + 1}; RM-22'):
                require_unverified_level_tail_length(SHARED_SKY_LAYOUT, SHARED_SKY_SUMMARY, {'remainingTailBytes': reviewed_tail}, 'skylevel.unr')

    def test_a_pair_without_a_reviewed_tail_is_refused(self):
        with self.assertRaisesRegex(UnverifiedLevelTailsError, f'{UNVERIFIED_LEVEL_TAILS_RELATIVE_PATH}: reviews no Level tail for 118/6'):
            reviewed_unverified_level_tail_bytes(118, 6)

    def test_the_shared_sky_config_carries_the_recipe_sha256(self):
        recipe = read_unverified_level_tails()
        config = shared_sky_config()
        self.assertEqual(config['unverifiedLevelTailsSha256'], recipe['sha256'])
        with patch('world.shared_sky_step.read_unverified_level_tails', lambda: {**recipe, 'sha256': 'c' * 64}):
            self.assertNotEqual(shared_sky_config(), config)

    def test_a_malformed_document_is_refused(self):
        document = read_unverified_level_tails()['document']
        entry = document['tails'][0]
        for changed in ({**document, 'kind': 'other'}, {**document, 'tails': [{**entry, 'remainingTailBytes': -1}]},
                        {**document, 'tails': [{**entry, 'remainingTailSHA256': 'X'}]}, {**document, 'tails': [entry, entry]},
                        {**document, 'tails': [{key: value for key, value in entry.items() if key != 'package'}]}):
            with self.subTest(changed=changed), self.assertRaises(UnverifiedLevelTailsError):
                validate_unverified_level_tails_document(changed)


class UnverifiedLevelTailWriterTests(unittest.TestCase):
    def test_the_writer_adds_a_pair_and_replaces_it_on_a_new_export(self):
        project_root = scratch_work_root(self, 'unverified-level-tails-')
        write_unverified_level_tail(project_root, SHARED_SKY_FIXTURE)
        changed_fixture = copy.deepcopy(SHARED_SKY_FIXTURE)
        changed_fixture['levelBinding']['remainingTailBytes'] += 1
        write_unverified_level_tail(project_root, changed_fixture)
        document = json.loads((project_root / UNVERIFIED_LEVEL_TAILS_RELATIVE_PATH).read_text(encoding='utf-8'))
        self.assertEqual(validate_unverified_level_tails_document(document)['tails'], [unverified_level_tail_entry(changed_fixture)])


if __name__ == '__main__':
    unittest.main()
