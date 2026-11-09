from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_map import SCHEMA, file_hash, implementation, json_bytes, sha, verify_map
import native_map_geometry
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


if __name__ == '__main__':
    unittest.main()
