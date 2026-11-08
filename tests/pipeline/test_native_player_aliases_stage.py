import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import stage_native_players  # noqa: E402

RECIPE = ROOT / 'recipes/native-player-aliases-stage.json'
REPORT = ROOT / 'artifacts/native-parity/research/dev-sheet-audio-20261107/models/ALIAS_COVERAGE.json'
CATALOG = ROOT / 'public/l2/catalog.json'
CLASSES = {'human-male-fighter': 'MFighter', 'human-female-fighter': 'FFighter',
           'human-male-mystic': 'MMagic', 'human-female-mystic': 'FMagic'}
NATIVE_DRAW_SCALE_AND_SOURCE_UNITS_PER_METRE = ([1, 1, 1], 100)


def load(path):
    return json.loads(path.read_bytes())


def load_prepare_native_player_aliases_script():
    spec = importlib.util.spec_from_file_location('prepare_native_player_aliases', ROOT / 'scripts/prepare-native-player-aliases.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RecipeTests(unittest.TestCase):
    def test_python_alias_keys_match_the_browser_alias_list(self):
        source = (ROOT / 'src/assets/native/nativeAnimationAliases.ts').read_text(encoding='utf-8')
        browser = re.findall(r'\{ alias: "(\w+)", field:', source) + [f'social{index}' for index in range(2, 14)]
        self.assertIn('[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map', source)
        self.assertEqual(tuple(browser), stage_native_players.PLAYER_ALIASES)
        self.assertEqual(re.search(r'requiredNativeAliases = \[([^\]]+)\]', source).group(1).replace('"', '').replace(' ', '').split(','),
                         list(stage_native_players.REQUIRED_ALIASES))

    def test_every_profile_binds_45_aliases_and_leaves_only_damage_unmapped(self):
        recipe = load(RECIPE)
        self.assertEqual((recipe['schemaVersion'], recipe['kind'], recipe['models']), (1, 'native-player-stage', []))
        self.assertEqual([row['id'] for row in recipe['profiles']], list(CLASSES))
        self.assertEqual(set(recipe['supersedes']), set(CLASSES))
        self.assertEqual(recipe['supersedes']['human-male-fighter'], 'built-in')
        for profile in recipe['profiles']:
            stage_native_players.profile_shape(profile)
            cls, rows = CLASSES[profile['id']], profile['aliasEvidence']['rows']
            self.assertEqual([row['alias'] for row in rows], list(stage_native_players.PLAYER_ALIASES))
            self.assertEqual(len(profile['clips']), 45)
            unbound = [row for row in rows if row['status'] not in stage_native_players.BOUND_STATUSES]
            self.assertEqual([(row['alias'], row['key'], row['status']) for row in unbound], [('damage', 'DamageAnimName[0]', 'no-family-value')])
            self.assertIn('do not substitute DamageFly', unbound[0]['reason'])
            self.assertNotIn('damage', profile['clips'])
            self.assertEqual(profile['clips']['damageFly'], f'Damagefly_{cls}')
            self.assertEqual({alias: profile['clips'][alias] for alias in ('idle', 'walk', 'run', 'attack', 'death')},
                             {'idle': f'Wait_Hand_{cls}', 'walk': f'Walk_Hand_{cls}', 'run': f'Run_Hand_{cls}',
                              'attack': f'Atk01_Hand_{cls}', 'death': f'Death_{cls}'})
            self.assertEqual((profile['actorScale'], profile['sourceUnitsPerMetre']), NATIVE_DRAW_SCALE_AND_SOURCE_UNITS_PER_METRE)
            self.assertEqual(profile['aliasEvidence']['family'], 'WT_HAND')
            self.assertEqual(profile['aliasEvidence']['reportSha256'], hashlib.sha256(REPORT.read_bytes()).hexdigest()
                             if REPORT.is_file() else profile['aliasEvidence']['reportSha256'])


class OutputVerificationTests(unittest.TestCase):
    def setUp(self):
        if not REPORT.is_file() or not CATALOG.is_file():
            self.skipTest('Alias report or staged catalog is absent')

    def test_recipe_regenerates_byte_identically_without_writes(self):
        module = load_prepare_native_player_aliases_script()
        result = module.run(RECIPE, REPORT.parent, CATALOG, ROOT / 'public/l2', ROOT / 'artifacts/native-parity/inputs/IMPORTA-PC',
                            ROOT / 'recipes/native-player-mfighter-base.json', verify_only=True)
        self.assertEqual((result['status'], result['filesWritten']), ('verified', 0))
        self.assertEqual(set(result['coverage'].values()), {'45 of 46'})

    def test_staged_catalog_carries_the_alias_update(self):
        catalog = load(CATALOG)
        bundle = next((row for row in catalog.get('playerProfiles', []) if row['id'] == stage_native_players.BUNDLE_ID), None)
        if bundle is None:
            self.skipTest('No managed player profiles are staged')
        staged = {row['id']: row for row in load(ROOT / 'public' / bundle['manifest'].lstrip('/'))['profiles']}
        if any(row['id'] not in staged for row in load(RECIPE)['profiles']):
            self.skipTest('The alias update is not staged in this tree')
        result = stage_native_players.stage(RECIPE, ROOT / 'public/l2', hashlib.sha256(CATALOG.read_bytes()).hexdigest(), verify_only=True)
        self.assertEqual((result['status'], result['filesWritten'], result['addedProfiles'], result['supersededProfiles']), ('verified', 0, [], []))


if __name__ == '__main__':
    unittest.main()
