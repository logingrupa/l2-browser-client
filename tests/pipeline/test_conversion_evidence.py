import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib import conversion_evidence
from native_assets_lib.conversion_evidence import EXPORT_MANIFEST_NAME, write_conversion_evidence
from native_assets_lib.gltf import safe_name
from test_native_assets_source_cache import MEDIA_REQUEST, LockedSourceTestCase

UMODEL_SHA256 = 'a' * 64
WORK_FILES = {
    '000-export-mesh.log': b'export log',
    '001-dump-mesh.log': b'dump log',
    'export/Pkg/mesh.gltf': b'{"asset":{}}',
    'export/Pkg/mesh.bin': b'buffer bytes',
    'export/Pkg/Textures/diffuse.png': b'\x89PNG\r\n\x1a\ntexture',
    'part-01/export/Pkg/arm.GLTF': b'{"asset":{"part":1}}',
}
RETAINED_PATHS = {'000-export-mesh.log', '001-dump-mesh.log', 'export/Pkg/Textures/diffuse.png'}


def files_under(directory):
    return sorted(path.relative_to(directory).as_posix() for path in directory.rglob('*') if path.is_file())


class ConversionEvidenceTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.base = Path(temporary_directory.name)
        self.work = self.base / 'work'
        self.work.mkdir()

    def write_work_files(self):
        for relative_path, payload in WORK_FILES.items():
            path = self.work / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)

    def manifest_of(self, evidence_directory):
        return json.loads((evidence_directory / EXPORT_MANIFEST_NAME).read_bytes())

    def test_evidence_keeps_logs_and_non_gltf_exports_and_drops_intermediate_gltf_and_buffers(self):
        self.write_work_files()
        evidence = self.base / 'evidence'
        write_conversion_evidence(self.work, evidence, UMODEL_SHA256)
        self.assertEqual(files_under(evidence), sorted([*RETAINED_PATHS, EXPORT_MANIFEST_NAME]))
        for relative_path in RETAINED_PATHS:
            self.assertEqual((evidence / relative_path).read_bytes(), WORK_FILES[relative_path])

    def test_export_manifest_records_every_work_file_sorted_by_casefolded_path(self):
        self.write_work_files()
        evidence = self.base / 'evidence'
        write_conversion_evidence(self.work, evidence, UMODEL_SHA256)
        manifest = self.manifest_of(evidence)
        self.assertEqual(manifest['schemaVersion'], 1)
        self.assertEqual(manifest['umodelSha256'], UMODEL_SHA256)
        expected_paths = sorted(WORK_FILES, key=lambda path: (path.casefold(), path))
        self.assertEqual([row['path'] for row in manifest['files']], expected_paths)
        for row in manifest['files']:
            payload = WORK_FILES[row['path']]
            self.assertEqual(row, {'path': row['path'], 'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload),
                                   'retained': row['path'] in RETAINED_PATHS})
            self.assertNotIn('\\', row['path'])

    def test_empty_work_folder_gives_an_empty_file_list(self):
        evidence = self.base / 'evidence'
        write_conversion_evidence(self.work, evidence, UMODEL_SHA256)
        self.assertEqual(self.manifest_of(evidence), {'schemaVersion': 1, 'umodelSha256': UMODEL_SHA256, 'files': []})
        self.assertEqual(files_under(evidence), [EXPORT_MANIFEST_NAME])

    def test_two_writes_of_one_work_folder_give_identical_manifest_bytes(self):
        self.write_work_files()
        first, second = self.base / 'first', self.base / 'second'
        write_conversion_evidence(self.work, first, UMODEL_SHA256)
        write_conversion_evidence(self.work, second, UMODEL_SHA256)
        self.assertEqual((first / EXPORT_MANIFEST_NAME).read_bytes(), (second / EXPORT_MANIFEST_NAME).read_bytes())

    def test_unsafe_work_path_is_refused_before_anything_is_copied(self):
        self.write_work_files()
        evidence = self.base / 'evidence'
        def refuse_texture_path(name):
            if name == 'export/Pkg/Textures/diffuse.png':
                raise ValueError(f'Unsafe asset path: {name!r}')
            return safe_name(name)
        with patch.object(conversion_evidence, 'safe_name', refuse_texture_path), self.assertRaisesRegex(ValueError, 'Unsafe asset path'):
            write_conversion_evidence(self.work, evidence, UMODEL_SHA256)
        self.assertEqual(files_under(evidence) if evidence.exists() else [], [])

    def test_work_file_named_like_the_export_manifest_is_refused(self):
        (self.work / 'Export-Manifest.json').write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError, 'export-manifest.json'):
            write_conversion_evidence(self.work, self.base / 'evidence', UMODEL_SHA256)


class ConverterEvidenceTests(LockedSourceTestCase):
    def test_media_conversion_writes_only_the_export_manifest_of_its_empty_work_folder(self):
        result = self.create_converter(self.trees.conversion_root).convert(MEDIA_REQUEST)
        evidence = Path(result['file']).parent / 'evidence'
        self.assertEqual(files_under(evidence), [EXPORT_MANIFEST_NAME])
        self.assertEqual(json.loads((evidence / EXPORT_MANIFEST_NAME).read_bytes()),
                         {'schemaVersion': 1, 'umodelSha256': self.umodel_sha256, 'files': []})


if __name__ == '__main__':
    unittest.main()
