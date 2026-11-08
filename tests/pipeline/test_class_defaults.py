from __future__ import annotations

from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_assets_lib.class_defaults import (CLASS_DEFAULT_PROVENANCES, ClassDefaultError, ClassDefaultValue,
                                              ReferenceClientClassScripts, declared_field_names,
                                              read_class_defaults_with_provenance)
from native_catalog.effects import UELIB
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH

CONVERSION_CLIENT_ROOT = Path('E:/Lineage2-client')
TEST_SCRATCH_ROOT = ROOT / 'artifacts' / 'test-scratch'

SYNTHETIC_CLASS_SCRIPTS = {
    'Synthetic.Base': (None, '''class Base;

struct ScaleRecord
{
    var float NestedOnly;
};

var bool FieldC;
var int FieldB;
var ScaleRecord Scale, OtherScale;
var float Values[4];

defaultproperties
{
    Scale=(X=1.000000,Y=2.000000)
}
'''),
    'Synthetic.Middle': ('Synthetic.Base', '''class Middle extends Base;

defaultproperties
{
    FieldB=7
    Values[1]=5.000000
}
'''),
    'Synthetic.Leaf': ('Synthetic.Middle', '''class Leaf extends Middle;

var float FieldA;

function Ignored()
{
    local int NotAField;
}

defaultproperties
{
    FieldA=1.500000
    Scale=(X=3.000000)
    Values[2]=6.000000
}
'''),
}


class SyntheticClassScripts:
    def __init__(self, scripts_by_class=None):
        self.scripts_by_class = dict(SYNTHETIC_CLASS_SCRIPTS if scripts_by_class is None else scripts_by_class)
        self.decompiled_classes = []
        self.package_sha256 = 'a' * 64

    def class_identity(self, class_object):
        super_class, _ = self.scripts_by_class[class_object]
        return {'object': class_object, 'superClass': super_class, 'package': 'system/Synthetic.u',
                'packageSha256': self.package_sha256}

    def decompile_class_script(self, class_object, work_directory):
        self.decompiled_classes.append(class_object)
        return self.scripts_by_class[class_object][1]


def scratch_work_root(test_case):
    TEST_SCRATCH_ROOT.mkdir(parents=True, exist_ok=True)
    work_root = Path(tempfile.mkdtemp(prefix='class-defaults-', dir=TEST_SCRATCH_ROOT))
    test_case.addCleanup(shutil.rmtree, work_root, True)
    return work_root


def values_by_field(values):
    return {value.field: value.to_record() for value in values}


class SyntheticClassChainTests(unittest.TestCase):
    def test_leaf_middle_and_unset_fields_carry_authored_class_default_and_ue_zero(self):
        values = read_class_defaults_with_provenance('Synthetic.Leaf', ['FieldA', 'FieldB', 'FieldC'], scratch_work_root(self),
                                                     SyntheticClassScripts())
        self.assertEqual(CLASS_DEFAULT_PROVENANCES, ('authored', 'class-default', 'ue-zero'))
        self.assertTrue(all(isinstance(value, ClassDefaultValue) for value in values))
        self.assertEqual(values_by_field(values), {
            'FieldA': {'field': 'FieldA', 'value': 1.5, 'provenance': 'authored', 'declaringClass': 'Synthetic.Leaf'},
            'FieldB': {'field': 'FieldB', 'value': 7, 'provenance': 'class-default', 'declaringClass': 'Synthetic.Middle'},
            'FieldC': {'field': 'FieldC', 'value': None, 'provenance': 'ue-zero', 'declaringClass': 'Synthetic.Base'},
        })

    def test_struct_and_array_defaults_inherit_member_by_member(self):
        values = read_class_defaults_with_provenance('Synthetic.Leaf', ['Scale', 'Values', 'OtherScale'], scratch_work_root(self),
                                                     SyntheticClassScripts())
        self.assertEqual(values_by_field(values), {
            'Scale': {'field': 'Scale', 'value': {'X': 3.0, 'Y': 2.0}, 'provenance': 'authored', 'declaringClass': 'Synthetic.Leaf'},
            'Values': {'field': 'Values', 'value': [None, 5.0, 6.0], 'provenance': 'authored', 'declaringClass': 'Synthetic.Leaf'},
            'OtherScale': {'field': 'OtherScale', 'value': None, 'provenance': 'ue-zero', 'declaringClass': 'Synthetic.Base'},
        })

    def test_a_field_the_chain_does_not_declare_is_refused(self):
        for field in ('NestedOnly', 'NotAField', 'Invented'):
            with self.subTest(field=field), self.assertRaisesRegex(ClassDefaultError, 'not declared'):
                read_class_defaults_with_provenance('Synthetic.Leaf', [field], scratch_work_root(self), SyntheticClassScripts())

    def test_malformed_requests_and_chains_are_refused(self):
        cyclic = {'Synthetic.Leaf': ('Synthetic.Middle', 'class Leaf extends Middle;\n'),
                  'Synthetic.Middle': ('Synthetic.Leaf', 'class Middle extends Leaf;\n')}
        mismatched = {'Synthetic.Leaf': ('Synthetic.Base', 'class Leaf extends Middle;\n'),
                      'Synthetic.Base': (None, 'class Base;\n')}
        unparsed = {'Synthetic.Leaf': (None, 'class Leaf;\nvar int FieldA;\ndefaultproperties\n{\n    FieldA=+-\n}\n')}
        refused = {
            'empty field list': ('Synthetic.Leaf', [], SyntheticClassScripts(), 'field list'),
            'repeated field': ('Synthetic.Leaf', ['FieldA', 'fielda'], SyntheticClassScripts(), 'field list'),
            'unqualified class': ('Leaf', ['FieldA'], SyntheticClassScripts(), 'qualified'),
            'cyclic chain': ('Synthetic.Leaf', ['FieldA'], SyntheticClassScripts(cyclic), 'Cyclic'),
            'decompiled superclass differs': ('Synthetic.Leaf', ['FieldA'], SyntheticClassScripts(mismatched), 'superclass'),
            'unparsed default': ('Synthetic.Leaf', ['FieldA'], SyntheticClassScripts(unparsed), 'unparsed'),
        }
        for case, (class_name, fields, class_scripts, message) in refused.items():
            with self.subTest(case=case), self.assertRaisesRegex(ClassDefaultError, message):
                read_class_defaults_with_provenance(class_name, fields, scratch_work_root(self), class_scripts)

    def test_the_work_root_must_be_a_converter_output(self):
        with tempfile.TemporaryDirectory() as outside_artifacts, self.assertRaisesRegex(ValueError, 'artifacts'):
            read_class_defaults_with_provenance('Synthetic.Leaf', ['FieldA'], outside_artifacts, SyntheticClassScripts())

    def test_the_cache_is_written_once_and_reused_until_the_source_identity_changes(self):
        work_root = scratch_work_root(self)
        class_scripts = SyntheticClassScripts()
        first = read_class_defaults_with_provenance('Synthetic.Leaf', ['FieldA', 'FieldB'], work_root, class_scripts)
        self.assertEqual(class_scripts.decompiled_classes, ['Synthetic.Leaf', 'Synthetic.Middle', 'Synthetic.Base'])
        cache_names = sorted(path.name for path in (work_root / 'class-defaults').glob('*.json'))
        self.assertEqual(cache_names, ['Synthetic.Base.json', 'Synthetic.Leaf.json', 'Synthetic.Middle.json'])
        second = read_class_defaults_with_provenance('Synthetic.Leaf', ['FieldA', 'FieldB'], work_root, class_scripts)
        self.assertEqual(second, first)
        self.assertEqual(len(class_scripts.decompiled_classes), 3)
        class_scripts.package_sha256 = 'b' * 64
        read_class_defaults_with_provenance('Synthetic.Middle', ['FieldB'], work_root, class_scripts)
        self.assertEqual(class_scripts.decompiled_classes[3:], ['Synthetic.Middle', 'Synthetic.Base'])

    def test_declared_field_names_reads_only_top_level_variables(self):
        self.assertEqual(declared_field_names(SYNTHETIC_CLASS_SCRIPTS['Synthetic.Base'][1]),
                         {'fieldc', 'fieldb', 'scale', 'otherscale', 'values'})
        self.assertEqual(declared_field_names('class X;\nvar() config bool bBlockPlayers; // var int Commented;\n'
                                              'var array<Material> Materials;\nvar enum EKind { KIND_A, KIND_B } Kind;\n'),
                         {'bblockplayers', 'materials', 'kind'})


@unittest.skipUnless(CONVERSION_CLIENT_ROOT.is_dir() and REFERENCE_CLIENT_LOCK_PATH.is_file() and UELIB.is_file(),
                     'needs --client E:/Lineage2-client, the committed reference client lock and the pinned UELib')
class ReferenceClientClassDefaultTests(unittest.TestCase):
    def test_static_mesh_actor_block_players_comes_with_its_provenance(self):
        values = read_class_defaults_with_provenance('Engine.StaticMeshActor', ['bBlockPlayers'], scratch_work_root(self),
                                                     ReferenceClientClassScripts(CONVERSION_CLIENT_ROOT))
        self.assertEqual([value.to_record() for value in values],
                         [{'field': 'bBlockPlayers', 'value': True, 'provenance': 'authored', 'declaringClass': 'Engine.StaticMeshActor'}])


if __name__ == '__main__':
    unittest.main()
