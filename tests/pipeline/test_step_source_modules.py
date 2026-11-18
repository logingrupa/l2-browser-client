import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_ROOT = ROOT / 'scripts'
sys.path.insert(0, str(SCRIPTS_ROOT))

from native_store.canonical_json import canonical_json_bytes
from native_store.converter_source_closure import ScriptsSourceIndex
from native_store.step_source_modules import STEP_SOURCE_MODULES_BY_LANE, StepSourceModulesError, step_converter_sources_sha256, step_source_modules
from native_store.unit_ledger import UnitLedger, UnitLedgerError, sha256_of_bytes

LOADED_SCRIPTS_MODULES_PROGRAM = '''
import importlib
import json
from pathlib import Path
import sys
scripts_root = Path(sys.argv[1]).resolve()
loaded_by_entry = {}
for entry in sys.argv[2:]:
    for name in [name for name, module in sys.modules.items()
                 if getattr(module, '__file__', None) and Path(module.__file__).resolve().is_relative_to(scripts_root)]:
        del sys.modules[name]
    entry_folder = scripts_root.joinpath(*entry.split('.')[:-1])
    sys.path[:] = [str(entry_folder), str(scripts_root)] + [path for path in sys.path if path not in (str(entry_folder), str(scripts_root))]
    importlib.import_module(entry.split('.')[-1] if entry_folder != scripts_root else entry)
    loaded_by_entry[entry] = sorted({Path(module.__file__).resolve().relative_to(scripts_root).as_posix() for module in list(sys.modules.values())
                                     if getattr(module, '__file__', None) and Path(module.__file__).resolve().is_relative_to(scripts_root)})
print(json.dumps(loaded_by_entry))
'''
FIRST_INPUT_SHA256 = 'a' * 64
SYNTHETIC_CONFIG = {'chunkSize': 4}


def distinct_entry_modules():
    return sorted({module for steps in STEP_SOURCE_MODULES_BY_LANE.values() for modules in steps.values() for module in modules})


def scripts_modules_loaded_by_importing(entry_modules):
    completed = subprocess.run([sys.executable, '-B', '-c', LOADED_SCRIPTS_MODULES_PROGRAM, str(SCRIPTS_ROOT), *entry_modules],
                               capture_output=True, text=True, check=True, cwd=ROOT)
    return json.loads(completed.stdout)


class StepSourceModulesTests(unittest.TestCase):
    def test_every_loaded_scripts_module_of_every_step_entry_is_in_its_static_closure(self):
        index = ScriptsSourceIndex(SCRIPTS_ROOT)
        for entry, loaded in scripts_modules_loaded_by_importing(distinct_entry_modules()).items():
            with self.subTest(entry=entry):
                self.assertEqual(sorted(set(loaded) - set(index.closure_relative_paths((entry,)))), [])

    def test_every_world_tile_step_names_its_own_module(self):
        from world.tile_step_registry import TILE_STEP_NAMES
        self.assertEqual(sorted(set(TILE_STEP_NAMES) - set(STEP_SOURCE_MODULES_BY_LANE['world'])), [])
        self.assertEqual(step_source_modules('world', 'meshes'), ('world.static_mesh_step',))

    def test_an_unlisted_step_is_refused(self):
        with self.assertRaisesRegex(StepSourceModulesError, 'step invented-step of lane world names no converter source modules'):
            step_source_modules('world', 'invented-step')


class LedgerConverterSourcesTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.work_root = Path(temporary_directory.name).resolve() / 'artifacts' / 'lane-store' / 'world' / 'work'

    def test_the_fingerprint_and_the_version_check_cover_the_step_converter_sources(self):
        ledger = UnitLedger(self.work_root, 'shared-sky', 1)
        self.assertEqual(ledger.converter_sources_sha256, step_converter_sources_sha256('world', 'shared-sky'))
        self.assertNotEqual(ledger.converter_sources_sha256, UnitLedger(self.work_root, 'meshes', 1).converter_sources_sha256)
        self.assertEqual(ledger.unit_fingerprint([FIRST_INPUT_SHA256], SYNTHETIC_CONFIG), sha256_of_bytes(canonical_json_bytes(
            {'algorithmVersion': 1, 'config': SYNTHETIC_CONFIG, 'converterSourcesSha256': ledger.converter_sources_sha256,
             'inputSha256s': [FIRST_INPUT_SHA256]})))
        current = {'algorithmVersion': 1, 'converterSourcesSha256': ledger.converter_sources_sha256}
        self.assertTrue(ledger.has_current_versions(current))
        self.assertFalse(ledger.has_current_versions({**current, 'converterSourcesSha256': 'b' * 64}))
        self.assertFalse(ledger.has_current_versions({'algorithmVersion': 1}))
        self.assertFalse(ledger.has_current_versions({**current, 'algorithmVersion': 2}))

    def test_a_ledger_of_an_unlisted_step_is_refused(self):
        with self.assertRaisesRegex(UnitLedgerError, 'names no converter source modules'):
            UnitLedger(self.work_root, 'invented-step', 1)


if __name__ == '__main__':
    unittest.main()
