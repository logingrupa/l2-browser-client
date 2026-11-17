import os
from pathlib import Path
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_store.converter_source_closure import ConverterSourceClosureError, ScriptsSourceIndex

SYNTHETIC_SCRIPTS_FILES = {
    'shared_library.py': 'def shared_value():\n    return 1\n',
    'world/__init__.py': '',
    'world/sky_only_helper.py': 'def sky_colour():\n    return 2\n',
    'world/mesh_only_helper.py': 'def mesh_scale():\n    return 3\n',
    'world/sky_step.py': 'from shared_library import shared_value\nfrom world.sky_only_helper import sky_colour\n',
    'world/mesh_step.py': ('from shared_library import shared_value\nfrom .mesh_only_helper import mesh_scale\n'
                           'def run_tool():\n    return ["powershell", "-File", "extract_defaults.ps1"]\n'),
    'world/dynamic_step.py': 'import importlib\ndef reader():\n    return importlib.import_module("vendor_reader.decoder")\n',
    'world/node_step.py': 'from pathlib import Path\nSTAGE_SCRIPT = Path(__file__).parents[1] / "stage-effect.mjs"\n',
    'world/file_loader_step.py': ('import importlib.util\nfrom pathlib import Path\ndef load():\n    return importlib.util.spec_from_file_location('
                                  '"loaded_reader", Path(__file__).parents[1] / "vendor_reader" / "decoder.py")\n'),
    'vendor_reader/__init__.py': '',
    'vendor_reader/decoder.py': 'def decode():\n    return 4\n',
    'extract_defaults.ps1': 'param($Package)\nWrite-Output $Package\n',
    'stage-effect.mjs': ('import { readFile } from "node:fs/promises";\nimport { pack } from "./stage-effect-packing.mjs";\n'
                         'const code = "from effect_readiness import inspect";\n'),
    'stage-effect-packing.mjs': 'export function pack() { return 5; }\n',
    'effect_readiness.py': 'def inspect():\n    return 6\n',
    'unrelated_tool.py': 'def unrelated():\n    return 7\n',
}
STEP_ENTRY_MODULES = {'sky': ('world.sky_step',), 'meshes': ('world.mesh_step',), 'dynamic': ('world.dynamic_step',),
                      'node': ('world.node_step',), 'file-loader': ('world.file_loader_step',)}
ONE_SECOND_NS = 10 ** 9


def written_scripts_tree(scripts_root, files):
    for relative_path, text in files.items():
        path = scripts_root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode('utf-8'))
    return scripts_root


class SyntheticScriptsTestCase(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.scripts_root = written_scripts_tree(Path(temporary_directory.name) / 'scripts', SYNTHETIC_SCRIPTS_FILES)

    def index(self):
        return ScriptsSourceIndex(self.scripts_root, sources_loaded_before_ns=time.time_ns())

    def step_sha256s(self):
        index = self.index()
        return {step: index.sources_sha256(entry_modules) for step, entry_modules in STEP_ENTRY_MODULES.items()}

    def steps_changed_by_edit(self, relative_path, appended_text):
        before = self.step_sha256s()
        path = self.scripts_root / relative_path
        path.write_bytes(path.read_bytes() + appended_text.encode('utf-8'))
        after = self.step_sha256s()
        return sorted(step for step in before if before[step] != after[step])


class StepSourceClosureTests(SyntheticScriptsTestCase):
    def closure(self, step):
        return self.index().closure_relative_paths(STEP_ENTRY_MODULES[step])

    def test_a_step_closure_holds_its_imports_package_initialisers_and_named_tools(self):
        self.assertEqual(self.closure('meshes'), ['extract_defaults.ps1', 'shared_library.py', 'world/__init__.py',
                                                  'world/mesh_only_helper.py', 'world/mesh_step.py'])
        self.assertEqual(self.closure('sky'), ['shared_library.py', 'world/__init__.py', 'world/sky_only_helper.py', 'world/sky_step.py'])

    def test_an_edit_of_a_module_used_by_one_step_makes_only_that_step_stale(self):
        self.assertEqual(self.steps_changed_by_edit('world/sky_only_helper.py', 'SKY_FACTOR = 2\n'), ['sky'])
        self.assertEqual(self.steps_changed_by_edit('world/mesh_only_helper.py', 'MESH_FACTOR = 3\n'), ['meshes'])

    def test_an_edit_of_a_shared_module_makes_every_importing_step_stale(self):
        self.assertEqual(self.steps_changed_by_edit('shared_library.py', 'SHARED_FACTOR = 4\n'), ['meshes', 'sky'])
        self.assertEqual(self.steps_changed_by_edit('world/__init__.py', 'PACKAGE_FACTOR = 5\n'),
                         ['dynamic', 'file-loader', 'meshes', 'node', 'sky'])

    def test_an_edit_of_a_module_no_step_reaches_makes_no_step_stale(self):
        self.assertEqual(self.steps_changed_by_edit('unrelated_tool.py', 'UNRELATED_FACTOR = 6\n'), [])

    def test_a_literal_dynamic_import_is_covered(self):
        self.assertIn('vendor_reader/decoder.py', self.closure('dynamic'))
        self.assertEqual(self.steps_changed_by_edit('vendor_reader/decoder.py', 'DECODER_FACTOR = 7\n'), ['dynamic', 'file-loader'])

    def test_a_literal_file_location_load_is_covered(self):
        self.assertIn('vendor_reader/decoder.py', self.closure('file-loader'))

    def test_a_subprocess_powershell_tool_named_by_the_step_is_covered(self):
        self.assertEqual(self.steps_changed_by_edit('extract_defaults.ps1', 'Write-Output 1\n'), ['meshes'])

    def test_a_node_script_its_relative_imports_and_its_inline_python_imports_are_covered(self):
        self.assertEqual(self.closure('node'), ['effect_readiness.py', 'stage-effect-packing.mjs', 'stage-effect.mjs', 'world/__init__.py',
                                                'world/node_step.py'])
        for relative_path in ('stage-effect.mjs', 'stage-effect-packing.mjs', 'effect_readiness.py'):
            self.assertEqual(self.steps_changed_by_edit(relative_path, '\n'), ['node'], relative_path)

    def test_flipped_line_endings_keep_every_step_sha256(self):
        before = self.step_sha256s()
        for path in self.scripts_root.rglob('*'):
            if path.is_file():
                path.write_bytes(path.read_bytes().replace(b'\n', b'\r\n'))
        self.assertEqual(self.step_sha256s(), before)

    def test_a_renamed_source_with_the_same_bytes_changes_the_step_sha256(self):
        before = self.step_sha256s()
        helper = self.scripts_root / 'world' / 'sky_only_helper.py'
        helper.rename(self.scripts_root / 'world' / 'sky_colour_helper.py')
        sky_step = self.scripts_root / 'world' / 'sky_step.py'
        sky_step.write_bytes(sky_step.read_bytes().replace(b'sky_only_helper', b'sky_colour_helper'))
        self.assertNotEqual(self.step_sha256s()['sky'], before['sky'])


class DynamicLoadRefusalTests(SyntheticScriptsTestCase):
    def test_a_dynamic_import_by_a_computed_name_is_refused(self):
        (self.scripts_root / 'world' / 'dynamic_step.py').write_text(
            'import importlib\ndef reader(name):\n    return importlib.import_module(name)\n', encoding='utf-8')
        with self.assertRaisesRegex(ConverterSourceClosureError, r'world/dynamic_step\.py:3 loads code through import_module'):
            self.index().closure(STEP_ENTRY_MODULES['dynamic'])

    def test_a_dynamic_import_by_a_computed_name_with_a_literal_package_is_refused(self):
        (self.scripts_root / 'world' / 'dynamic_step.py').write_text(
            'import importlib\ndef reader(name):\n    return importlib.import_module(name, package="world")\n', encoding='utf-8')
        with self.assertRaisesRegex(ConverterSourceClosureError, r'world/dynamic_step\.py:3 loads code through import_module'):
            self.index().closure(STEP_ENTRY_MODULES['dynamic'])

    def test_exec_of_a_computed_source_is_refused(self):
        (self.scripts_root / 'world' / 'sky_only_helper.py').write_text('def run(source):\n    exec(source)\n', encoding='utf-8')
        with self.assertRaisesRegex(ConverterSourceClosureError, r'world/sky_only_helper\.py:2 loads code through exec'):
            self.index().closure(STEP_ENTRY_MODULES['sky'])

    def test_an_entry_module_without_a_source_is_refused(self):
        with self.assertRaisesRegex(ConverterSourceClosureError, 'entry module world.missing_step has no source'):
            self.index().closure(('world.missing_step',))


class SourceChangedAfterLoadTests(SyntheticScriptsTestCase):
    def test_a_closure_source_modified_after_the_process_loaded_its_code_refuses_the_check_and_the_hash(self):
        index = self.index()
        index.sources_sha256(STEP_ENTRY_MODULES['sky'])
        index.require_closure_unchanged(STEP_ENTRY_MODULES['sky'])
        later_ns = index.sources_loaded_before_ns + ONE_SECOND_NS
        os.utime(self.scripts_root / 'world' / 'sky_only_helper.py', ns=(later_ns, later_ns))
        changed_message = r'world/sky_only_helper\.py changed after this process loaded its converter code; rerun'
        with self.assertRaisesRegex(ConverterSourceClosureError, changed_message):
            index.require_closure_unchanged(STEP_ENTRY_MODULES['sky'])
        index.require_closure_unchanged(STEP_ENTRY_MODULES['meshes'])
        with self.assertRaisesRegex(ConverterSourceClosureError, changed_message):
            ScriptsSourceIndex(self.scripts_root, sources_loaded_before_ns=index.sources_loaded_before_ns).sources_sha256(STEP_ENTRY_MODULES['sky'])

    def test_a_closure_source_removed_after_the_process_loaded_its_code_refuses_the_check(self):
        index = self.index()
        index.sources_sha256(STEP_ENTRY_MODULES['meshes'])
        (self.scripts_root / 'world' / 'mesh_only_helper.py').unlink()
        with self.assertRaisesRegex(ConverterSourceClosureError, r'world/mesh_only_helper\.py was removed after this process loaded'):
            index.require_closure_unchanged(STEP_ENTRY_MODULES['meshes'])


if __name__ == '__main__':
    unittest.main()
