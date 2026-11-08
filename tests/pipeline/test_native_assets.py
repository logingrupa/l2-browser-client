import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets import archive_bytes, verify_archive, sha, apply_native_mesh_transform, Converter
from native_assets_lib.gltf import Document
from native_assets_lib.animation import read_track, decode_tracks, add_animations
from native_assets_lib.rigid import is_root_rigid, attach_rigid_part
from native_catalog.ue2 import Package, Reader, FormatError
from reference_client_lock_fixture import lock_client_as_reference_root


class PackageTests(unittest.TestCase):
    def manifest(self, payload=b'test'):
        return {'schemaVersion': 1, 'id': 'test', 'kind': 'audio', 'files': [{'path': 'audio.wav', 'bytes': len(payload), 'sha256': sha(payload), 'mime': 'audio/wav'}]}

    def test_deterministic_archive_and_hash_verification(self):
        first = archive_bytes(self.manifest(), {'audio.wav': b'test'})
        self.assertEqual(first, archive_bytes(self.manifest(), {'audio.wav': b'test'}))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.l2asset'
            path.write_bytes(first)
            self.assertEqual(verify_archive(path)['files'], 2)
            damaged = bytearray(first)
            offset = first.index(b'test', first.index(b'audio.wav', first.index(b'PK\x03\x04', 4)))
            damaged[offset] ^= 1
            path.write_bytes(damaged)
            with self.assertRaises((ValueError, zipfile.BadZipFile)):
                verify_archive(path)

    def test_rejects_unlisted_files_and_wrong_hash(self):
        with self.assertRaises(ValueError):
            archive_bytes(self.manifest(), {'audio.wav': b'nope'})
        with self.assertRaises(ValueError):
            archive_bytes(self.manifest(), {'audio.wav': b'test', 'extra': b'x'})

    def test_rejects_unsafe_paths_and_case_collisions(self):
        for name in ('../outside', '/outside', 'C:/outside', 'a\\b', 'a//b', './file'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                archive_bytes({'files': []}, {name: b'x'})
        with self.assertRaises(ValueError):
            archive_bytes({'files': []}, {'asset.JSON': b'x'})


class GeometryTests(unittest.TestCase):
    def make_document(self, root):
        payload = struct.pack('<6f', 0, 0, 0, 1.23456789, 2, 3)
        (root / 'mesh.bin').write_bytes(payload)
        (root / 'mesh.gltf').write_text(json.dumps({'asset': {'version': '2.0'}, 'buffers': [{'uri': 'mesh.bin', 'byteLength': len(payload)}], 'bufferViews': [{'buffer': 0, 'byteLength': len(payload)}], 'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 2, 'type': 'VEC3', 'min': [0, 0, 0], 'max': [1.23457, 2, 3]}], 'nodes': [{'name': 'mesh', 'skin': 0, 'children': [1]}, {'name': 'root'}], 'skins': [{'joints': [1]}], 'scenes': [{'nodes': [0]}]}))
        return Document(root / 'mesh.gltf'), payload

    def test_packing_and_bounds_repair_leave_source_bytes_identical(self):
        with tempfile.TemporaryDirectory() as directory:
            doc, original = self.make_document(Path(directory))
            packed = doc.glb()
            json_size = struct.unpack_from('<I', packed, 12)[0]
            binary_start = 12 + 8 + json_size + 8
            self.assertEqual(packed[binary_start:binary_start + len(original)], original)
            self.assertEqual(doc.data['accessors'][0]['max'][0], struct.unpack_from('<f', original, 12)[0])

    def test_rejects_bad_declared_buffer_length(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_document(root)
            (root / 'mesh.bin').write_bytes(b'bad')
            with self.assertRaises(ValueError):
                Document(root / 'mesh.gltf')

    def test_native_mesh_pivot_and_scale_are_not_height_fitting(self):
        with tempfile.TemporaryDirectory() as directory:
            doc, original = self.make_document(Path(directory))
            result = apply_native_mesh_transform(doc, 'MeshOrigin = { X=0, Y=0, Z=25.2 }\nMeshScale = { X=1.03, Y=1.03, Z=1.03 }\nRotOrigin = { Yaw=49152, Pitch=0, Roll=0 }')
            self.assertAlmostEqual(result['gltfParentMatrix'][13], -.25956)
            self.assertAlmostEqual(result['gltfParentMatrix'][2], -1.03)
            self.assertEqual(bytes(doc.binary), original)
            self.assertEqual(doc.data['scenes'][0]['nodes'], [0, 2])
            self.assertEqual(doc.data['nodes'][2]['children'], [1])

    def test_assembly_remaps_bone_targets_and_preserves_both_buffers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            left, _ = self.make_document(root)
            right, _ = self.make_document(root)
            for document in (left, right):
                times = document.accessor([(0,), (1,)], 1, True)
                values = document.accessor([(0, 0, 0), (1, 0, 0)], 3)
                document.data['animations'] = [{'name': 'move', 'extras': {'nativeDurationSeconds': 2}, 'samplers': [{'input': times, 'output': values}], 'channels': [{'sampler': 0, 'target': {'node': 1, 'path': 'translation'}}]}]
            left_bytes, right_bytes = bytes(left.binary), bytes(right.binary)
            left.merge(right)
            self.assertEqual(bytes(left.binary), left_bytes + right_bytes)
            clip = left.data['animations'][0]
            self.assertEqual([channel['target']['node'] for channel in clip['channels']], [1, 3])
            self.assertEqual([channel['sampler'] for channel in clip['channels']], [0, 1])
            self.assertEqual(left.data['skins'][1]['joints'], [3])


class CacheTests(unittest.TestCase):
    def test_cache_rechecks_source_and_output_hashes(self):
        def wav(value):
            output = io.BytesIO()
            with wave.open(output, 'wb') as stream:
                stream.setnchannels(1)
                stream.setsampwidth(2)
                stream.setframerate(8000)
                stream.writeframes(struct.pack('<h', value) * 80)
            return output.getvalue()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client = root / 'source'
            client.mkdir()
            lock_client_as_reference_root(self, client)
            media = client / 'sample.wav'
            media.write_bytes(wav(1))
            tool = root / 'tool.exe'
            tool.write_bytes(b'not executed by the media adapter')
            with patch('native_assets.UMODEL_SHA256', sha(tool.read_bytes())):
                converter = Converter(client, root / 'artifacts' / 'output', tool, project_root=root)
                request = {'kind': 'audio', 'media': 'sample.wav'}
                first = converter.convert(request)
                self.assertFalse(first['cacheHit'])
                self.assertTrue(converter.convert(request)['cacheHit'])
                media.write_bytes(wav(2))
                changed = converter.convert(request)
                self.assertFalse(changed['cacheHit'])
                self.assertNotEqual(first['sha256'], changed['sha256'])
                Path(changed['file']).write_bytes(b'corrupt')
                with self.assertRaisesRegex(ValueError, 'content-addressed output is corrupt'):
                    converter.convert(request)
                self.assertEqual(media.read_bytes(), wav(2))
                with self.assertRaisesRegex(ValueError, 'outside client'):
                    converter.source(tool)


class TrackTests(unittest.TestCase):
    def test_native_track_count_and_time_validation(self):
        empty_track_with_single_byte_compact_counts = struct.pack('<I', 0) + b'\0\0\0'
        self.assertEqual(read_track(Reader(empty_track_with_single_byte_compact_counts))['times'], [])
        track_with_two_times_and_no_keys = struct.pack('<I', 0) + b'\0\0\2' + struct.pack('<2f', 1, 0)
        with self.assertRaises(FormatError):
            read_track(Reader(track_with_two_times_and_no_keys))
        with self.assertRaises(FormatError):
            read_track(Reader(empty_track_with_single_byte_compact_counts[:-1]))

    def test_native_positive_x_quarter_turn_maps_gltf_y_toward_positive_z_without_a_w_flip(self):
        q = 2 ** -.5
        sequence = {'name': 'quarter-turn', 'numFrames': 1, 'rate': 30, 'sourceDurationSeconds': 1/30}
        metadata = {'trackTime': 1, 'sha256': 'fixture', 'rootSpeed3D': [0, 0, 0], 'startBone': 0, 'flags': 0}
        animation = {'object': 'Fixture.Native', 'bones': [{'name': 'root', 'parentIndex': 0}, {'name': 'head', 'parentIndex': 0}], 'sequences': [sequence], 'motionMetadata': [metadata]}
        class NativeFixture:
            summary = {'version': 123, 'licenseeVersion': 30}
            def animation(self, item):
                return animation
        track = lambda rotation: {'rotations': [rotation], 'translations': [(0, 0, 0)], 'times': [0]}
        motion = {'tracks': [track((0, 0, q, q)), track((q, 0, 0, q))], 'boneIndices': [0, 1], 'rootTrack': {}}
        with tempfile.TemporaryDirectory() as directory:
            document, _ = RigidAttachmentTests().document(Path(directory))
            with patch('native_assets_lib.animation.decode_tracks', return_value=[motion]):
                add_animations(document, NativeFixture(), {})
            clip = document.data['animations'][0]
            values = {}
            for channel in clip['channels']:
                if channel['target']['path'] != 'rotation':
                    continue
                accessor = document.data['accessors'][clip['samplers'][channel['sampler']]['output']]
                view = document.data['bufferViews'][accessor['bufferView']]
                values[channel['target']['node']] = struct.unpack_from('<4f', document.binary, view['byteOffset'])
            x, y, z, w = values[2]
            self.assertAlmostEqual(2 * (y*z + w*x), 1, places=6)
            x, y, z, w = values[1]
            self.assertAlmostEqual(2 * (x*z - w*y), 1, places=6)


class RigidAttachmentTests(unittest.TestCase):
    def document(self, root):
        payload = struct.pack('<3f', 0, 2, 0) + bytes([0, 0, 0, 0, 255, 0, 0, 0])
        identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        head_inverse = list(identity)
        head_inverse[13] = -1
        payload += struct.pack('<32f', *(identity + head_inverse))
        (root / 'rigid.bin').write_bytes(payload)
        data = {'asset': {'version': '2.0'}, 'buffers': [{'uri': 'rigid.bin', 'byteLength': len(payload)}],
            'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': 12}, {'buffer': 0, 'byteOffset': 12, 'byteLength': 4}, {'buffer': 0, 'byteOffset': 16, 'byteLength': 4}, {'buffer': 0, 'byteOffset': 20, 'byteLength': 128}],
            'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 1, 'type': 'VEC3'}, {'bufferView': 1, 'componentType': 5121, 'count': 1, 'type': 'VEC4'}, {'bufferView': 2, 'componentType': 5121, 'count': 1, 'type': 'VEC4', 'normalized': True}, {'bufferView': 3, 'componentType': 5126, 'count': 2, 'type': 'MAT4'}],
            'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'JOINTS_0': 1, 'WEIGHTS_0': 2}}]}],
            'nodes': [{'name': 'face', 'mesh': 0, 'skin': 0, 'children': [1]}, {'name': 'root', 'children': [2]}, {'name': 'head', 'translation': [0, 1, 0]}],
            'skins': [{'joints': [1, 2], 'inverseBindMatrices': 3}], 'scenes': [{'nodes': [0]}]}
        (root / 'rigid.gltf').write_text(json.dumps(data))
        return Document(root / 'rigid.gltf'), payload

    def test_face_follows_head_palette_with_exact_original_bind_matrix(self):
        with tempfile.TemporaryDirectory() as directory:
            document, original = self.document(Path(directory))
            self.assertTrue(is_root_rigid(document))
            result = attach_rigid_part(document, 'head')
            self.assertEqual(document.data['skins'][0]['joints'], [2])
            self.assertEqual(bytes(document.binary[:len(original)]), original)
            self.assertEqual(bytes(document.binary[-64:]), original[-64:])
            self.assertEqual(result['originalBoneIndex'], 1)
            inverse = struct.unpack('<16f', document.binary[-64:])
            point_one_unit_above_head_pivot = (0, 2 + inverse[13], 0)
            point_after_head_z_quarter_turn = (-point_one_unit_above_head_pivot[1], point_one_unit_above_head_pivot[0] + 1,
                point_one_unit_above_head_pivot[2])
            self.assertEqual(point_after_head_z_quarter_turn, (-1, 1, 0))

    def test_rigid_attachment_rejects_missing_bone_and_weighted_geometry(self):
        with tempfile.TemporaryDirectory() as directory:
            document, _ = self.document(Path(directory))
            with self.assertRaisesRegex(ValueError, 'missing or ambiguous'):
                attach_rigid_part(document, 'missing')
            document.binary[16:20] = bytes([128, 127, 0, 0])
            self.assertFalse(is_root_rigid(document))
            with self.assertRaisesRegex(ValueError, 'root-only rigid'):
                attach_rigid_part(document, 'head')


NATIVE = Path('E:/lineage2-client/animations/Fighter.ukx')
PSA = ROOT / 'artifacts/native-assets/probes/Fighter/MeshAnimation/MFighter_anim.psa'
GLTF = ROOT / 'artifacts/native-assets/probes/Fighter/MFighter_m000_u.gltf'


@unittest.skipUnless(NATIVE.exists() and PSA.exists() and GLTF.exists(), 'Optional read-only native fixture and independent UModel PSA probe are unavailable')
class NativeOracleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.package = Package(NATIVE.read_bytes(), NATIVE.name)
        cls.item = next(item for item in cls.package.exports if item['name'] == 'MFighter_anim')
        cls.animation = cls.package.animation(cls.item)
        cls.motions = decode_tracks(cls.package, cls.animation)

    def test_native_tracks_match_independent_psa_original_frame_samples(self):
        data = PSA.read_bytes()
        position, chunks = 0, {}
        while position < len(data):
            name, _, size, count = struct.unpack_from('<20siii', data, position)
            position += 32
            chunks[name.split(b'\0')[0].decode()] = (position, size, count)
            position += size * count
        info_offset, info_size, clip_count = chunks['ANIMINFO']
        keys_offset, _, _ = chunks['ANIMKEYS']
        self.assertEqual(clip_count, 114)
        comparisons = 0
        for clip_index, (sequence, metadata, motion) in enumerate(zip(self.animation['sequences'], self.animation['motionMetadata'], self.motions)):
            fields = struct.unpack_from('<64s64s4i3f3i', data, info_offset + clip_index * info_size)
            name, bone_count, rate, first_frame, frames = fields[0].split(b'\0')[0].decode(), fields[2], fields[8], fields[10], fields[11]
            self.assertEqual((name, bone_count, rate, frames), (sequence['name'], 70, sequence['rate'], sequence['numFrames']))
            for bone, track in enumerate(motion['tracks']):
                for kind, values in [('translations', track['translations']), ('rotations', track['rotations'])]:
                    for key, value in enumerate(values):
                        time = key * frames / len(values) if len(values) == 1 or not track['times'] else track['times'][key] * frames / metadata['trackTime']
                        frame = round(time)
                        if abs(frame - time) > 1e-5 or frame < 0 or frame >= frames:
                            continue
                        sample = struct.unpack_from('<8f', data, keys_offset + ((first_frame + frame) * bone_count + bone) * 32)
                        expected = (value[0], -value[1], value[2]) if kind == 'translations' else (value[0], -value[1], value[2], -value[3])
                        actual = sample[:3] if kind == 'translations' else sample[3:7]
                        error = max(abs(a - b) for a, b in zip(actual, expected))
                        if kind == 'rotations':
                            error = min(error, max(abs(a + b) for a, b in zip(actual, expected)))
                        self.assertLess(error, 1e-4, (name, bone, kind, frame, actual, expected))
                        comparisons += 1
        self.assertGreater(comparisons, 100_000)

    def test_glb_bone_map_handles_source_typo_and_sibling_reordering(self):
        document = Document(GLTF)
        original = bytes(document.binary)
        report = add_animations(document, self.package, self.item)
        self.assertEqual(len(document.data['animations']), 114)
        self.assertEqual(document.binary[:len(original)], original)
        mapping = report['boneMapping']
        self.assertEqual(mapping[18]['animationIndex'], 19)
        self.assertEqual(mapping[19]['animationIndex'], 18)
        self.assertEqual(mapping[27]['animationIndex'], 27)
        self.assertEqual(report['sourceDuplicateNameCorrections'][0]['meshName'], 'Bip01_R_Finger01')

    def test_exported_rotation_axes_match_native_skinning_not_conjugated_bind(self):
        document = Document(GLTF)
        report = add_animations(document, self.package, self.item)
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
        comparisons = 0
        order = [0, 2, 1]
        for clip_index, clip in enumerate(document.data['animations']):
            for mesh_index in (0, 1, 6, 38, 39):
                native_index = report['boneMapping'][mesh_index]['animationIndex']
                source = self.motions[clip_index]['tracks'][native_index]['rotations']
                channel = next(channel for channel in clip['channels'] if channel['target'] == {'node': mesh_index + 1, 'path': 'rotation'})
                accessor = document.data['accessors'][clip['samplers'][channel['sampler']]['output']]
                view = document.data['bufferViews'][accessor['bufferView']]
                for key, native in enumerate(source):
                    if mesh_index == 0:
                        native = (-native[0], -native[1], -native[2], native[3])
                    expected = ueviewer_cquat_to_axis_basis_columns(native)
                    exported = struct.unpack_from('<4f', document.binary, view['byteOffset'] + 16 * key)
                    actual = right_handed_gltf_quaternion_matrix_columns(exported)
                    for column in range(3):
                        for row in range(3):
                            self.assertAlmostEqual(actual[column][row], expected[order[column]][order[row]], places=6)
                    comparisons += 1
        self.assertGreater(comparisons, 10000)

    def test_direct_sound_export_matches_pinned_umodel_payload(self):
        from native_assets import UMODEL
        if not UMODEL.exists():
            self.skipTest('Pinned UModel fixture unavailable')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            converter = Converter(NATIVE.parents[1], root / 'artifacts' / 'output', UMODEL, project_root=root)
            _, package = converter.package('skillsound')
            item = converter.select(package, 'power_strike_cast', 'Sound')
            payload, mime, metadata = converter.sound(root, package, item)
            self.assertEqual(sha(payload), 'cf7d6fe320d0824e839407fa2f4fab020a522f28c9d313e0afc57ff68dc3d826')
            self.assertEqual((mime, metadata['sampleRate']), ('audio/wav', 22050))


if __name__ == '__main__':
    unittest.main()
