from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_assets_lib.class_defaults import (CLASS_DEFAULT_PROVENANCES, ClassDefaultError, ClassDefaultValue,
                                              ReferenceClientClassScripts, declared_fields, read_class_defaults_with_provenance,
                                              read_class_field_declarations)
from native_catalog.effects import UELIB
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH
from synthetic_class_scripts import SyntheticClassScripts, scratch_work_root

CONVERSION_CLIENT_ROOT = Path('E:/Lineage2-client')

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


def synthetic_chain_scripts(scripts_by_class=None):
    return SyntheticClassScripts(SYNTHETIC_CLASS_SCRIPTS if scripts_by_class is None else scripts_by_class)


def values_by_field(values):
    return {value.field: value.to_record() for value in values}


class SyntheticClassChainTests(unittest.TestCase):
    def test_leaf_middle_and_unset_fields_carry_authored_class_default_and_ue_zero(self):
        values = read_class_defaults_with_provenance('Synthetic.Leaf', ['FieldA', 'FieldB', 'FieldC'], scratch_work_root(self, 'class-defaults-'),
                                                     synthetic_chain_scripts())
        self.assertEqual(CLASS_DEFAULT_PROVENANCES, ('authored', 'class-default', 'ue-zero'))
        self.assertTrue(all(isinstance(value, ClassDefaultValue) for value in values))
        self.assertEqual(values_by_field(values), {
            'FieldA': {'field': 'FieldA', 'value': 1.5, 'provenance': 'authored', 'declaringClass': 'Synthetic.Leaf'},
            'FieldB': {'field': 'FieldB', 'value': 7, 'provenance': 'class-default', 'declaringClass': 'Synthetic.Middle'},
            'FieldC': {'field': 'FieldC', 'value': None, 'provenance': 'ue-zero', 'declaringClass': 'Synthetic.Base'},
        })

    def test_struct_and_array_defaults_inherit_member_by_member(self):
        values = read_class_defaults_with_provenance('Synthetic.Leaf', ['Scale', 'Values', 'OtherScale'], scratch_work_root(self, 'class-defaults-'),
                                                     synthetic_chain_scripts())
        self.assertEqual(values_by_field(values), {
            'Scale': {'field': 'Scale', 'value': {'X': 3.0, 'Y': 2.0}, 'provenance': 'authored', 'declaringClass': 'Synthetic.Leaf'},
            'Values': {'field': 'Values', 'value': [None, 5.0, 6.0], 'provenance': 'authored', 'declaringClass': 'Synthetic.Leaf'},
            'OtherScale': {'field': 'OtherScale', 'value': None, 'provenance': 'ue-zero', 'declaringClass': 'Synthetic.Base'},
        })

    def test_a_redeclared_field_shadows_the_ancestor_declaration_and_its_default(self):
        scripts = {'Synthetic.Base': (None, 'class Base;\nvar byte Shadowed;\nvar int Kept;\ndefaultproperties\n{\n    Shadowed=3\n}\n'),
                   'Synthetic.Leaf': ('Synthetic.Base', 'class Leaf extends Base;\nvar() byte Shadowed;\n')}
        work_root = scratch_work_root(self, 'class-defaults-')
        values = read_class_defaults_with_provenance('Synthetic.Leaf', ['Shadowed'], work_root, synthetic_chain_scripts(scripts))
        self.assertEqual(values_by_field(values)['Shadowed'],
                         {'field': 'Shadowed', 'value': None, 'provenance': 'ue-zero', 'declaringClass': 'Synthetic.Leaf'})
        declarations = read_class_field_declarations('Synthetic.Leaf', work_root, synthetic_chain_scripts(scripts))
        self.assertEqual([(declaration.field, declaration.declaring_class) for declaration in declarations],
                         [('Kept', 'Synthetic.Base'), ('Shadowed', 'Synthetic.Leaf')])

    def test_a_field_the_chain_does_not_declare_is_refused(self):
        for field in ('NestedOnly', 'NotAField', 'Invented'):
            with self.subTest(field=field), self.assertRaisesRegex(ClassDefaultError, 'not declared'):
                read_class_defaults_with_provenance('Synthetic.Leaf', [field], scratch_work_root(self, 'class-defaults-'), synthetic_chain_scripts())

    def test_malformed_requests_and_chains_are_refused(self):
        cyclic = {'Synthetic.Leaf': ('Synthetic.Middle', 'class Leaf extends Middle;\n'),
                  'Synthetic.Middle': ('Synthetic.Leaf', 'class Middle extends Leaf;\n')}
        mismatched = {'Synthetic.Leaf': ('Synthetic.Base', 'class Leaf extends Middle;\n'),
                      'Synthetic.Base': (None, 'class Base;\n')}
        unparsed = {'Synthetic.Leaf': (None, 'class Leaf;\nvar int FieldA;\ndefaultproperties\n{\n    FieldA=+-\n}\n')}
        refused = {
            'empty field list': ('Synthetic.Leaf', [], synthetic_chain_scripts(), 'field list'),
            'repeated field': ('Synthetic.Leaf', ['FieldA', 'fielda'], synthetic_chain_scripts(), 'field list'),
            'unqualified class': ('Leaf', ['FieldA'], synthetic_chain_scripts(), 'qualified'),
            'cyclic chain': ('Synthetic.Leaf', ['FieldA'], synthetic_chain_scripts(cyclic), 'Cyclic'),
            'decompiled superclass differs': ('Synthetic.Leaf', ['FieldA'], synthetic_chain_scripts(mismatched), 'superclass'),
            'unparsed default': ('Synthetic.Leaf', ['FieldA'], synthetic_chain_scripts(unparsed), 'unparsed'),
        }
        for case, (class_name, fields, class_scripts, message) in refused.items():
            with self.subTest(case=case), self.assertRaisesRegex(ClassDefaultError, message):
                read_class_defaults_with_provenance(class_name, fields, scratch_work_root(self, 'class-defaults-'), class_scripts)

    def test_the_work_root_must_be_a_converter_output(self):
        with tempfile.TemporaryDirectory() as outside_artifacts, self.assertRaisesRegex(ValueError, 'artifacts'):
            read_class_defaults_with_provenance('Synthetic.Leaf', ['FieldA'], outside_artifacts, synthetic_chain_scripts())

    def test_the_cache_is_written_once_and_reused_until_the_source_identity_changes(self):
        work_root = scratch_work_root(self, 'class-defaults-')
        class_scripts = synthetic_chain_scripts()
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

    def test_declared_fields_reads_only_top_level_variables_with_their_types(self):
        self.assertEqual(declared_fields(SYNTHETIC_CLASS_SCRIPTS['Synthetic.Base'][1]), [
            {'name': 'FieldC', 'type': 'bool'}, {'name': 'FieldB', 'type': 'int'}, {'name': 'Scale', 'type': 'ScaleRecord'},
            {'name': 'OtherScale', 'type': 'ScaleRecord'}, {'name': 'Values', 'type': 'float'}])
        self.assertEqual(declared_fields('class X;\nvar() config bool bBlockPlayers; // var int Commented;\n'
                                         'var() editinlineuse array<editinlineuse Material> Materials;\n'
                                         'var enum EKind { KIND_A, KIND_B } Kind;\n'), [
            {'name': 'bBlockPlayers', 'type': 'config bool'},
            {'name': 'Materials', 'type': 'editinlineuse array<editinlineuse Material>'},
            {'name': 'Kind', 'type': 'enum EKind'}])

    def test_field_declarations_list_the_chain_root_first_with_enum_members(self):
        scripts = dict(SYNTHETIC_CLASS_SCRIPTS)
        scripts['Synthetic.Leaf'] = ('Synthetic.Middle', 'class Leaf extends Middle;\nenum EBlend\n{\n    BLEND_None,// 0\n'
                                     '    BLEND_Add // 1\n};\nvar() Leaf.EBlend Blend;\nvar Missing.EOther Other;\n')
        declarations = read_class_field_declarations('Synthetic.Leaf', scratch_work_root(self, 'class-defaults-'), synthetic_chain_scripts(scripts))
        self.assertEqual([declaration.to_record() for declaration in declarations], [
            {'field': 'FieldC', 'declaredType': 'bool', 'declaringClass': 'Synthetic.Base', 'enumMembers': None},
            {'field': 'FieldB', 'declaredType': 'int', 'declaringClass': 'Synthetic.Base', 'enumMembers': None},
            {'field': 'Scale', 'declaredType': 'ScaleRecord', 'declaringClass': 'Synthetic.Base', 'enumMembers': None},
            {'field': 'OtherScale', 'declaredType': 'ScaleRecord', 'declaringClass': 'Synthetic.Base', 'enumMembers': None},
            {'field': 'Values', 'declaredType': 'float', 'declaringClass': 'Synthetic.Base', 'enumMembers': None},
            {'field': 'Blend', 'declaredType': 'Leaf.EBlend', 'declaringClass': 'Synthetic.Leaf', 'enumMembers': ['BLEND_None', 'BLEND_Add']},
            {'field': 'Other', 'declaredType': 'Missing.EOther', 'declaringClass': 'Synthetic.Leaf', 'enumMembers': None},
        ])


@unittest.skipUnless(CONVERSION_CLIENT_ROOT.is_dir() and REFERENCE_CLIENT_LOCK_PATH.is_file() and UELIB.is_file(),
                     'needs --client E:/Lineage2-client, the committed reference client lock and the pinned UELib')
class ReferenceClientClassDefaultTests(unittest.TestCase):
    def test_static_mesh_actor_block_players_comes_with_its_provenance(self):
        values = read_class_defaults_with_provenance('Engine.StaticMeshActor', ['bBlockPlayers'], scratch_work_root(self, 'class-defaults-'),
                                                     ReferenceClientClassScripts(CONVERSION_CLIENT_ROOT))
        self.assertEqual([value.to_record() for value in values],
                         [{'field': 'bBlockPlayers', 'value': True, 'provenance': 'authored', 'declaringClass': 'Engine.StaticMeshActor'}])

    def test_final_blend_frame_buffer_blending_declares_its_enum_members(self):
        declarations = read_class_field_declarations('Engine.FinalBlend', scratch_work_root(self, 'class-defaults-'),
                                                     ReferenceClientClassScripts(CONVERSION_CLIENT_ROOT))
        frame_buffer_blending = next(declaration for declaration in declarations if declaration.field == 'FrameBufferBlending')
        self.assertEqual(frame_buffer_blending.declaring_class, 'Engine.FinalBlend')
        self.assertEqual(frame_buffer_blending.enum_members[8], 'FB_Add')


if __name__ == '__main__':
    unittest.main()
