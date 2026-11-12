from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_assets_lib.class_defaults import ClassDefaultError, ClassDefaultValue
from world import static_placement
from world.static_placement import ClassDefaults

WORK_ROOT = ROOT / 'artifacts' / 'lane-store' / 'world' / 'work'
CLASS_SCRIPTS = object()
LOCATION_DEFAULT = {'X': 1.0, 'Y': 2.0, 'Z': 3.0}
UNDECLARED_FIELD_MESSAGE = 'Missing is not declared by the class chain of Engine.StaticMeshActor'


def synthetic_class_defaults(class_name, fields, work_root, class_scripts):
    if 'Missing' in fields:
        raise ClassDefaultError(UNDECLARED_FIELD_MESSAGE)
    return [ClassDefaultValue(field, dict(LOCATION_DEFAULT), 'class-default', class_name) for field in fields]


class ClassDefaultLookupTests(unittest.TestCase):
    def setUp(self):
        reader = patch.object(static_placement, 'read_class_defaults_with_provenance', side_effect=synthetic_class_defaults)
        self.read_class_defaults = reader.start()
        self.addCleanup(reader.stop)
        self.class_defaults = ClassDefaults(WORK_ROOT, CLASS_SCRIPTS)

    def test_one_class_and_field_list_is_read_once_however_often_it_is_asked(self):
        answers = [self.class_defaults.values('Engine.StaticMeshActor', ['Location']) for _ in range(50)]
        self.assertEqual(answers[0], {'Location': ClassDefaultValue('Location', LOCATION_DEFAULT, 'class-default', 'Engine.StaticMeshActor')})
        self.assertTrue(all(answer == answers[0] for answer in answers))
        self.read_class_defaults.assert_called_once_with('Engine.StaticMeshActor', ['Location'], WORK_ROOT, CLASS_SCRIPTS)

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
        for _ in range(3):
            with self.assertRaises(ClassDefaultError) as refusal:
                self.class_defaults.values('Engine.StaticMeshActor', ['Missing'])
            self.assertEqual(str(refusal.exception), UNDECLARED_FIELD_MESSAGE)
        self.read_class_defaults.assert_called_once()

    def test_two_class_default_readers_do_not_share_answers(self):
        self.class_defaults.values('Engine.StaticMeshActor', ['Location'])
        ClassDefaults(WORK_ROOT, CLASS_SCRIPTS).values('Engine.StaticMeshActor', ['Location'])
        self.assertEqual(self.read_class_defaults.call_count, 2)


if __name__ == '__main__':
    unittest.main()
