import copy
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import wave

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets import archive_bytes
from native_assets_lib.gltf import json_bytes
from native_assets_lib import stepsound_package_bundle as subject
from native_assets_lib.sha256_identity import sha256_hex_digest
import stage_native_stepsound_package as stager

PACKAGE = 'sounds/stepsound.uax'
GROUP_AND_MIXED_CASE_SOUND_NAMES = [
    ('Stone', 'stone_walk_01'), ('Stone', 'Stone_Walk_02'), ('Stone', 'stone_run_01'), ('Stone', 'stone_run_02'),
    ('Wood', 'wood_walk_01'), ('Wood', 'Wood_Run_01'),
    ('water', 'water_shalow_01'), ('water', 'Water_Shalow_02'), ('water', 'Water_In'), ('water', 'Water_Out'),
    ('noise_boots', 'noise_01'), ('noise_boots', 'noise_02'),
]


def snapshot(root):
    return {p.relative_to(root).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns) for p in root.rglob('*') if p.is_file()}


class StepsoundPackageTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='stepsound-package-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.output = self.root / 'artifacts/bundle'
        self.package_bytes = b'original stepsound package fixture'
        self.package_sha = sha256_hex_digest(self.package_bytes)
        self.inventory = {'kind': 'native-staged-sound-inventory', 'packages': [{
            'source': {'relativePath': PACKAGE, 'sha256': self.package_sha, 'bytes': len(self.package_bytes)},
            'status': 'enumerated', 'soundCount': len(GROUP_AND_MIXED_CASE_SOUND_NAMES), 'expectedSounds': len(GROUP_AND_MIXED_CASE_SOUND_NAMES)}], 'sounds': []}
        self.coverage = {'kind': 'native-staged-sound-coverage', 'sounds': []}
        for ordinal, (group, name) in enumerate(GROUP_AND_MIXED_CASE_SOUND_NAMES):
            self.add_sound(ordinal + 2, group, name, frames=bytes([ordinal + 1, 0]) * (ordinal + 2))
        self.recipe = {'schemaVersion': 1, 'kind': subject.RECIPE_KIND,
                       'package': {'objectPrefix': 'stepsound', 'relativePath': PACKAGE, 'sha256': self.package_sha, 'bytes': len(self.package_bytes)},
                       'corpus': {'root': 'inputs/corpus'},
                       'surfaces': [{'id': 'Stone', 'group': 'Stone', 'gaitSplit': True, 'expected': {'walk': 2, 'run': 2}},
                                    {'id': 'Wood', 'group': 'Wood', 'gaitSplit': True, 'expected': {'walk': 1, 'run': 1}},
                                    {'id': 'Water_Shalow', 'label': 'Water shallow', 'group': 'water', 'namePrefix': 'water_shalow',
                                     'gaitSplit': False, 'expected': {'any': 2}}],
                       'events': [{'id': 'Water_In', 'group': 'water', 'name': 'Water_In'},
                                  {'id': 'Water_Out', 'group': 'water', 'name': 'Water_Out'}],
                       'layers': [{'id': 'noise_boots', 'group': 'noise_boots', 'namePrefix': 'noise', 'expected': 2}],
                       'expectedCoverage': {'sounds': 12, 'wavFiles': 12, 'surfaces': 3, 'gaitSurfaces': 2, 'events': 2, 'layers': 1}}
        self.placement = None
        self.save()

    def add_sound(self, export, group, name, frames):
        stream = io.BytesIO()
        with wave.open(stream, 'wb') as writer:
            writer.setnchannels(1); writer.setsampwidth(2); writer.setframerate(22050); writer.writeframes(frames)
        wav = stream.getvalue()
        obj, stable = f'stepsound.{group}.{name}', f'FIXTURE:{self.package_sha}:{export}'
        asset = {'schemaVersion': 1, 'kind': 'audio', 'id': 'interlude:' + obj,
                 'source': {'edition': 'interlude', 'object': obj, 'sha256': self.package_sha}, 'audio': {'file': 'audio.wav'}, 'animationEvents': []}
        payloads = {'audio.wav': wav, 'provenance.json': json_bytes({'metadata': {
            'nativeExportIndex': export, 'encodedAudioUnchanged': True, 'nativePayloadSha256': sha256_hex_digest(wav)}})}
        asset['files'] = [{'path': n, 'bytes': len(b), 'sha256': sha256_hex_digest(b)} for n, b in payloads.items()]
        archive = self.write(f'inputs/corpus/cache/{export}/asset.l2asset', archive_bytes(asset, payloads))
        self.write(f'inputs/corpus/cache/{export}/audio.wav', wav)
        self.write(f'inputs/corpus/source/{export}/native-payload.bin', wav)
        self.inventory['sounds'].append({'stableId': stable, 'id': asset['id'], 'status': 'source-ready',
            'export': {'exportIndex': export, 'classObject': 'Engine.Sound', 'object': obj},
            'sourcePackage': {'relativePath': PACKAGE, 'sha256': self.package_sha, 'bytes': len(self.package_bytes)},
            'nativePayload': {'path': f'source/{export}/native-payload.bin', 'sha256': sha256_hex_digest(wav), 'bytes': len(wav)},
            'serializedExport': {'path': f'source/{export}/serialized.bin', 'bytes': len(wav) + 9, 'sha256': sha256_hex_digest(b'x' + wav)},
            'nativeSound': {'exportIndex': export, 'embeddedPayloadSha256': sha256_hex_digest(wav)}})
        self.coverage['sounds'].append({'stableId': stable, 'status': 'exported-and-verified', 'products': {
            'archive': {**archive, 'path': f'cache/{export}/asset.l2asset'},
            'audio': {'path': f'cache/{export}/audio.wav', 'sha256': sha256_hex_digest(wav), 'bytes': len(wav),
                      'metadata': {'durationSeconds': len(frames) / 2 / 22050}}}})

    def write(self, name, data):
        path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
        return {'path': name, 'bytes': len(data), 'sha256': sha256_hex_digest(data)}

    def stable(self, name):
        return next(r['stableId'] for r in self.inventory['sounds'] if r['export']['object'].endswith('.' + name))

    def save(self):
        corpus = self.recipe['corpus']
        corpus['inventory'] = self.write('inputs/corpus/inventory.json', json_bytes(self.inventory))
        self.coverage['inventorySha256'] = corpus['inventory']['sha256']
        corpus['coverage'] = self.write('inputs/corpus/coverage.json', json_bytes(self.coverage))
        if self.placement is not None:
            self.recipe['placementAudio'] = {'manifest': self.write('inputs/placement.json', json_bytes(self.placement)),
                                             'sectionManifestSha256': 'd' * 64}
        self.write('recipes/stepsound.json', json_bytes(self.recipe))

    def run_bundle(self, **kwargs):
        return subject.run(self.root, self.root / 'recipes/stepsound.json', self.output, **kwargs)

    def refused(self, pattern, **kwargs):
        before = snapshot(self.root)
        with self.assertRaisesRegex(ValueError, pattern):
            self.run_bundle(**kwargs)
        self.assertEqual(snapshot(self.root), before)

    def test_plan_produce_repeat_and_verify_preserve_bytes(self):
        self.assertEqual(self.run_bundle(plan=True)['status'], 'planned')
        self.assertFalse(self.output.exists())
        produced = self.run_bundle()
        self.assertEqual((produced['status'], produced['filesWritten']), ('produced', 13))
        before = snapshot(self.output)
        self.assertEqual(self.run_bundle()['filesWritten'], 0)
        self.assertEqual(self.run_bundle(verify_only=True)['status'], 'verified')
        self.assertEqual(snapshot(self.output), before)
        manifest = json.loads((self.output / 'manifest.json').read_bytes())
        self.assertEqual(manifest['kind'], 'native-stepsound-package')
        stone = next(s for s in manifest['surfaces'] if s['id'] == 'Stone')
        objects = {s['dependencyId']: s['object'] for s in manifest['sounds']}
        self.assertEqual([objects[k] for k in stone['walk']], ['stepsound.Stone.stone_walk_01', 'stepsound.Stone.Stone_Walk_02'])
        water = next(s for s in manifest['surfaces'] if s['id'] == 'Water_Shalow')
        self.assertFalse(water['gaitSplit']); self.assertEqual(len(water['clips']), 2)
        self.assertEqual([e['id'] for e in manifest['events']], ['Water_In', 'Water_Out'])
        self.assertEqual(manifest['layers'][0]['id'], 'noise_boots')
        self.assertEqual({s['classification']['class'] for s in manifest['sounds']}, {'surface', 'event', 'layer'})
        self.assertTrue(all(s['source']['packageSha256'] == self.package_sha for s in manifest['sounds']))

    def test_verify_only_requires_output_and_existing_mismatch_is_preserved(self):
        self.refused('Verify-only requires', verify_only=True)
        self.run_bundle()
        target = next((self.output / 'audio').iterdir()); target.write_bytes(b'RIFF tampered')
        self.refused('Existing immutable output differs')

    def test_counts_that_differ_fail_loudly(self):
        self.recipe['surfaces'][0]['expected']['walk'] = 3; self.save()
        self.refused('Surface Stone walk count differs')
        self.recipe['surfaces'][0]['expected']['walk'] = 2; self.recipe['expectedCoverage']['sounds'] = 13; self.save()
        self.refused('Sound count differs')

    def test_unclassified_and_noncontiguous_sounds_fail(self):
        self.add_sound(40, 'Stone', 'stone_crawl_01', b'\x09\x00')
        self.inventory['packages'][0]['soundCount'] = self.inventory['packages'][0]['expectedSounds'] = 13
        self.recipe['expectedCoverage']['sounds'] = 13; self.save()
        self.refused('Unclassified stepsound Sound: stepsound.Stone.stone_crawl_01')

    def test_noncontiguous_variation_numbers_fail(self):
        self.add_sound(41, 'Wood', 'Wood_Walk_03', b'\x0a\x00')
        self.inventory['packages'][0]['soundCount'] = self.inventory['packages'][0]['expectedSounds'] = 13
        self.recipe['expectedCoverage']['sounds'] = 13; self.recipe['surfaces'][1]['expected']['walk'] = 2; self.save()
        self.refused('Variation numbers are not contiguous from 01: Wood walk')

    def test_case_insensitive_classification_is_not_a_leaf_alias(self):
        self.inventory['sounds'][4]['export']['object'] = 'stepsound.Stone.wood_walk_01'
        self.save()
        self.refused('Unclassified stepsound Sound: stepsound.Stone.wood_walk_01')

    def test_changed_payload_or_package_identity_fails(self):
        self.recipe['package']['sha256'] = 'f' * 64; self.save()
        self.refused('Package identity or Sound count differs')
        self.recipe['package']['sha256'] = self.package_sha; self.save()
        (self.root / 'inputs/corpus/cache/2/audio.wav').write_bytes(b'RIFFxxxxWAVE')
        self.refused('Input hash differs')

    def test_output_must_be_named_artifacts_child(self):
        self.output = self.root / 'public/l2'
        self.refused('Output must be a named artifacts/scratch subdirectory')

    def test_placement_declarations_join_exact_package_sounds(self):
        wood = self.stable('wood_walk_01')
        wav = next(r for r in self.coverage['sounds'] if r['stableId'] == wood)['products']['audio']
        self.placement = {'schemaVersion': 1, 'kind': 'native-placement-audio-dependencies',
                          'section': {'id': 's', 'manifest': {'path': 'x', 'bytes': 1, 'sha256': 'd' * 64}},
                          'sounds': [{'dependencyId': wood, 'sha256': wav['sha256'], 'bytes': wav['bytes']}],
                          'placements': [{'placementId': 'interlude:fixture.Steps', 'sourceActor': {'object': 'fixture.Steps'},
                                          'sourceMesh': 'Models.Steps', 'modelId': 'model', 'slots': [
                                              {'property': 'StepSound_1', 'slot': 0, 'status': 'source-declared',
                                               'reference': 'StepSound.Wood.wood_walk_01', 'dependencyId': wood},
                                              {'property': 'StepSound_2', 'slot': 1, 'status': 'omitted', 'reference': None, 'dependencyId': None},
                                              {'property': 'StepSound_3', 'slot': 2, 'status': 'explicit-null', 'reference': None, 'dependencyId': None}]},
                                         {'placementId': 'interlude:fixture.House', 'sourceActor': {}, 'sourceMesh': 'M', 'modelId': 'm',
                                          'slots': [{'property': p, 'slot': i, 'status': 'omitted', 'reference': None} for i, p in
                                                    enumerate(('StepSound_1', 'StepSound_2', 'StepSound_3'))]}]}
        self.recipe['expectedCoverage'].update(declaredPlacements=1, omittedPlacements=1, placementSlots=1)
        self.save()
        self.run_bundle()
        manifest = json.loads((self.output / 'manifest.json').read_bytes())
        declared = manifest['placements']['declared']
        self.assertEqual([p['placementId'] for p in declared], ['interlude:fixture.Steps'])
        self.assertEqual([s['status'] for s in declared[0]['slots']], ['source-declared', 'omitted', 'explicit-null'])
        self.placement['placements'][0]['slots'][0]['reference'] = 'StepSound.Wood.other'
        self.save()
        with self.assertRaisesRegex(ValueError, 'Placement declaration does not join'):
            self.run_bundle(plan=True)
        self.placement['placements'][0]['slots'][0]['reference'] = 'StepSound.Wood.wood_walk_01'
        self.recipe['placementAudio'] = None
        self.save()
        self.recipe['placementAudio'] = {'manifest': self.write('inputs/placement.json', json_bytes(self.placement)), 'sectionManifestSha256': 'e' * 64}
        self.write('recipes/stepsound.json', json_bytes(self.recipe))
        with self.assertRaisesRegex(ValueError, 'Placement section identity differs'):
            self.run_bundle(plan=True)

    def stage_setup(self):
        result = self.run_bundle()
        public = self.root / 'public/l2'; public.mkdir(parents=True)
        catalog = {'schemaVersion': 1, 'models': [], 'animationAudio': [{'id': 'human-fighter-footsteps', 'manifestSha256': 'a' * 64}]}
        (public / 'catalog.json').write_bytes(json_bytes(catalog))
        return result['manifestSha256'], sha256_hex_digest((public / 'catalog.json').read_bytes()), catalog

    def test_stager_plan_stage_repeat_and_verify(self):
        manifest_hash, catalog_hash, catalog = self.stage_setup()
        plan = stager.stage(self.output, manifest_hash, catalog_hash, plan=True, root=self.root)
        self.assertEqual((plan['filesWritten'], len(plan['newResources'])), (0, 13))
        self.assertFalse((self.root / 'public/l2/step-sounds').exists())
        staged = stager.stage(self.output, manifest_hash, catalog_hash, root=self.root)
        self.assertEqual(staged['filesWritten'], 14)
        after = json.loads((self.root / 'public/l2/catalog.json').read_bytes())
        self.assertEqual(after['animationAudio'][0], catalog['animationAudio'][0])
        self.assertEqual(after['animationAudio'][1], {'id': 'stepsound-surfaces', 'kind': 'native-stepsound-package',
            'manifest': f'/l2/step-sounds/{manifest_hash}/manifest.json',
            'manifestBytes': (self.output / 'manifest.json').stat().st_size, 'manifestSha256': manifest_hash})
        before = snapshot(self.root / 'public')
        repeat = stager.stage(self.output, manifest_hash, staged['resultingCatalogSha256'], root=self.root)
        self.assertEqual(repeat['filesWritten'], 0)
        self.assertEqual(stager.stage(self.output, manifest_hash, staged['resultingCatalogSha256'], verify_only=True, root=self.root)['filesWritten'], 0)
        self.assertEqual(snapshot(self.root / 'public'), before)

    def test_stager_refuses_changed_catalog_conflicts_and_bad_payloads(self):
        manifest_hash, catalog_hash, catalog = self.stage_setup()
        with self.assertRaisesRegex(ValueError, 'Catalog changed'):
            stager.stage(self.output, manifest_hash, 'b' * 64, root=self.root)
        with self.assertRaisesRegex(ValueError, 'not completely staged'):
            stager.stage(self.output, manifest_hash, catalog_hash, verify_only=True, root=self.root)
        conflicting = copy.deepcopy(catalog)
        conflicting['animationAudio'].append({'id': 'stepsound-surfaces', 'kind': 'native-stepsound-package', 'manifestSha256': 'c' * 64})
        (self.root / 'public/l2/catalog.json').write_bytes(json_bytes(conflicting))
        with self.assertRaisesRegex(ValueError, 'Existing stepsound identity differs'):
            stager.stage(self.output, manifest_hash, sha256_hex_digest(json_bytes(conflicting)), root=self.root)
        (self.root / 'public/l2/catalog.json').write_bytes(json_bytes(catalog))
        next((self.output / 'audio').iterdir()).write_bytes(b'RIFFxxxxWAVE')
        with self.assertRaisesRegex(ValueError, 'Original audio payload differs'):
            stager.stage(self.output, manifest_hash, catalog_hash, root=self.root)
        self.assertFalse((self.root / 'public/l2/step-sounds').exists())


@unittest.skipUnless((ROOT / 'artifacts/native-parity/research/dev-sheet-audio-20261107/footstep-surfaces/bundle/manifest.json').exists(),
                     'Real stepsound bundle not produced in this checkout')
class RealStepsoundRecipeTests(unittest.TestCase):
    def test_real_recipe_verifies_the_retained_93_sound_bundle(self):
        result = subject.run(ROOT, ROOT / 'recipes/native-stepsound-surfaces.json',
                             ROOT / 'artifacts/native-parity/research/dev-sheet-audio-20261107/footstep-surfaces/bundle', verify_only=True)
        self.assertEqual(result['status'], 'verified'); self.assertEqual(result['filesWritten'], 0)
        self.assertEqual(result['coverage'], {'sounds': 93, 'wavFiles': 93, 'surfaces': 16, 'gaitSurfaces': 14, 'events': 2, 'layers': 1,
                                              'declaredPlacements': 8, 'omittedPlacements': 149, 'placementSlots': 24})


if __name__ == '__main__':
    unittest.main()
