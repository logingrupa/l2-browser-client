import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets import Converter
from native_assets_lib.animation import add_animations, decode_tracks
from native_assets_lib.gltf import Document
from native_catalog.tables import (
    CRYPTO_SOURCE, MTX_DEFINITION_EVIDENCE, RGBA_DEFINITION_EVIDENCE, SCHEMA_ROOT, decode_table,
    read_nodes, read_value, table_definition_pins, table_source_path,
)
from native_catalog.ue2 import FormatError, Package, Reader, animation_layout
from reference_client_guard import ENGINE_LIBRARY_RELATIVE_PATH
from reference_client_lock_fixture import lock_client_as_reference_root

CLIENT = ROOT / 'artifacts/native-parity/inputs/IMPORTA-PC'
PSA = ROOT / 'artifacts/native-parity/research/field-stalker-source/psa/LineageMonsters/field_stalker_anim.psa'
RESULTS = ROOT / 'artifacts/native-parity/research/musveren-equipment/conversion-results.json'


def umodel_psa_parity_at_original_integer_frame_keys(animation, motions, data):
    position, chunks = 0, {}
    while position < len(data):
        name, _, size, count = struct.unpack_from('<20siii', data, position)
        position += 32
        if size < 0 or count < 0 or position + size * count > len(data):
            raise ValueError('Invalid independent PSA chunk boundaries')
        chunks[name.split(b'\0')[0].decode()] = (position, size, count)
        position += size * count
    info_offset, info_size, clip_count = chunks['ANIMINFO']
    keys_offset, key_size, key_count = chunks['ANIMKEYS']
    if clip_count != len(animation['sequences']) or key_size != 32:
        raise ValueError('Independent PSA layout or clip count differs')
    results = []
    for clip_index, (sequence, metadata, motion) in enumerate(zip(animation['sequences'], animation['motionMetadata'], motions)):
        fields = struct.unpack_from('<64s64s4i3f3i', data, info_offset + clip_index * info_size)
        name, bones, rate, first_frame, frames = fields[0].split(b'\0')[0].decode(), fields[2], fields[8], fields[10], fields[11]
        if (name, bones, rate, frames) != (sequence['name'], len(animation['bones']), sequence['rate'], sequence['numFrames']):
            raise ValueError('Independent PSA sequence metadata differs')
        result = {'clip': name, 'sourceFrames': frames, 'sourceRate': rate,
                  'sourceDurationSeconds': sequence['sourceDurationSeconds'],
                  'comparedKeys': 0, 'maxTranslationErrorSourceUnits': 0, 'maxQuaternionComponentError': 0}
        for bone, track in enumerate(motion['tracks']):
            for kind, values in [('translations', track['translations']), ('rotations', track['rotations'])]:
                for key, value in enumerate(values):
                    time = key * frames / len(values) if len(values) == 1 or not track['times'] else track['times'][key] * frames / metadata['trackTime']
                    frame = round(time)
                    if abs(frame - time) > 1e-5 or not 0 <= frame < frames:
                        continue
                    sample_index = (first_frame + frame) * bones + bone
                    if sample_index >= key_count:
                        raise ValueError('PSA sample exceeds declared chunk')
                    sample = struct.unpack_from('<8f', data, keys_offset + sample_index * key_size)
                    expected = (value[0], -value[1], value[2]) if kind == 'translations' else (value[0], -value[1], value[2], -value[3])
                    actual = sample[:3] if kind == 'translations' else sample[3:7]
                    error = max(abs(a - b) for a, b in zip(actual, expected))
                    if kind == 'rotations':
                        error = min(error, max(abs(a + b) for a, b in zip(actual, expected)))
                    metric = 'maxTranslationErrorSourceUnits' if kind == 'translations' else 'maxQuaternionComponentError'
                    result[metric] = max(result[metric], error)
                    result['comparedKeys'] += 1
        results.append(result)
    return results


class PresentationFormatTests(unittest.TestCase):
    def test_rgba_retains_all_four_bytes_in_pinned_reader_order(self):
        reader = Reader(bytes.fromhex('009cffff7e'))
        self.assertEqual(read_value(reader, 'RGBA'), '009CFFFF')
        self.assertEqual(reader.number('B'), 0x7e)
        for size in range(4):
            with self.subTest(size=size), self.assertRaisesRegex(FormatError, 'Truncated'):
                read_value(Reader(b'\xff' * size), 'RGBA')

    def test_npcname_source_requires_the_pattern_and_an_unambiguous_language(self):
        pattern = r'npcname-[\w]+\.dat'
        with tempfile.TemporaryDirectory() as directory:
            client = Path(directory).resolve()
            system = client / 'system'
            system.mkdir()
            lock_client_as_reference_root(self, client)
            (system / 'npcname.dat').write_bytes(b'not a language file')
            with self.assertRaisesRegex(FormatError, 'matches 0 source files'):
                table_source_path(client, pattern)
            english = system / 'npcname-e.dat'
            english.write_bytes(b'english')
            self.assertEqual(table_source_path(client, pattern), english)
            (system / 'npcname-ru.dat').write_bytes(b'russian')
            with self.assertRaisesRegex(FormatError, 'matches 2 source files, expected 1: npcname-e.dat, npcname-ru.dat'):
                table_source_path(client, pattern)
            self.assertEqual(table_source_path(client, pattern, 'npcname-e.dat'), english)
            for filename in ('npcname.dat', '../npcname-e.dat', 'sub/npcname-e.dat', 'sub\\npcname-e.dat', 'NPCName-e.dat', 'npcname-E.dat'):
                with self.subTest(filename=filename), self.assertRaises(FormatError):
                    table_source_path(client, pattern, filename)

    def test_animation_guard_only_allows_reviewed_native_layouts(self):
        for version in (28, 30):
            self.assertEqual(animation_layout({'version': 123, 'licenseeVersion': version})['licenseeVersion'], version)
        for version, licensee in ((123, 27), (123, 29), (123, 31), (118, 0), (120, 28)):
            with self.subTest(version=version, licensee=licensee), self.assertRaises(FormatError):
                animation_layout({'version': version, 'licenseeVersion': licensee})

    def test_mtx_retains_independent_mesh_and_texture_counts(self):
        def string(value):
            data = (value + '\0').encode('utf-16le')
            return struct.pack('<I', len(data)) + data
        reader = Reader(struct.pack('<i', 1) + string('Fighter.NativeMesh') + struct.pack('<i', 2) + string('Texture.A') + string('Texture.B'))
        value = read_value(reader, 'MTX')['var_0_']
        self.assertEqual((value['mtx_size_1_'], value['mtx_size_2_']), (1, 2))
        self.assertEqual(value['for_mtx_size_1_'], [{'mtx_mesh_': 'Fighter.NativeMesh'}])
        self.assertEqual(value['for_mtx_size_2_'], [{'mtx_text_': 'Texture.A'}, {'mtx_text_': 'Texture.B'}])
        self.assertEqual(reader.position, reader.end)

    def test_mtx_negative_excessive_and_truncated_arrays_fail(self):
        for payload in (struct.pack('<i', -1), struct.pack('<i', 4097), struct.pack('<i', 1), struct.pack('<ii', 0, -1)):
            with self.subTest(payload=payload), self.assertRaises(FormatError):
                read_value(Reader(payload), 'MTX')

    def test_repeated_conditional_labels_consume_only_selected_fields(self):
        layout = ET.fromstring('<layout><wrapper name="wp_mesh"><node name="wp_mesh" reader="INT" /></wrapper><if name="check_100" param="#wp_mesh" val="2"><node name="left_mesh" reader="INT" /></if><if name="check_100" param="#wp_mesh" val="2"><node name="left_texture" reader="INT" /></if><node name="sentinel" reader="INT" /></layout>')
        selected = Reader(struct.pack('<4i', 2, 21, 22, 99))
        self.assertEqual(read_nodes(selected, layout), {'wp_mesh': {'wp_mesh': 2}, 'left_mesh': 21, 'left_texture': 22, 'sentinel': 99})
        self.assertEqual(selected.position, selected.end)
        omitted = Reader(struct.pack('<2i', 1, 99))
        self.assertEqual(read_nodes(omitted, layout), {'wp_mesh': {'wp_mesh': 1}, 'sentinel': 99})
        self.assertEqual(omitted.position, omitted.end)

    def test_conditional_field_cannot_overwrite_native_value(self):
        layout = ET.fromstring('<layout><node name="count" reader="INT" /><if name="check" param="#count" val="2"><node name="count" reader="INT" /></if></layout>')
        with self.assertRaisesRegex(FormatError, 'overwrite'):
            read_nodes(Reader(struct.pack('<2i', 2, 3)), layout)

    def test_material_sections_keep_the_multiline_final_blend_second_slot_after_an_inline_shader_before_later_lods(self):
        musveren_style_material_dump = "Sections[2] = {\n Sections[0] = { Material=Shader'body', FirstIndex=0 }\n Sections[1] =\n {\n Material = FinalBlend'eyes'\n FirstIndex = 3\n }\n}\nSections[0] = { Material=Shader'body', FirstIndex=0 }"
        converter = object.__new__(Converter)
        package = type('PackageStub', (), {'imports': [{'object': 'Pkg.body', 'name': 'body', 'className': 'Shader'}, {'object': 'Pkg.eyes', 'name': 'eyes', 'className': 'FinalBlend'}], 'exports': []})()
        document = type('DocumentStub', (), {'data': {'materials': [{}, {}]}, 'image': lambda *args: 0})()
        with patch.object(converter, 'material_texture', side_effect=lambda work, ref: (b'png', {}, ref, [])):
            slots, _ = converter.materials(None, package, document, musveren_style_material_dump, {})
        self.assertEqual([slot['sourceReference'] for slot in slots], ['Pkg.body', 'Pkg.eyes'])


@unittest.skipUnless((CLIENT / 'system/npcgrp.dat').is_file() and SCHEMA_ROOT.is_dir() and CRYPTO_SOURCE.is_file(), 'Staged native presentation tables or pinned formats unavailable')
class NativePresentationTableTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tables = {name: decode_table(CLIENT, name) for name in ('armorgrp', 'weapongrp', 'npcgrp')}

    def test_all_rows_consume_exact_safe_package_and_unique_ids(self):
        for name, count, collection, id_key in [('armorgrp', 1014, 'item', 'object_id'), ('weapongrp', 1313, 'item', 'object_id'), ('npcgrp', 6519, 'npc', 'npc_id')]:
            table = self.tables[name]
            rows = table['data'][collection]
            self.assertEqual(len(rows), count)
            self.assertEqual(len({row[id_key] for row in rows}), count)
            self.assertEqual(table['decodedBytes'] - table['consumedBytes'], 13)
            self.assertEqual(bytes.fromhex(table['trailerHex']), b'\x0cSafePackage\0')

    def test_leather_shirt22_and_small_sword1_exact_native_bindings(self):
        armor = self.tables['armorgrp']['data']['item'][1]
        self.assertEqual((armor['object_id'], armor['body_part'], armor['armor_type']), (22, 10, 1))
        male = armor['m_HumnFigh']['var_0_']
        self.assertEqual(male['for_mtx_size_1_'], [{'mtx_mesh_': 'Fighter.MFighter_m001_u'}])
        self.assertEqual(male['for_mtx_size_2_'], [{'mtx_text_': 'MFighter.MFighter_m001_t04_u'}])
        sword = self.tables['weapongrp']['data']['item'][0]
        self.assertEqual((sword['object_id'], sword['weapon_type'], sword['handness']), (1, 1, 1))
        self.assertEqual(sword['wp_mesh']['mesh_0_'][0]['mesh0'], 'LineageWeapons.small_sword_m00_wp')
        self.assertEqual(sword['texture'][0]['texture0'], 'LineageWeaponsTex.small_sword_t00_wp')

    def test_shared_monster_mesh_does_not_invent_unique_npc_identity(self):
        rows = [row for row in self.tables['npcgrp']['data']['npc'] if row['mesh_name'] == 'LineageMonsters.field_stalker_m00']
        self.assertEqual(len(rows), 22)
        for row in rows:
            self.assertEqual(row['texture_name'], [{'param_texture_name': 'LineageMonstersTex.field_stalker_t00'}, {'param_texture_name': 'LineageMonstersTex.field_stalker_t01'}])

    def test_armor_compound_format_pin_is_checked_from_retained_bytes(self):
        pins = table_definition_pins('armorgrp')
        self.assertEqual(pins['definitions.xml#MTX'], MTX_DEFINITION_EVIDENCE['sha256'])
        self.assertEqual(pins, self.tables['armorgrp']['formatDefinitionPins'])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'structure/dats').mkdir(parents=True)
            for relative in ('06_interlude.xml', 'dats/armorgrp.xml'):
                (root / 'structure' / relative).write_bytes((SCHEMA_ROOT / relative).read_bytes())
            (root / 'definitions.xml').write_bytes(b'mutated MTX definition')
            with self.assertRaisesRegex(FormatError, 'hash mismatch'):
                table_definition_pins('armorgrp', root / 'structure')


@unittest.skipUnless((CLIENT / 'system/npcname-e.dat').is_file() and (CLIENT / ENGINE_LIBRARY_RELATIVE_PATH).is_file() and SCHEMA_ROOT.is_dir() and CRYPTO_SOURCE.is_file(),
    'Staged native npcname table, its Engine.dll lock anchor or pinned formats unavailable')
class NativeNpcNameTableTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.table = decode_table(CLIENT, 'npcname', source_filename='npcname-e.dat')

    @staticmethod
    def payload(ids=(21622,), name='Greater Musveren', nick=''):
        def ascf(value):
            raw = (value + '\0').encode('cp1252') if value else b''
            return bytes([len(raw)]) + raw
        row = ascf(name) + ascf(nick) + bytes.fromhex('9ce8a9ff')
        return struct.pack('<I', len(ids)) + b''.join(struct.pack('<I', value) + row for value in ids) + b'\x0cSafePackage\0'

    def test_authoritative_table_retains_all_ids_names_nicknames_and_colors(self):
        table = self.table
        self.assertEqual(table['source'], 'system/npcname-e.dat')
        self.assertEqual(table['sourceSha256'], '84c79b73a97e489b455f44f21d8c8cba0f4df401ccb1d56887a1eacc62285b9a')
        self.assertEqual(table['decodedSha256'], 'ec6dc7cb06bcecc1e9eaa4336558768140d4b3117f1e7c4aa1ef3509ed6a709a')
        self.assertEqual((table['decodedBytes'], table['consumedBytes']), (186592, 186579))
        self.assertEqual(bytes.fromhex(table['trailerHex']), b'\x0cSafePackage\0')
        self.assertEqual((table['schema']['layout'], table['schema']['sourcePattern']), ('ScionsOfDestiny', r'npcname-[\w]+\.dat'))
        rows = table['data']['npc']
        self.assertEqual((table['data']['data'], len(rows), len({row['id'] for row in rows})), (6519, 6519, 6519))
        self.assertTrue(all(set(row) == {'id', 'name', 'nick', 'nickcolor'} for row in rows))
        greater_musveren_row_decoded_from_native_bytes_36805_to_36832 = rows[1431]
        self.assertEqual(greater_musveren_row_decoded_from_native_bytes_36805_to_36832, {'id': 21622, 'name': 'Greater Musveren', 'nick': '', 'nickcolor': '9CE8A9FF'})
        self.assertGreater(len(rows), len({row['name'] for row in rows}))

    def test_repeated_display_names_survive_but_duplicate_ids_fail(self):
        with patch('native_catalog.tables.decode413', return_value=('fixture', self.payload((17, 99), 'Same NAME', 'Title'))):
            table = decode_table(CLIENT, 'npcname')
        self.assertEqual(table['data']['npc'], [
            {'id': value, 'name': 'Same NAME', 'nick': 'Title', 'nickcolor': '9CE8A9FF'} for value in (17, 99)])
        with patch('native_catalog.tables.decode413', return_value=('fixture', self.payload((17, 17)))):
            with self.assertRaisesRegex(FormatError, 'identifiers are not unique'):
                decode_table(CLIENT, 'npcname')

    def test_exact_safe_package_trailer_and_bounded_fields_are_required(self):
        good = self.payload()
        malformed = [good[:-1], good + b'\0', good[:-13] + b'\x0cWrongPackag\0',
                     struct.pack('<II', 1, 21622) + b'\x02x!' + b'\x0cSafePackage\0',
                     struct.pack('<II', 1, 21622) + b'\0\0\x9c\xe8\xa9',
                     struct.pack('<I', 100001) + b'\x0cSafePackage\0']
        for payload in malformed:
            with self.subTest(payload=payload), patch('native_catalog.tables.decode413', return_value=('fixture', payload)):
                with self.assertRaises(FormatError):
                    decode_table(CLIENT, 'npcname')

    def test_rgba_primitive_source_pins_reject_tampering(self):
        pins = table_definition_pins('npcname')
        self.assertEqual(pins, self.table['formatDefinitionPins'])
        for relative, expected in RGBA_DEFINITION_EVIDENCE['files'].items():
            self.assertEqual(pins[relative + '#RGBA'], expected)
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                schema_root = root / 'dat_engine/data/structure'
                (schema_root / 'dats').mkdir(parents=True)
                for schema in ('06_interlude.xml', 'dats/npcname.xml'):
                    (schema_root / schema).write_bytes((SCHEMA_ROOT / schema).read_bytes())
                for definition in RGBA_DEFINITION_EVIDENCE['files']:
                    destination = root / definition
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes((SCHEMA_ROOT.parents[2] / definition).read_bytes())
                (root / relative).write_bytes(b'mutated RGBA primitive definition')
                with self.assertRaisesRegex(FormatError, 'hash mismatch'):
                    table_definition_pins('npcname', schema_root)


@unittest.skipUnless((CLIENT / 'animations/LineageMonsters.ukx').is_file() and PSA.is_file() and RESULTS.is_file(), 'Staged monster, independent PSA and local conversion evidence unavailable')
class NativeMonsterOracleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = CLIENT / 'animations/LineageMonsters.ukx'
        cls.package = Package(path.read_bytes(), path.name)
        cls.item = next(item for item in cls.package.exports if item['name'] == 'field_stalker_anim')
        cls.animation = cls.package.animation(cls.item)
        cls.motions = decode_tracks(cls.package, cls.animation)
        cls.output = Path(next(item['file'] for item in json.loads(RESULTS.read_text()) if item['id'] == 'interlude:LineageMonsters.field_stalker_m00')).parent
        cls.gltf = cls.output / 'evidence/export/LineageMonsters/field_stalker_m00.gltf'

    def test_exact_source_version_bones_clips_and_complete_notifies(self):
        self.assertEqual(self.package.source_hash, '157715304bfb1f289ce6bf202e5651f3809f57d5b061239db0c6a2a817c9a9c9')
        self.assertEqual(len(self.animation['bones']), 49)
        self.assertEqual([clip['name'] for clip in self.animation['sequences']], ['Wait', 'atk01', 'atkwait', 'death', 'deathwait', 'run', 'Walk', 'SpWait01', 'spatk01'])
        self.assertTrue(all(len(motion['tracks']) == 49 for motion in self.motions))
        sidecar = self.package.notification_sidecar()
        self.assertEqual(sidecar['licenseeVersion'], 28)
        self.assertEqual(sidecar['unsupported'], [])
        death = [event for event in sidecar['animationEvents'] if event['animationSet'] == self.animation['object'] and event['clip'] == 'death']
        self.assertTrue(death)
        self.assertTrue(all(event['sourceFrames'] == 91 and event['sourceRate'] == 30 for event in death))

    def test_original_keys_agree_with_independent_psa(self):
        results = umodel_psa_parity_at_original_integer_frame_keys(self.animation, self.motions, PSA.read_bytes())
        self.assertEqual(len(results), 9)
        self.assertGreater(sum(row['comparedKeys'] for row in results), 10000)
        for row in results:
            self.assertLess(row['maxTranslationErrorSourceUnits'], 1e-4, row)
            self.assertLess(row['maxQuaternionComponentError'], 1e-4, row)

    def test_all_gltf_keys_exactly_preserve_source_values_and_death_final_pose(self):
        document = Document(self.gltf)
        geometry = bytes(document.binary)
        report = add_animations(document, self.package, self.item)
        self.assertEqual(bytes(document.binary[:len(geometry)]), geometry)
        joints = document.data['skins'][0]['joints']
        def values(index, width):
            accessor = document.data['accessors'][index]
            view = document.data['bufferViews'][accessor['bufferView']]
            offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
            return [struct.unpack_from('<' + 'f' * width, document.binary, offset + key * width * 4) for key in range(accessor['count'])]
        for clip, sequence, metadata, motion in zip(document.data['animations'], self.animation['sequences'], self.animation['motionMetadata'], self.motions):
            self.assertEqual(clip['extras']['nativeDurationSeconds'], sequence['numFrames'] / sequence['rate'])
            for entry in report['boneMapping']:
                mesh_bone, source_bone = entry['meshIndex'], entry['animationIndex']
                track = motion['tracks'][source_bone]
                for path, field, width in [('translation', 'translations', 3), ('rotation', 'rotations', 4)]:
                    source = track[field]
                    if not source:
                        continue
                    channel = next(channel for channel in clip['channels'] if channel['target'] == {'node': joints[mesh_bone], 'path': path})
                    sampler = clip['samplers'][channel['sampler']]
                    actual = values(sampler['output'], width)
                    self.assertEqual(len(actual), len(source), (clip['name'], mesh_bone, path))
                    for original, exported in zip(source, actual):
                        expected = (original[0] * .01, original[2] * .01, original[1] * .01) if path == 'translation' else (original[0], original[2], original[1], original[3])
                        if path == 'rotation' and mesh_bone == 0:
                            expected = (-expected[0], -expected[1], -expected[2], expected[3])
                        expected_as_float32 = struct.unpack('<' + 'f' * width, struct.pack('<' + 'f' * width, *expected))
                        self.assertEqual(exported, expected_as_float32)
                    expected_times = [key * sequence['numFrames'] / len(source) / sequence['rate'] for key in range(len(source))] if len(source) == 1 or not track['times'] else [time * sequence['numFrames'] / metadata['trackTime'] / sequence['rate'] for time in track['times']]
                    actual_times = [row[0] for row in values(sampler['input'], 1)]
                    for actual_time, expected_time in zip(actual_times, expected_times):
                        self.assertAlmostEqual(actual_time, expected_time, places=6)
            if clip['name'] == 'death':
                self.assertEqual(clip['extras']['nativeFrames'], 91)
                self.assertAlmostEqual(clip['extras']['nativeDurationSeconds'], 91 / 30)

    def test_exported_rotations_match_native_basis_for_deformed_vectors(self):
        document = Document(self.gltf)
        report = add_animations(document, self.package, self.item)
        joints = document.data['skins'][0]['joints']
        def ueviewer_cquat_to_axis_basis_columns(q):
            x, y, z, w = q
            return [[1 - 2 * (y*y + z*z), 2 * (x*y - w*z), 2 * (x*z + w*y)],
                    [2 * (x*y + w*z), 1 - 2 * (x*x + z*z), 2 * (y*z - w*x)],
                    [2 * (x*z - w*y), 2 * (y*z + w*x), 1 - 2 * (x*x + y*y)]]
        def right_handed_gltf_quaternion_matrix_columns(q):
            x, y, z, w = q
            return [[1 - 2 * (y*y + z*z), 2 * (x*y + w*z), 2 * (x*z - w*y)],
                    [2 * (x*y - w*z), 1 - 2 * (x*x + z*z), 2 * (y*z + w*x)],
                    [2 * (x*z + w*y), 2 * (y*z - w*x), 1 - 2 * (x*x + y*y)]]
        order, comparisons = [0, 2, 1], 0
        native_vector = (13.25, -8.5, 31.75)
        gltf_vector = tuple(native_vector[index] * .01 for index in order)
        for clip, motion in zip(document.data['animations'], self.motions):
            for entry in report['boneMapping']:
                mesh_bone = entry['meshIndex']
                channel = next(channel for channel in clip['channels'] if channel['target'] == {'node': joints[mesh_bone], 'path': 'rotation'})
                accessor = document.data['accessors'][clip['samplers'][channel['sampler']]['output']]
                view = document.data['bufferViews'][accessor['bufferView']]
                for key, source in enumerate(motion['tracks'][entry['animationIndex']]['rotations']):
                    if mesh_bone == 0:
                        source = (-source[0], -source[1], -source[2], source[3])
                    native = ueviewer_cquat_to_axis_basis_columns(source)
                    converted = struct.unpack_from('<4f', document.binary, view.get('byteOffset', 0) + key * 16)
                    gltf = right_handed_gltf_quaternion_matrix_columns(converted)
                    native_deformed = [sum(native[column][row] * native_vector[column] for column in range(3)) for row in range(3)]
                    gltf_deformed = [sum(gltf[column][row] * gltf_vector[column] for column in range(3)) for row in range(3)]
                    for row in range(3):
                        self.assertAlmostEqual(gltf_deformed[row], native_deformed[order[row]] * .01, places=7)
                    comparisons += 1
        self.assertGreater(comparisons, 1000)


if __name__ == '__main__':
    unittest.main()
