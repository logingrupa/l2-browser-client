from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_assets_lib.class_defaults import ClassDefaultError, ClassDefaultValue
from native_catalog.ue2 import FormatError
from world import class_default_reads
from world.static_placement import ClassDefaults

CLASS_SCRIPTS = SimpleNamespace(client_root=Path('E:/synthetic-client'))
LOCATION_DEFAULT = {'X': 1.0, 'Y': 2.0, 'Z': 3.0}
UNDECLARED_FIELD_MESSAGE = 'Missing is not declared by the class chain of Engine.StaticMeshActor'


def synthetic_class_defaults(class_name, fields, work_root, class_scripts):
    if 'Missing' in fields:
        raise ClassDefaultError(UNDECLARED_FIELD_MESSAGE)
    return [ClassDefaultValue(field, dict(LOCATION_DEFAULT), 'class-default', class_name) for field in fields]


class ClassDefaultLookupTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.work_root = Path(temporary_directory.name).resolve() / 'work'
        reader = patch.object(class_default_reads, 'read_class_defaults_with_provenance', side_effect=synthetic_class_defaults)
        self.read_class_defaults = reader.start()
        self.addCleanup(reader.stop)
        for kept_reads in (class_default_reads.kept_answers_by_read, class_default_reads.kept_refusal_arguments_by_read):
            emptied_kept_reads = patch.dict(kept_reads, clear=True)
            emptied_kept_reads.start()
            self.addCleanup(emptied_kept_reads.stop)
        self.class_defaults = ClassDefaults(self.work_root, CLASS_SCRIPTS)

    def test_one_class_and_field_list_is_read_once_however_often_it_is_asked(self):
        answers = [self.class_defaults.values('Engine.StaticMeshActor', ['Location']) for _ in range(50)]
        self.assertEqual(answers[0], {'Location': ClassDefaultValue('Location', LOCATION_DEFAULT, 'class-default', 'Engine.StaticMeshActor')})
        self.assertTrue(all(answer == answers[0] for answer in answers))
        self.read_class_defaults.assert_called_once_with('Engine.StaticMeshActor', ['Location'], self.work_root, CLASS_SCRIPTS)

    def test_another_class_or_another_field_list_is_read_on_its_own(self):
        self.class_defaults.values('Engine.StaticMeshActor', ['Location'])
        self.class_defaults.values('Engine.StaticMeshActor', ['Location', 'Rotation'])
        self.class_defaults.values('Engine.Mover', ['Location'])
        self.class_defaults.values('Engine.Mover', ['Location'])
        self.assertEqual([call.args[:2] for call in self.read_class_defaults.call_args_list],
                         [('Engine.StaticMeshActor', ['Location']), ('Engine.StaticMeshActor', ['Location', 'Rotation']),
                          ('Engine.Mover', ['Location'])])

    def test_a_caller_that_changes_its_answer_does_not_change_the_next_answer(self):
        first = self.class_defaults.values('Engine.StaticMeshActor', ['Location'])
        first['Location'].value['X'] = 99.0
        del first['Location']
        self.assertEqual(self.class_defaults.values('Engine.StaticMeshActor', ['Location'])['Location'].value, LOCATION_DEFAULT)

    def test_an_unresolved_default_is_refused_every_time_with_the_same_message_and_read_once(self):
        refusals = []
        for _ in range(3):
            with self.assertRaises(ClassDefaultError) as refusal:
                self.class_defaults.values('Engine.StaticMeshActor', ['Missing'])
            refusals.append(refusal.exception)
        self.assertEqual([(type(refusal), str(refusal)) for refusal in refusals], [(ClassDefaultError, UNDECLARED_FIELD_MESSAGE)] * 3)
        self.assertEqual(len({id(refusal) for refusal in refusals}), 3)
        self.read_class_defaults.assert_called_once()

    def test_a_field_list_given_as_a_one_shot_iterable_is_read_with_all_its_fields(self):
        answer = self.class_defaults.values('Engine.StaticMeshActor', (name for name in ['Location', 'Rotation']))
        self.assertEqual(sorted(answer), ['Location', 'Rotation'])
        self.assertEqual(self.class_defaults.values('Engine.StaticMeshActor', ['Location', 'Rotation']), answer)
        self.read_class_defaults.assert_called_once_with('Engine.StaticMeshActor', ['Location', 'Rotation'], self.work_root, CLASS_SCRIPTS)

    def test_a_failure_that_is_not_a_class_default_refusal_is_not_kept_and_the_next_ask_reads_again(self):
        self.read_class_defaults.side_effect = [FormatError('Native package missing/ambiguous: Engine'),
                                                [ClassDefaultValue('Location', dict(LOCATION_DEFAULT), 'class-default', 'Engine.StaticMeshActor')]]
        with self.assertRaisesRegex(FormatError, 'Native package missing/ambiguous: Engine'):
            self.class_defaults.values('Engine.StaticMeshActor', ['Location'])
        self.assertEqual(self.class_defaults.values('Engine.StaticMeshActor', ['Location'])['Location'].value, LOCATION_DEFAULT)
        self.assertEqual(self.read_class_defaults.call_count, 2)

    def test_two_class_default_readers_of_one_cache_folder_share_one_frozen_read(self):
        first_answer = self.class_defaults.values('Engine.StaticMeshActor', ['Location'])
        second_answer = ClassDefaults(self.work_root, CLASS_SCRIPTS).values('Engine.StaticMeshActor', ['Location'])
        self.assertEqual(second_answer, first_answer)
        self.assertEqual(self.read_class_defaults.call_count, 1)


if __name__ == '__main__':
    unittest.main()
