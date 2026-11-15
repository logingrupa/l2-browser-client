import base64
import copy
import json
from pathlib import Path
import struct
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from native_assets_lib.effect_readiness import inspect, run
from native_assets_lib.gltf import json_bytes
from native_assets_lib.sha256_identity import sha256_hex_digest

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')


def model_bytes(material=None, image=PNG):
    binary = struct.pack('<9f6f3H', 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 2)
    binary += b'\0' * (-len(binary) % 4)
    image_offset = len(binary); binary += image
    doc = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}],
           'buffers': [{'byteLength': len(binary)}],
           'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': 36}, {'buffer': 0, 'byteOffset': 36, 'byteLength': 24},
                           {'buffer': 0, 'byteOffset': 60, 'byteLength': 6}, {'buffer': 0, 'byteOffset': image_offset, 'byteLength': len(image)}],
           'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 3, 'type': 'VEC3', 'min': [0, 0, 0], 'max': [1, 1, 0]},
                         {'bufferView': 1, 'componentType': 5126, 'count': 3, 'type': 'VEC2'},
                         {'bufferView': 2, 'componentType': 5123, 'count': 3, 'type': 'SCALAR'}],
           'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'TEXCOORD_0': 1}, 'indices': 2, 'material': 0}]}],
           'materials': [material if material is not None else {'extras': {'nativeSourceReference': 'Textures.Glow'}, 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}}}],
           'textures': [{'source': 0}], 'images': [{'bufferView': 3, 'mimeType': 'image/png', 'name': 'Textures.Glow'}]}
    encoded = json_bytes(doc); encoded += b' ' * (-len(encoded) % 4); binary += b'\0' * (-len(binary) % 4)
    return struct.pack('<III', 0x46546c67, 2, 28 + len(encoded) + len(binary)) + struct.pack('<II', len(encoded), 0x4e4f534a) + encoded + struct.pack('<II', len(binary), 0x004e4942) + binary


class ReadinessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.bundle = self.root / 'bundle'; self.bundle.mkdir()
        self.output = self.root / 'report.json'; self.payloads = {}; self.assets = []
        self.add_asset('Meshes.Glow', 'model', 'model.glb', model_bytes())
        self.add_asset('Textures.Glow', 'texture', 'texture.png', PNG)
        self.add_asset('Sound.Group.Cast', 'audio', 'audio.wav', b'RIFF-retained-test-payload')
        mesh = {'name': 'Mesh0', 'object': 'Effects.Cast.Mesh0', 'class': 'Engine.MeshEmitter',
                'properties': {'StaticMesh': {'class': 'StaticMesh', 'object': 'Meshes.Glow'}, 'DrawStyle': 3},
                'effectiveProperties': {'StaticMesh': {'class': 'StaticMesh', 'object': 'Meshes.Glow'}, 'DrawStyle': 3,
                                        'Texture': {'class': 'Texture', 'object': 'Textures.Glow'}, 'UnknownRuntimeField': {'unparsedHex': 'abcd'}}}
        sprite = {'name': 'Sprite0', 'object': 'Effects.Cast.Sprite0', 'class': 'Engine.SpriteEmitter',
                  'properties': {'Texture': {'class': 'Texture', 'object': 'Textures.Glow'}},
                  'effectiveProperties': {'Texture': {'class': 'Texture', 'object': 'Textures.Glow'}, 'DrawStyle': 3, 'MaxParticles': 7}}
        self.graph = {'skillRow': {'skill_id': 3, 'skill_level': 1}, 'soundRow': {'spelleffect_sound_1': 'Sound.Cast'},
                      'associations': [], 'effects': [{'object': 'Effects.Cast', 'properties': {'Emitters': [{'symbol': 'Sprite0'}, {'symbol': 'Mesh0'}]},
                                                       'effectiveProperties': {}, 'children': [mesh, sprite]}],
                      'classDefaults': [{'object': 'Engine.MeshEmitter', 'className': 'MeshEmitter', 'superClass': 'ParticleEmitter'},
                                        {'object': 'Engine.SpriteEmitter', 'className': 'SpriteEmitter', 'superClass': 'ParticleEmitter'},
                                        {'object': 'Engine.ParticleEmitter', 'className': 'ParticleEmitter', 'superClass': None,
                                         'enums': {'EParticleDrawStyle': {'PTDS_Translucent': 3}}}],
                      'nativeObjects': [{'source': {'object': 'Textures.Glow', 'class': 'Texture'},
                                         'properties': {'AnimNext': {'object': 'Textures.Next'}, 'MinFrameRate': 18, 'TotalFrameNum': 4}, 'effectiveProperties': {}}],
                      'unresolvedDependencies': [], 'stages': []}
        self.manifest = {'schemaVersion': 1, 'kind': 'native-effect-bundle', 'id': 'fixture', 'skillId': 3, 'level': 1,
                         'sourceGraph': 'effect-source.json', 'assets': self.assets, 'sourceFiles': [{'path': 'unopened/original.u', 'sha256': '0' * 64, 'bytes': 12}],
                         'associations': []}
        self.save()

    def add_asset(self, obj, kind, name, data):
        prefix = 'assets/' + kind
        asset = {'schemaVersion': 1, 'id': 'interlude:' + obj, 'kind': kind, 'source': {'object': obj, 'sha256': '1' * 64},
                 {'model': 'model', 'texture': 'image', 'audio': 'audio'}[kind]: {'file': name},
                 'files': [{'path': name, 'bytes': len(data), 'sha256': sha256_hex_digest(data)}]}
        archive = ('retained-archive-' + obj).encode()
        self.payloads[prefix + '/' + name] = data; self.payloads[prefix + '/asset.json'] = json_bytes(asset)
        self.payloads[prefix + '/asset.l2asset'] = archive
        self.assets.append({'object': obj, 'id': asset['id'], 'kind': kind, 'manifest': prefix + '/asset.json',
                            'primary': prefix + '/' + name, 'archive': prefix + '/asset.l2asset', 'archiveSha256': sha256_hex_digest(archive)})

    def save(self):
        self.payloads['effect-source.json'] = json_bytes(self.graph)
        for name, data in self.payloads.items():
            path = self.bundle / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
        self.manifest['files'] = [{'file': n, 'bytes': len(d), 'sha256': sha256_hex_digest(d)} for n, d in sorted(self.payloads.items())]
        self.write_manifest()

    def write_manifest(self):
        (self.bundle / 'manifest.json').write_bytes(json_bytes(self.manifest))

    def test_actual_material_defaults_order_enum_and_unknown_fields(self):
        report, _ = inspect(self.bundle)
        self.assertEqual([c['object'] for c in report['components']], ['Effects.Cast.Sprite0', 'Effects.Cast.Mesh0'])
        mesh = report['components'][1]; material = mesh['primitiveMaterials'][0]
        self.assertEqual(mesh['sourcePointer'], '/effects/0/children/0')
        self.assertEqual(material['alphaMode'], 'OPAQUE'); self.assertIs(material['doubleSided'], False)
        self.assertEqual(material['textureIdentityStatus'], 'exact-converted-image-bytes')
        self.assertEqual(mesh['enums'][0]['definitions'][0]['labels'], ['PTDS_Translucent'])
        self.assertIn('UnknownRuntimeField', mesh['unimplementedEffectiveFields'])
        self.assertEqual(mesh['effectiveProperties']['UnknownRuntimeField'], {'unparsedHex': 'abcd'})
        self.assertEqual(report['coverage']['resourceReadyComponents'], 2)
        self.assertEqual(report['coverage']['runtimePlayableComponents'], 0)
        self.assertEqual(report['sourceFiles'], self.manifest['sourceFiles'])

    def test_sound_candidate_and_texture_links_never_become_playback(self):
        report, _ = inspect(self.bundle)
        sound = report['audio']['references'][0]
        self.assertEqual(sound['identityMatch'], 'package-leaf-candidate'); self.assertFalse(sound['executable'])
        self.assertEqual(sound['rawReference'], 'Sound.Cast')
        tex = report['textureGraph'][0]
        self.assertEqual(tex['animationProperties']['AnimNext']['object'], 'Textures.Next')
        self.assertFalse(tex['loopInferred']); self.assertFalse(tex['runtimePlaybackImplemented'])

    def test_output_and_verify_are_deterministic_and_preserve_inputs(self):
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.bundle.rglob('*') if p.is_file()}
        self.assertEqual(run(self.bundle, self.output)['status'], 'produced')
        stamp = self.output.stat().st_mtime_ns
        self.assertEqual(run(self.bundle / 'manifest.json', self.output, verify=True)['status'], 'verified')
        self.assertEqual(run(self.bundle, self.output)['status'], 'preserved')
        self.assertEqual(stamp, self.output.stat().st_mtime_ns)
        self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before})

    def test_corrupt_hash_is_refused(self):
        (self.bundle / 'assets/model/model.glb').write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'bytes/hash'): inspect(self.bundle)

    def test_traversal_is_refused_before_read(self):
        self.manifest['files'][0]['file'] = '../outside'; self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'Unsafe'): inspect(self.bundle)

    def test_duplicate_declared_outputs_are_refused(self):
        self.manifest['files'].append(copy.deepcopy(self.manifest['files'][0])); self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'Duplicate declared'): inspect(self.bundle)

    def test_duplicate_asset_identity_is_refused(self):
        self.manifest['assets'].append(copy.deepcopy(self.assets[0])); self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'ambiguous asset'): inspect(self.bundle)

    def test_duplicate_symbols_are_refused(self):
        self.graph['effects'][0]['properties']['Emitters'] = [{'symbol': 'Mesh0'}, {'symbol': 'Mesh0'}]; self.save()
        with self.assertRaisesRegex(ValueError, 'duplicate emitter symbol'): inspect(self.bundle)

    def test_ambiguous_child_names_are_refused(self):
        self.graph['effects'][0]['children'][1]['name'] = 'mEsH0'; self.save()
        with self.assertRaisesRegex(ValueError, 'ambiguous emitter name'): inspect(self.bundle)

    def test_unreferenced_child_is_refused(self):
        self.graph['effects'][0]['properties']['Emitters'].pop(); self.save()
        with self.assertRaisesRegex(ValueError, 'Unreferenced'): inspect(self.bundle)

    def test_source_graph_must_be_declared_and_match_identity(self):
        self.manifest['sourceGraph'] = 'other.json'; self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'Undeclared'): inspect(self.bundle)
        self.manifest['sourceGraph'] = 'effect-source.json'; self.graph['skillRow']['skill_id'] = 9; self.save()
        with self.assertRaisesRegex(ValueError, 'skill binding'): inspect(self.bundle)

    def test_unknown_emitter_class_is_preserved_not_resource_ready(self):
        self.graph['effects'][0]['children'][0]['class'] = 'Custom.Unknown'; self.save()
        report, _ = inspect(self.bundle)
        self.assertFalse(report['components'][1]['resourceReady'])
        self.assertEqual(report['components'][1]['class'], 'Custom.Unknown')

    def test_model_image_mismatch_remains_explicit(self):
        glb = model_bytes(image=b'other-retained-image')
        self.payloads['assets/model/model.glb'] = glb
        asset = json.loads(self.payloads['assets/model/asset.json']); asset['files'][0].update(bytes=len(glb), sha256=sha256_hex_digest(glb))
        self.payloads['assets/model/asset.json'] = json_bytes(asset); self.save()
        report, _ = inspect(self.bundle)
        self.assertFalse(report['components'][1]['resourceReady'])
        self.assertEqual(report['components'][1]['primitiveMaterials'][0]['textureIdentityStatus'], 'unproved-or-different-image-route')

    def test_explicit_glb_material_flags_are_reported(self):
        material = {'alphaMode': 'BLEND', 'doubleSided': True, 'extras': {'nativeSourceReference': 'Textures.Glow'},
                    'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}}}
        self.replace_model(model_bytes(material=material))
        report, _ = inspect(self.bundle)
        result = report['components'][1]['primitiveMaterials'][0]
        self.assertEqual(result['alphaMode'], 'BLEND'); self.assertTrue(result['doubleSided'])
        self.assertFalse(report['components'][1]['runtimePlayable'])

    def replace_model(self, data):
        self.payloads['assets/model/model.glb'] = data
        asset = json.loads(self.payloads['assets/model/asset.json'])
        asset['files'][0].update(bytes=len(data), sha256=sha256_hex_digest(data))
        self.payloads['assets/model/asset.json'] = json_bytes(asset); self.save()

    def test_hash_valid_but_malformed_glb_is_refused(self):
        self.replace_model(b'not-a-glb')
        with self.assertRaisesRegex(ValueError, 'GLB header'): inspect(self.bundle)

    def test_asset_primary_join_is_checked(self):
        self.assets[0]['primary'] = self.assets[1]['primary']; self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'primary binding'): inspect(self.bundle)

    def test_asset_internal_payload_pin_is_checked(self):
        asset = json.loads(self.payloads['assets/model/asset.json']); asset['files'][0]['sha256'] = '0' * 64
        self.payloads['assets/model/asset.json'] = json_bytes(asset); self.save()
        with self.assertRaisesRegex(ValueError, 'payload pin'): inspect(self.bundle)

    def test_output_cannot_write_inside_bundle(self):
        with self.assertRaisesRegex(ValueError, 'outside'): run(self.bundle, self.bundle / 'report.json')
        self.assertFalse((self.bundle / 'report.json').exists())

    def test_verify_requires_exact_existing_bytes(self):
        with self.assertRaisesRegex(ValueError, 'existing report'): run(self.bundle, self.output, verify=True)
        self.output.write_bytes(b'existing'); before = self.output.read_bytes()
        with self.assertRaisesRegex(ValueError, 'differs'): run(self.bundle, self.output, verify=True)
        self.assertEqual(self.output.read_bytes(), before)

    def test_reparse_input_and_output_paths_are_refused_without_os_link_privilege(self):
        output_dir = self.root / 'linked-output'; output_dir.mkdir()
        original = Path.lstat
        def reparse(path):
            value = original(path)
            return SimpleNamespace(st_mode=value.st_mode, st_file_attributes=0x400) if path in (self.bundle, output_dir) else value
        with patch.object(Path, 'lstat', reparse):
            with self.assertRaisesRegex(ValueError, 'reparse'): inspect(self.bundle)
        def output_reparse(path):
            value = original(path)
            return SimpleNamespace(st_mode=value.st_mode, st_file_attributes=0x400) if path == output_dir else value
        with patch.object(Path, 'lstat', output_reparse):
            with self.assertRaisesRegex(ValueError, 'reparse'): run(self.bundle, output_dir / 'report.json')


if __name__ == '__main__':
    unittest.main()
