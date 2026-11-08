import ast
from pathlib import Path
import unittest

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_ROOT = REPOSITORY_ROOT / 'scripts'
STORE_PATHS_RELATIVE_PATH = 'scripts/native_store/store_paths.py'
OUTPUT_GUARD_NAME = 'require_converter_output'
OUTPUT_OPTION = '--output'
LANE_SCRIPT_FOLDERS = ('world', 'actors', 'data')
DEDUPLICATED_HELPER_NAMES = {'checked', 'child', 'relative_name', 'safe_relative'}
STORE_PATH_HELPER_NAMES = {'refuse_reparse_points', 'confined_child_path', 'require_portable_relative_path'}
OUTPUT_GUARDED_MAIN_ENTRY_POINTS = ('scripts/data/convert_tables.py', 'scripts/native_catalog/cli.py')
ARGUMENT_ERROR_METHOD_NAME = 'error'


def called_function_name(call):
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return None


def calls_named(node, name):
    return sorted((call for call in ast.walk(node) if isinstance(call, ast.Call) and called_function_name(call) == name),
                  key=lambda call: (call.lineno, call.col_offset))


def parse_script(relative_path):
    return ast.parse((REPOSITORY_ROOT / relative_path).read_text(encoding='utf-8'), filename=relative_path)


def function_named(nodes, name):
    return next(node for node in nodes if isinstance(node, ast.FunctionDef) and node.name == name)


def registers_output_option(module_tree):
    return any(called_function_name(call) == 'add_argument' and call.args and isinstance(call.args[0], ast.Constant)
               and call.args[0].value == OUTPUT_OPTION
               for call in ast.walk(module_tree) if isinstance(call, ast.Call))


def output_entry_point_violations(trees_by_relative_path):
    return sorted(relative_path for relative_path, module_tree in trees_by_relative_path.items()
                  if registers_output_option(module_tree) and not calls_named(module_tree, OUTPUT_GUARD_NAME))


def lane_entry_points():
    return sorted(path.relative_to(REPOSITORY_ROOT).as_posix()
                  for folder in LANE_SCRIPT_FOLDERS for path in (SCRIPTS_ROOT / folder).rglob('*.py')
                  if registers_output_option(parse_script(path.relative_to(REPOSITORY_ROOT).as_posix())))


def first_work_after_argument_parsing(main_function):
    parse_line = calls_named(main_function, 'parse_args')[0].lineno
    later_calls = [call for call in ast.walk(main_function) if isinstance(call, ast.Call) and call.lineno > parse_line
                   and called_function_name(call) != ARGUMENT_ERROR_METHOD_NAME]
    return min(call.lineno for call in later_calls)


def top_level_function_names(relative_path):
    return {node.name for node in parse_script(relative_path).body if isinstance(node, ast.FunctionDef)}


class ConverterOutputGuardScanTests(unittest.TestCase):
    def test_converter_init_guards_its_output_before_any_folder_is_created(self):
        converter = next(node for node in parse_script('scripts/native_assets.py').body
                         if isinstance(node, ast.ClassDef) and node.name == 'Converter')
        initializer = function_named(converter.body, '__init__')
        guard_calls = calls_named(initializer, OUTPUT_GUARD_NAME)
        self.assertTrue(guard_calls, 'Converter.__init__ must call require_converter_output')
        self.assertIs(initializer.body[0].value, guard_calls[0])
        folder_creations = calls_named(initializer, 'mkdir')
        self.assertTrue(folder_creations)
        self.assertTrue(all(guard_calls[0].lineno < creation.lineno for creation in folder_creations))

    def test_batch_prepare_guards_its_output(self):
        prepare = function_named(parse_script('scripts/native_batch.py').body, 'prepare')
        self.assertTrue(calls_named(prepare, OUTPUT_GUARD_NAME))

    def test_every_lane_entry_point_with_an_output_option_calls_the_guard(self):
        entry_points = lane_entry_points()
        self.assertEqual(output_entry_point_violations({path: parse_script(path) for path in entry_points}), [])

    def test_entry_points_guard_their_output_right_after_argument_parsing(self):
        for relative_path in OUTPUT_GUARDED_MAIN_ENTRY_POINTS:
            with self.subTest(relative_path=relative_path):
                main_function = function_named(parse_script(relative_path).body, 'main')
                guard_calls = calls_named(main_function, OUTPUT_GUARD_NAME)
                self.assertTrue(guard_calls, f'{relative_path} main must call {OUTPUT_GUARD_NAME}')
                self.assertEqual(guard_calls[0].lineno, first_work_after_argument_parsing(main_function))

    def test_scan_flags_an_output_option_without_the_guard(self):
        unguarded = ast.parse("parser.add_argument('--output')\noutput = arguments.output\n")
        guarded = ast.parse("parser.add_argument('--output')\noutput = require_converter_output(ROOT, arguments.output)\n")
        without_output = ast.parse("parser.add_argument('--client')\n")
        self.assertEqual(output_entry_point_violations({'unguarded.py': unguarded, 'guarded.py': guarded,
                                                        'without-output.py': without_output}), ['unguarded.py'])

    def test_path_helpers_have_one_owner(self):
        for relative_path in ('scripts/native_batch.py', 'scripts/stage_native_players.py'):
            with self.subTest(relative_path=relative_path):
                self.assertFalse(top_level_function_names(relative_path) & DEDUPLICATED_HELPER_NAMES)
        owners = sorted(path.relative_to(REPOSITORY_ROOT).as_posix() for path in SCRIPTS_ROOT.rglob('*.py')
                        if '__pycache__' not in path.parts
                        and top_level_function_names(path.relative_to(REPOSITORY_ROOT).as_posix()) & STORE_PATH_HELPER_NAMES)
        self.assertEqual(owners, [STORE_PATHS_RELATIVE_PATH])


if __name__ == '__main__':
    unittest.main()
