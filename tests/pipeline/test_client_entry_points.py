import ast
from pathlib import Path
import unittest

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_ROOT = REPOSITORY_ROOT / 'scripts'
CLIENT_OPTION_PREFIX = '--client'
REFERENCE_CLIENT_GUARD_NAME = 'require_reference_client'
KNOWN_CLIENT_ENTRY_POINTS = {
    'scripts/audit-native-footstep-config.py',
    'scripts/audit_musveren_weights.py',
    'scripts/derive-native-map-model.py',
    'scripts/derive-native-map-movers.py',
    'scripts/derive-native-map-overlap.py',
    'scripts/export-native-map-audio.py',
    'scripts/export-native-sounds.py',
    'scripts/extract-native-terrain-patch.py',
    'scripts/native_actor_profiles.py',
    'scripts/native_assets.py',
    'scripts/native_bsp_building.py',
    'scripts/native_bsp_floor.py',
    'scripts/native_catalog/cli.py',
    'scripts/native_effect_bundle.py',
    'scripts/native_effects.py',
    'scripts/native_map.py',
    'scripts/native_map_geometry.py',
    'scripts/native_map_overlap.py',
    'scripts/native_migration.py',
    'scripts/native_sky.py',
    'scripts/prepare-native-player-aliases.py',
    'scripts/report-native-animation-aliases.py',
    'scripts/restore-native-static-normals.py',
}
ENTRY_POINTS_NOT_YET_GUARDED = {
    'scripts/native_actor_profiles.py',
    'scripts/native_effect_bundle.py',
    'scripts/native_effects.py',
    'scripts/native_migration.py',
    'scripts/prepare-native-player-aliases.py',
    'scripts/report-native-animation-aliases.py',
}


def called_function_name(call):
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return None


def registers_client_option(module_tree):
    for node in ast.walk(module_tree):
        if isinstance(node, ast.Call) and called_function_name(node) == 'add_argument' and node.args:
            option = node.args[0]
            if isinstance(option, ast.Constant) and isinstance(option.value, str) and option.value.startswith(CLIENT_OPTION_PREFIX):
                return True
    return False


def calls_reference_client_guard(module_tree):
    return any(isinstance(node, ast.Call) and called_function_name(node) == REFERENCE_CLIENT_GUARD_NAME
               for node in ast.walk(module_tree))


def client_entry_point_trees():
    trees_by_relative_path = {}
    for path in sorted(SCRIPTS_ROOT.rglob('*.py')):
        if '__pycache__' in path.parts:
            continue
        module_tree = ast.parse(path.read_bytes(), filename=str(path))
        if registers_client_option(module_tree):
            trees_by_relative_path[path.relative_to(REPOSITORY_ROOT).as_posix()] = module_tree
    return trees_by_relative_path


def unguarded_entry_points(trees_by_relative_path):
    return {relative_path for relative_path, module_tree in trees_by_relative_path.items()
            if not calls_reference_client_guard(module_tree)}


class ClientEntryPointScanTests(unittest.TestCase):
    def test_scan_selects_every_known_client_entry_point(self):
        selected = set(client_entry_point_trees())
        self.assertLessEqual(KNOWN_CLIENT_ENTRY_POINTS, selected, KNOWN_CLIENT_ENTRY_POINTS - selected)

    def test_only_the_listed_entry_points_still_skip_the_reference_client_guard(self):
        self.assertEqual(unguarded_entry_points(client_entry_point_trees()), ENTRY_POINTS_NOT_YET_GUARDED)

    def test_scan_flags_a_client_option_without_a_guard_call(self):
        unguarded_source = "import argparse\nparser = argparse.ArgumentParser()\nparser.add_argument('--client-snapshot')\n"
        guarded_source = unguarded_source + "args = parser.parse_args()\nrequire_reference_client(args.client_snapshot)\n"
        imported_only_source = 'from reference_client_guard import require_reference_client\n' + unguarded_source
        trees_by_relative_path = {
            'unguarded.py': ast.parse(unguarded_source),
            'guarded.py': ast.parse(guarded_source),
            'imported-only.py': ast.parse(imported_only_source),
        }
        self.assertTrue(all(registers_client_option(tree) for tree in trees_by_relative_path.values()))
        self.assertEqual(unguarded_entry_points(trees_by_relative_path), {'unguarded.py', 'imported-only.py'})

    def test_scan_ignores_a_client_option_named_only_in_help_text(self):
        module_tree = ast.parse("parser.add_argument('--output', help='never --client')\n")
        self.assertFalse(registers_client_option(module_tree))


if __name__ == '__main__':
    unittest.main()
