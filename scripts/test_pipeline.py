"""Run conversion regressions; local-source checks skip on a clean checkout."""
from pathlib import Path
import argparse
import os
import sys
import unittest


root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--migration-output', type=Path,
                    help='Validated migration output used by local archive regressions')
parser.add_argument('--pattern', default='test_*.py',
                    help='Test file name pattern for a targeted run, for example test_unit_ledger.py')
arguments = parser.parse_args()
if arguments.migration_output is not None:
    output = arguments.migration_output.resolve()
    if not all((output / name).is_file() for name in ('validation.json', 'products.json')):
        parser.error('--migration-output requires completed validation.json and products.json')
    os.environ['L2_MIGRATION_TEST_OUTPUT'] = str(output)
sys.path.insert(0, str(root / 'scripts'))
from native_store.store_paths import PIPELINE_TEST_RUN_ENVIRONMENT_VARIABLE

os.environ[PIPELINE_TEST_RUN_ENVIRONMENT_VARIABLE] = '1'
suite = unittest.TestSuite()
for directory in (root / 'tests' / 'pipeline', root / 'scripts' / 'native_catalog'):
    suite.addTests(unittest.TestLoader().discover(str(directory), pattern=arguments.pattern))
result = unittest.TextTestRunner(verbosity=2).run(suite)
raise SystemExit(0 if result.wasSuccessful() else 1)
