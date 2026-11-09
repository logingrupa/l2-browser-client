import ast
from collections import deque
import contextlib
import io
import json
from pathlib import Path
import re
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import native_assets
from native_assets import Converter, sha
from reference_client_lock_fixture import lock_client_as_reference_root

PER_SYSTEM_ENTRY_POINTS = ('native_assets.py', 'native_effect_bundle.py', 'native_actor_profiles.py',
                           'export-native-sounds.py', 'export-native-map-audio.py')
LANE_ENTRY_POINT_FOLDERS = ('world', 'actors', 'data')
BATCH_MODULE_PATHS = ('scripts/native_batch.py', 'scripts/native_batch_adapters.py')
LANE_ENTRY_POINT_SELECTORS = {
    'scripts/world/convert_tile.py': (('--map', '--step'), '02-14'),
    'scripts/data/convert_tables.py': (('--table',), '02-17'),
    'scripts/data/convert_ui.py': (('--step',), '02-19'),
    'scripts/actors/convert_actors.py': (('--npc',), '02-22'),
}
CONVERTER_PACKAGE_SCRIPT_NAMES = ('convert:tables', 'convert:world', 'convert:actors', 'convert:ui')
REFUSED_CONVERTER_NAME_PREFIXES = ('assets:', 'world:stage', 'preview')
STORE_WRITER_FILE_PREFIXES = ('assets', 'stage_', 'stage-', 'derive-', 'migrate-')
STORE_WRITER_FILE_NAMES = ('native_batch.py', 'merge_lane_store.py')
CONVERTER_COMMAND_PREFIX = 'python -B scripts/'
SCRIPT_PATH_PATTERN = re.compile(r'(?:^|[\s"\'=])(?:\./)?(scripts/[^\s"\'&|;]+)')
CONTENT_DIRECTORY_PATTERN = re.compile(r'[0-9a-f]{64}')


def repo_relative(path, repo_root):
    return Path(path).resolve().relative_to(Path(repo_root).resolve()).as_posix()


def module_file_candidates(module_name, base_directory):
    parts = module_name.split('.')
    candidates = []
    for length in range(1, len(parts) + 1):
        stem = base_directory.joinpath(*parts[:length])
        candidates += [stem / '__init__.py', stem.with_name(stem.name + '.py')]
    return [candidate for candidate in candidates if candidate.is_file()]


def imported_module_files(path, scripts_root):
    tree = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
    files = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                files += module_file_candidates(alias.name, scripts_root)
        elif isinstance(node, ast.ImportFrom):
            base_directory = scripts_root
            if node.level:
                base_directory = path.parent
                for _ in range(node.level - 1):
                    base_directory = base_directory.parent
            module_names = [node.module] if node.module else []
            module_names += [f'{node.module}.{alias.name}' if node.module else alias.name for alias in node.names]
            for module_name in module_names:
                files += module_file_candidates(module_name, base_directory)
    return files


def local_import_closure(entry_path, scripts_root=SCRIPTS, repo_root=ROOT):
    entry = Path(entry_path).resolve()
    visited, queue = {entry}, deque([entry])
    while queue:
        for module_file in imported_module_files(queue.popleft(), Path(scripts_root)):
            resolved = module_file.resolve()
            if resolved not in visited:
                visited.add(resolved)
                queue.append(resolved)
    return tuple(sorted(repo_relative(path, repo_root) for path in visited if path != entry))


def lane_entry_points():
    return sorted(path for folder in LANE_ENTRY_POINT_FOLDERS for path in (SCRIPTS / folder).glob('convert_*.py'))


def per_system_entry_points():
    return [SCRIPTS / name for name in PER_SYSTEM_ENTRY_POINTS if (SCRIPTS / name).is_file()] + lane_entry_points()


def batch_closure_violations(entry_points, scripts_root=SCRIPTS, repo_root=ROOT):
    return sorted((repo_relative(entry, repo_root), module) for entry in entry_points
                  for module in local_import_closure(entry, scripts_root, repo_root) if module in BATCH_MODULE_PATHS)


def invoked_script_paths(command):
    return SCRIPT_PATH_PATTERN.findall(command.replace('\\', '/'))


def invoked_script_name(command):
    paths = invoked_script_paths(command)
    return Path(paths[0]).name if paths else None


def banned_store_writer(script_file_name):
    name = script_file_name.casefold()
    return name.startswith(STORE_WRITER_FILE_PREFIXES) or 'preview' in name or name in STORE_WRITER_FILE_NAMES


def refused_converter_name(script_name):
    name = script_name.casefold()
    return name.startswith(REFUSED_CONVERTER_NAME_PREFIXES) or name not in CONVERTER_PACKAGE_SCRIPT_NAMES


def converter_package_script_problems(scripts, repo_root=ROOT):
    problems = []
    for name, command in sorted(scripts.items()):
        if not name.casefold().startswith('convert:'):
            continue
        normalised_command = command.replace('\\', '/')
        paths = invoked_script_paths(normalised_command)
        if refused_converter_name(name):
            problems.append((name, 'converter name is not one of ' + ', '.join(CONVERTER_PACKAGE_SCRIPT_NAMES)))
        if not normalised_command.startswith(CONVERTER_COMMAND_PREFIX) or not paths:
            problems.append((name, f'command does not start with {CONVERTER_COMMAND_PREFIX}'))
            continue
        if any(banned_store_writer(Path(path).name) for path in paths):
            problems.append((name, 'command runs a store writer or native_batch.py'))
        first_path = paths[0]
        if Path(first_path).parent.as_posix() not in {f'scripts/{folder}' for folder in LANE_ENTRY_POINT_FOLDERS} or not (Path(repo_root) / first_path).is_file():
            problems.append((name, f'{first_path} is not an existing lane entry point'))
    return problems


def declared_option_strings(path):
    tree = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
    return {argument.value for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'add_argument'
            for argument in node.args if isinstance(argument, ast.Constant) and isinstance(argument.value, str) and argument.value.startswith('--')}


def package_scripts():
    return json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['scripts']


def synthetic_wav():
    output = io.BytesIO()
    with wave.open(output, 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(8000)
        stream.writeframes(struct.pack('<h', 5) * 80)
    return output.getvalue()


class ConverterImportClosureTests(unittest.TestCase):
    def test_native_assets_entry_point_exists(self):
        self.assertTrue((SCRIPTS / 'native_assets.py').is_file())

    def test_no_per_system_entry_point_reaches_native_batch(self):
        self.assertEqual(batch_closure_violations(per_system_entry_points()), [])
        self.assertNotIn('scripts/native_batch.py', local_import_closure(SCRIPTS / 'native_assets.py'))

    def test_no_lane_entry_point_imports_another_lane_entry_point(self):
        entry_points = lane_entry_points()
        names = {repo_relative(path, ROOT) for path in entry_points}
        crossings = sorted((repo_relative(entry, ROOT), module) for entry in entry_points
                           for module in local_import_closure(entry) if module in names)
        self.assertEqual(crossings, [])

    def test_scanner_catches_a_batch_import_and_gives_an_empty_closure_without_local_imports(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            scripts = root / 'scripts'
            (scripts / 'world').mkdir(parents=True)
            (scripts / 'native_batch.py').write_text('', encoding='utf-8')
            (scripts / 'shared_reader.py').write_text('import native_batch\n', encoding='utf-8')
            (scripts / 'world' / 'convert_tile.py').write_text('import json\nfrom shared_reader import read\n', encoding='utf-8')
            (scripts / 'standalone.py').write_text('import json\n', encoding='utf-8')
            entry = scripts / 'world' / 'convert_tile.py'
            self.assertEqual(local_import_closure(entry, scripts, root), ('scripts/native_batch.py', 'scripts/shared_reader.py'))
            self.assertEqual(batch_closure_violations([entry], scripts, root), [('scripts/world/convert_tile.py', 'scripts/native_batch.py')])
            self.assertEqual(local_import_closure(scripts / 'standalone.py', scripts, root), ())


class SingleTargetConversionTests(unittest.TestCase):
    def test_native_assets_convert_writes_one_target_alone(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client = root / 'source'
            client.mkdir()
            lock_client_as_reference_root(self, client)
            (client / 'sample.wav').write_bytes(synthetic_wav())
            tool = root / 'tool.exe'
            tool.write_bytes(b'not executed by the media adapter')
            output = root / 'artifacts' / 'output'
            arguments = ['native_assets.py', 'convert', '--kind', 'audio', '--media', 'sample.wav',
                         '--client', str(client), '--output', str(output), '--umodel', str(tool)]
            printed = io.StringIO()
            with (patch.object(sys, 'argv', arguments), patch('native_assets.UMODEL_SHA256', sha(tool.read_bytes())),
                  patch.dict(Converter.__init__.__kwdefaults__, {'project_root': root}), contextlib.redirect_stdout(printed)):
                native_assets.main()
            result = json.loads(printed.getvalue())
            self.assertFalse(result['cacheHit'])
            content_directories = [path.name for path in output.iterdir() if path.is_dir() and CONTENT_DIRECTORY_PATTERN.fullmatch(path.name)]
            self.assertEqual(len(content_directories), 1)
            self.assertEqual(len(list((output / 'index').glob('*.json'))), 1)


class SingleUnitSelectorTests(unittest.TestCase):
    def require_selectors(self, relative_path):
        selectors, plan = LANE_ENTRY_POINT_SELECTORS[relative_path]
        path = ROOT / relative_path
        if not path.is_file():
            self.skipTest(f'{relative_path} lands in plan {plan}')
        declared = declared_option_strings(path)
        self.assertEqual(sorted(set(selectors) - declared), [])
        return declared

    def test_convert_tile_declares_map_and_step(self):
        self.require_selectors('scripts/world/convert_tile.py')

    def test_convert_tables_declares_table(self):
        self.require_selectors('scripts/data/convert_tables.py')

    def test_convert_ui_declares_step(self):
        self.require_selectors('scripts/data/convert_ui.py')

    def test_convert_actors_declares_npc_and_level_with_skill(self):
        declared = self.require_selectors('scripts/actors/convert_actors.py')
        if '--skill' in declared:
            self.assertIn('--level', declared)

    def test_option_reader_collects_add_argument_strings(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'convert_sample.py'
            path.write_text("parser.add_argument('--map', '-m')\nparser.add_argument('--step', required=True)\n", encoding='utf-8')
            self.assertEqual(declared_option_strings(path), {'--map', '--step'})


class PackageScriptNamingTests(unittest.TestCase):
    def test_only_assets_pipeline_runs_native_batch(self):
        runners = sorted(name for name, command in package_scripts().items()
                         if any(Path(path).name.casefold() == 'native_batch.py' for path in invoked_script_paths(command)))
        self.assertEqual(runners, ['assets:pipeline'])

    def test_package_converter_scripts_reach_only_lane_entry_points(self):
        scripts = package_scripts()
        converter_names = sorted(name for name in scripts if name.casefold().startswith('convert:'))
        self.assertLessEqual(set(converter_names), set(CONVERTER_PACKAGE_SCRIPT_NAMES))
        self.assertEqual(converter_package_script_problems(scripts), [])

    def test_package_declares_exactly_the_four_lane_converter_scripts(self):
        scripts = package_scripts()
        converter_scripts = {name: command for name, command in scripts.items() if name.casefold().startswith('convert:')}
        self.assertEqual(converter_scripts, {
            'convert:tables': 'python -B scripts/data/convert_tables.py',
            'convert:world': 'python -B scripts/world/convert_tile.py',
            'convert:actors': 'python -B scripts/actors/convert_actors.py',
            'convert:ui': 'python -B scripts/data/convert_ui.py',
        })
        for name, command in converter_scripts.items():
            with self.subTest(name=name):
                self.assertTrue((ROOT / invoked_script_paths(command)[0]).is_file())

    def test_invoked_script_name_reads_the_file_name_after_slash_normalisation(self):
        self.assertEqual(invoked_script_name('python -B scripts\\data\\convert_tables.py --table npcgrp'), 'convert_tables.py')
        self.assertEqual(invoked_script_name('vite --host 127.0.0.1'), None)

    def test_store_writers_are_banned_casefolded_and_by_file_name(self):
        for name in ('stage_native_runtime.py', 'STAGE_native_runtime.py', 'stage-world-assets.mjs', 'derive-synthetic-store-writer.py',
                     'migrate-synthetic-store-writer.py', 'private-preview.mjs', 'native_batch.py', 'assets_stage.py', 'Merge_Lane_Store.py'):
            with self.subTest(name=name):
                self.assertTrue(banned_store_writer(name))
        self.assertFalse(banned_store_writer('convert_tables.py'))

    def test_converter_names_compare_casefolded(self):
        for name in ('Assets:Stage', 'world:stage', 'preview:private', 'convert:everything'):
            with self.subTest(name=name):
                self.assertTrue(refused_converter_name(name))
        self.assertFalse(refused_converter_name('Convert:World'))

    def test_synthetic_store_writer_commands_are_refused(self):
        for command in ('python -B scripts/stage_native_runtime.py', 'python -B scripts/native_batch.py',
                        'python -B scripts\\STAGE_native_runtime.py', 'python -B scripts/data/convert_tables.py && python -B scripts/stage_native_runtime.py'):
            with self.subTest(command=command):
                self.assertNotEqual(converter_package_script_problems({'convert:tables': command}), [])

    def test_a_converter_command_that_invokes_the_lane_store_merge_is_refused(self):
        command = ('python -B scripts/data/convert_tables.py --table npcgrp && python -B scripts/native_store/merge_lane_store.py '
                   '--lane-store artifacts/lane-store/data-ui/l2 --target public/l2 --expected-base-catalog-sha256 ' + '0' * 64)
        self.assertEqual(converter_package_script_problems({'convert:tables': command}),
                         [('convert:tables', 'command runs a store writer or native_batch.py')])

    def test_lane_entry_point_command_with_a_banned_token_inside_its_path_passes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'scripts' / 'data').mkdir(parents=True)
            (root / 'scripts' / 'data' / 'convert_tables.py').write_text('', encoding='utf-8')
            scripts = {'convert:tables': 'python -B scripts/data/convert_tables.py --table stage_npcgrp'}
            self.assertEqual(converter_package_script_problems(scripts, root), [])

    def test_no_converter_scripts_report_zero_problems(self):
        self.assertEqual(converter_package_script_problems({'dev': 'vite', 'assets:pipeline': 'python -B scripts/native_batch.py'}), [])


if __name__ == '__main__':
    unittest.main()
