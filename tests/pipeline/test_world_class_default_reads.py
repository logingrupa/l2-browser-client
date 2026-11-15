import ast
from contextlib import contextmanager
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_assets_lib.class_defaults import CLASS_DEFAULT_CACHE_FOLDER_NAME, ClassDefaultError, ClassDefaultValue
from native_catalog.ue2 import FormatError
from native_store.interprocess_lock import lane_lock_folder
from native_store.store_paths import lane_work_root
from world import class_default_reads, tile_chunk_plan
from world.class_default_reads import kept_class_chain, kept_class_default_values, kept_material_class_defaults
from world.static_placement import ClassDefaults
from world.tile_census import WORLD_LANE_NAME
from world.tile_chunk_plan import PLAYER_START_CLASS, PLAYER_START_ENABLED_FIELD, player_start_class_defaults

FROZEN_CLASS_DEFAULT_READERS = ('read_class_defaults_with_provenance', 'cached_class_chain', 'read_material_class_defaults')
OWNER_MODULE_NAME = 'class_default_reads.py'
LOCATION_DEFAULT = {'X': 1.0, 'Y': 2.0, 'Z': 3.0}
UNDECLARED_FIELD_MESSAGE = 'Missing is not declared by the class chain of Engine.StaticMeshActor'
TEXTURE_GRAPH = {'root': 'Synthetic.Texture', 'nodes': [{'id': 'Synthetic.Texture', 'classObject': 'Engine.Texture', 'status': 'reviewed'}]}
SHADER_GRAPH = {'root': 'Synthetic.Shader', 'nodes': [{'id': 'Synthetic.Shader', 'classObject': 'Engine.Shader', 'status': 'reviewed'}]}


def synthetic_class_default_values(class_name, fields, work_root, class_scripts):
    if 'Missing' in fields:
        raise ClassDefaultError(UNDECLARED_FIELD_MESSAGE, class_name)
    return [ClassDefaultValue(field, dict(LOCATION_DEFAULT), 'class-default', class_name) for field in fields]


def synthetic_class_chain(class_name, work_root, class_scripts):
    return [{'identity': {'object': class_name}, 'declaredFields': [{'name': 'Location', 'type': 'vector'}]},
            {'identity': {'object': 'Core.Object'}, 'declaredFields': []}]


def synthetic_material_class_defaults(graph, work_root, class_scripts):
    return {node['classObject']: [{'field': 'USize', 'classDefault': {'field': 'USize', 'value': None, 'provenance': 'ue-zero'}}]
            for node in graph['nodes']}


def class_scripts_of(client_root):
    return SimpleNamespace(client_root=Path(client_root))


class RecordingLock:
    def __init__(self):
        self.held, self.entered_with = False, []

    @contextmanager
    def interprocess_lock(self, lock_folder, key):
        self.entered_with.append((lock_folder, key))
        self.held = True
        try:
            yield
        finally:
            self.held = False


class KeptClassDefaultReadTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve()
        self.work_root = lane_work_root(self.project_root, WORLD_LANE_NAME)
        self.other_work_root = self.project_root / 'other-work'
        self.class_scripts, self.other_class_scripts = class_scripts_of('E:/synthetic-client'), class_scripts_of('E:/other-synthetic-client')
        self.read_values = self.start(mock.patch.object(class_default_reads, 'read_class_defaults_with_provenance',
                                                        side_effect=synthetic_class_default_values))
        self.read_chain = self.start(mock.patch.object(class_default_reads, 'cached_class_chain', side_effect=synthetic_class_chain))
        self.read_material = self.start(mock.patch.object(class_default_reads, 'read_material_class_defaults',
                                                          side_effect=synthetic_material_class_defaults))
        self.start(mock.patch.dict(class_default_reads.kept_answers_by_read, clear=True))
        self.start(mock.patch.dict(class_default_reads.kept_refusal_arguments_by_read, clear=True))

    def start(self, patcher):
        started = patcher.start()
        self.addCleanup(patcher.stop)
        return started

    def test_several_step_objects_of_one_cache_folder_share_one_frozen_read_per_class_and_field_list(self):
        player_start = {'classObject': PLAYER_START_CLASS, 'exportIndex': 1, 'properties': []}
        with mock.patch.object(tile_chunk_plan, 'ReferenceClientClassScripts', return_value=self.class_scripts):
            chunk_plan_answer = player_start_class_defaults('E:/synthetic-client', self.project_root, [player_start])
        step_object_answers = [ClassDefaults(self.work_root, self.class_scripts).values(PLAYER_START_CLASS, [PLAYER_START_ENABLED_FIELD])
                               for _ in range(3)]
        owner_answers = [kept_class_default_values(PLAYER_START_CLASS, (PLAYER_START_ENABLED_FIELD,), self.work_root, self.class_scripts)
                         for _ in range(2)]
        expected_value = ClassDefaultValue(PLAYER_START_ENABLED_FIELD, LOCATION_DEFAULT, 'class-default', PLAYER_START_CLASS)
        self.assertEqual(chunk_plan_answer, {PLAYER_START_ENABLED_FIELD: LOCATION_DEFAULT})
        self.assertEqual(step_object_answers, [{PLAYER_START_ENABLED_FIELD: expected_value}] * 3)
        self.assertEqual(owner_answers, [[expected_value]] * 2)
        self.read_values.assert_called_once_with(PLAYER_START_CLASS, [PLAYER_START_ENABLED_FIELD], self.work_root, self.class_scripts)

    def test_another_cache_folder_another_client_another_class_or_another_field_list_is_read_on_its_own(self):
        asks = [('Engine.StaticMeshActor', ['Location'], self.work_root, self.class_scripts),
                ('Engine.StaticMeshActor', ['Location'], self.other_work_root, self.class_scripts),
                ('Engine.StaticMeshActor', ['Location'], self.work_root, self.other_class_scripts),
                ('Engine.Mover', ['Location'], self.work_root, self.class_scripts),
                ('Engine.StaticMeshActor', ['Location', 'Rotation'], self.work_root, self.class_scripts)]
        for _ in range(2):
            for ask in asks:
                kept_class_default_values(*ask)
        self.assertEqual([call.args for call in self.read_values.call_args_list], asks)

    def test_a_refusal_is_kept_and_raised_again_with_the_same_arguments_without_a_second_read(self):
        refusals = []
        for class_defaults in (ClassDefaults(self.work_root, self.class_scripts), ClassDefaults(self.work_root, self.class_scripts)):
            for _ in range(2):
                with self.assertRaises(ClassDefaultError) as refusal:
                    class_defaults.values('Engine.StaticMeshActor', ['Missing'])
                refusals.append(refusal.exception)
        self.assertEqual([(type(refusal), refusal.args) for refusal in refusals],
                         [(ClassDefaultError, (UNDECLARED_FIELD_MESSAGE, 'Engine.StaticMeshActor'))] * 4)
        self.assertEqual(len({id(refusal) for refusal in refusals}), 4)
        self.read_values.assert_called_once()

    def test_a_failure_that_is_not_a_class_default_refusal_is_not_kept_and_the_next_ask_reads_again(self):
        self.read_values.side_effect = [FormatError('Native package missing/ambiguous: Engine'),
                                        [ClassDefaultValue('Location', dict(LOCATION_DEFAULT), 'class-default', 'Engine.StaticMeshActor')]]
        with self.assertRaisesRegex(FormatError, 'Native package missing/ambiguous: Engine'):
            kept_class_default_values('Engine.StaticMeshActor', ['Location'], self.work_root, self.class_scripts)
        answer = kept_class_default_values('Engine.StaticMeshActor', ['Location'], self.work_root, self.class_scripts)
        self.assertEqual(answer[0].value, LOCATION_DEFAULT)
        self.assertEqual(self.read_values.call_count, 2)

    def test_a_caller_that_changes_its_answer_does_not_change_the_answer_of_the_next_caller(self):
        values = kept_class_default_values('Engine.StaticMeshActor', ['Location'], self.work_root, self.class_scripts)
        values[0].value['X'] = 99.0
        values.clear()
        chain = kept_class_chain('Engine.StaticMeshActor', self.work_root, self.class_scripts)
        chain[0]['declaredFields'].clear()
        chain.pop()
        material_class_defaults = kept_material_class_defaults(TEXTURE_GRAPH, self.work_root, self.class_scripts)
        material_class_defaults['Engine.Texture'][0]['classDefault']['value'] = 256
        material_class_defaults['Engine.Shader'] = []
        self.assertEqual(kept_class_default_values('Engine.StaticMeshActor', ['Location'], self.work_root, self.class_scripts),
                         synthetic_class_default_values('Engine.StaticMeshActor', ['Location'], None, None))
        self.assertEqual(kept_class_chain('Engine.StaticMeshActor', self.work_root, self.class_scripts),
                         synthetic_class_chain('Engine.StaticMeshActor', None, None))
        self.assertEqual(kept_material_class_defaults(TEXTURE_GRAPH, self.work_root, self.class_scripts),
                         synthetic_material_class_defaults(TEXTURE_GRAPH, None, None))
        self.assertEqual([reader.call_count for reader in (self.read_values, self.read_chain, self.read_material)], [1, 1, 1])

    def test_a_class_chain_is_read_once_per_cache_folder_client_and_class(self):
        asks = [('Engine.Light', self.work_root, self.class_scripts), ('Engine.Light', self.other_work_root, self.class_scripts),
                ('Engine.Light', self.work_root, self.other_class_scripts), ('Engine.L2FogInfo', self.work_root, self.class_scripts)]
        for _ in range(3):
            for ask in asks:
                self.assertEqual(kept_class_chain(*ask), synthetic_class_chain(*ask))
        self.assertEqual([call.args for call in self.read_chain.call_args_list], asks)

    def test_the_material_class_defaults_of_one_graph_are_read_once_and_another_graph_is_read_on_its_own(self):
        same_graph_in_another_key_order = {'nodes': [dict(reversed(node.items())) for node in TEXTURE_GRAPH['nodes']], 'root': TEXTURE_GRAPH['root']}
        for graph in (TEXTURE_GRAPH, same_graph_in_another_key_order, SHADER_GRAPH, TEXTURE_GRAPH, SHADER_GRAPH):
            self.assertEqual(kept_material_class_defaults(graph, self.work_root, self.class_scripts),
                             synthetic_material_class_defaults(graph, None, None))
        self.assertEqual([call.args for call in self.read_material.call_args_list],
                         [(TEXTURE_GRAPH, self.work_root, self.class_scripts), (SHADER_GRAPH, self.work_root, self.class_scripts)])

    def test_a_read_that_is_not_kept_takes_the_lock_of_its_cache_folder_and_a_kept_read_takes_no_lock(self):
        lock = RecordingLock()
        held_at_each_read = []

        def read_under_the_lock(class_name, fields, work_root, class_scripts):
            held_at_each_read.append(lock.held)
            return synthetic_class_default_values(class_name, fields, work_root, class_scripts)

        self.read_values.side_effect = read_under_the_lock
        with mock.patch.object(class_default_reads, 'interprocess_lock', lock.interprocess_lock):
            for _ in range(3):
                kept_class_default_values('Engine.StaticMeshActor', ['Location'], self.work_root, self.class_scripts)
        cache_folder = (self.work_root / CLASS_DEFAULT_CACHE_FOLDER_NAME).resolve()
        self.assertEqual(lock.entered_with, [(lane_lock_folder(self.work_root), 'class-defaults:' + cache_folder.as_posix())])
        self.assertEqual((held_at_each_read, lock.held), ([True], False))

    def test_a_read_that_is_not_kept_leaves_its_lock_file_under_the_work_root(self):
        kept_class_default_values('Engine.StaticMeshActor', ['Location'], self.work_root, self.class_scripts)
        kept_class_chain('Engine.StaticMeshActor', self.work_root, self.class_scripts)
        self.assertEqual(len(list(lane_lock_folder(self.work_root).iterdir())), 1)


def imported_names(tree):
    return {alias.name for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) for alias in node.names}


class FrozenClassDefaultReaderImportTests(unittest.TestCase):
    def test_only_the_owner_module_imports_the_frozen_class_default_readers(self):
        importing_module_names = [path.name for path in sorted((ROOT / 'scripts' / 'world').glob('*.py'))
                                  if imported_names(ast.parse(path.read_text(encoding='utf-8'))) & set(FROZEN_CLASS_DEFAULT_READERS)]
        self.assertEqual(importing_module_names, [OWNER_MODULE_NAME])
        owner_tree = ast.parse((ROOT / 'scripts' / 'world' / OWNER_MODULE_NAME).read_text(encoding='utf-8'))
        self.assertLessEqual(set(FROZEN_CLASS_DEFAULT_READERS), imported_names(owner_tree))


if __name__ == '__main__':
    unittest.main()
