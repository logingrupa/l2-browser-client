import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets import archive_bytes
from native_assets_lib.gltf import json_bytes
from native_assets_lib import animation_audio_bundle, footstep_event_inventory as subject
from native_assets_lib.sha256_identity import sha256_hex_digest

INVENTORY_RECIPE = ROOT / 'recipes/native-human-mystic-footstep-events.json'
BUNDLE_RECIPE = ROOT / 'recipes/native-human-mystic-footstep-audio.json'
MYSTIC_FOOTSTEP_OUTPUT = ROOT / 'artifacts/native-parity/research/dev-sheet-audio-20261107/footstep-mystics'


def snapshot(root):
    return {p.relative_to(root).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns) for p in root.rglob('*') if p.is_file()}


class SyntheticArchiveInventoryTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='footstep-inventory-')
        self.addCleanup(temp.cleanup)
        self.root, self.hash = Path(temp.name), sha256_hex_digest(b'source package')
        self.output = self.root / 'artifacts/inventory'
        self.step = {'animationSet': 'Magic.MMagic_anim', 'clip': 'Run_Hand_MMagic', 'object': 'Magic.AnimNotify_Sound598',
                     'type': 'AnimNotify_Sound', 'function': 'None', 'normalizedTime': .19, 'timeSeconds': .19 * 10 / 12,
                     'sourceFrames': 10, 'sourceRate': 12.0, 'sound': None,
                     'properties': {'DefaultRunSound': ['StepSound.Default.default_run_01'] * 3, 'Volume': 250.0, 'Radius': 30}}
        self.breath = {**copy.deepcopy(self.step), 'object': 'Magic.AnimNotify_Sound597', 'sound': 'ChrSound.Breath',
                       'resolvedFile': 'audio/breath.wav', 'properties': {**copy.deepcopy(self.step['properties']), 'Random': 5}}
        self.actor = {'schemaVersion': 1, 'kind': 'model', 'id': 'interlude:mystic',
                      'source': {'edition': 'interlude', 'object': 'Magic.MMagic_M005_u', 'sha256': self.hash},
                      'model': {'file': 'model.glb'},
                      'animationEvents': [{**copy.deepcopy(self.step), 'clip': 'Wait_Hand_MMagic'}, self.breath, self.step]}
        self.dependencies = {'locomotion': {'dependencies': [
            {'authoredReference': 'StepSound.Default.default_run_01', 'sourceObject': 'stepsound.Default.default_run_01', 'exportIndex': 5},
            {'authoredReference': 'StepSound.Grass.grass_run_01', 'sourceObject': 'stepsound.Grass.grass_run_01', 'exportIndex': 9}]}}
        self.save()

    def write(self, name, data):
        path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
        return {'path': name, 'sha256': sha256_hex_digest(data), 'bytes': len(data)}

    def save(self):
        payloads = {'model.glb': b'unrendered', 'audio/breath.wav': b'RIFF0000WAVE'}
        self.actor['files'] = [{'path': n, 'sha256': sha256_hex_digest(b), 'bytes': len(b)} for n, b in payloads.items()]
        archive = self.write('inputs/actor.l2asset', archive_bytes(self.actor, payloads))
        dependencies = self.write('inputs/coverage.json', json_bytes(self.dependencies))
        self.recipe = {'schemaVersion': 1, 'kind': subject.RECIPE_KIND,
                       'dependencies': {**dependencies, 'pointer': '/locomotion/dependencies'},
                       'actors': [{'catalogId': 'human-male-mystic:0', 'assetId': 'interlude:mystic', 'sex': 'male',
                                   'archive': archive, 'clips': ['Run_Hand_MMagic']}]}
        self.write('recipes/inventory.json', json_bytes(self.recipe))

    def run_inventory(self, **kwargs):
        return subject.run(self.root, self.root / 'recipes/inventory.json', self.output, **kwargs)

    def fails_read_only(self, pattern, **kwargs):
        before = snapshot(self.root)
        with self.assertRaisesRegex((ValueError, KeyError), pattern): self.run_inventory(**kwargs)
        self.assertEqual(snapshot(self.root), before)

    def test_copies_selected_events_unchanged_and_only_the_used_dependency_rows(self):
        result = self.run_inventory()
        self.assertEqual((result['status'], result['filesWritten']), ('produced', 1))
        inventory = json.loads((self.output / 'inventory.json').read_bytes())
        events = inventory['locomotion']['events']
        self.assertEqual([row['manifestPointer'] for row in events], ['/animationEvents/1', '/animationEvents/2'])
        for row, raw in zip(events, (self.breath, self.step)):
            self.assertEqual({key: row[key] for key in subject.EVENT_FIELDS}, {key: raw.get(key) for key in subject.EVENT_FIELDS})
            self.assertEqual(row['nativeNotification']['sourcePackageSha256'], self.hash)
            self.assertIsNone(row['nativeNotification']['offsetUnwrapped'])
        self.assertEqual(events[0]['authoredScalars'], {'Radius': 30, 'Volume': 250.0, 'Random': 5})
        self.assertEqual(events[0]['resolvedFile'], 'audio/breath.wav')
        self.assertEqual(inventory['locomotion']['dependencies'], self.dependencies['locomotion']['dependencies'][:1])
        self.assertEqual(inventory['coverage'], {'actors': 1, 'events': 2, 'directSoundEvents': 1, 'dependencies': 1})

    def test_rows_satisfy_the_animation_audio_bundle_provenance_check(self):
        self.run_inventory()
        inventory = json.loads((self.output / 'inventory.json').read_bytes())
        manifest_hash = sha256_hex_digest(json_bytes(self.actor))
        index = animation_audio_bundle.evidence_index(inventory['locomotion']['events'])
        for ordinal in (1, 2):
            raw = self.actor['animationEvents'][ordinal]
            row = index[(manifest_hash, f'/animationEvents/{ordinal}')]
            self.assertEqual(animation_audio_bundle.event_provenance(raw, row, manifest_hash, ordinal), row)

    def test_plan_repeat_and_verify_write_nothing(self):
        before = snapshot(self.root)
        self.assertEqual(self.run_inventory(plan=True)['filesWritten'], 0); self.assertEqual(snapshot(self.root), before)
        self.run_inventory(); produced = snapshot(self.root)
        self.assertEqual(self.run_inventory()['status'], 'preserved')
        self.assertEqual(self.run_inventory(verify_only=True)['status'], 'verified')
        self.assertEqual(snapshot(self.root), produced)

    def test_changed_output_is_preserved_and_refused(self):
        self.run_inventory(); (self.output / 'inventory.json').write_bytes(b'{}')
        self.fails_read_only('immutable output differs')

    def test_missing_dependency_clip_and_input_hash_fail_closed(self):
        self.dependencies['locomotion']['dependencies'].pop(0); self.save()
        self.fails_read_only('Missing exact dependency: StepSound.Default.default_run_01')
        self.dependencies['locomotion']['dependencies'].insert(0, {'authoredReference': 'StepSound.Default.default_run_01'}); self.save()
        self.recipe['actors'][0]['clips'] = ['Run_Hand_MMagic', 'Walk_Hand_MMagic']
        self.write('recipes/inventory.json', json_bytes(self.recipe))
        self.fails_read_only('no retained notify events: Walk_Hand_MMagic')
        self.save(); self.recipe['dependencies']['sha256'] = '0' * 64
        self.write('recipes/inventory.json', json_bytes(self.recipe))
        self.fails_read_only('Input hash differs')

    def test_ambiguous_dependency_and_unqualified_reference_fail_closed(self):
        self.dependencies['locomotion']['dependencies'].append({'authoredReference': 'stepsound.default.DEFAULT_RUN_01'}); self.save()
        self.fails_read_only('Ambiguous qualified dependency')
        self.dependencies['locomotion']['dependencies'].pop()
        self.step['properties']['DefaultRunSound'] = ['default_run_01']; self.save()
        self.fails_read_only('Unqualified/empty authored dependency')


@unittest.skipUnless((MYSTIC_FOOTSTEP_OUTPUT / 'inventory/inventory.json').is_file() and (MYSTIC_FOOTSTEP_OUTPUT / 'bundle/manifest.json').is_file(),
                     'Mystic footstep outputs are absent')
class MysticFootstepOutputVerificationTests(unittest.TestCase):
    def test_inventory_and_bundle_verify_byte_identically_without_writes(self):
        inventory = subject.run(ROOT, INVENTORY_RECIPE, MYSTIC_FOOTSTEP_OUTPUT / 'inventory', verify_only=True)
        self.assertEqual((inventory['status'], inventory['filesWritten']), ('verified', 0))
        self.assertEqual(inventory['coverage'], {'actors': 2, 'events': 10, 'directSoundEvents': 2, 'dependencies': 20})
        self.assertEqual(json.loads(BUNDLE_RECIPE.read_bytes())['inventory']['sha256'], inventory['inventorySha256'])
        bundle = animation_audio_bundle.run(ROOT, BUNDLE_RECIPE, MYSTIC_FOOTSTEP_OUTPUT / 'bundle', verify_only=True)
        self.assertEqual((bundle['status'], bundle['filesWritten']), ('verified', 0))
        self.assertEqual({key: bundle['coverage'][key] for key in ('actors', 'events', 'surfaceEvents', 'directSoundEvents', 'arraySlots', 'dependencies')},
                         {'actors': 2, 'events': 10, 'surfaceEvents': 10, 'directSoundEvents': 2, 'arraySlots': 240, 'dependencies': 20})


if __name__ == '__main__':
    unittest.main()
