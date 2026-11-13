import hashlib
import json
from pathlib import Path
import struct
import sys
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_assets_lib.class_defaults import CLASS_DEFAULT_CACHE_FOLDER_NAME, DECOMPILE_WORK_FOLDER_NAME, ClassDefaultError
from native_catalog.ue2 import Package
from native_effect_bundle import object_values
from synthetic_class_scripts import SyntheticClassScripts, scratch_work_root
from ue2_package_fixture import compact, package_bytes, tag
from world.declared_property_types import DeclaredPropertyTypeError, DeclaredPropertyTypes, PropertyScope, struct_member_declarations
from world.struct_property_tag_rules import read_struct_property_tag_rules
from world.struct_property_values import StructPropertyValueError, decode_property_tags

BYTE_PROPERTY_TYPE = 1
INTEGER_PROPERTY_TYPE = 2
BOOL_PROPERTY_TYPE = 3
FLOAT_PROPERTY_TYPE = 4
OBJECT_PROPERTY_TYPE = 5
NAME_PROPERTY_TYPE = 6
ARRAY_PROPERTY_TYPE = 9
STRUCT_PROPERTY_TYPE = 10
ARRAY_FLAG = 0x80
BOOL_TRUE_BIT = 0x80
U8_SIZE_CODE = 5 << 4
OWNER_CLASS = 'Synthetic.Holder'
PROPERTY_NAMES = ['Range', 'RangeVector', 'Min', 'Max', 'X', 'Y', 'Z', 'Color', 'Rotator', 'Vector', 'Plane', 'Fog', 'Turn', 'Spot', 'Limits', 'Big',
                  'Flags', 'bOn', 'Slots', 'ColorInfo', 'Time', 'Tints', 'Infos', 'Weights', 'Switches', 'Strings', 'Unknowns', 'Count', 'Target', 'Tag',
                  'Labels', 'Modes', 'Sources', 'W']
IMPORTS = [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'Holder'), ('Core', 'Class', -1, 'Texture'), ('Engine', 'Texture', -1, 'Glow')]
HOLDER_CLASS_IMPORT = -2
GLOW_TEXTURE_IMPORT = -4
RULES = read_struct_property_tag_rules()


class SyntheticDeclaredTypes:
    def __init__(self, field_types, struct_members, enums=(), object_classes=()):
        self.field_types, self.struct_members, self.enums, self.object_classes = field_types, struct_members, set(enums), set(object_classes)

    def property_type(self, scope, name):
        types = self.field_types if scope.struct_name is None else self.struct_members.get(scope.struct_name, {})
        return types.get(name)

    def is_struct(self, scope, type_name):
        return type_name in self.struct_members

    def is_enum(self, scope, type_name):
        return type_name in self.enums

    def is_object_class(self, scope, type_name):
        return type_name in self.object_classes


DECLARED_TYPES = SyntheticDeclaredTypes(
    {'Infos': 'array<ColorInfo>', 'Weights': 'array<float>', 'Switches': 'array<bool>', 'Strings': 'array<string>', 'Unknowns': 'array<Mystery>',
     'Labels': 'array<name>', 'Modes': 'array<EMode>', 'Sources': 'array<Texture>', 'Limits': 'array<Range>'},
    {'Range': {'Min': 'float', 'Max': 'float'}, 'RangeVector': {'X': 'Range', 'Y': 'Range', 'Z': 'Range'},
     'ColorInfo': {'Time': 'float', 'Tints': 'array<Color>'}, 'Slots': {'Flags': 'int', 'bOn': 'bool'}},
    enums={'EMode'}, object_classes={'Texture'})


def float_tag(names, name, value):
    return tag(names, name, FLOAT_PROPERTY_TYPE, struct.pack('<f', value))


def range_body(names, minimum, maximum):
    return float_tag(names, 'Min', minimum) + float_tag(names, 'Max', maximum) + compact(names['None'])


def struct_tag(names, name, struct_name, body):
    return tag(names, name, STRUCT_PROPERTY_TYPE, body, struct_name)


def array_tag(names, name, count, elements):
    return tag(names, name, ARRAY_PROPERTY_TYPE, compact(count) + elements)


def indexed_float_tag(names, name, index_bytes, value):
    return compact(names[name]) + bytes([FLOAT_PROPERTY_TYPE | (2 << 4) | ARRAY_FLAG]) + index_bytes + struct.pack('<f', value)


def holder_package(body_of_names):
    exports = [{'name': 'Holder0', 'class': HOLDER_CLASS_IMPORT, 'body': lambda offset, names: body_of_names(names) + compact(names['None'])}]
    return Package(package_bytes(PROPERTY_NAMES, IMPORTS, exports), '00_00.unr')


def decoded_holder(body_of_names, declared_types=DECLARED_TYPES, package=None):
    package = holder_package(body_of_names) if package is None else package
    tags, reader = package.properties(package.exports[0])
    return decode_property_tags(package, tags, OWNER_CLASS, declared_types, RULES)


class TaggedStructTests(unittest.TestCase):
    def test_a_tagged_range_decodes_to_its_members_in_stream_order(self):
        values = decoded_holder(lambda names: struct_tag(names, 'Fog', 'Range', range_body(names, 3000.0, 4000.0)))
        self.assertEqual(list(values['Fog'].items()), [('Min', 3000.0), ('Max', 4000.0)])

    def test_a_range_vector_decodes_three_nested_ranges_each_with_its_own_none(self):
        body = lambda names: struct_tag(names, 'Spot', 'RangeVector', b''.join(
            struct_tag(names, axis, 'Range', range_body(names, 150.0, 150.0 + index)) for index, axis in enumerate('XYZ')) + compact(names['None']))
        self.assertEqual(decoded_holder(body)['Spot'], {axis: {'Min': 150.0, 'Max': 150.0 + index} for index, axis in enumerate('XYZ')})

    def test_a_struct_stream_that_ends_before_none_is_refused_with_its_path(self):
        body = lambda names: struct_tag(names, 'Fog', 'Range', float_tag(names, 'Min', 1.0))
        with self.assertRaisesRegex(StructPropertyValueError, r'^Fog at offset \d+: Missing property terminator'):
            decoded_holder(body)

    def test_bytes_after_the_none_of_a_struct_are_refused_with_its_path(self):
        body = lambda names: struct_tag(names, 'Spot', 'RangeVector', struct_tag(names, 'X', 'Range', range_body(names, 1.0, 2.0) + b'\x00')
                                        + compact(names['None']))
        with self.assertRaisesRegex(StructPropertyValueError, r'^Spot\.X at offset \d+: 1 bytes follow the Range value'):
            decoded_holder(body)

    def test_a_nested_bool_reads_bit_0x80_and_consumes_its_size_byte_and_array_indexes_place_static_members(self):
        def body(names):
            nested = (compact(names['bOn']) + bytes([BOOL_PROPERTY_TYPE | U8_SIZE_CODE | BOOL_TRUE_BIT, 0])
                      + indexed_float_tag(names, 'Flags', bytes([1]), 1.5) + indexed_float_tag(names, 'Flags', bytes([0x80, 0x02]), 2.5)
                      + indexed_float_tag(names, 'Flags', bytes([0xc0, 0x00, 0x00, 0x03]), 3.5) + compact(names['None']))
            return struct_tag(names, 'Big', 'Slots', nested)
        values = decoded_holder(body)['Big']
        self.assertIs(values['bOn'], True)
        self.assertEqual(values['Flags'][1], 1.5)
        self.assertEqual((values['Flags'][2], values['Flags'][3]), (2.5, 3.5))
        self.assertEqual(len(values['Flags']), 4)

    def test_a_tagged_struct_in_a_package_below_version_118_is_refused(self):
        package = holder_package(lambda names: struct_tag(names, 'Fog', 'Range', range_body(names, 1.0, 2.0)))
        package.summary = {**package.summary, 'version': 117}
        with self.assertRaisesRegex(StructPropertyValueError, 'tagged struct Range needs package version 118, the package is 117'):
            decoded_holder(None, package=package)


class BinaryStructTests(unittest.TestCase):
    def test_color_reads_blue_green_red_alpha_from_its_four_bytes(self):
        self.assertEqual(list(decoded_holder(lambda names: struct_tag(names, 'Fog', 'Color', bytes([10, 20, 30, 40])))['Fog'].items()),
                         [('B', 10), ('G', 20), ('R', 30), ('A', 40)])

    def test_rotator_reads_pitch_yaw_roll_int32_and_vector_reads_xyz_float32(self):
        values = decoded_holder(lambda names: struct_tag(names, 'Turn', 'Rotator', struct.pack('<iii', -16384, 32768, 7))
                                + struct_tag(names, 'Spot', 'Vector', struct.pack('<fff', 1.5, -2.0, 3.25)))
        self.assertEqual(values['Turn'], {'Pitch': -16384, 'Yaw': 32768, 'Roll': 7})
        self.assertEqual(values['Spot'], {'X': 1.5, 'Y': -2.0, 'Z': 3.25})

    def test_a_binary_struct_of_another_size_is_refused(self):
        with self.assertRaisesRegex(StructPropertyValueError, r'^Fog at offset \d+: 1 bytes follow the Color value'):
            decoded_holder(lambda names: struct_tag(names, 'Fog', 'Color', bytes([1, 2, 3, 4, 5])))
        with self.assertRaisesRegex(StructPropertyValueError, 'binary Rotator needs 12 bytes, 8 remain'):
            decoded_holder(lambda names: struct_tag(names, 'Turn', 'Rotator', struct.pack('<ii', 1, 2)))


class DynamicArrayTests(unittest.TestCase):
    def test_an_array_of_a_declared_tagged_struct_with_an_array_of_color_member_decodes(self):
        def body(names):
            first = float_tag(names, 'Time', 0.5) + array_tag(names, 'Tints', 2, bytes([1, 2, 3, 4, 5, 6, 7, 8])) + compact(names['None'])
            second = float_tag(names, 'Time', 1.0) + compact(names['None'])
            return array_tag(names, 'Infos', 2, first + second)
        self.assertEqual(decoded_holder(body)['Infos'], [{'Time': 0.5, 'Tints': [{'B': 1, 'G': 2, 'R': 3, 'A': 4}, {'B': 5, 'G': 6, 'R': 7, 'A': 8}]},
                                                          {'Time': 1.0}])

    def test_float_name_enum_object_and_binary_struct_arrays_decode(self):
        def body(names):
            return (array_tag(names, 'Weights', 2, struct.pack('<ff', 0.25, 4.0)) + array_tag(names, 'Labels', 1, compact(names['Tag']))
                    + array_tag(names, 'Modes', 2, bytes([2, 0])) + array_tag(names, 'Sources', 2, compact(GLOW_TEXTURE_IMPORT) + compact(0))
                    + array_tag(names, 'Limits', 1, range_body(names, 5.0, 6.0)))
        values = decoded_holder(body)
        self.assertEqual((values['Weights'], values['Labels'], values['Modes']), ([0.25, 4.0], ['Tag'], [2, 0]))
        self.assertEqual(values['Sources'], [{'class': 'Object', 'object': 'Engine.Glow'}, None])
        self.assertEqual(values['Limits'], [{'Min': 5.0, 'Max': 6.0}])

    def test_an_array_of_bool_or_of_an_unresolved_inner_type_stays_the_unparsed_record_at_its_path(self):
        def body(names):
            return (array_tag(names, 'Switches', 1, b'\x01') + array_tag(names, 'Strings', 1, compact(1) + b'\x00')
                    + array_tag(names, 'Unknowns', 1, b'\x07') + array_tag(names, 'Count', 1, b'\x07'))
        values = decoded_holder(body)
        self.assertEqual(values['Switches'], {'unparsedHex': '0101', 'type': ARRAY_PROPERTY_TYPE, 'struct': None})
        self.assertEqual(values['Strings']['unparsedHex'], '010100')
        self.assertEqual(values['Unknowns']['unparsedHex'], '0107')
        self.assertEqual(values['Count']['unparsedHex'], '0107')

    def test_an_array_that_leaves_bytes_after_its_elements_is_refused_with_its_path(self):
        with self.assertRaisesRegex(StructPropertyValueError, r'^Weights at offset \d+: 1 bytes follow its 1 elements'):
            decoded_holder(lambda names: array_tag(names, 'Weights', 1, struct.pack('<f', 1.0) + b'\x00'))

    def test_scalar_and_object_values_stay_equal_to_the_frozen_object_values(self):
        def body(names):
            return (tag(names, 'Count', INTEGER_PROPERTY_TYPE, struct.pack('<i', 9)) + tag(names, 'Target', OBJECT_PROPERTY_TYPE, compact(GLOW_TEXTURE_IMPORT))
                    + tag(names, 'Tag', NAME_PROPERTY_TYPE, compact(names['Fog'])) + tag(names, 'Modes', BYTE_PROPERTY_TYPE, bytes([3]))
                    + struct_tag(names, 'Spot', 'Vector', struct.pack('<fff', 1.0, 2.0, 3.0)))
        package = holder_package(body)
        tags, _ = package.properties(package.exports[0])
        self.assertEqual(json.dumps(decode_property_tags(package, tags, OWNER_CLASS, DECLARED_TYPES, RULES)), json.dumps(object_values(package, tags)))


SCRIPT_WITH_STRUCTS = '''class Holder extends Object
\tnative;

// struct Ghost { var int Hidden; };
struct native export ColorInfo
{
\tvar() float Time; /* a block comment with struct Fake { } inside */
\tvar() config array<Color> Tints, Halos;
};

struct Plane extends Object.Vector
{
\tvar() config float W;
};

var() array<ColorInfo> Infos;

defaultproperties
{
}
'''
OBJECT_SCRIPT = '''class Object;

struct Vector
{
\tvar() config float X;
\tvar() config float Y;
\tvar() config float Z;
};

enum EMode
{
\tMODE_A,
\tMODE_B
};
'''


class RefusingSyntheticClassScripts(SyntheticClassScripts):
    def class_identity(self, class_object):
        if class_object not in self.scripts_by_class:
            raise ClassDefaultError(f'class {class_object} does not resolve to an exact qualified export')
        return super().class_identity(class_object)


def write_decompiled_script(work_root, class_object, script_text, recorded_sha256=None):
    folder = Path(work_root) / CLASS_DEFAULT_CACHE_FOLDER_NAME / DECOMPILE_WORK_FOLDER_NAME / class_object
    (folder / 'scripts').mkdir(parents=True, exist_ok=True)
    script_bytes = script_text.encode('utf-8')
    (folder / 'scripts' / f'{class_object}.uc').write_bytes(script_bytes)
    metadata = {'sourceScript': f'scripts/{class_object}.uc', 'sourceScriptSha256': recorded_sha256 or hashlib.sha256(script_bytes).hexdigest()}
    (folder / 'defaults.json').write_text(json.dumps(metadata), encoding='utf-8')


class DeclaredPropertyTypeTests(unittest.TestCase):
    def declared_types(self, holder_script=SCRIPT_WITH_STRUCTS, recorded_sha256=None):
        work_root = scratch_work_root(self, 'declared-types-')
        class_scripts = RefusingSyntheticClassScripts({OWNER_CLASS: ('Core.Object', holder_script), 'Core.Object': (None, OBJECT_SCRIPT),
                                                        'Core.Texture': ('Core.Object', 'class Texture extends Object;')})
        class_scripts.client_root = work_root
        write_decompiled_script(work_root, OWNER_CLASS, holder_script, recorded_sha256)
        write_decompiled_script(work_root, 'Core.Object', OBJECT_SCRIPT)
        return DeclaredPropertyTypes(SimpleNamespace(work_root=work_root, class_scripts=class_scripts))

    def test_struct_bodies_are_read_with_modifiers_comments_and_parents(self):
        structs = struct_member_declarations(SCRIPT_WITH_STRUCTS)
        self.assertEqual(sorted(structs), ['colorinfo', 'plane'])
        self.assertEqual(structs['colorinfo'].members, (('Time', 'float'), ('Tints', 'config array<Color>'), ('Halos', 'config array<Color>')))
        self.assertEqual((structs['plane'].parent, structs['plane'].members), ('Vector', (('W', 'config float'),)))

    def test_field_and_member_types_come_from_the_class_chain_scripts(self):
        types = self.declared_types()
        holder, color_info, plane = PropertyScope(OWNER_CLASS, None), PropertyScope(OWNER_CLASS, 'ColorInfo'), PropertyScope(OWNER_CLASS, 'Plane')
        self.assertEqual(types.property_type(holder, 'infos'), 'array<ColorInfo>')
        self.assertEqual((types.property_type(color_info, 'Tints'), types.property_type(color_info, 'Time')), ('array<Color>', 'float'))
        self.assertEqual([types.property_type(plane, member) for member in ('W', 'X', 'Z')], ['float', 'float', 'float'])
        self.assertTrue(types.is_struct(holder, 'Vector') and types.is_enum(holder, 'EMode') and types.is_enum(holder, 'Object.EMode'))
        self.assertFalse(types.is_struct(holder, 'Mystery') or types.is_enum(holder, 'Holder.EMode'))
        self.assertEqual([types.is_object_class(holder, name) for name in ('Texture', 'class<Actor>', 'Mystery')], [True, True, False])

    def test_a_script_that_differs_from_its_defaults_json_sha256_is_refused(self):
        types = self.declared_types(recorded_sha256='0' * 64)
        with self.assertRaisesRegex(DeclaredPropertyTypeError, 'differs from the sourceScriptSha256 of its defaults.json'):
            types.is_struct(PropertyScope(OWNER_CLASS, None), 'ColorInfo')

    def test_a_script_that_differs_from_its_cached_class_definition_is_refused(self):
        types = self.declared_types()
        types.property_type(PropertyScope(OWNER_CLASS, None), 'Infos')
        write_decompiled_script(types.class_defaults.work_root, OWNER_CLASS, SCRIPT_WITH_STRUCTS.replace('float W', 'int W'))
        with self.assertRaisesRegex(DeclaredPropertyTypeError, 'differs from the scriptSha256 of its cached class definition'):
            types.is_struct(PropertyScope(OWNER_CLASS, None), 'Plane')

    def test_an_unreadable_class_chain_resolves_no_type(self):
        types = self.declared_types()
        scope = PropertyScope('Synthetic.Missing', None)
        self.assertEqual((types.property_type(scope, 'Infos'), types.is_struct(scope, 'Vector'), types.is_enum(scope, 'EMode')), (None, False, False))


if __name__ == '__main__':
    unittest.main()
