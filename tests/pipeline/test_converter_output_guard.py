import ast
from pathlib import Path
import unittest

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_ROOT = REPOSITORY_ROOT / 'scripts'
TESTS_ROOT = REPOSITORY_ROOT / 'tests'
STORE_PATHS_RELATIVE_PATH = 'scripts/native_store/store_paths.py'
OUTPUT_GUARD_NAME = 'require_converter_output'
LANE_STORE_ROOT_GUARD_NAME = 'lane_store_root'
OUTPUT_ROOT_GUARD_NAMES = (OUTPUT_GUARD_NAME, LANE_STORE_ROOT_GUARD_NAME)
OUTPUT_OPTION = '--output'
LANE_SCRIPT_FOLDERS = ('world', 'actors', 'data')
DEDUPLICATED_HELPER_NAMES = {'checked', 'child', 'reject_links', 'relative_name', 'safe_relative'}
PATH_HELPER_CALLER_PATHS = ('scripts/native_batch.py', 'scripts/stage_native_players.py', 'scripts/export-native-sounds.py',
                            'scripts/native_assets_lib/sound_export_guards.py')
STORE_PATH_HELPER_NAMES = {'refuse_reparse_points', 'confined_child_path', 'require_portable_relative_path'}
OUTPUT_GUARDED_MAIN_ENTRY_POINTS = ('scripts/data/convert_tables.py', 'scripts/native_catalog/cli.py')
COMMITTED_REPORT_ENTRY_POINTS = ('scripts/data/sysstring_systemmsg_counts.py',)
DATA_UI_LANE_ONLY_ENTRY_POINTS = ('scripts/data/convert_tables.py', 'scripts/data/convert_ui.py', 'scripts/data/table_name_indexes.py')
ARGUMENT_ERROR_METHOD_NAME = 'error'
PLAYER_STAGE_MODULE = 'stage_native_players'
STRICT_JSON_HELPER_OWNERS = {
    'require_condition': 'scripts/native_assets_lib/guard_clauses.py',
    'SHA256_HEX_PATTERN': 'scripts/native_assets_lib/sha256_identity.py',
    'sha256_hex_digest': 'scripts/native_assets_lib/sha256_identity.py',
    'decode_strict_json': 'scripts/native_assets_lib/strict_json.py',
}
FORMER_PLAYER_STAGE_HELPER_NAMES = {'decode', 'digest', 'require', 'HASH'}
WORLD_LANE_DEFINERS_AWAITING_THE_OWNER = {'SHA256_HEX_PATTERN': ['scripts/world/copy_world07_fixtures.py']}
PLAYER_STAGE_HELPER_NAMES = set(STRICT_JSON_HELPER_OWNERS) | FORMER_PLAYER_STAGE_HELPER_NAMES


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


def python_sources_under_scripts_and_tests():
    return sorted(path.relative_to(REPOSITORY_ROOT).as_posix() for root in (SCRIPTS_ROOT, TESTS_ROOT)
                  for path in root.rglob('*.py') if '__pycache__' not in path.parts)


def player_stage_helper_imports(trees_by_relative_path):
    violations = []
    for relative_path, module_tree in trees_by_relative_path.items():
        player_stage_module_names = {alias.asname or alias.name for node in ast.walk(module_tree) if isinstance(node, ast.Import)
                                     for alias in node.names if alias.name == PLAYER_STAGE_MODULE}
        for node in ast.walk(module_tree):
            if isinstance(node, ast.ImportFrom) and node.module == PLAYER_STAGE_MODULE:
                violations.extend(f'{relative_path}:{node.lineno} {alias.name}' for alias in node.names if alias.name in PLAYER_STAGE_HELPER_NAMES)
            elif (isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id in player_stage_module_names
                  and node.attr in PLAYER_STAGE_HELPER_NAMES):
                violations.append(f'{relative_path}:{node.lineno} {node.attr}')
    return sorted(violations)


def defines_top_level_name(module_tree, name):
    for node in module_tree.body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name == name:
            return True
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
        if any(isinstance(target, ast.Name) and target.id == name for target in targets):
            return True
    return False


def top_level_definers(trees_by_relative_path, name):
    return sorted(relative_path for relative_path, module_tree in trees_by_relative_path.items() if defines_top_level_name(module_tree, name))


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
                guard_calls = sorted((call for guard_name in OUTPUT_ROOT_GUARD_NAMES for call in calls_named(main_function, guard_name)),
                                     key=lambda call: (call.lineno, call.col_offset))
                self.assertTrue(guard_calls, f'{relative_path} main must call one of {", ".join(OUTPUT_ROOT_GUARD_NAMES)}')
                self.assertEqual(guard_calls[0].lineno, first_work_after_argument_parsing(main_function))

    def test_the_lane_store_root_is_the_converter_output_guard_result(self):
        lane_store_root_function = function_named(parse_script(STORE_PATHS_RELATIVE_PATH).body, LANE_STORE_ROOT_GUARD_NAME)
        self.assertIsInstance(lane_store_root_function.body[0], ast.Return)
        self.assertEqual(called_function_name(lane_store_root_function.body[0].value), OUTPUT_GUARD_NAME)

    def test_committed_report_entry_points_take_no_output_option(self):
        for relative_path in COMMITTED_REPORT_ENTRY_POINTS:
            with self.subTest(relative_path=relative_path):
                self.assertFalse(registers_output_option(parse_script(relative_path)))

    def test_data_ui_entry_points_write_only_the_lane_store_and_take_no_output_option(self):
        for relative_path in DATA_UI_LANE_ONLY_ENTRY_POINTS:
            with self.subTest(relative_path=relative_path):
                module_tree = parse_script(relative_path)
                self.assertFalse(registers_output_option(module_tree))
                self.assertTrue(calls_named(function_named(module_tree.body, 'main'), LANE_STORE_ROOT_GUARD_NAME))

    def test_scan_flags_an_output_option_without_the_guard(self):
        unguarded = ast.parse("parser.add_argument('--output')\noutput = arguments.output\n")
        guarded = ast.parse("parser.add_argument('--output')\noutput = require_converter_output(ROOT, arguments.output)\n")
        without_output = ast.parse("parser.add_argument('--client')\n")
        self.assertEqual(output_entry_point_violations({'unguarded.py': unguarded, 'guarded.py': guarded,
                                                        'without-output.py': without_output}), ['unguarded.py'])

    def test_path_helpers_have_one_owner(self):
        for relative_path in PATH_HELPER_CALLER_PATHS:
            with self.subTest(relative_path=relative_path):
                self.assertFalse(top_level_function_names(relative_path) & DEDUPLICATED_HELPER_NAMES)
        owners = sorted(path.relative_to(REPOSITORY_ROOT).as_posix() for path in SCRIPTS_ROOT.rglob('*.py')
                        if '__pycache__' not in path.parts
                        and top_level_function_names(path.relative_to(REPOSITORY_ROOT).as_posix()) & STORE_PATH_HELPER_NAMES)
        self.assertEqual(owners, [STORE_PATHS_RELATIVE_PATH])

    def test_strict_json_helpers_have_one_owner_each_and_no_player_stage_import(self):
        trees_by_relative_path = {relative_path: parse_script(relative_path) for relative_path in python_sources_under_scripts_and_tests()}
        self.assertEqual(player_stage_helper_imports(trees_by_relative_path), [])
        for helper_name, owner in STRICT_JSON_HELPER_OWNERS.items():
            with self.subTest(helper_name=helper_name):
                expected_definers = sorted([owner, *WORLD_LANE_DEFINERS_AWAITING_THE_OWNER.get(helper_name, [])])
                self.assertEqual(top_level_definers(trees_by_relative_path, helper_name), expected_definers)

    def test_scan_flags_a_helper_reached_through_the_player_stage(self):
        from_import = ast.parse('from stage_native_players import ID, decode_strict_json\n')
        former_name_import = ast.parse('from stage_native_players import digest\n')
        module_attribute = ast.parse('import stage_native_players as players\nplayers.sha256_hex_digest(b"")\n')
        owner_import = ast.parse('from native_assets_lib.strict_json import decode_strict_json\nfrom stage_native_players import ID\n')
        self.assertEqual(player_stage_helper_imports({'from-import.py': from_import, 'former-name-import.py': former_name_import,
                                                      'module-attribute.py': module_attribute, 'owner-import.py': owner_import}),
                         ['former-name-import.py:1 digest', 'from-import.py:1 decode_strict_json', 'module-attribute.py:2 sha256_hex_digest'])

    def test_scan_counts_every_top_level_definition_of_a_helper(self):
        trees_by_relative_path = {'owner.py': ast.parse("SHA256_HEX_PATTERN = re.compile(r'[a-f0-9]{64}')\n"),
                                  'duplicate.py': ast.parse("SHA256_HEX_PATTERN: object = None\n"),
                                  'nested.py': ast.parse('def outer():\n    SHA256_HEX_PATTERN = None\n')}
        self.assertEqual(top_level_definers(trees_by_relative_path, 'SHA256_HEX_PATTERN'), ['duplicate.py', 'owner.py'])


if __name__ == '__main__':
    unittest.main()
