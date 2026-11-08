import copy
import hashlib
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_assets_lib.gltf import json_bytes
from native_store.merge_lane_store import LaneStoreMergeRefusedError, merge_lane_store

GOLDEN_ROOT = ROOT / 'tests' / 'fixtures' / 'golden'
GOLDEN_CATALOG = json.loads((GOLDEN_ROOT / 'l2' / 'catalog.json').read_bytes())
MODEL_VERSION_ONE_RECORD = GOLDEN_CATALOG['models'][0]
MODEL_VERSION_TWO_RECORD = GOLDEN_CATALOG['models'][1]
MODEL_VERSION_ONE_BYTES = (GOLDEN_ROOT / 'model-v1.l2asset').read_bytes()
MODEL_VERSION_TWO_BYTES = (GOLDEN_ROOT / 'model-v2.l2asset').read_bytes()
MODEL_VERSION_TWO_SHA256 = MODEL_VERSION_TWO_RECORD['archiveSha256']
NATIVE_RESOURCE_PREFIX = '/l2/'


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


def archive_member(archive_bytes, name):
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        return archive.read(name)


MODEL_VERSION_TWO_GLB = archive_member(MODEL_VERSION_TWO_BYTES, 'model.glb')
LANE_MODEL_RECORD = dict(MODEL_VERSION_TWO_RECORD, model=f'/l2/{MODEL_VERSION_TWO_SHA256}/model.glb',
                         modelSha256=sha256_hex(MODEL_VERSION_TWO_GLB))
LANE_SCRATCH_FILES = ('.work/x.tmp', 'index/key.json', f'{MODEL_VERSION_TWO_SHA256}/evidence/000-export-x.log', 'export-manifest.json',
                      'coverage.json', 'load-checks/check.json', 'logs/convert.log')


def snapshot_tree(root):
    return {path.relative_to(root).as_posix(): (path.read_bytes(), path.stat().st_mtime_ns)
            for path in sorted(root.rglob('*')) if path.is_file()}


def write_file(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def relative_resource(path):
    return path[len(NATIVE_RESOURCE_PREFIX):]


class LaneStoreFixture:
    def __init__(self, test_case):
        temporary_directory = tempfile.TemporaryDirectory()
        test_case.addCleanup(temporary_directory.cleanup)
        self.temporary_root = Path(temporary_directory.name).resolve()
        self.target_root = self.temporary_root / 'target' / 'l2'
        self.lane_root = self.temporary_root / 'lane' / 'l2'
        self.build_target_store(self.target_root)
        self.lane_records = {'models': [copy.deepcopy(LANE_MODEL_RECORD)]}
        self.lane_files = {MODEL_VERSION_TWO_RECORD['archive']: MODEL_VERSION_TWO_BYTES, LANE_MODEL_RECORD['model']: MODEL_VERSION_TWO_GLB}
        self.write_lane_store()

    @staticmethod
    def build_target_store(target_root):
        shutil.copytree(GOLDEN_ROOT / 'l2', target_root)
        target_catalog = copy.deepcopy(GOLDEN_CATALOG)
        target_catalog['models'] = [MODEL_VERSION_ONE_RECORD]
        write_file(target_root / 'catalog.json', json_bytes(target_catalog))
        write_file(target_root / relative_resource(MODEL_VERSION_ONE_RECORD['archive']), MODEL_VERSION_ONE_BYTES)

    def target_catalog_sha256(self, target_root=None):
        return sha256_hex(((target_root or self.target_root) / 'catalog.json').read_bytes())

    def write_lane_store(self, source_catalog_sha256=None):
        lane_catalog = {'schemaVersion': 1, **self.lane_records,
                        'sourceCatalogSha256': source_catalog_sha256 or self.target_catalog_sha256()}
        if self.lane_root.exists():
            shutil.rmtree(self.lane_root)
        write_file(self.lane_root / 'catalog.json', json_bytes(lane_catalog))
        for resource_path, payload in self.lane_files.items():
            write_file(self.lane_root / relative_resource(resource_path), payload)
        for scratch in LANE_SCRATCH_FILES:
            write_file(self.lane_root / scratch, b'converter scratch ' + scratch.encode())

    def merge(self, target_root=None, expected_base_catalog_sha256=None):
        target_root = target_root or self.target_root
        return merge_lane_store(self.lane_root, target_root, expected_base_catalog_sha256 or self.target_catalog_sha256(target_root))


class LaneStoreMergeTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LaneStoreFixture(self)

    def test_one_lane_model_record_and_its_pinned_files_merge_catalog_last_and_a_repeat_is_refused(self):
        base_sha256 = self.fixture.target_catalog_sha256()
        result = self.fixture.merge()
        target_root = self.fixture.target_root
        merged_catalog_bytes = (target_root / 'catalog.json').read_bytes()
        merged_catalog = json.loads(merged_catalog_bytes)
        self.assertEqual(merged_catalog['models'], [MODEL_VERSION_ONE_RECORD, LANE_MODEL_RECORD])
        self.assertNotIn('sourceCatalogSha256', merged_catalog)
        for resource_path, payload in self.fixture.lane_files.items():
            self.assertEqual((target_root / relative_resource(resource_path)).read_bytes(), payload)
        for scratch in LANE_SCRATCH_FILES:
            self.assertFalse((target_root / scratch).exists(), scratch)
        self.assertEqual(result, {'beforeCatalogSha256': base_sha256, 'afterCatalogSha256': sha256_hex(merged_catalog_bytes),
                                  'copiedFiles': sorted(relative_resource(path) for path in self.fixture.lane_files),
                                  'unchangedFiles': [], 'addedRecordsBySlice': {'models': 1}})
        snapshot = snapshot_tree(target_root)
        with self.assertRaisesRegex(LaneStoreMergeRefusedError, f'expected base catalog sha256 {base_sha256} differs'):
            merge_lane_store(self.fixture.lane_root, target_root, base_sha256)
        self.assertEqual(snapshot_tree(target_root), snapshot)


if __name__ == '__main__':
    unittest.main()
