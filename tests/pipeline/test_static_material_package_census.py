from __future__ import annotations

import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_assets_lib.asset_manifest import reference_client_build
from native_assets_lib.static_materials import REVIEWED_VERSIONS
from native_store.canonical_json import canonical_json_bytes
from reference_client_guard import ENGINE_LIBRARY_RELATIVE_PATH, REFERENCE_CLIENT_LOCK_PATH, read_reference_client_lock, require_reference_client
from reference_client_lock_fixture import equal_lock_record, use_synthetic_reference_client_lock, write_synthetic_engine_library
from ue2_package_fixture import package_bytes
import static_material_package_census as census_module

PACKAGE_VERSION_HEADER_OFFSET = 4
STATIC_MESH_IMPORTS = [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'StaticMesh'), ('Core', 'Class', -1, 'Texture')]
STATIC_MESH_CLASS_IMPORT = -2
TEXTURE_CLASS_IMPORT = -3


def empty_export(name, class_import):
    return {'name': name, 'class': class_import, 'body': lambda offset, names: b''}


def synthetic_static_mesh_package(version, static_mesh_names, texture_names=()):
    exports = [empty_export(name, STATIC_MESH_CLASS_IMPORT) for name in static_mesh_names]
    exports += [empty_export(name, TEXTURE_CLASS_IMPORT) for name in texture_names]
    data = bytearray(package_bytes([], STATIC_MESH_IMPORTS, exports))
    struct.pack_into('<HH', data, PACKAGE_VERSION_HEADER_OFFSET, *version)
    return bytes(data)


SYNTHETIC_PACKAGES = {
    'staticmeshes/Twelve_S.usx': ((123, 12), ['Rock', 'Tree'], ['Skin']),
    'staticmeshes/reviewed_s.usx': ((123, 28), ['Wall'], []),
    'staticmeshes/Neighbour_S.usx': ((123, 13), ['Arch', 'Gate', 'Door'], []),
    'staticmeshes/Older_S.usx': ((118, 11), ['Old'], []),
}
NOT_EQUAL_PACKAGE = 'staticmeshes/Changed_S.usx'


class SyntheticStaticMeshPackageCensusTests(unittest.TestCase):
    def setUp(self):
        client_directory = tempfile.TemporaryDirectory()
        self.addCleanup(client_directory.cleanup)
        self.client_root = Path(client_directory.name)
        write_synthetic_engine_library(self.client_root)
        files = {ENGINE_LIBRARY_RELATIVE_PATH: equal_lock_record(self.client_root / ENGINE_LIBRARY_RELATIVE_PATH)}
        for relative_path, (version, static_meshes, textures) in {**SYNTHETIC_PACKAGES, NOT_EQUAL_PACKAGE: ((123, 28), ['Lost'], [])}.items():
            package_path = self.client_root / relative_path
            package_path.parent.mkdir(parents=True, exist_ok=True)
            package_path.write_bytes(synthetic_static_mesh_package(version, static_meshes, textures))
            files[relative_path] = equal_lock_record(package_path)
        files[NOT_EQUAL_PACKAGE][0] = 'differs'
        use_synthetic_reference_client_lock(self, self.client_root, files)

    def census(self):
        return census_module.build_static_mesh_package_census(require_reference_client(self.client_root))

    def test_every_lock_equal_usx_is_listed_by_path_with_its_header_and_static_mesh_count(self):
        census = self.census()
        rows = {row['path']: row for row in census['packages']}
        self.assertEqual([row['path'] for row in census['packages']], ['staticmeshes/Neighbour_S.usx', 'staticmeshes/Older_S.usx',
                                                                      'staticmeshes/reviewed_s.usx', 'staticmeshes/Twelve_S.usx'])
        self.assertEqual({path: (row['packageVersion'], row['licensee'], row['staticMeshExportCount']) for path, row in rows.items()}, {
            'staticmeshes/Neighbour_S.usx': (123, 13, 3), 'staticmeshes/Older_S.usx': (118, 11, None),
            'staticmeshes/reviewed_s.usx': (123, 28, 1), 'staticmeshes/Twelve_S.usx': (123, 12, 2)})
        for path, row in rows.items():
            with self.subTest(path=path):
                version = (row['packageVersion'], row['licensee'])
                self.assertEqual(row['reviewed'], version in REVIEWED_VERSIONS)
                self.assertEqual(row['reason'], None if row['reviewed'] else f'static-material-layout-unreviewed:{version[0]}/{version[1]}')
                self.assertEqual(row['sha256'], equal_lock_record(self.client_root / path)[2])
        self.assertTrue(rows['staticmeshes/reviewed_s.usx']['reviewed'])
        self.assertEqual(rows['staticmeshes/Neighbour_S.usx']['reason'], 'static-material-layout-unreviewed:123/13')
        self.assertEqual(rows['staticmeshes/Older_S.usx']['reason'], 'static-material-layout-unreviewed:118/11')
        self.assertEqual(census['reviewedVersions'], [list(version) for version in sorted(REVIEWED_VERSIONS)])
        self.assertEqual(census['referenceTreeLockSha256'],
                         reference_client_build(require_reference_client(self.client_root).lock)['referenceTreeLockSha256'])

    def test_the_census_is_byte_identical_on_rerun(self):
        self.assertEqual(canonical_json_bytes(self.census()), canonical_json_bytes(self.census()))

    def test_unreviewed_versions_are_ordered_by_static_mesh_export_count(self):
        ordered = census_module.unreviewed_versions_by_static_mesh_count(self.census())
        self.assertEqual(ordered[0], {'version': '123/13', 'packages': 1, 'staticMeshExports': 3})
        self.assertEqual(ordered[-1], {'version': '118/11', 'packages': 1, 'staticMeshExports': 0})

    def test_an_output_outside_the_adapter_dispatch_evidence_folder_is_refused(self):
        with self.assertRaisesRegex(census_module.StaticMeshPackageCensusError, 'docs/parts/adapter-dispatch'):
            census_module.write_static_mesh_package_census(self.census(), self.client_root / 'static-mesh-package-census.json')
        with self.assertRaises(census_module.StaticMeshPackageCensusError):
            census_module.require_census_output_path(ROOT / 'docs/parts/world/static-mesh-package-census.json')

    def test_a_census_with_a_stale_reviewed_flag_or_unsorted_rows_is_refused(self):
        census = self.census()
        stale_flag = json.loads(json.dumps(census))
        stale_flag['packages'][2]['reviewed'] = False
        unsorted_rows = json.loads(json.dumps(census))
        unsorted_rows['packages'].reverse()
        missing_count = json.loads(json.dumps(census))
        missing_count['packages'][0]['staticMeshExportCount'] = None
        for case, document in {'stale flag': stale_flag, 'unsorted rows': unsorted_rows, 'missing UE123 count': missing_count}.items():
            with self.subTest(case=case), self.assertRaises(census_module.StaticMeshPackageCensusError):
                census_module.validate_static_mesh_package_census(document)


class CommittedStaticMeshPackageCensusTests(unittest.TestCase):
    def test_the_committed_census_is_valid_pinned_to_the_lock_and_lists_every_lock_equal_usx(self):
        census = json.loads((ROOT / census_module.STATIC_MESH_PACKAGE_CENSUS_RELATIVE_PATH).read_bytes())
        census_module.validate_static_mesh_package_census(census)
        lock = read_reference_client_lock(REFERENCE_CLIENT_LOCK_PATH)
        self.assertEqual(census['referenceTreeLockSha256'], reference_client_build(lock)['referenceTreeLockSha256'])
        self.assertEqual([row['path'] for row in census['packages']], census_module.lock_equal_static_mesh_package_paths(lock))
        for row in census['packages']:
            self.assertEqual(row['sha256'], lock.record(row['path'])['eSha256'])
            self.assertEqual(row['reviewed'], (row['packageVersion'], row['licensee']) in REVIEWED_VERSIONS)


if __name__ == '__main__':
    unittest.main()
