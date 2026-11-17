from pathlib import Path
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_ROOT = ROOT / 'scripts'
sys.path.insert(0, str(SCRIPTS_ROOT))
import native_assets
from native_store.converter_source_closure import ScriptsSourceIndex

CONVERTER_RELATIVE_PATH = 'native_assets.py'


def copied_converter_closure(target_scripts_root, changed_bytes):
    for relative_path in ScriptsSourceIndex(SCRIPTS_ROOT).closure_relative_paths(native_assets.CONVERTER_SOURCE_MODULES):
        copy = Path(target_scripts_root) / relative_path
        copy.parent.mkdir(parents=True, exist_ok=True)
        copy.write_bytes(changed_bytes(relative_path, (SCRIPTS_ROOT / relative_path).read_bytes()))
    return target_scripts_root


def with_crlf_line_endings(relative_path, source_bytes):
    return source_bytes.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')


def with_lf_line_endings(relative_path, source_bytes):
    return source_bytes.replace(b'\r\n', b'\n')


def with_one_byte_appended_to_the_converter(relative_path, source_bytes):
    return source_bytes + b'\n' if relative_path == CONVERTER_RELATIVE_PATH else source_bytes


class ConverterImplementationHashTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.temporary_root = Path(temporary_directory.name).resolve()

    def converter_sha256_of_copy(self, folder_name, changed_bytes):
        copy_root = copied_converter_closure(self.temporary_root / folder_name, changed_bytes)
        return ScriptsSourceIndex(copy_root, sources_loaded_before_ns=time.time_ns()).sources_sha256(native_assets.CONVERTER_SOURCE_MODULES)

    def test_the_implementation_hash_is_the_source_closure_sha256_of_the_converter(self):
        self.assertEqual(native_assets.implementation_hash(), ScriptsSourceIndex(SCRIPTS_ROOT).sources_sha256(('native_assets',)))

    def test_the_converter_closure_holds_its_helpers_and_the_class_defaults_tool(self):
        closure = ScriptsSourceIndex(SCRIPTS_ROOT).closure_relative_paths(native_assets.CONVERTER_SOURCE_MODULES)
        for relative_path in ('native_assets.py', 'native_assets_lib/gltf.py', 'native_catalog/ue2.py', 'native_catalog/extract_ue_defaults.ps1',
                              'reference_client_guard.py', 'native_store/store_paths.py', 'data/pinned_elbera_module.py'):
            self.assertIn(relative_path, closure)

    def test_flipped_line_endings_keep_the_implementation_hash(self):
        self.assertEqual({self.converter_sha256_of_copy('lf', with_lf_line_endings), self.converter_sha256_of_copy('crlf', with_crlf_line_endings)},
                         {native_assets.implementation_hash()})

    def test_one_changed_converter_byte_changes_the_implementation_hash(self):
        self.assertNotEqual(self.converter_sha256_of_copy('appended', with_one_byte_appended_to_the_converter), native_assets.implementation_hash())


if __name__ == '__main__':
    unittest.main()
