import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_ROOT = ROOT / 'scripts'
sys.path.insert(0, str(SCRIPTS_ROOT))
import native_assets
from native_assets import implementation_source_paths

REAL_STORE_CONVERTER_OUTPUT_VERSION = 'c4bf8e6cf5f61bddf65a35e6fb65f6af34199e0589b978930aeb92d2f15a2bd8'
RECORDED_CONVERTER_SOURCE_DIGEST = 'a2321966fe9a00d7ee0416f2fbd1d966aac4907fc4e6f8b7e0bbf7d28aefa20a'
CONVERTER_RELATIVE_PATH = 'native_assets.py'

LOADED_SCRIPT_MODULES_PROGRAM = '''
import json
from pathlib import Path
import sys
scripts_root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(scripts_root))
import native_assets
loaded = sorted({Path(module.__file__).resolve().relative_to(scripts_root).as_posix() for module in list(sys.modules.values())
                 if getattr(module, '__file__', None) and Path(module.__file__).resolve().is_relative_to(scripts_root)})
print(json.dumps(loaded))
'''


def converter_import_closure_with_code():
    completed = subprocess.run([sys.executable, '-B', '-c', LOADED_SCRIPT_MODULES_PROGRAM, str(SCRIPTS_ROOT)],
                               capture_output=True, text=True, check=True)
    return [relative_path for relative_path in json.loads(completed.stdout)
            if (SCRIPTS_ROOT / relative_path).stat().st_size > 0]


def converter_source_digest(scripts_root, source_paths):
    resolved_scripts_root = Path(scripts_root).resolve()
    source_path_by_relative_path = {Path(source_path).resolve().relative_to(resolved_scripts_root).as_posix(): Path(source_path)
                                    for source_path in source_paths}
    digest = hashlib.sha256()
    for relative_path, source_path in sorted(source_path_by_relative_path.items()):
        content_sha256 = hashlib.sha256(source_path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()
        digest.update(relative_path.encode('utf-8') + b'\0' + content_sha256.encode('ascii') + b'\n')
    return digest.hexdigest()


def require_recorded_converter_source_digest(scripts_root, source_paths, recorded_digest):
    computed_digest = converter_source_digest(scripts_root, source_paths)
    if computed_digest != recorded_digest:
        raise AssertionError(f'The converter sources changed: their digest is {computed_digest}, the recorded digest is {recorded_digest}. '
                             'Way out: prove by a byte comparison of converted outputs that they are unchanged, or give '
                             'CONVERTER_OUTPUT_VERSION_RAISED_BY_HAND_ONLY_WHEN_OUTPUTS_CHANGE a new value (every converted unit converts again); '
                             'then record the new digest in RECORDED_CONVERTER_SOURCE_DIGEST.')


def copied_converter_sources(target_scripts_root, changed_bytes):
    copies = []
    for source_path in implementation_source_paths():
        relative_path = source_path.resolve().relative_to(SCRIPTS_ROOT).as_posix()
        copy = Path(target_scripts_root) / relative_path
        copy.parent.mkdir(parents=True, exist_ok=True)
        copy.write_bytes(changed_bytes(relative_path, source_path.read_bytes()))
        copies.append(copy)
    return copies


def with_lf_line_endings(relative_path, source_bytes):
    return source_bytes.replace(b'\r\n', b'\n')


def with_crlf_line_endings(relative_path, source_bytes):
    return with_lf_line_endings(relative_path, source_bytes).replace(b'\n', b'\r\n')


def with_one_byte_appended_to_the_converter(relative_path, source_bytes):
    return source_bytes + b'#' if relative_path == CONVERTER_RELATIVE_PATH else source_bytes


def with_the_first_byte_of_the_converter_changed(relative_path, source_bytes):
    return bytes([source_bytes[0] ^ 1]) + source_bytes[1:] if relative_path == CONVERTER_RELATIVE_PATH else source_bytes


class TemporaryScriptsRootTestCase(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.temporary_root = Path(temporary_directory.name).resolve()


class ConverterImplementationHashTests(TemporaryScriptsRootTestCase):
    def test_the_version_is_the_value_the_real_store_is_sealed_under(self):
        self.assertEqual(native_assets.CONVERTER_OUTPUT_VERSION_RAISED_BY_HAND_ONLY_WHEN_OUTPUTS_CHANGE, REAL_STORE_CONVERTER_OUTPUT_VERSION)

    def test_implementation_hash_reads_no_file(self):
        with patch.object(native_assets, 'hash_file', side_effect=AssertionError('implementation_hash hashed a file')) as hash_file, \
                patch.object(native_assets, 'implementation_source_paths',
                             side_effect=AssertionError('implementation_hash listed the converter sources')) as source_paths:
            self.assertEqual(native_assets.implementation_hash(), REAL_STORE_CONVERTER_OUTPUT_VERSION)
        self.assertEqual((hash_file.call_count, source_paths.call_count), (0, 0))

    def test_changed_bytes_and_flipped_line_endings_leave_the_version_unchanged(self):
        for folder_name, changed_bytes in (('appended-byte', with_one_byte_appended_to_the_converter), ('crlf', with_crlf_line_endings)):
            copies = copied_converter_sources(self.temporary_root / folder_name, changed_bytes)
            with patch.object(native_assets, 'implementation_source_paths', return_value=copies):
                self.assertEqual(native_assets.implementation_hash(), REAL_STORE_CONVERTER_OUTPUT_VERSION)


class ConverterSourceGuardTests(TemporaryScriptsRootTestCase):
    def test_every_module_the_converter_imports_is_guarded(self):
        hashed = {path.resolve().relative_to(SCRIPTS_ROOT).as_posix() for path in implementation_source_paths()}
        self.assertEqual([relative_path for relative_path in converter_import_closure_with_code() if relative_path not in hashed], [])

    def test_the_recorded_digest_matches_this_checkout(self):
        require_recorded_converter_source_digest(SCRIPTS_ROOT, implementation_source_paths(), RECORDED_CONVERTER_SOURCE_DIGEST)

    def test_lf_and_crlf_copies_give_the_digest_of_this_checkout(self):
        lf_root, crlf_root = self.temporary_root / 'lf', self.temporary_root / 'crlf'
        lf_copies = copied_converter_sources(lf_root, with_lf_line_endings)
        crlf_copies = copied_converter_sources(crlf_root, with_crlf_line_endings)
        self.assertEqual([any(b'\r\n' in copy.read_bytes() for copy in copies) for copies in (lf_copies, crlf_copies)], [False, True])
        self.assertEqual({converter_source_digest(lf_root, lf_copies), converter_source_digest(crlf_root, crlf_copies)},
                         {converter_source_digest(SCRIPTS_ROOT, implementation_source_paths())})

    def test_one_changed_content_byte_fails_with_the_way_out(self):
        changed_root = self.temporary_root / 'changed'
        changed_copies = copied_converter_sources(changed_root, with_the_first_byte_of_the_converter_changed)
        digest_of_this_checkout = converter_source_digest(SCRIPTS_ROOT, implementation_source_paths())
        with self.assertRaises(AssertionError) as refusal:
            require_recorded_converter_source_digest(changed_root, changed_copies, digest_of_this_checkout)
        message = str(refusal.exception)
        self.assertNotEqual(converter_source_digest(changed_root, changed_copies), digest_of_this_checkout)
        for expected_part in (converter_source_digest(changed_root, changed_copies), digest_of_this_checkout, 'byte comparison of converted outputs',
                              'CONVERTER_OUTPUT_VERSION_RAISED_BY_HAND_ONLY_WHEN_OUTPUTS_CHANGE', 'RECORDED_CONVERTER_SOURCE_DIGEST'):
            self.assertIn(expected_part, message)


if __name__ == '__main__':
    unittest.main()
