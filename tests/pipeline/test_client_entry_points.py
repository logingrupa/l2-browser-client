import ast
from pathlib import Path
import unittest

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_ROOT = REPOSITORY_ROOT / 'scripts'
CLIENT_OPTION_PREFIX = '--client'
REFERENCE_CLIENT_GUARD_NAME = 'require_reference_client'
PER_FILE_GUARD_METHOD_NAME = 'require_equal_file'
REFERENCE_CLIENT_GUARD_MODULE_NAME = 'reference_client_guard'
SCRIPT_FILE_LOADER_NAME = 'spec_from_file_location'
ARGUMENT_PARSING_METHOD_NAME = 'parse_args'
KNOWN_CLIENT_ENTRY_POINTS = {
    'scripts/audit-native-footstep-config.py',
    'scripts/audit_musveren_weights.py',
    'scripts/export-native-map-audio.py',
    'scripts/export-native-sounds.py',
    'scripts/native_actor_profiles.py',
    'scripts/native_assets.py',
    'scripts/native_catalog/cli.py',
    'scripts/native_effect_bundle.py',
    'scripts/native_effects.py',
    'scripts/native_migration.py',
    'scripts/native_sky.py',
    'scripts/prepare-native-player-aliases.py',
    'scripts/report-native-animation-aliases.py',
}


def called_function_name(call):
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return None


def client_option_destinations(module_tree):
    destinations = set()
    for node in ast.walk(module_tree):
        if not (isinstance(node, ast.Call) and called_function_name(node) == 'add_argument' and node.args):
            continue
        option = node.args[0]
        if isinstance(option, ast.Constant) and isinstance(option.value, str) and option.value.startswith(CLIENT_OPTION_PREFIX):
            explicit_destination = next((keyword.value.value for keyword in node.keywords
                                         if keyword.arg == 'dest' and isinstance(keyword.value, ast.Constant)), None)
            destinations.add(explicit_destination or option.value.lstrip('-').replace('-', '_'))
    return destinations


def registers_client_option(module_tree):
    return bool(client_option_destinations(module_tree))


def parsed_argument_names(module_tree):
    return {target.id for node in ast.walk(module_tree)
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) and called_function_name(node.value) == ARGUMENT_PARSING_METHOD_NAME
            for target in node.targets if isinstance(target, ast.Name)}


def guarded_client_destinations(module_tree):
    argument_names = parsed_argument_names(module_tree)
    return {call.args[0].attr for call in ast.walk(module_tree)
            if isinstance(call, ast.Call) and called_function_name(call) == REFERENCE_CLIENT_GUARD_NAME
            and call.args and isinstance(call.args[0], ast.Attribute) and isinstance(call.args[0].value, ast.Name)
            and call.args[0].value.id in argument_names}


def module_name_of(relative_path):
    return '.'.join(Path(relative_path).with_suffix('').parts[1:])


def imported_module_name(module_name, import_node):
    if not import_node.level:
        return import_node.module
    package_parts = module_name.split('.')[:-import_node.level]
    return '.'.join(package_parts + ([import_node.module] if import_node.module else []))


class PerFileGuardReachability:
    def __init__(self, trees_by_module_name):
        self.trees_by_module_name = trees_by_module_name
        self.references_by_definition, self.guarded_definitions, self.module_references = {}, set(), {}
        self.loaded_script_module_names = {}
        for module_name, module_tree in trees_by_module_name.items():
            self.index_module(module_name, module_tree)
        self.propagate_guarded_definitions()

    def import_bindings(self, module_name, module_tree):
        imported_definitions, module_aliases = {}, {}
        for node in ast.walk(module_tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    module_aliases[alias.asname or alias.name] = alias.name
            elif isinstance(node, ast.ImportFrom):
                source_module = imported_module_name(module_name, node)
                for alias in node.names:
                    local_name = alias.asname or alias.name
                    if f'{source_module}.{alias.name}' in self.trees_by_module_name:
                        module_aliases[local_name] = f'{source_module}.{alias.name}'
                    else:
                        imported_definitions[local_name] = (source_module, alias.name)
        return imported_definitions, module_aliases

    def referenced_definitions(self, module_name, node, imported_definitions, module_aliases, local_definitions):
        references, calls_per_file_guard = set(), False
        for child in ast.walk(node):
            if isinstance(child, ast.Attribute) and child.attr == PER_FILE_GUARD_METHOD_NAME:
                calls_per_file_guard = True
            elif isinstance(child, ast.Attribute) and isinstance(child.value, ast.Name) and child.value.id in module_aliases:
                references.add((module_aliases[child.value.id], child.attr))
            elif isinstance(child, ast.Name) and child.id in local_definitions:
                references.add((module_name, child.id))
            elif isinstance(child, ast.Name) and child.id in imported_definitions:
                references.add(imported_definitions[child.id])
        return references, calls_per_file_guard

    def index_module(self, module_name, module_tree):
        imported_definitions, module_aliases = self.import_bindings(module_name, module_tree)
        definitions = [node for node in module_tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef))]
        local_definitions = {node.name for node in definitions}
        for local_name, imported_definition in imported_definitions.items():
            if local_name not in local_definitions:
                self.references_by_definition[(module_name, local_name)] = {imported_definition}
        for node in definitions:
            references, calls_per_file_guard = self.referenced_definitions(module_name, node, imported_definitions, module_aliases, local_definitions)
            self.references_by_definition[(module_name, node.name)] = references
            if calls_per_file_guard and module_name != REFERENCE_CLIENT_GUARD_MODULE_NAME:
                self.guarded_definitions.add((module_name, node.name))
        self.module_references[module_name] = self.referenced_definitions(module_name, module_tree, imported_definitions, module_aliases, local_definitions)
        self.loaded_script_module_names[module_name] = self.script_modules_loaded_from_files(module_tree)

    def script_modules_loaded_from_files(self, module_tree):
        loaded_module_names = set()
        for call in ast.walk(module_tree):
            if isinstance(call, ast.Call) and called_function_name(call) == SCRIPT_FILE_LOADER_NAME:
                for node in ast.walk(call):
                    if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value.endswith('.py'):
                        loaded_module_names.add(module_name_of('scripts/' + node.value.removeprefix('scripts/')))
        return loaded_module_names & set(self.trees_by_module_name)

    def propagate_guarded_definitions(self):
        changed = True
        while changed:
            changed = False
            for definition, references in self.references_by_definition.items():
                if definition not in self.guarded_definitions and references & self.guarded_definitions:
                    self.guarded_definitions.add(definition)
                    changed = True

    def reaches_per_file_guard(self, module_name, visited_module_names=frozenset()):
        references, calls_per_file_guard = self.module_references[module_name]
        if calls_per_file_guard or references & self.guarded_definitions:
            return True
        visited_module_names = visited_module_names | {module_name}
        return any(self.reaches_per_file_guard(loaded_module_name, visited_module_names)
                   for loaded_module_name in self.loaded_script_module_names[module_name] - visited_module_names)


def script_trees_by_module_name():
    trees_by_module_name = {}
    for path in sorted(SCRIPTS_ROOT.rglob('*.py')):
        if '__pycache__' not in path.parts:
            trees_by_module_name[module_name_of(path.relative_to(REPOSITORY_ROOT).as_posix())] = ast.parse(path.read_bytes(), filename=str(path))
    return trees_by_module_name


def client_entry_point_module_names(trees_by_module_name):
    return {module_name for module_name, module_tree in trees_by_module_name.items() if registers_client_option(module_tree)}


def relative_script_path(module_name):
    return 'scripts/' + module_name.replace('.', '/') + '.py'


def entry_point_guard_failures(trees_by_module_name):
    reachability = PerFileGuardReachability(trees_by_module_name)
    failures = {}
    for module_name in client_entry_point_module_names(trees_by_module_name):
        module_tree = trees_by_module_name[module_name]
        unguarded_options = client_option_destinations(module_tree) - guarded_client_destinations(module_tree)
        if unguarded_options:
            failures[module_name] = 'no reference client guard on the parsed ' + ', '.join(sorted(unguarded_options))
        elif not reachability.reaches_per_file_guard(module_name):
            failures[module_name] = 'reads client files without the per-file lock check'
    return failures


def synthetic_trees(**sources_by_module_name):
    return {module_name: ast.parse(source) for module_name, source in sources_by_module_name.items()}


CLIENT_OPTION_SOURCE = "import argparse\nparser = argparse.ArgumentParser()\nparser.add_argument('--client-snapshot')\nargs = parser.parse_args()\n"


class ClientEntryPointScanTests(unittest.TestCase):
    def test_scan_selects_every_known_client_entry_point(self):
        selected = {relative_script_path(module_name) for module_name in client_entry_point_module_names(script_trees_by_module_name())}
        self.assertLessEqual(KNOWN_CLIENT_ENTRY_POINTS, selected, KNOWN_CLIENT_ENTRY_POINTS - selected)

    def test_every_client_entry_point_guards_its_parsed_client_option_and_references_the_per_file_lock_check(self):
        self.assertEqual(entry_point_guard_failures(script_trees_by_module_name()), {})

    def test_scan_flags_a_client_option_without_a_guard_call(self):
        trees_by_module_name = synthetic_trees(
            unguarded=CLIENT_OPTION_SOURCE,
            imported_only='from reference_client_guard import require_reference_client\n' + CLIENT_OPTION_SOURCE)
        self.assertEqual(set(entry_point_guard_failures(trees_by_module_name)), {'unguarded', 'imported_only'})

    def test_scan_flags_a_guard_on_anything_but_the_parsed_client_option(self):
        trees_by_module_name = synthetic_trees(
            fixed_root=CLIENT_OPTION_SOURCE + "require_reference_client('E:/client').require_equal_file('system/a.dat')\n")
        self.assertEqual(entry_point_guard_failures(trees_by_module_name), {'fixed_root': 'no reference client guard on the parsed client_snapshot'})

    def test_scan_flags_a_guard_on_an_attribute_of_anything_but_the_parsed_arguments(self):
        trees_by_module_name = synthetic_trees(
            instance_attribute=CLIENT_OPTION_SOURCE + "class Reader:\n    def __init__(self, client_snapshot):\n        self.client_snapshot = client_snapshot\n"
                "    def read(self):\n        return require_reference_client(self.client_snapshot).require_equal_file('system/a.dat').read_bytes()\n",
            parsed_arguments=CLIENT_OPTION_SOURCE + "require_reference_client(args.client_snapshot).require_equal_file('system/a.dat').read_bytes()\n")
        self.assertEqual(entry_point_guard_failures(trees_by_module_name), {'instance_attribute': 'no reference client guard on the parsed client_snapshot'})

    def test_scan_flags_a_script_that_reads_client_files_without_the_per_file_lock_check(self):
        trees_by_module_name = synthetic_trees(
            root_guard_only=CLIENT_OPTION_SOURCE + "require_reference_client(args.client_snapshot)\n(args.client_snapshot / 'system/a.dat').read_bytes()\n",
            direct_per_file_guard=CLIENT_OPTION_SOURCE + "require_reference_client(args.client_snapshot).require_equal_file('system/a.dat').read_bytes()\n",
            guarded_reader="def read_lock_equal_table(client):\n    return require_reference_client(client).require_equal_file('system/a.dat').read_bytes()\n",
            imported_per_file_guard='from guarded_reader import read_lock_equal_table\n' + CLIENT_OPTION_SOURCE
                + 'require_reference_client(args.client_snapshot)\nread_lock_equal_table(args.client_snapshot)\n',
            loaded_per_file_guard='import importlib.util\n' + CLIENT_OPTION_SOURCE
                + "require_reference_client(args.client_snapshot)\nimportlib.util.spec_from_file_location('reader', 'scripts/guarded_reader.py')\n",
            reexporting_reader='from guarded_reader import read_lock_equal_table\n',
            reexported_per_file_guard='from reexporting_reader import read_lock_equal_table\n' + CLIENT_OPTION_SOURCE
                + 'require_reference_client(args.client_snapshot)\nread_lock_equal_table(args.client_snapshot)\n')
        self.assertEqual(entry_point_guard_failures(trees_by_module_name), {'root_guard_only': 'reads client files without the per-file lock check'})

    def test_scan_ignores_a_client_option_named_only_in_help_text(self):
        module_tree = ast.parse("parser.add_argument('--output', help='never --client')\n")
        self.assertFalse(registers_client_option(module_tree))


if __name__ == '__main__':
    unittest.main()
