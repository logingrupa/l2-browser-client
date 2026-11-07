"""Synthetic archive/dependency fixtures; no converter or real source exports."""
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
from native_assets_lib import animation_audio_bundle as subject


def snapshot(root):
    return {p.relative_to(root).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
            for p in root.rglob('*') if p.is_file()}


class BundleTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='animation-audio-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.output = self.root / 'artifacts/bundle'
        self.hash = subject.digest(b'original source')
        self.wav = io.BytesIO()
        with wave.open(self.wav, 'wb') as writer:
            writer.setnchannels(1); writer.setsampwidth(2); writer.setframerate(22050)
            writer.writeframes(b'\x01\x00\x02\x00')
        self.wav = self.wav.getvalue()
        self.reference = 'StepSound.Grass.Run_01'
        self.event = {'animationSet': 'Fighter.FFighter_anim', 'clip': 'Run_FFighter', 'object': 'Fighter.Notify1',
                      'type': 'AnimNotify_Sound', 'function': 'None', 'normalizedTime': .18333333730697632,
                      'timeSeconds': .14666666984558105, 'sourceFrames': 12, 'sourceRate': 15.0,
                      'sound': None, 'properties': {'GrassRunSound': [self.reference, self.reference, self.reference], 'Volume': 250}}
        self.direct = {**copy.deepcopy(self.event), 'object': 'Fighter.Breath', 'sound': 'ChrSound.Female.Breath',
                       'resolvedFile': 'audio/breath.wav', 'properties': {'Random': 5}}
        self.actor = {'schemaVersion': 1, 'kind': 'model', 'id': 'interlude:female',
                      'source': {'edition': 'interlude', 'object': 'Fighter.FFighter_m001_u', 'sha256': self.hash},
                      'model': {'file': 'model.glb'}, 'animationEvents': [{**self.event, 'clip': 'Other'}, self.event, self.direct]}
        self.inventory = {'events': [], 'dependencies': []}
        self.sound = {'schemaVersion': 1, 'kind': 'audio', 'id': 'interlude:stepsound.Grass.Run_01',
                      'source': {'edition': 'interlude', 'object': 'stepsound.Grass.Run_01', 'sha256': self.hash},
                      'audio': {'file': 'audio.wav'}, 'animationEvents': []}
        sound_archive = self.archive('inputs/sound.l2asset', self.sound, {'audio.wav': self.wav,
            'provenance.json': json_bytes({'metadata': {'nativeExportIndex': 7, 'encodedAudioUnchanged': True,
                                                       'nativePayloadSha256': subject.digest(self.wav)}})})
        self.write('inputs/audio.wav', self.wav)
        self.inventory['dependencies'] = [{'authoredReference': self.reference, 'sourceObject': 'stepsound.Grass.Run_01',
            'sourcePackageSha256': self.hash, 'exportIndex': 7,
            'payload': {'sha256': subject.digest(self.wav), 'bytes': len(self.wav), 'offset': 1234},
            'existingExport': {'archivePath': sound_archive['path'], 'archiveSha256': sound_archive['sha256'],
                'id': self.sound['id'], 'sourceObject': self.sound['source']['object'], 'sourcePackageSha256': self.hash,
                'nativeExportIndex': 7, 'stableId': 'HOST:' + self.hash + ':7', 'wavPath': 'inputs/audio.wav',
                'wavSha256': subject.digest(self.wav), 'wavBytes': len(self.wav)}}]
        self.recipe = {'schemaVersion': 1, 'kind': 'native-animation-audio-bundle', 'arrayProperties': ['GrassRunSound'],
                       'actors': [{'catalogId': 'female:0', 'assetId': 'interlude:female', 'archive': {},
                                   'clips': [{'name': 'Run_FFighter', 'gait': 'run'}]}]}
        self.refresh_actor()

    def write(self, name, data):
        path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
        return {'path': name, 'sha256': subject.digest(data), 'bytes': len(data)}

    def archive(self, name, asset, payloads):
        asset['files'] = [{'path': n, 'sha256': subject.digest(b), 'bytes': len(b)} for n, b in payloads.items()]
        return self.write(name, archive_bytes(asset, payloads))

    def refresh_actor(self):
        self.recipe['actors'][0]['archive'] = self.archive('inputs/actor.l2asset', self.actor,
            {'model.glb': b'synthetic unrendered model payload', 'audio/breath.wav': self.wav})
        manifest_hash = subject.digest(json_bytes(self.actor))
        self.inventory['events'] = []
        for ordinal in [1, 2]:
            raw = self.actor['animationEvents'][ordinal]
            row = {k: copy.deepcopy(raw.get(k)) for k in ('animationSet', 'clip', 'object', 'type', 'function',
                    'normalizedTime', 'timeSeconds', 'sourceFrames', 'sourceRate', 'sound')}
            row.update(assetManifestSha256=manifest_hash, manifestPointer=f'/animationEvents/{ordinal}',
                       nativeNotification={'sourcePackageSha256': self.hash, 'offsetUnwrapped': None})
            self.inventory['events'].append(row)
        self.save()

    def save(self):
        inventory = self.write('inputs/inventory.json', json_bytes(self.inventory))
        self.recipe['inventory'] = {**inventory, 'eventsPointer': '/events', 'dependenciesPointer': '/dependencies'}
        self.write('recipes/bundle.json', json_bytes(self.recipe))

    def run_bundle(self, **kwargs):
        return subject.run(self.root, self.root / 'recipes/bundle.json', self.output, **kwargs)

    def fails_read_only(self, pattern, **kwargs):
        before = snapshot(self.root)
        with self.assertRaisesRegex((ValueError, KeyError, OSError), pattern):self.run_bundle(**kwargs)
        self.assertEqual(snapshot(self.root), before)

    def test_plan_does_not_create_output_or_change_any_input(self):
        before = snapshot(self.root); result = self.run_bundle(plan=True)
        self.assertEqual(result['status'], 'planned'); self.assertEqual(result['filesWritten'], 0)
        self.assertFalse(self.output.exists()); self.assertEqual(snapshot(self.root), before)

    def test_preserves_order_raw_timing_duplicate_slots_and_original_wav(self):
        source_before = snapshot(self.root / 'inputs'); self.run_bundle()
        m = json.loads((self.output / 'manifest.json').read_bytes()); events = m['actors'][0]['events']
        self.assertEqual([e['ordinal'] for e in events], [1, 2])
        self.assertEqual(events[0]['event'], self.event)
        self.assertEqual([s['reference'] for s in events[0]['arrays'][0]['slots']], [self.reference]*3)
        self.assertEqual([s['index'] for s in events[0]['arrays'][0]['slots']], [0, 1, 2])
        self.assertEqual(m['coverage']['dependencies'], 1)
        self.assertEqual((self.output / m['sounds'][0]['file']).read_bytes(), self.wav)
        self.assertIsNone(events[0]['provenance']['nativeNotification']['offsetUnwrapped'])
        self.assertEqual(source_before, snapshot(self.root / 'inputs'))

    def test_direct_conditional_breath_is_retained_but_not_added_to_step_arrays(self):
        self.run_bundle(); m = json.loads((self.output / 'manifest.json').read_bytes()); e = m['actors'][0]['events'][1]
        self.assertEqual(e['event']['properties']['Random'], 5); self.assertEqual(e['arrays'], [])
        self.assertEqual(e['directSound']['status'], 'existing-actor-only-unconsumed')
        self.assertEqual(m['coverage']['wavFiles'], 1)

    def test_repeat_and_verify_are_exact_byte_and_mtime_noops(self):
        self.run_bundle(); before = snapshot(self.root)
        self.assertEqual(self.run_bundle()['status'], 'preserved')
        self.assertEqual(self.run_bundle(verify_only=True)['status'], 'verified')
        self.assertEqual(snapshot(self.root), before)

    def test_direct_breath_can_also_carry_arrays_without_becoming_surface_only(self):
        self.actor['animationEvents'][2]['properties']['GrassRunSound'] = [self.reference]*3
        self.refresh_actor(); self.run_bundle(); m = json.loads((self.output / 'manifest.json').read_bytes())
        self.assertEqual(m['coverage']['surfaceEvents'], 2)
        self.assertEqual(m['coverage']['surfaceOnlyEvents'], 1)
        self.assertEqual(m['coverage']['directSoundEvents'], 1)
        self.assertEqual(m['coverage']['arraySlots'], 6)
        self.assertEqual(m['actors'][0]['events'][1]['event']['properties']['Random'], 5)

    def test_verify_requires_complete_output(self):self.fails_read_only('requires a complete', verify_only=True)

    def test_changed_existing_output_is_preserved_and_rejected(self):
        self.run_bundle(); (self.output / 'manifest.json').write_bytes(b'changed')
        self.fails_read_only('immutable output differs')

    def test_extra_output_file_is_not_silently_accepted(self):
        self.run_bundle(); (self.output / 'user-work.txt').write_bytes(b'preserve')
        self.fails_read_only('file set differs')

    def test_stale_inventory_hash_is_rejected(self):
        (self.root / 'inputs/inventory.json').write_bytes(b'{}'); self.fails_read_only('Input hash differs')

    def test_stale_original_wav_is_rejected(self):
        (self.root / 'inputs/audio.wav').write_bytes(self.wav+b'x'); self.fails_read_only('Input hash differs')

    def test_group_less_leaf_is_not_matched(self):
        self.actor['animationEvents'][1]['properties']['GrassRunSound'] = ['StepSound.Run_01']; self.refresh_actor()
        self.fails_read_only('Missing exact dependency')

    def test_casefold_identity_collision_is_rejected(self):
        other = copy.deepcopy(self.inventory['dependencies'][0]); other['authoredReference'] = self.reference.lower()
        self.inventory['dependencies'].append(other); self.save(); self.fails_read_only('Ambiguous')

    def test_source_export_mismatch_is_rejected(self):
        self.inventory['dependencies'][0]['exportIndex'] = 8; self.save(); self.fails_read_only('identity differs')

    def test_event_timing_provenance_mismatch_is_rejected(self):
        self.inventory['events'][0]['timeSeconds'] += .01; self.save(); self.fails_read_only('Event provenance differs')

    def test_native_property_reference_mismatch_is_rejected(self):
        self.inventory['events'][0]['nativeNotification']['surfacePropertyTags'] = [
            {'name': 'GrassRunSound', 'arrayIndex': 1, 'reference': 'StepSound.Wrong.Object'}]
        self.save(); self.fails_read_only('Native property provenance differs')

    def test_input_traversal_is_rejected(self):
        self.recipe['actors'][0]['archive']['path'] = '../actor.l2asset'; self.save(); self.fails_read_only('Unsafe')

    def test_public_output_is_rejected(self):
        self.output = self.root / 'public/l2/audio'; self.fails_read_only('artifacts/scratch')

    def test_input_directory_overlap_is_rejected(self):
        self.output = self.root / 'artifacts'; self.fails_read_only('named artifacts/scratch')

    def test_inconsistent_clip_timeline_is_rejected(self):
        self.actor['animationEvents'][2]['sourceFrames'] = 13; self.refresh_actor(); self.fails_read_only('Inconsistent')

    def test_symlink_output_is_rejected(self):
        target = self.root / 'target'; target.mkdir(); self.output.parent.mkdir()
        try:self.output.symlink_to(target, target_is_directory=True)
        except OSError as error:self.skipTest('Windows symlink privilege unavailable: '+str(error))
        self.fails_read_only('Symlink|reparse')


if __name__ == '__main__':unittest.main()
