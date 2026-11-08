from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_catalog import effects
import native_map
from native_map import SCHEMA, file_hash, implementation, json_bytes, sha, verify_map
import native_map_geometry
import native_map_overlap
from reference_client_guard import ReferenceClientLockError
from reference_client_lock_fixture import use_reference_client_lock
from test_reference_client_guard import SyntheticReferenceClientTrees, write_tree_file

DIFFERING_TABLE = 'system/chargrp.dat'
EQUAL_TABLE = 'system/npcgrp.dat'


def recorded_file(path):
    payload = path.read_bytes()
    return {'bytes': len(payload), 'sha256': sha(payload)}


def write_raw_map_output(raw_output, map_relative_path, dependencies):
    manifest = {'recipe': {'map': map_relative_path}, 'support': 'fixture', 'coverage': {}, 'gaps': [], 'unsupported': []}
    manifest_path = write_tree_file(raw_output, 'manifest.json', json_bytes(manifest))
    receipt = {'schemaVersion': SCHEMA, 'kind': 'native-map-raw', 'recipeSha256': sha(json_bytes(manifest['recipe'])),
               'implementation': implementation(), 'dependencies': dependencies, 'outputs': {'manifest.json': recorded_file(manifest_path)}}
    write_tree_file(raw_output, 'receipt.json', json_bytes(receipt))


class MapReadPathLockTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.base = Path(temporary_directory.name).resolve()
        self.trees = SyntheticReferenceClientTrees(self.base)
        use_reference_client_lock(self, self.trees.lock_path)
        self.trees.write_lock()
        self.client = self.trees.conversion_root
        self.raw_output = self.base / 'raw'

    def differing_table_record(self):
        return recorded_file(self.client / DIFFERING_TABLE)

    def test_map_verification_refuses_a_recorded_dependency_the_lock_marks_differing(self):
        write_raw_map_output(self.raw_output, DIFFERING_TABLE, {DIFFERING_TABLE: self.differing_table_record()})
        with self.assertRaisesRegex(ReferenceClientLockError, 'system/chargrp.dat is differing, not equal'):
            verify_map(self.client, self.raw_output)

    def test_map_verification_accepts_a_lock_equal_dependency(self):
        write_raw_map_output(self.raw_output, EQUAL_TABLE, {EQUAL_TABLE: recorded_file(self.client / EQUAL_TABLE)})
        self.assertTrue(verify_map(self.client, self.raw_output)['verified'])

    def test_geometry_verification_refuses_a_source_dependency_the_lock_marks_differing(self):
        write_raw_map_output(self.raw_output, EQUAL_TABLE, {})
        geometry_output = self.base / 'geometry'
        write_tree_file(geometry_output, 'receipt.json', json_bytes({
            'kind': 'native-terrain-section', 'implementationSha256': native_map_geometry.implementation_hash(),
            'rawMapReceiptSha256': file_hash(self.raw_output / 'receipt.json'), 'outputs': {},
            'sourceDependencies': {DIFFERING_TABLE: self.differing_table_record()['sha256']}}))
        with self.assertRaisesRegex(ReferenceClientLockError, 'system/chargrp.dat is differing, not equal'):
            native_map_geometry.verify_geometry(self.client, self.raw_output, geometry_output)

    def test_geometry_build_refuses_to_decode_a_map_the_lock_marks_differing(self):
        write_raw_map_output(self.raw_output, DIFFERING_TABLE, {})
        with self.assertRaisesRegex(ReferenceClientLockError, 'system/chargrp.dat is differing, not equal'):
            native_map_geometry.build_geometry(self.client, self.raw_output, {'schemaVersion': 1, 'kind': 'native-terrain-section'},
                                               self.base / 'geometry')

    def test_reused_class_evidence_refuses_a_package_the_lock_marks_differing(self):
        class_parser = write_tree_file(self.base, 'tools/UELib.dll', b'stand-in class parser')
        reused_evidence = self.base / 'class-evidence'
        script = write_tree_file(reused_evidence / 'Engine.Actor', 'Actor.uc', b'class Actor extends Object;')
        write_tree_file(reused_evidence / 'Engine.Actor', 'defaults.json', json_bytes({
            'sourceScript': 'Actor.uc', 'sourceScriptSha256': sha(script.read_bytes()),
            'source': {'package': DIFFERING_TABLE, 'packageSha256': self.differing_table_record()['sha256']}}))
        with patch.object(effects, 'UELIB', class_parser), patch.object(effects, 'UELIB_SHA256', file_hash(class_parser)), \
                self.assertRaisesRegex(ReferenceClientLockError, 'system/chargrp.dat is differing, not equal'):
            native_map_geometry.read_class_evidence(self.client, self.base / 'work', reused_evidence)

    def test_overlap_audit_client_files_must_be_lock_equal(self):
        checked_hashes = {}
        self.assertEqual(native_map_overlap.verify_lock_equal_client_file(self.client, EQUAL_TABLE,
                         recorded_file(self.client / EQUAL_TABLE), checked_hashes), self.client / EQUAL_TABLE)
        with self.assertRaisesRegex(ReferenceClientLockError, 'system/chargrp.dat is differing, not equal'):
            native_map_overlap.verify_lock_equal_client_file(self.client, DIFFERING_TABLE, self.differing_table_record(), checked_hashes)

    def test_map_sources_read_only_lock_equal_packages(self):
        with patch.object(native_map, 'Package', lambda data, name: data):
            sources = native_map.MapSources(self.client)
            self.assertEqual(sources.get(EQUAL_TABLE), b'equal table')
            with self.assertRaisesRegex(ReferenceClientLockError, 'system/chargrp.dat is differing, not equal'):
                sources.get(DIFFERING_TABLE)


if __name__ == '__main__':
    unittest.main()
