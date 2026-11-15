import json
from pathlib import Path, PurePosixPath
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from world.copy_world07_fixtures import find_absolute_path_text

MUSIC_ID_JOIN_PATH = ROOT / 'tests' / 'fixtures' / 'world-07' / 'music-id-join.json'
OBSERVED_MUSIC_VOLUME_JOINS = [
    {'object': '20_20.MusicVolume0', 'nMusicID': 202001, 'bForcePlayMusic': None, 'orderedStrings': ['D03_F', 'D03_S01', 'D03_S02']},
    {'object': '20_20.MusicVolume1', 'nMusicID': 202002, 'bForcePlayMusic': True,
     'orderedStrings': ['F09_F', 'F09_S01', 'F10_F', 'F10_S01', 'F04_F', 'F04_S01']},
]
OBSERVED_JOIN_LIMITS = [
    'Array order, count and spelling are source facts; they do not establish sequential or random selection',
    'The filename join identifies unique local candidates, not observed file loading or audible playback',
    'bForcePlayMusic is retained as authored metadata; its runtime consumer and override policy remain unresolved',
    'No matching entereventgrp ID row does not establish absence of other event relationships',
    'Native triggers, loops, transitions, gain, interruption, selection policy and audio tolerances remain unresolved',
]


def load_music_id_join():
    return json.loads(MUSIC_ID_JOIN_PATH.read_text(encoding='utf-8'))


class MusicIdJoinFixtureTest(unittest.TestCase):
    def setUp(self):
        self.music_id_join = load_music_id_join()

    def test_no_absolute_path_survives_in_the_fixture(self):
        self.assertEqual(find_absolute_path_text(MUSIC_ID_JOIN_PATH.read_text(encoding='utf-8')), [])

    def test_each_music_volume_keeps_its_music_id_and_ordered_musicinfo_strings(self):
        observed_joins = [{'object': join['volumeEvidence']['object'], 'nMusicID': join['volumeEvidence']['nMusicID'],
                           'bForcePlayMusic': join['volumeEvidence'].get('bForcePlayMusic'),
                           'orderedStrings': join['musicinfo']['orderedStrings']} for join in self.music_id_join['joins']]
        self.assertEqual(observed_joins, OBSERVED_MUSIC_VOLUME_JOINS)
        for join in self.music_id_join['joins']:
            with self.subTest(music_id=join['volumeEvidence']['nMusicID']):
                musicinfo = join['musicinfo']
                self.assertEqual(musicinfo['id'], join['volumeEvidence']['nMusicID'])
                self.assertEqual(musicinfo['cnt'], len(musicinfo['orderedStrings']))
                stored_columns = [musicinfo['fields'][f'str[{index}]'] for index in range(musicinfo['cnt'])]
                self.assertEqual(stored_columns, musicinfo['orderedStrings'])

    def test_each_stored_string_matches_one_music_file_basename_under_casefold(self):
        for join in self.music_id_join['joins']:
            ordered_strings = join['musicinfo']['orderedStrings']
            filename_joins = join['filenameJoins']
            self.assertEqual([filename_join['arrayIndex'] for filename_join in filename_joins], list(range(len(ordered_strings))))
            for filename_join, stored_string in zip(filename_joins, ordered_strings):
                with self.subTest(stored_string=stored_string):
                    self.assertEqual(filename_join['storedString'], stored_string)
                    self.assertEqual(len(filename_join['filenameMatches']), 1)
                    matched_file = filename_join['filenameMatches'][0]
                    self.assertNotIn('path', matched_file)
                    self.assertEqual(PurePosixPath(matched_file['pathBasename']).stem.casefold(), stored_string.casefold())
                    self.assertRegex(matched_file['sha256'], r'^[0-9a-f]{64}$')

    def test_the_five_join_limits_are_kept_verbatim(self):
        self.assertEqual(self.music_id_join['limits'], OBSERVED_JOIN_LIMITS)


if __name__ == '__main__':
    unittest.main()
