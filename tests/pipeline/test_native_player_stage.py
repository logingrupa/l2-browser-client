from __future__ import annotations

import copy
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets import archive_bytes
from native_assets_lib.gltf import json_bytes
import stage_native_players as subject


def sha(data):
    return hashlib.sha256(data).hexdigest()


def snapshot(root):
    return {path.relative_to(root).as_posix(): (path.read_bytes(), path.stat().st_mtime_ns)
            for path in root.rglob('*') if path.is_file()}


def glb(names, padding=''):
    document = json_bytes({'asset': {'version': '2.0'}, 'buffers': [{'byteLength': 4}],
                           'animations': [{'name': name, 'channels': [], 'samplers': []} for name in names],
                           'extras': {'fixturePadding': padding}})
    document += b' ' * (-len(document) % 4)
    return (struct.pack('<5I', 0x46546c67, 2, len(document) + 32, len(document), 0x4e4f534a)
            + document + struct.pack('<2I', 4, 0x004e4942) + b'\0' * 4)


class PlayerStageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='native-player-stage-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.destination = self.root / 'public/l2'
        self.destination.mkdir(parents=True)
        self.catalog_path = self.destination / 'catalog.json'
        self.catalog = {'schemaVersion': 1, 'models': [{'id': 'existing-world-model', 'retained': 'exact'}],
                        'sections': [{'id': 'original-section', 'manifest': '/l2/original.json'}],
                        'npcProfiles': [{'id': 'original-npc'}], 'extension': {'unchanged': [1, 2, 3]}}
        self.catalog_path.write_bytes(json.dumps(self.catalog, indent=2).encode())
        self.source_hash = sha(b'synthetic native source identity')
        self.names = ['wait', 'run', 'atk01', 'death']
        self.recipe_path = self.root / 'recipes/player-stage.json'
        self.recipe_path.parent.mkdir()
        self.recipe = {'schemaVersion': 1, 'kind': 'native-player-stage',
                       'models': [self.package('female:0'), self.package('female-upper:0', upper=True)],
                       'profiles': [self.profile()]}
        self.save_recipe()

    def package(self, identifier, *, upper=False, names=None, source_object=None):
        model = glb(self.names if names is None else names)
        source_object = source_object or 'Fighter.FFighter_m001_u'
        files = {'model.glb': model, 'provenance.json': b'{"fixture":true}', 'audio/voice.wav': b'fixture audio'}
        manifest = {'schemaVersion': 1, 'kind': 'model', 'id': 'fixture:' + identifier,
                    'source': {'edition': 'interlude', 'object': source_object, 'sha256': self.source_hash},
                    'model': {'file': 'model.glb'}, 'limitations': ['Synthetic staging fixture.'],
                    'files': [{'path': name, 'sha256': sha(data), 'bytes': len(data)} for name, data in files.items()]}
        if not upper:
            manifest['source']['assembly'] = [source_object, 'Fighter.FFighter_m001_l']
        payload = archive_bytes(manifest, files)
        path = self.root / ('artifacts/' + identifier.replace(':', '-') + '.l2asset')
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(payload)
        (path.parent / '.work').write_bytes(b'private scratch')
        return {'catalogId': identifier, 'archive': path.relative_to(self.root).as_posix(), 'archiveSha256': sha(payload)}

    def profile(self, identifier='human-female-fighter'):
        return {'id': identifier, 'name': 'Human female fighter', 'catalogId': 'female:0', 'assetId': 'fixture:female:0',
                'sourceObject': 'Fighter.FFighter_m001_u', 'sourceSha256': self.source_hash,
                'clips': dict(zip(('idle', 'run', 'attack', 'death'), self.names)), 'forwardAxis': [1, 0, 0],
                'actorScale': [1, 1, 1], 'collisionRadius': 8, 'collisionHeight': 23.5, 'sourceUnitsPerMetre': 100,
                'upperItems': [{'itemId': 22, 'catalogId': 'female-upper:0', 'sourceObject': 'Fighter.FFighter_m001_u',
                                'sourceSha256': self.source_hash}],
                'sourceEvidence': {'fixture': True}, 'limitations': ['Fixture native/rendering behavior is unproved.']}

    def save_recipe(self):
        self.recipe_path.write_bytes(json_bytes(self.recipe))

    def run_stage(self, **options):
        expected = options.pop('expected', sha(self.catalog_path.read_bytes()))
        return subject.stage(self.recipe_path, self.destination, expected, project_root=self.root, **options)

    def assert_read_only_failure(self, message, **options):
        before = snapshot(self.root)
        with self.assertRaisesRegex((ValueError, OSError, KeyError), message):
            self.run_stage(**options)
        self.assertEqual(before, snapshot(self.root))

    def test_plan_is_read_only_and_reports_additive_result(self):
        before = snapshot(self.root)
        result = self.run_stage(plan_only=True)
        self.assertEqual(before, snapshot(self.root))
        self.assertEqual(result['filesWritten'], 0)
        self.assertEqual(result['status'], 'planned')
        self.assertEqual(result['addedModels'], ['female:0', 'female-upper:0'])
        self.assertEqual(result['addedProfiles'], ['human-female-fighter'])

    def test_additive_stage_preserves_world_and_publishes_all_verified_payloads(self):
        original_inputs = snapshot(self.root / 'artifacts')
        planned = self.run_stage(plan_only=True)
        result = self.run_stage()
        catalog = json.loads(self.catalog_path.read_bytes())
        self.assertEqual(result['resultingCatalogSha256'], planned['resultingCatalogSha256'])
        self.assertEqual(catalog['models'][0], self.catalog['models'][0])
        for key in ('sections', 'npcProfiles', 'extension'):
            self.assertEqual(catalog[key], self.catalog[key])
        self.assertEqual(original_inputs, snapshot(self.root / 'artifacts'))
        self.assertEqual(result['filesWritten'], 12)
        self.assertEqual(result['verifiedResources'], 11)
        self.assertFalse(any('.work' in name for name in snapshot(self.destination)))
        for record in self.recipe['models']:
            prefix = self.destination / record['archiveSha256']
            self.assertEqual((prefix / 'asset.l2asset').read_bytes(), (self.root / record['archive']).read_bytes())
            self.assertEqual((prefix / 'audio/voice.wav').read_bytes(), b'fixture audio')
        manifest = json.loads((self.destination / catalog['playerProfiles'][0]['manifest'][4:]).read_bytes())
        self.assertEqual(manifest['profiles'], self.recipe['profiles'])

    def test_exact_repeat_and_verify_preserve_every_byte_and_mtime(self):
        self.run_stage()
        before = snapshot(self.root)
        self.assertEqual(self.run_stage()['status'], 'unchanged')
        self.assertEqual(self.run_stage(verify_only=True)['status'], 'verified')
        self.assertEqual(before, snapshot(self.root))

    def test_stale_catalog_pin_fails_even_after_success(self):
        stale = sha(self.catalog_path.read_bytes())
        self.run_stage()
        self.assert_read_only_failure('Current catalog differs', expected=stale)

    def test_verify_incomplete_does_not_write(self):
        self.assert_read_only_failure('incomplete', verify_only=True)

    def test_model_identity_conflict_preserves_catalog(self):
        self.catalog['models'].append({'id': 'female:0', 'retained': True})
        self.catalog_path.write_bytes(json_bytes(self.catalog))
        self.assert_read_only_failure('Existing model identity conflicts')

    def test_profile_identity_conflict_preserves_catalog(self):
        self.run_stage()
        self.recipe['profiles'][0]['name'] = 'Conflicting name'
        self.save_recipe()
        self.assert_read_only_failure('Existing player profile conflicts')

    def test_source_identity_mismatch_is_rejected(self):
        self.recipe['profiles'][0]['sourceSha256'] = '0' * 64
        self.save_recipe()
        self.assert_read_only_failure('source identities differ')

    def test_case_sensitive_missing_clip_is_rejected(self):
        self.recipe['profiles'][0]['clips']['idle'] = 'WAIT'
        self.save_recipe()
        self.assert_read_only_failure('missing or differently cased clips')

    def test_upper_item_must_be_replacement_part(self):
        self.recipe['models'][1] = self.package('female-upper:0', upper=True, source_object='Fighter.Unrelated')
        self.recipe['profiles'][0]['upperItems'][0]['sourceObject'] = 'Fighter.Unrelated'
        self.save_recipe()
        self.assert_read_only_failure('replacement part')

    def test_upper_item_requires_selected_clips(self):
        self.recipe['models'][1] = self.package('female-upper:0', upper=True, names=['wait'])
        self.save_recipe()
        self.assert_read_only_failure('Upper item is missing')

    def test_required_actor_scale_and_builtin_male_are_validated(self):
        original = copy.deepcopy(self.recipe['profiles'][0])
        for value in (None, [], [1, 1], [0, 1, 1], [1, -1, 1], [101, 1, 1], [True, 1, 1], ['1', 1, 1]):
            with self.subTest(scale=value):
                self.recipe['profiles'][0] = dict(original, actorScale=value)
                self.save_recipe()
                self.assert_read_only_failure('actorScale')
        self.recipe['profiles'][0] = dict(original)
        del self.recipe['profiles'][0]['actorScale']
        self.save_recipe()
        self.assert_read_only_failure('profile fields')
        self.recipe['profiles'][0] = dict(original, id='human-male-fighter')
        self.save_recipe()
        self.assert_read_only_failure('Built-in human-male-fighter')

    def test_facing_and_dimensions_are_validated(self):
        original = copy.deepcopy(self.recipe['profiles'][0])
        for changes in ({'forwardAxis': [1, 1, 0]}, {'forwardAxis': [2, 0, 0]}, {'collisionHeight': 0},
                        {'collisionRadius': True}, {'collisionHeight': 10001}, {'sourceUnitsPerMetre': 1}):
            with self.subTest(changes=changes):
                self.recipe['profiles'][0] = dict(original, **changes)
                self.save_recipe()
                self.assert_read_only_failure('facing|dimension|source units')

    def test_browser_profile_size_and_string_bounds_are_enforced(self):
        original = copy.deepcopy(self.recipe['profiles'][0])
        for changes in ({'limitations': ['x' * 513]}, {'limitations': ['\U0001f600' * 257]},
                        {'assetId': '\U0001f600' * 257}, {'sourceObject': '1Fighter.Part'},
                        {'catalogId': 'x' * 97}):
            with self.subTest(fields=list(changes)):
                self.recipe['profiles'][0] = dict(original, **changes)
                self.save_recipe()
                self.assert_read_only_failure('limitations|source identity')
        self.recipe['profiles'][0] = dict(original, sourceEvidence={'tooLarge': 'x' * 2_000_000})
        self.save_recipe()
        self.assert_read_only_failure('manifest exceeds browser limit')

    def test_browser_boundary_values_are_supported(self):
        self.recipe['profiles'][0].update(actorScale=[100, 100, 100], collisionHeight=10000,
                                          forwardAxis=[1.0000005, 0, 0], limitations=['\U0001f600' * 256])
        self.save_recipe()
        self.assertEqual(self.run_stage()['status'], 'staged')

    def test_archive_corruption_is_rejected_before_writes(self):
        path = self.root / self.recipe['models'][0]['archive']
        path.write_bytes(path.read_bytes() + b'changed identity')
        self.assert_read_only_failure('archive hash differs')

    def test_duplicate_archive_manifest_keys_are_rejected(self):
        path = self.root / self.recipe['models'][0]['archive']
        with zipfile.ZipFile(path) as archive:
            files = {name: archive.read(name) for name in archive.namelist()}
        files['asset.json'] = files['asset.json'].replace(b'{', b'{"kind":"model",', 1)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_STORED) as archive:
            for name, payload in files.items():
                archive.writestr(name, payload)
        path.write_bytes(buffer.getvalue())
        self.recipe['models'][0]['archiveSha256'] = sha(buffer.getvalue())
        self.save_recipe()
        self.assert_read_only_failure('Duplicate JSON key')

    def test_existing_loose_payload_corruption_is_preserved(self):
        self.run_stage()
        path = self.destination / self.recipe['models'][0]['archiveSha256'] / 'model.glb'
        path.write_bytes(b'authored/corrupt file must remain')
        self.assert_read_only_failure('immutable player resource differs')

    def test_existing_manifest_corruption_is_preserved(self):
        self.run_stage()
        manifest = json.loads(self.catalog_path.read_bytes())['playerProfiles'][0]['manifest']
        (self.destination / manifest[4:]).write_bytes(b'changed')
        self.assert_read_only_failure('manifest hash/length differs')

    def test_append_profile_preserves_old_immutable_manifest(self):
        self.run_stage()
        first = json.loads(self.catalog_path.read_bytes())['playerProfiles'][0]
        old_path = self.destination / first['manifest'][4:]
        old = (old_path.read_bytes(), old_path.stat().st_mtime_ns)
        self.recipe['profiles'].append(self.profile('human-female-fighter-alternate'))
        self.save_recipe()
        result = self.run_stage()
        current = json.loads(self.catalog_path.read_bytes())['playerProfiles'][0]
        self.assertNotEqual(first['manifest'], current['manifest'])
        self.assertEqual(old, (old_path.read_bytes(), old_path.stat().st_mtime_ns))
        self.assertEqual(result['filesWritten'], 2)
        self.assertEqual(result['addedProfiles'], ['human-female-fighter-alternate'])

    def add_external_bundle(self, profiles):
        payload = json_bytes({'schemaVersion': 1, 'kind': 'native-player-profiles', 'profiles': profiles})
        identity = sha(payload)
        path = self.destination / ('player-profiles/' + identity + '/manifest.json')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        catalog = json.loads(self.catalog_path.read_bytes())
        record = {'id': 'other-owner', 'manifest': '/l2/player-profiles/' + identity + '/manifest.json',
                  'manifestSha256': identity, 'manifestBytes': len(payload), 'extension': 'preserved'}
        catalog.setdefault('playerProfiles', []).append(record)
        self.catalog_path.write_bytes(json_bytes(catalog))
        return record

    def test_unrelated_bundle_and_profile_are_retained(self):
        record = self.add_external_bundle([self.profile('unrelated-player')])
        self.run_stage()
        self.assertEqual(json.loads(self.catalog_path.read_bytes())['playerProfiles'][0], record)

    def test_duplicate_profile_ids_across_manifests_are_rejected(self):
        self.run_stage()
        self.add_external_bundle([self.profile()])
        self.assert_read_only_failure('Duplicate player identity')

    def test_duplicate_recipe_ids_and_json_keys_are_rejected(self):
        self.recipe['profiles'].append(copy.deepcopy(self.recipe['profiles'][0]))
        self.save_recipe()
        self.assert_read_only_failure('Duplicate requested player profile')
        self.recipe_path.write_bytes(b'{"schemaVersion":1,"schemaVersion":1}')
        self.assert_read_only_failure('Duplicate JSON key')

    def test_nonfinite_json_is_rejected(self):
        self.recipe_path.write_bytes(b'{"value":NaN}')
        self.assert_read_only_failure('Nonfinite JSON')

    def test_unsafe_and_overlapping_paths_are_rejected(self):
        for name in ('../outside.l2asset', '/absolute.l2asset', 'artifacts/CON.txt', 'artifacts/a:stream', 'artifacts/x./a',
                     'artifacts/a*', 'artifacts/a?'):
            with self.subTest(name=name):
                self.recipe['models'][0]['archive'] = name
                self.save_recipe()
                self.assert_read_only_failure('Unsafe relative path')
        self.recipe['models'][0]['archive'] = 'public/l2/source.l2asset'
        self.save_recipe()
        self.assert_read_only_failure('source/output overlap')
        before = snapshot(self.root)
        with self.assertRaisesRegex(ValueError, 'only this project public/l2'):
            subject.stage(self.recipe_path, self.root / 'other', sha(self.catalog_path.read_bytes()), project_root=self.root)
        self.assertEqual(before, snapshot(self.root))

    def test_recipe_inside_output_is_rejected(self):
        path = self.destination / 'recipe.json'
        path.write_bytes(self.recipe_path.read_bytes())
        with self.assertRaisesRegex(ValueError, 'outside public/l2'):
            subject.stage(path, self.destination, sha(self.catalog_path.read_bytes()), project_root=self.root)

    def test_symlink_input_is_rejected(self):
        original = self.root / self.recipe['models'][0]['archive']
        linked = self.root / 'artifacts/linked.l2asset'
        try:
            linked.symlink_to(original)
        except OSError as error:
            self.skipTest('OS does not allow fixture symlink: ' + str(error))
        self.recipe['models'][0]['archive'] = linked.relative_to(self.root).as_posix()
        self.save_recipe()
        self.assert_read_only_failure('Symlink/junction/reparse')

    def test_changed_catalog_during_copy_is_not_overwritten(self):
        original_writer = subject.immutable_write
        replacement = json_bytes(dict(self.catalog, concurrentOwner='retained'))
        changed = False
        def write_then_change(path, payload):
            nonlocal changed
            original_writer(path, payload)
            if not changed:
                self.catalog_path.write_bytes(replacement)
                changed = True
        with patch.object(subject, 'immutable_write', write_then_change):
            with self.assertRaisesRegex(ValueError, 'Catalog changed before publication'):
                self.run_stage()
        self.assertEqual(self.catalog_path.read_bytes(), replacement)

    def test_reused_catalog_model_loose_payload_is_also_verified(self):
        self.run_stage()
        self.recipe['models'] = self.recipe['models'][:1]
        self.save_recipe()
        first_catalog = json.loads(self.catalog_path.read_bytes())
        upper = next(row for row in first_catalog['models'] if row['id'] == 'female-upper:0')
        (self.destination / upper['model'][4:]).write_bytes(b'corrupt reused model')
        self.assert_read_only_failure('immutable player resource differs')

    def test_glb_container_and_clip_duplicates_are_rejected(self):
        for payload in (b'bad header', glb(['wait', 'wait'])):
            with self.subTest(bytes=len(payload)):
                with self.assertRaisesRegex(ValueError, 'GLB header|duplicate player animation'):
                    subject.clip_names(payload)

    def test_animation_glb_json_can_exceed_profile_json_limit(self):
        self.assertEqual(subject.clip_names(glb(self.names, padding='x' * 8_000_000)), set(self.names))


if __name__ == '__main__':
    unittest.main()
