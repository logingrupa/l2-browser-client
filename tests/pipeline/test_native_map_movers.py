import copy
import hashlib
import json
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
from native_assets import verify_archive
from native_catalog.ue2 import FormatError
from world.map_sources import MapSources
from native_map_movers import (ACTORS, MAP_SHA, MoverDefaults, collect_movers,
    endpoint_matrix, indexed_properties, qualified_classes)

CLIENT = ROOT/'artifacts/native-parity/inputs/IMPORTA-PC'
OUTPUT = ROOT/'artifacts/native-parity/research/native-door-movers-20261107/converted'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def transformed(matrix, point):
    return [sum(matrix[column*4+row]*point[column] for column in range(3)) + matrix[12+row]
            for row in range(3)]


def glb(raw):
    size = struct.unpack_from('<I', raw, 12)[0]
    return json.loads(raw[20:20+size]), raw[28+size:]


class MoverResolutionTests(unittest.TestCase):
    def test_omitted_fixed_array_index_means_zero_and_duplicates_are_refused(self):
        tags = [{'name': 'KeyRot', 'arrayIndex': None, 'value': {'Yaw': 0}},
                {'name': 'KeyRot', 'arrayIndex': 1, 'value': {'Yaw': -16384}}]
        props = indexed_properties(tags)
        self.assertEqual(props['KeyRot', 1]['value']['Yaw'], -16384)
        self.assertEqual(tags[0]['arrayIndex'], None)
        with self.assertRaisesRegex(FormatError, 'Duplicate'):
            indexed_properties(tags + [{'name': 'KeyRot', 'arrayIndex': 0}])
        with self.assertRaisesRegex(FormatError, 'outside declaration'):
            indexed_properties([{'name': 'KeyPos', 'arrayIndex': 8}])

    def test_nested_struct_field_does_not_override_actor_declaration(self):
        defaults = MoverDefaults({}, {'core.object': 'struct Test\n{\n\tvar Vector Location;\n};',
            'engine.actor': 'var(Movement) const Vector Location;\n'})
        self.assertEqual(defaults.declaration('Location', 'Vector'), 'engine.actor')

    def test_omission_requires_a_real_native_field_declaration(self):
        defaults = MoverDefaults({'engine.mover': {'properties': {}},
            'engine.actor': {'properties': {}}, 'core.object': {'properties': {}}},
            {'engine.mover': 'var Rotator KeyRot[8];\n'})
        value = defaults.resolve({}, 'KeyRot', 'Rotator', 0, 8)
        self.assertEqual(value['value'], {'Pitch': 0, 'Yaw': 0, 'Roll': 0})
        self.assertEqual(value['source'], 'native-declared-field-zero-init')
        with self.assertRaisesRegex(FormatError, 'declaration unresolved'):
            defaults.resolve({}, 'BaseRot', 'Rotator')

    def test_endpoint_preserves_authored_pivot_and_single_unit_conversion(self):
        transforms = {name: {'value': value} for name, value in {
            'Location': {'X': 0, 'Y': 0, 'Z': 0},
            'Rotation': {'Pitch': 0, 'Yaw': 0, 'Roll': 0},
            'PrePivot': {'X': 100, 'Y': 0, 'Z': 0},
            'DrawScale': 1, 'DrawScale3D': {'X': 1, 'Y': 1, 'Z': 1}}.items()}
        matrix = endpoint_matrix({'X': 1000, 'Y': 2000, 'Z': 3000},
            {'Pitch': 0, 'Yaw': 0, 'Roll': 0}, {'X': 0, 'Y': 0, 'Z': 0},
            {'Pitch': 0, 'Yaw': 16384, 'Roll': 0}, transforms)
        for actual, expected in zip(transformed(matrix, [1, 0, 0]), [10, 30, 20]):
            self.assertAlmostEqual(actual, expected)
        for actual, expected in zip(transformed(matrix, [2, 0, 0]), [10, 30, 21]):
            self.assertAlmostEqual(actual, expected)


@unittest.skipUnless((CLIENT/'maps/20_20.unr').is_file() and (OUTPUT/'movers.json').is_file(),
                     'Retained native client and isolated mover extraction required')
class RetainedMoverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.descriptor = json.loads((OUTPUT/'movers.json').read_text())
        cls.definitions = json.loads((OUTPUT/'class-evidence.json').read_text())
        cls.scripts = qualified_classes(cls.definitions, lambda name: (OUTPUT/name).read_bytes())
        cls.defaults = MoverDefaults(cls.definitions, cls.scripts)
        cls.movers, cls.meshes = collect_movers(MapSources(CLIENT), cls.defaults)
        cls.by_name = {mover['actorName']: mover for mover in cls.movers}

    def test_all_eight_exact_actors_two_meshes_and_server_ids_are_preserved(self):
        self.assertEqual(tuple(row['actorName'] for row in self.movers), ACTORS)
        self.assertEqual(len(self.meshes), 2)
        self.assertEqual(self.movers, self.descriptor['movers'])
        self.assertEqual({row['serverObject']['realId'] for row in self.movers}, set(range(20200001, 20200009)))
        self.assertTrue(all(row['serverObject']['type'] == 1 for row in self.movers))
        self.assertEqual(self.descriptor['sourceMap']['packageSha256'], MAP_SHA)

    def test_native_defaults_and_raw_indexed_keys_remain_distinguishable(self):
        for mover in self.movers:
            self.assertEqual(mover['moveTimeSeconds'], 1)
            self.assertTrue(mover['initiallyClosed'])
            self.assertEqual(mover['initialKey'], 0)
            self.assertEqual(mover['resolvedProperties']['NumKeys']['source'], 'Engine.Mover')
            self.assertEqual(mover['resolvedProperties']['MoveTime']['source'], 'Engine.Mover')
            self.assertEqual(mover['resolvedProperties']['StayOpenTime']['value'], 4)
            self.assertEqual(mover['keys'][0]['rotation']['source'], 'native-declared-field-zero-init')
            self.assertEqual([key['index'] for key in mover['keys']], list(range(8)))
            self.assertEqual(len(mover['meshGrades']), 7)
            self.assertEqual(len([key for key in mover['keys'] if key['active']]), 2)
        self.assertEqual(self.by_name['Mover194']['resolvedProperties']['Rotation']['source'],
                         'native-declared-field-zero-init')

    def test_all_hall_leaves_rotate_with_authored_sign_at_fixed_hinges(self):
        expected = {'Mover195': (-16384, [114.59, -34.54, 943.86], [0, 0, 1]),
                    'Mover194': (16384, [116.15, -34.54, 943.86], [0, 0, 1]),
                    'Mover193': (16384, [114.59, -34.54, 955.87], [0, 0, -1]),
                    'Mover192': (-16384, [116.15, -34.54, 955.87], [0, 0, -1])}
        for name, (yaw, origin, direction) in expected.items():
            mover = self.by_name[name]
            self.assertEqual(mover['keys'][1]['rotation']['value']['Yaw'], yaw)
            for matrix in (mover['closedMatrix'], mover['openMatrix']):
                for actual, target in zip(matrix[12:15], origin):
                    self.assertAlmostEqual(actual, target)
            tip = transformed(mover['openMatrix'], [1, 0, 0])
            for actual, base, delta in zip(tip, origin, direction):
                self.assertAlmostEqual(actual, base+delta)

    def test_other_door_pair_and_lifting_gates_are_preserved(self):
        for name, yaw in (('Mover61', 16384), ('Mover60', -16384)):
            self.assertEqual(self.by_name[name]['keys'][1]['rotation']['value']['Yaw'], yaw)
        for name in ('Mover1', 'Mover24'):
            mover = self.by_name[name]
            self.assertEqual(mover['keys'][1]['position']['value'], {'X': 0, 'Y': 0, 'Z': 136})
            self.assertAlmostEqual(mover['openMatrix'][13]-mover['closedMatrix'][13], 1.36)
            self.assertEqual(mover['openMatrix'][:12], mover['closedMatrix'][:12])
            self.assertEqual(mover['openMatrix'][12], mover['closedMatrix'][12])
            self.assertEqual(mover['openMatrix'][14], mover['closedMatrix'][14])

    def test_state_sentinels_never_become_transforms_and_sound_payloads_remain(self):
        raw_map = (OUTPUT/'source/map.unwrapped.bin').read_bytes()
        for mover in self.movers:
            raw = mover['rawProperties']
            self.assertEqual(next(prop['value'] for prop in raw if prop['name'] == 'SavedPos'),
                             {'X': -12345, 'Y': -12345, 'Z': -12345})
            self.assertTrue(all(abs(value) > 1 for value in mover['closedMatrix'][12:15]))
            self.assertTrue({'OpeningSound', 'OpenedSound', 'ClosingSound', 'ClosedSound', 'DamageSounds'} <=
                            {prop['name'] for prop in mover['sounds']})
            source = mover['source']
            block = raw_map[source['exportOffset']:source['exportOffset']+source['exportBytes']]
            self.assertEqual(sha(block), source['exportSha256'])
            for prop in raw:
                payload = prop['payload']
                self.assertEqual(sha(raw_map[payload['offset']:payload['offset']+payload['bytes']]), payload['sha256'])

    def test_changed_class_defaults_and_native_operators_are_rejected(self):
        definitions = copy.deepcopy(self.definitions)
        definitions['engine.mover']['properties']['MoveTime'] = 25
        with self.assertRaisesRegex(FormatError, 'disagree'):
            qualified_classes(definitions, lambda name: (OUTPUT/name).read_bytes())
        scripts = {name: (OUTPUT/definition['sourceScript']).read_bytes() for name, definition in self.definitions.items()}
        changed = scripts['core.object'].replace(b'native(316)', b'native(999)')
        definitions = copy.deepcopy(self.definitions)
        definitions['core.object']['sourceScriptSha256'] = sha(changed)
        values = {definition['sourceScript']: scripts[name] for name, definition in definitions.items()}
        values[definitions['core.object']['sourceScript']] = changed
        with self.assertRaisesRegex(FormatError, 'endpoint semantics'):
            qualified_classes(definitions, lambda name: values[name])

    def test_bundle_files_sources_and_model_archives_validate(self):
        receipt = json.loads((OUTPUT/'bundle.json').read_text())
        self.assertEqual(receipt['counts'], {'movers': 8, 'models': 2})
        for name, record in receipt['files'].items():
            value = (OUTPUT/name).read_bytes()
            self.assertEqual({'sha256': sha(value), 'bytes': len(value)}, record)
        for name, record in receipt['sourceFiles'].items():
            value = (CLIENT/name).read_bytes()
            self.assertEqual({'sha256': sha(value), 'bytes': len(value)}, record)
        for model in self.descriptor['models']:
            self.assertEqual(verify_archive(OUTPUT/model['archive']['file'])['id'], model['id'])

    def test_original_geometry_pngs_and_material_flags_are_unchanged(self):
        for model in self.descriptor['models']:
            doc, binary = glb((OUTPUT/model['model']['file']).read_bytes())
            evidence = OUTPUT/'.work/converter'/model['archive']['sha256']/'evidence/export'
            raw_geometry = list(evidence.rglob('*.bin'))
            self.assertEqual(len(raw_geometry), 1)
            self.assertTrue(binary.startswith(raw_geometry[0].read_bytes()))
            source_pngs = {path.read_bytes() for path in evidence.rglob('*.png')}
            for image in doc['images']:
                view = doc['bufferViews'][image['bufferView']]
                start = view.get('byteOffset', 0)
                self.assertIn(binary[start:start+view['byteLength']], source_pngs)
            for material in doc['materials']:
                self.assertEqual(material.get('alphaMode', 'OPAQUE'), 'OPAQUE')
                self.assertFalse(material.get('doubleSided', False))
                self.assertTrue(material['extras']['nativeSourceReference'].startswith('L2fortress_02_T.'))


if __name__ == '__main__':
    unittest.main()
