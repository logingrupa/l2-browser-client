"""Animation-audio staging contract; isolated tiny fixtures, no real corpus."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib.gltf import json_bytes
import stage_native_animation_audio as subject


def sha(data):
    return hashlib.sha256(data).hexdigest()


def snapshot(root):
    return {p.relative_to(root).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
            for p in root.rglob('*') if p.is_file()}


class AnimationAudioStageTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='native-animation-audio-stage-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.public = self.root / 'public/l2'
        self.public.mkdir(parents=True)
        self.catalog_path = self.public / 'catalog.json'
        self.bundle = self.root / 'artifacts/audio-bundle'
        self.bundle.mkdir(parents=True)
        self.source = {'edition': 'interlude', 'object': 'Fixture.Actor', 'sha256': 'a' * 64,
                       'assembly': ['Fixture.Actor', 'Fixture.Hair']}
        self.model = {'id': 'human-male-fighter:0', 'assetId': 'fixture:actor', 'source': self.source,
                      'archiveSha256': 'b' * 64, 'archive': '/l2/existing/asset.l2asset',
                      'model': '/l2/existing/model.glb', 'arbitraryAuthorData': {'preserve': True}}
        self.catalog = {'schemaVersion': 1, 'models': [self.model, {'id': 'unrelated:0'}],
                        'sections': [{'id': 'unchanged-section'}], 'npcProfiles': [{'id': 'retained-npc'}],
                        'textures': [{'identity': 'untouched'}], 'extension': {'author': [3, 1, 2]}}
        self.save_catalog()
        sentinel = self.public / 'existing'
        sentinel.mkdir()
        (sentinel / 'model.glb').write_bytes(b'Original model must not be parsed or rewritten')
        (sentinel / 'asset.l2asset').write_bytes(b'Original actor archive is not an audio staging input')
        (self.root / 'assets').mkdir()
        (self.root / 'assets/authored.scene').write_bytes(b'authored geometry and UV2 sentinel')
        self.actor = {'catalogId': self.model['id'], 'assetId': self.model['assetId'],
                      'archiveSha256': self.model['archiveSha256'], 'source': copy.deepcopy(self.source),
                      'clips': [{'name': 'Run_Fixture', 'frames': 15, 'rate': 15, 'durationSeconds': 1, 'gait': 'run'}],
                      'events': [{'ordinal': 17, 'event': {'timeSeconds': 0.125, 'properties': {
                          'GrassRunSound': ['StepSound.Grass.a', 'StepSound.Grass.b', 'StepSound.Grass.b']}}}]}
        self.payloads = [b'RIFF synthetic exact payload 1', b'RIFF synthetic exact payload 2']
        sounds = []
        for index, payload in enumerate(self.payloads):
            identity = sha(payload)
            name = 'audio/' + identity + '.wav'
            path = self.bundle / name
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(payload)
            sounds.append({'dependencyId': 'fixture:' + 'c' * 64 + ':' + str(index + 1),
                           'file': name, 'sha256': identity, 'bytes': len(payload), 'mime': 'audio/wav',
                           'source': {'object': 'StepSound.Grass.' + chr(97 + index),
                                      'packageSha256': 'c' * 64, 'exportIndex': index + 1}})
        self.manifest = {'schemaVersion': 1, 'kind': 'native-animation-audio-dependencies',
                         'actors': [self.actor], 'sounds': sounds, 'limits': ['Synthetic test only.']}
        self.save_manifest()
        (self.bundle / 'unlisted-private-notes.txt').write_bytes(b'never publish')

    def save_catalog(self):
        self.catalog_path.write_bytes(json.dumps(self.catalog, indent=2).encode())

    def save_manifest(self):
        self.manifest_bytes = json_bytes(self.manifest)
        (self.bundle / 'manifest.json').write_bytes(self.manifest_bytes)
        self.manifest_hash = sha(self.manifest_bytes)

    def run_stage(self, **options):
        catalog_hash = options.pop('catalog_hash', sha(self.catalog_path.read_bytes()))
        manifest_hash = options.pop('manifest_hash', self.manifest_hash)
        bundle = options.pop('bundle', self.bundle)
        return subject.stage(bundle, manifest_hash, catalog_hash, root=self.root, **options)

    def assert_read_only_failure(self, message, **options):
        before = snapshot(self.root)
        with self.assertRaisesRegex((ValueError, OSError, KeyError), message):
            self.run_stage(**options)
        self.assertEqual(snapshot(self.root), before)

    def test_plan_is_read_only_and_describes_only_additive_audio_resources(self):
        before = snapshot(self.root)
        result = self.run_stage(plan=True)
        self.assertEqual(snapshot(self.root), before)
        self.assertEqual(result['filesWritten'], 0)
        self.assertEqual(result['mode'], 'plan')
        self.assertEqual(result['resourceCount'], 3)
        self.assertEqual(result['actors'], [self.actor['catalogId']])
        self.assertTrue(all(path.startswith('animation-audio/') for path in result['newResources']))

    def test_additive_stage_preserves_models_authored_data_raw_events_and_unrelated_catalog(self):
        protected = {p: snapshot(self.root / p) for p in ('assets', 'public/l2/existing', 'artifacts')}
        plan = self.run_stage(plan=True)
        result = self.run_stage()
        self.assertEqual(result['resultingCatalogSha256'], plan['resultingCatalogSha256'])
        self.assertEqual(result['filesWritten'], 4)
        catalog = json.loads(self.catalog_path.read_bytes())
        self.assertEqual({key: value for key, value in catalog.items() if key != 'animationAudio'}, self.catalog)
        for path, expected in protected.items():
            self.assertEqual(snapshot(self.root / path), expected)
        entry = catalog['animationAudio'][0]
        published = self.public / entry['manifest'].removeprefix('/l2/')
        self.assertEqual(published.read_bytes(), self.manifest_bytes)
        self.assertEqual(json.loads(published.read_bytes())['actors'][0]['events'], self.actor['events'])
        self.assertEqual(len(list(published.parent.rglob('*.wav'))), 2)
        self.assertFalse(any('private' in name for name in snapshot(self.public)))

    def test_repeat_and_verify_preserve_all_bytes_and_mtimes(self):
        self.run_stage()
        before = snapshot(self.root)
        for options in ({}, {'plan': True}, {'verify_only': True}):
            result = self.run_stage(**options)
            self.assertEqual(result['filesWritten'], 0)
            self.assertEqual(result['newResources'], [])
            self.assertEqual(snapshot(self.root), before)

    def test_incomplete_verify_is_read_only(self):
        self.assert_read_only_failure('not completely staged', verify_only=True)

    def test_stale_catalog_or_manifest_hash_is_rejected(self):
        self.assert_read_only_failure('Catalog changed', catalog_hash='0' * 64)
        self.assert_read_only_failure('manifest hash differs', manifest_hash='0' * 64)
        self.assert_read_only_failure('Invalid staging hash', manifest_hash='xyz')

    def test_actor_identity_archive_and_source_changes_fail_before_any_writes(self):
        original = copy.deepcopy(self.actor)
        for field, value in [('assetId', 'different'), ('archiveSha256', 'd' * 64),
                             ('source', dict(self.source, object='Fixture.Other'))]:
            with self.subTest(field=field):
                self.manifest['actors'][0] = dict(original, **{field: value})
                self.save_manifest()
                self.assert_read_only_failure('Actor archive/source differs')

    def test_missing_or_duplicated_source_actor_is_rejected(self):
        self.manifest['actors'][0]['catalogId'] = 'not-staged:0'
        self.save_manifest()
        self.assert_read_only_failure('Missing/duplicate source actor')
        self.manifest['actors'][0]['catalogId'] = self.model['id']
        self.manifest['actors'].append(copy.deepcopy(self.actor))
        self.save_manifest()
        self.assert_read_only_failure('Missing/duplicate source actor')

    def test_reordered_source_assembly_is_not_equivalent(self):
        self.actor['source']['assembly'].reverse()
        self.save_manifest()
        self.assert_read_only_failure('Actor archive/source differs')

    def test_missing_archive_pins_cannot_match_by_both_being_absent(self):
        del self.actor['archiveSha256']
        del self.model['archiveSha256']
        self.save_catalog()
        self.save_manifest()
        self.assert_read_only_failure('archive|source|identity')

    def test_duplicate_catalog_models_are_rejected(self):
        self.catalog['models'].append(copy.deepcopy(self.model))
        self.save_catalog()
        self.assert_read_only_failure('Duplicate catalog model identity')

    def test_existing_other_audio_bundle_is_preserved(self):
        other = {'id': 'other-audio', 'manifest': '/l2/unrelated/manifest.json', 'author': {'keep': True}}
        self.catalog['animationAudio'] = [other]
        self.save_catalog()
        self.run_stage()
        self.assertEqual(json.loads(self.catalog_path.read_bytes())['animationAudio'][0], other)

    def test_conflicting_audio_identity_is_not_replaced(self):
        self.catalog['animationAudio'] = [{'id': 'human-fighter-footsteps', 'manifestSha256': 'f' * 64}]
        self.save_catalog()
        self.assert_read_only_failure('identity differs')

    def test_duplicated_selected_audio_record_is_rejected(self):
        result = self.run_stage()
        self.catalog = json.loads(self.catalog_path.read_bytes())
        self.catalog['animationAudio'].append(result['entry'])
        self.save_catalog()
        self.assert_read_only_failure('identity differs')

    def test_existing_immutable_payload_corruption_is_preserved(self):
        result = self.run_stage()
        path = self.public / result['newResources'][-1]
        path.write_bytes(b'authored/conflicting resource retained')
        self.assert_read_only_failure('immutable audio resource differs')

    def test_last_payload_failure_does_not_publish_first_payload(self):
        path = self.bundle / self.manifest['sounds'][-1]['file']
        path.write_bytes(path.read_bytes()[:-1] + b'!')
        self.assert_read_only_failure('Original audio payload differs')
        self.assertFalse((self.public / 'animation-audio').exists())

    def test_payload_size_mismatch_and_missing_file_fail_read_only(self):
        sound = self.manifest['sounds'][0]
        sound['bytes'] += 1
        self.save_manifest()
        self.assert_read_only_failure('Original audio payload differs')
        sound['bytes'] -= 1
        self.save_manifest()
        (self.bundle / sound['file']).unlink()
        self.assert_read_only_failure('No such file|cannot find|not find')

    def test_unsafe_payload_paths_never_read_outside_bundle(self):
        sound = self.manifest['sounds'][0]
        for value in ('../secret.wav', '/absolute.wav', 'audio/../secret.wav', 'audio/a:stream',
                      'audio\\windows.wav', 'audio/CON.wav', 'https://remote.invalid/a.wav'):
            with self.subTest(path=value):
                sound['file'] = value
                self.save_manifest()
                self.assert_read_only_failure('Invalid audio payload descriptor')

    def test_invalid_sound_descriptors_and_duplicate_dependencies_fail(self):
        original = copy.deepcopy(self.manifest['sounds'][0])
        for field, value in [('bytes', True), ('bytes', 0), ('bytes', 8_000_001), ('sha256', 'F' * 64), ('mime', 'audio/mp3')]:
            with self.subTest(field=field, value=value):
                self.manifest['sounds'][0] = dict(original, **{field: value})
                self.save_manifest()
                self.assert_read_only_failure('Invalid audio payload descriptor')
        self.manifest['sounds'][0] = original
        self.manifest['sounds'].append(copy.deepcopy(original))
        self.save_manifest()
        self.assert_read_only_failure('Duplicate/missing source sound identity')

    def test_duplicate_json_keys_and_nonfinite_values_are_rejected(self):
        for raw, message in [(b'{"kind":1,"kind":2}', 'Duplicate JSON key'), (b'{"value":NaN}', 'Nonfinite JSON')]:
            (self.bundle / 'manifest.json').write_bytes(raw)
            self.assert_read_only_failure(message, manifest_hash=sha(raw))

    def test_bundle_cannot_escape_project_root(self):
        with tempfile.TemporaryDirectory(prefix='outside-audio-bundle-') as outside:
            self.assert_read_only_failure('Bundle must be a project child', bundle=Path(outside))
        self.assert_read_only_failure('Bundle must be a project child', bundle=self.root)

    def test_reparse_input_or_output_is_rejected_without_native_links(self):
        original_lstat = Path.lstat
        for target in (self.bundle, self.public):
            def lstat(path, *args, **kwargs):
                value = original_lstat(path, *args, **kwargs)
                if path == target:
                    return SimpleNamespace(st_mode=value.st_mode, st_file_attributes=getattr(value, 'st_file_attributes', 0) | 0x400)
                return value
            with self.subTest(path=str(target)), patch.object(Path, 'lstat', lstat):
                with self.assertRaisesRegex(ValueError, 'Symlink/junction/reparse'):
                    self.run_stage()

    def test_changed_catalog_during_copy_is_not_overwritten(self):
        original_writer = subject.immutable_write
        replacement = json_bytes(dict(self.catalog, concurrentAuthor='preserved'))
        changed = False
        def write_then_change(path, payload):
            nonlocal changed
            original_writer(path, payload)
            if not changed:
                self.catalog_path.write_bytes(replacement)
                changed = True
        with patch.object(subject, 'immutable_write', write_then_change):
            with self.assertRaisesRegex(ValueError, 'Catalog changed during resource staging'):
                self.run_stage()
        self.assertEqual(self.catalog_path.read_bytes(), replacement)
        self.assertEqual(snapshot(self.public / 'existing')['model.glb'][0], b'Original model must not be parsed or rewritten')

    def test_both_modes_are_rejected(self):
        self.assert_read_only_failure('mutually exclusive', plan=True, verify_only=True)

    def test_exact_repeat_and_verify_at_catalog_capacity(self):
        self.catalog['animationAudio'] = [{'id': f'other-{i}', 'manifest': f'/l2/other-{i}/manifest.json'} for i in range(15)]
        self.save_catalog()
        self.run_stage()
        before = snapshot(self.root)
        self.assertEqual(self.run_stage(verify_only=True)['filesWritten'], 0)
        self.assertEqual(self.run_stage()['filesWritten'], 0)
        self.assertEqual(snapshot(self.root), before)

    def test_new_record_beyond_catalog_capacity_fails_read_only(self):
        self.catalog['animationAudio'] = [{'id': f'other-{i}', 'manifest': f'/l2/other-{i}/manifest.json'} for i in range(16)]
        self.save_catalog()
        self.assert_read_only_failure('catalog|capacity|limit')


if __name__ == '__main__':
    unittest.main()
