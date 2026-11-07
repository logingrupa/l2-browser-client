"""Human mystic player recipes, input lock, profile evidence and staging.

Recipe/lock checks are static. Evidence, batch and staging checks use the real
outputs in verify-only mode and are skipped when those outputs are absent.
Nothing here writes to public/l2, the native inputs or the batch outputs.
"""
import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import native_batch  # noqa: E402
import stage_native_players  # noqa: E402

MODELS = ROOT / 'artifacts/native-parity/research/dev-sheet-audio-20261107/models'
MAIN_LOCK = ROOT / 'recipes/native-inputs.lock.json'
MAGIC_LOCK = ROOT / 'recipes/native-pipeline-magic.inputs.lock.json'
STAGE = ROOT / 'recipes/native-player-mystics-stage.json'
CHARGRP = '2bb52de25ef3558f51e458c0095efcd9c509dfd5b5695a269f268b5f235fbc0f'
CLASSES = {'MMagic': ('human-male-mystic', 8), 'FMagic': ('human-female-mystic', 9)}


def load(path):
    return json.loads(path.read_bytes())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class RecipeTests(unittest.TestCase):
    def test_lock_is_main_lock_subset_plus_one_additive_original(self):
        main = {row['relativePath']: row for row in load(MAIN_LOCK)['files']}
        magic = load(MAGIC_LOCK)
        rows = {row['relativePath']: row for row in magic['files']}
        self.assertNotIn('systextures/MMagic.utx', main)
        self.assertEqual({name for name in rows if name not in main}, {'systextures/MMagic.utx'})
        for name, row in rows.items():
            if name in main:
                self.assertEqual(row, main[name])
        self.assertEqual(rows['systextures/MMagic.utx']['sha256'], magic['additiveInputs'][0]['remoteSha256'])
        self.assertEqual([row['relativePath'] for row in magic['files']], sorted(rows, key=str.casefold))

    def test_assemblies_follow_chargrp_rows_and_class_hair(self):
        for name, (job, row) in CLASSES.items():
            recipe = load(ROOT / f'recipes/native-{name.lower()}.json')
            self.assertEqual(len(recipe), 1)
            request = recipe[0]
            self.assertEqual((request['name'], request['animation'], request['withEventAudio']),
                             (f'{name}-native-body-face0-hair0', f'{name}_anim', True))
            parts = request['parts']
            self.assertEqual(len(parts), 7)
            for index, part in enumerate(parts[:5]):
                binding = part['sourceBinding']
                self.assertEqual((binding['table'], binding['sourceSha256'], binding['meshPath'][1]), ('chargrp', CHARGRP, row))
                self.assertEqual(binding['meshPath'][2], 'body_mesh' if index < 4 else 'face_mesh')
            for index, part in zip((4, 5), parts[5:]):
                self.assertNotIn('sourceBinding', part)
                attachment = part.get('rigidAttachment')
                if attachment:
                    self.assertEqual(attachment['bone'], 'Bip01_head')
                    self.assertEqual(attachment['source']['class'], 'LineageWarrior.' + name)
                    self.assertEqual(attachment['source']['meshPath'], ['SubMeshes', index])
            # No height fitting or scale override can enter through the recipe.
            self.assertFalse({'scale', 'height', 'drawScale', 'recenter', 'ground'} & {key.casefold() for key in request})
        self.assertIn('animationFamilyBinding', load(ROOT / 'recipes/native-mmagic.json')[0])
        self.assertNotIn('animationFamilyBinding', load(ROOT / 'recipes/native-fmagic.json')[0])

    def test_pipeline_recipes_use_the_magic_lock(self):
        for name, (job, _) in CLASSES.items():
            recipe = load(ROOT / f'recipes/native-pipeline-{name.lower()}.json')
            self.assertEqual(recipe['sources']['interlude']['lock'], 'recipes/native-pipeline-magic.inputs.lock.json')
            self.assertEqual(recipe['jobs'], [{'id': job, 'adapter': 'assets', 'source': 'interlude', 'recipe': f'recipes/native-{name.lower()}.json'}])

    def test_stage_profiles_are_valid_and_native_scaled(self):
        stage = load(STAGE)
        self.assertEqual({profile['id'] for profile in stage['profiles']}, {job for job, _ in CLASSES.values()})
        for profile in stage['profiles']:
            stage_native_players.profile_shape(profile)
            self.assertEqual((profile['actorScale'], profile['sourceUnitsPerMetre'], profile['forwardAxis']), ([1, 1, 1], 100, [1, 0, 0]))
        dims = {profile['id']: (profile['collisionRadius'], profile['collisionHeight']) for profile in stage['profiles']}
        self.assertEqual(dims, {'human-male-mystic': (7.5, 22.8), 'human-female-mystic': (6.5, 22.5)})


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        if not (MODELS / 'PROFILE_EVIDENCE.json').is_file():
            self.skipTest('Mystic profile evidence is absent')
        self.evidence = load(MODELS / 'PROFILE_EVIDENCE.json')

    def test_stage_recipe_equals_class_evidence(self):
        stage = load(STAGE)
        profiles = {profile['id']: profile for profile in stage['profiles']}
        models = {model['catalogId']: model for model in stage['models']}
        for name, (job, _) in CLASSES.items():
            evidence, profile = self.evidence['profiles'][name], profiles[job]
            self.assertEqual(profile['sourceEvidence']['reportSha256'], sha(MODELS / 'PROFILE_EVIDENCE.json'))
            for key in ('assetId', 'sourceObject', 'sourceSha256', 'collisionRadius', 'collisionHeight', 'actorScale'):
                self.assertEqual(profile[key], evidence[key], name + ' ' + key)
            self.assertEqual(profile['forwardAxis'], evidence['facing']['axisRecommendation'])
            self.assertEqual(models[profile['catalogId']]['archiveSha256'], evidence['archiveSha256'])
            self.assertEqual(evidence['resolved']['DrawScale'], {'value': 1.0, 'origin': 'Engine.Actor'})
            self.assertEqual(evidence['resolved']['CollisionRadius']['origin'], 'LineageWarrior.' + name)
            self.assertEqual(evidence['unresolved'], ['PrePivot'])


class OutputVerificationTests(unittest.TestCase):
    def test_batches_verify_without_conversion(self):
        import native_assets
        for name in CLASSES:
            output = MODELS / 'build' / name.lower()
            if not (output / 'complete.json').is_file():
                self.skipTest('Mystic batch output is absent')
            owner = load(output / 'owner.json')
            if owner['jobs'][0]['descriptor']['adapterPins'].get('fingerprint:native-assets') != native_assets.implementation_hash():
                # Any edit under scripts/native_assets_lib changes the converter fingerprint;
                # a batch is then reusable only as a fresh rebuild (see the provenance-only check below).
                self.skipTest('Converter fingerprint changed since the staged mystic batch; rebuild into a fresh output to verify')
            result = native_batch.run(ROOT / f'recipes/native-pipeline-{name.lower()}.json', output, verify_only=True)
            self.assertEqual((result['mode'], result['status'], result['writes'], result['adapterExecutions']), ('verify', 'converted', 0, 0))

    def test_fresh_rebuilds_differ_from_staged_archives_only_in_converter_pin(self):
        import zipfile
        stage = {model['catalogId']: model for model in load(STAGE)['models']}
        checked = 0
        for name, (job, _) in CLASSES.items():
            staged = ROOT / stage[job + ':0']['archive']
            for rebuilt in sorted(MODELS.glob(f'build-repro-*/{name.lower()}/jobs/{job}/*/asset.l2asset')):
                if not staged.is_file():
                    continue
                with zipfile.ZipFile(staged) as left, zipfile.ZipFile(rebuilt) as right:
                    self.assertEqual(set(left.namelist()), set(right.namelist()))
                    differing = sorted(entry for entry in left.namelist() if left.read(entry) != right.read(entry))
                    self.assertEqual(differing, ['asset.json', 'provenance.json'] if differing else [])
                    if differing:
                        a, b = json.loads(left.read('provenance.json')), json.loads(right.read('provenance.json'))
                        self.assertEqual({key for key in a if a[key] != b.get(key)}, {'converterSha256'})
                checked += 1
        if not checked:
            self.skipTest('No fresh mystic rebuild is present')

    def test_staging_verifies_without_writes(self):
        catalog = ROOT / 'public/l2/catalog.json'
        stage = load(STAGE)
        if not catalog.is_file() or not all((ROOT / model['archive']).is_file() for model in stage['models']):
            self.skipTest('Staging inputs are absent')
        ids = {row['id'] for row in load(catalog)['models']}
        if not {model['catalogId'] for model in stage['models']} <= ids:
            self.skipTest('Mystics are not staged in this tree')
        result = stage_native_players.stage(STAGE, ROOT / 'public/l2', sha(catalog), verify_only=True)
        self.assertEqual((result['status'], result['filesWritten'], result['addedModels'], result['addedProfiles']), ('verified', 0, [], []))


if __name__ == '__main__':
    unittest.main()
