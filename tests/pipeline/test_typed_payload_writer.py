import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_store.store_paths import ConverterOutputRefusedError
from synthetic_class_scripts import scratch_work_root
from world.typed_payload import TypedPayloadArray, TypedPayloadError, typed_payload_asset, typed_payload_asset_text, write_typed_payload_asset

GOLDEN_FOLDER = ROOT / 'tests' / 'fixtures' / 'typed-payload'
GOLDEN_METADATA = {'sourceSha256': '0123456789abcdef' * 4, 'converterVersion': 'typed-payload-fixture-1'}
GOLDEN_ARRAYS = [TypedPayloadArray('TEST.positions', 'float32', (1.5, -2.25, 0.1, 3.4028234663852886e38, -0.0)),
                 TypedPayloadArray('TEST.indices', 'int32', (-1, 0, 2147483647, -2147483648)),
                 TypedPayloadArray('TEST.flags', 'uint32', (0, 1, 4294967295)),
                 TypedPayloadArray('TEST.bytes', 'uint8', (1, 2, 255))]


class TypedPayloadWriterTests(unittest.TestCase):
    def test_the_synthetic_groups_write_the_committed_golden_payload_and_asset_layout(self):
        output = scratch_work_root(self, 'typed-payload-')
        asset = write_typed_payload_asset(output / 'asset', GOLDEN_ARRAYS, GOLDEN_METADATA)
        golden_payload = (GOLDEN_FOLDER / 'payload.bin').read_bytes()
        self.assertEqual((output / 'asset' / 'payload.bin').read_bytes(), golden_payload)
        written = json.loads((output / 'asset' / 'asset.json').read_bytes())
        self.assertEqual(written['payload'], {'file': 'payload.bin', 'sha256': hashlib.sha256(golden_payload).hexdigest(), 'bytes': len(golden_payload)})
        record_without_pin = {key: value for key, value in written.items() if key != 'payload'}
        self.assertEqual(typed_payload_asset_text(record_without_pin), (GOLDEN_FOLDER / 'asset.json').read_bytes())
        self.assertEqual((written['units'], written['axes'], written['sourceSha256'], written['converterVersion']),
                         ('source', 'ue2-z-up', GOLDEN_METADATA['sourceSha256'], GOLDEN_METADATA['converterVersion']))
        self.assertEqual(asset.asset_sha256, hashlib.sha256((output / 'asset' / 'asset.json').read_bytes()).hexdigest())

    def test_an_empty_group_writes_zero_length_arrays(self):
        asset = typed_payload_asset([TypedPayloadArray('VOLS.exportIndex', 'uint32', ()), TypedPayloadArray('VOLS.kind', 'uint8', ())],
                                    GOLDEN_METADATA)
        self.assertEqual((asset.payload_bytes, [record['byteLength'] for record in asset.asset_record['arrays']]), (b'', [0, 0]))

    def test_invalid_names_values_and_metadata_are_refused(self):
        cases = ([TypedPayloadArray('test.positions', 'float32', (1.0,))], [TypedPayloadArray('TESTS.positions', 'float32', (1.0,))],
                 [TypedPayloadArray('TEST.Positions', 'float32', (1.0,))], [TypedPayloadArray('TEST.bytes', 'uint8', (256,))],
                 [TypedPayloadArray('TEST.indices', 'int32', (2 ** 31,))], [TypedPayloadArray('TEST.flags', 'uint32', (-1,))],
                 [TypedPayloadArray('TEST.positions', 'float32', (float('nan'),))], [TypedPayloadArray('TEST.positions', 'float64', (1.0,))],
                 [TypedPayloadArray('TEST.flags', 'uint32', (1,)), TypedPayloadArray('TEST.flags', 'uint32', (2,))])
        for arrays in cases:
            with self.assertRaises(TypedPayloadError):
                typed_payload_asset(arrays, GOLDEN_METADATA)
        for metadata in ({'sourceSha256': 'A' * 64, 'converterVersion': 'x'}, {'sourceSha256': 'a' * 64, 'converterVersion': ''}, {}):
            with self.assertRaises(TypedPayloadError):
                typed_payload_asset(GOLDEN_ARRAYS, metadata)

    def test_the_writer_refuses_the_shared_store(self):
        with self.assertRaises(ConverterOutputRefusedError):
            write_typed_payload_asset(ROOT / 'public' / 'l2' / 'typed-payload-refused', GOLDEN_ARRAYS, GOLDEN_METADATA)


if __name__ == '__main__':
    unittest.main()
