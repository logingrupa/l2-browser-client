import hashlib
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from native_store.merge_lane_store import LaneStoreMergeRefusedError
from native_store.print_lane_union_catalog import LaneUnionCatalogRefusedError, lane_union_catalog_document
from test_merge_lane_store import LaneStoreFixture

PRINT_LANE_UNION_CATALOG_SCRIPT = ROOT / 'scripts' / 'native_store' / 'print_lane_union_catalog.py'


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


class LaneUnionCatalogTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LaneStoreFixture(self)

    def print_union_catalog(self):
        return subprocess.run([sys.executable, '-B', str(PRINT_LANE_UNION_CATALOG_SCRIPT), '--lane-store', str(self.fixture.lane_root),
                               '--shared-store', str(self.fixture.target_root)], capture_output=True, check=False)

    def test_the_union_text_is_byte_for_byte_the_catalog_the_restage_merge_writes(self):
        document = lane_union_catalog_document(self.fixture.lane_root, self.fixture.target_root)
        self.fixture.merge()
        self.assertEqual(document['unionCatalogText'].encode('utf-8'), (self.fixture.target_root / 'catalog.json').read_bytes())
        self.assertEqual(document['laneCatalogSha256'], sha256_hex((self.fixture.lane_root / 'catalog.json').read_bytes()))

    def test_a_lane_built_on_another_shared_catalog_is_refused(self):
        self.fixture.write_lane_store(source_catalog_sha256='0' * 64)
        with self.assertRaisesRegex(LaneStoreMergeRefusedError, 'lane catalog sourceCatalogSha256 0{64} differs'):
            lane_union_catalog_document(self.fixture.lane_root, self.fixture.target_root)

    def test_a_shared_store_without_a_catalog_is_refused(self):
        (self.fixture.target_root / 'catalog.json').unlink()
        with self.assertRaisesRegex(LaneUnionCatalogRefusedError, 'shared store has no catalog.json'):
            lane_union_catalog_document(self.fixture.lane_root, self.fixture.target_root)

    def test_the_command_prints_the_document_and_exits_one_with_the_reason_on_a_refusal(self):
        printed = self.print_union_catalog()
        self.assertEqual(printed.returncode, 0, printed.stderr)
        self.assertEqual(json.loads(printed.stdout), lane_union_catalog_document(self.fixture.lane_root, self.fixture.target_root))
        self.fixture.write_lane_store(source_catalog_sha256='0' * 64)
        refused = self.print_union_catalog()
        self.assertEqual((refused.returncode, refused.stdout), (1, b''))
        self.assertIn(b'Lane union catalog refused: lane catalog sourceCatalogSha256', refused.stderr)


if __name__ == '__main__':
    unittest.main()
