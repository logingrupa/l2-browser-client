import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from actors.skill_effect_conversion import (add_staged_effect_store_files, skill_dispatch_class_component_record, skill_effect_component_record,
                                            stage_effect_bundle)
from effect_source_bundle_fixture import write_sprite_effect_source_bundle
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import CatalogWriteError, merge_catalog_slice, write_store
from native_store.pinned_store_verification import PINNED_STORE_VERIFICATION_WORKER_COUNT, verify_pinned_store_files

VISUAL_ROOT = 'skill.fixture.root'


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


class StagedSkillEffectStoreTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source_bytes = write_sprite_effect_source_bundle(self.root / 'bundle')
        self.manifest_sha256 = stage_effect_bundle(ROOT, self.root / 'bundle', self.root / 'effects')
        self.staged_root = self.root / 'effects' / self.manifest_sha256
        self.staged_manifest = json.loads((self.staged_root / 'manifest.json').read_bytes())
        self.store_root = self.root / 'store'
        files = {}
        add_staged_effect_store_files(files, self.staged_root, self.manifest_sha256)
        record = skill_effect_component_record(3, 1, VISUAL_ROOT, self.manifest_sha256)
        self.catalog = merge_catalog_slice({'schemaVersion': 1, 'models': []}, 'effectComponents', record, 1)
        write_store(self.store_root, files, None, canonical_json_bytes(self.catalog))

    def effect_store_relative(self, member):
        return f'effects/{self.manifest_sha256}/{member}'

    def test_the_staged_source_bundle_pins_name_content_addressed_files_holding_the_source_bytes(self):
        source_bundle = self.staged_manifest['sourceBundle']
        for field, payload in (('manifest', self.source_bytes['manifest']), ('graph', self.source_bytes['graph'])):
            self.assertEqual(source_bundle[field], {'file': f'source-bundle/{sha256_hex(payload)}.json', 'bytes': len(payload),
                                                    'sha256': sha256_hex(payload)})
            self.assertEqual((self.store_root / self.effect_store_relative(source_bundle[field]['file'])).read_bytes(), payload)

    def test_a_store_written_from_a_staged_root_pins_every_file_its_effect_manifest_names(self):
        verified_store_file_by_key = verify_pinned_store_files(self.store_root, self.catalog, PINNED_STORE_VERIFICATION_WORKER_COUNT)
        pinned_relatives = {verified_store_file.relative for verified_store_file in verified_store_file_by_key.values()}
        source_bundle = self.staged_manifest['sourceBundle']
        resource_files = {resource['file'] for resource in self.staged_manifest['resources'].values()}
        expected = {self.effect_store_relative(member) for member in
                    {'manifest.json', source_bundle['manifest']['file'], source_bundle['graph']['file'], *resource_files}}
        self.assertEqual(pinned_relatives, expected)

    def test_a_dispatch_class_record_on_the_same_staged_root_pins_the_same_files(self):
        record = skill_dispatch_class_component_record('LineageEffect.s_u010_b', self.manifest_sha256)
        self.assertEqual(record, {'id': 'interlude:skill-dispatch-class:LineageEffect.s_u010_b',
                                  'bundleId': 'interlude:skill-dispatch-class:LineageEffect.s_u010_b',
                                  'manifest': f'/l2/effects/{self.manifest_sha256}/manifest.json', 'manifestSha256': self.manifest_sha256})
        class_catalog = merge_catalog_slice({'schemaVersion': 1, 'models': []}, 'effectComponents', record, 1)
        class_files = verify_pinned_store_files(self.store_root, class_catalog, PINNED_STORE_VERIFICATION_WORKER_COUNT)
        skill_files = verify_pinned_store_files(self.store_root, self.catalog, PINNED_STORE_VERIFICATION_WORKER_COUNT)
        self.assertEqual({entry.relative for entry in class_files.values()}, {entry.relative for entry in skill_files.values()})

    def test_a_store_missing_the_source_graph_is_still_refused_by_the_pin_check(self):
        (self.store_root / self.effect_store_relative(self.staged_manifest['sourceBundle']['graph']['file'])).unlink()
        with self.assertRaisesRegex(CatalogWriteError, 'pinned store file is missing'):
            verify_pinned_store_files(self.store_root, self.catalog, PINNED_STORE_VERIFICATION_WORKER_COUNT)


if __name__ == '__main__':
    unittest.main()
