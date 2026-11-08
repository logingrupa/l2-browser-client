from pathlib import Path
import struct
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from audit_musveren_weights import accessor, source_arrays, source_package
from reference_client_lock_fixture import lock_client_as_reference_root


class WeightAuditGuardTests(unittest.TestCase):
    def test_unreviewed_source_hash_rejected_before_fixed_offsets_are_read(self):
        with tempfile.TemporaryDirectory() as directory:
            client = Path(directory)
            (client / 'animations').mkdir()
            lock_client_as_reference_root(self, client)
            source = client / 'animations/LineageMonsters.ukx'
            raw = b'wrong native source fixture'
            source.write_bytes(raw)
            with self.assertRaisesRegex(ValueError, 'exact reviewed.*source hash'):
                source_package(client)
            self.assertEqual(source.read_bytes(), raw)

    def test_native_array_requires_exact_lazy_end_and_bounded_payload(self):
        for data in (struct.pack('<i', 99) + b'\x01' + struct.pack('<fHH', 1, 0, 0),
                     struct.pack('<i', 13) + b'\x01' + b'\x00'):
            with self.subTest(data=data), self.assertRaises(ValueError):
                source_arrays(type('PackageStub', (), {'data': data})(), len(data), 0)

    def test_export_accessor_cannot_read_beyond_declared_buffer_view(self):
        document = {'accessors': [{'bufferView': 0, 'componentType': 5126, 'type': 'VEC3', 'count': 2}],
                    'bufferViews': [{'buffer': 0, 'byteLength': 12}]}
        with self.assertRaisesRegex(ValueError, 'exceeds its buffer view'):
            accessor(document, [bytes(24)], 0)


if __name__ == '__main__':
    unittest.main()
