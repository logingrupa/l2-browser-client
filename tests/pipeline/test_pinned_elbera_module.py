import hashlib
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'scripts' / 'data'))
from pinned_elbera_module import PinnedElberaModuleError, load_pinned_elbera_module, require_pinned_elbera_script

SIDE_EFFECT_FREE_SCRIPT = b'''"""Synthetic Elbera tool."""
import struct
from os import path

WINDOW_COUNT_FORMAT = '<I'
data_g = b''


class SyntheticReader:
    pass


def declared_window_count(data):
    return struct.unpack_from(WINDOW_COUNT_FORMAT, data, 0)[0]


def main():
    raise SystemExit('main must never run')


if __name__ == "__main__":
    main()
'''


class PinnedElberaModuleTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.elbera_root = Path(temporary_directory.name).resolve() / 'elbera'
        (self.elbera_root / 'tools' / 'xdat').mkdir(parents=True)
        self.original_dont_write_bytecode = sys.dont_write_bytecode
        self.addCleanup(setattr, sys, 'dont_write_bytecode', self.original_dont_write_bytecode)

    def write_script(self, relative_path, payload):
        path = self.elbera_root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        return hashlib.sha256(payload).hexdigest()

    def test_pinned_script_loads_without_running_main_and_writes_no_bytecode(self):
        sha256 = self.write_script('tools/xdat/synthetic_tool.py', SIDE_EFFECT_FREE_SCRIPT)
        sys.dont_write_bytecode = False
        module = load_pinned_elbera_module('tools/xdat/synthetic_tool.py', sha256, elbera_root=self.elbera_root)
        self.assertEqual(module.declared_window_count(b'\x05\x00\x00\x00'), 5)
        self.assertEqual(module.__name__, f'pinned_elbera_synthetic_tool_{sha256[:12]}')
        self.assertTrue(sys.dont_write_bytecode)
        self.assertEqual([path for path in self.elbera_root.rglob('*') if path.name == '__pycache__' or path.suffix == '.pyc'], [])

    def test_script_whose_sha256_differs_from_its_pin_is_refused_before_it_runs(self):
        self.write_script('tools/xdat/synthetic_tool.py', b'raise SystemExit("must never run")\n')
        with self.assertRaisesRegex(PinnedElberaModuleError, 'differs from its pin'):
            load_pinned_elbera_module('tools/xdat/synthetic_tool.py', '0' * 64, elbera_root=self.elbera_root)
        with self.assertRaisesRegex(PinnedElberaModuleError, 'differs from its pin'):
            require_pinned_elbera_script('tools/xdat/synthetic_tool.py', '0' * 64, elbera_root=self.elbera_root)

    def test_top_level_call_statement_is_refused(self):
        sha256 = self.write_script('tools/xdat/synthetic_tool.py', SIDE_EFFECT_FREE_SCRIPT + b'main()\n')
        with self.assertRaisesRegex(PinnedElberaModuleError, 'top-level Expr statement'):
            load_pinned_elbera_module('tools/xdat/synthetic_tool.py', sha256, elbera_root=self.elbera_root)

    def test_conditional_other_than_the_main_guard_is_refused(self):
        sha256 = self.write_script('tools/xdat/synthetic_tool.py', SIDE_EFFECT_FREE_SCRIPT + b'if True:\n    main()\n')
        with self.assertRaisesRegex(PinnedElberaModuleError, 'top-level If statement'):
            load_pinned_elbera_module('tools/xdat/synthetic_tool.py', sha256, elbera_root=self.elbera_root)

    def test_path_outside_the_elbera_root_is_refused(self):
        outside_sha256 = hashlib.sha256(SIDE_EFFECT_FREE_SCRIPT).hexdigest()
        (self.elbera_root.parent / 'outside_tool.py').write_bytes(SIDE_EFFECT_FREE_SCRIPT)
        for relative_path in ('../outside_tool.py', (self.elbera_root.parent / 'outside_tool.py').as_posix(), 'tools\\xdat\\synthetic_tool.py'):
            with self.subTest(relative_path=relative_path), self.assertRaises(PinnedElberaModuleError):
                load_pinned_elbera_module(relative_path, outside_sha256, elbera_root=self.elbera_root)

    def test_located_script_path_is_returned_only_at_its_pin(self):
        sha256 = self.write_script('tools/xdat/synthetic_tool.py', SIDE_EFFECT_FREE_SCRIPT)
        path = require_pinned_elbera_script('tools/xdat/synthetic_tool.py', sha256, elbera_root=self.elbera_root)
        self.assertEqual(path, self.elbera_root / 'tools' / 'xdat' / 'synthetic_tool.py')


if __name__ == '__main__':
    unittest.main()
