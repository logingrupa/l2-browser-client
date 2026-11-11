import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_ROOT = ROOT / 'scripts'
sys.path.insert(0, str(SCRIPTS_ROOT))
from native_assets import implementation_source_paths

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


class ConverterImplementationHashTests(unittest.TestCase):
    def test_every_module_the_converter_imports_is_hashed(self):
        hashed = {path.resolve().relative_to(SCRIPTS_ROOT).as_posix() for path in implementation_source_paths()}
        self.assertEqual([relative_path for relative_path in converter_import_closure_with_code() if relative_path not in hashed], [])


if __name__ == '__main__':
    unittest.main()
