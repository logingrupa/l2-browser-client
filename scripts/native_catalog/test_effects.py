import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from native_catalog.cli import file_hash, json_bytes
from native_catalog.effects import (SourcePackages, extract, merge_properties,
    parse_uc, parse_value, read_class_defaults, references, select_skill_rows, skill_actions, verify, UELIB)
from native_catalog.ue2 import FormatError

CLIENT = Path('E:/Lineage2-client')
GRAPH = Path(__file__).resolve().parents[2] / 'artifacts/native-effects/heal.json'


class DefaultPropertyTests(unittest.TestCase):
    def test_nested_ranges_typed_references_and_quoted_commas(self):
        value = parse_value('(Range=(Min=-0.25,Max=1.0),Label="a,b",Asset=Texture\'Pack.Group.Leaf\',Enabled=true)')
        self.assertEqual(value['Range'], {'Min': -0.25, 'Max': 1.0})
        self.assertEqual(value['Label'], 'a,b')
        self.assertEqual(value['Asset'], {'class': 'Texture', 'object': 'Pack.Group.Leaf'})
        self.assertIs(value['Enabled'], True)
        with self.assertRaises(FormatError):
            parse_value('(Range=(Min=1,Max=2)')

    def test_child_defaults_keep_qualified_assets_and_unparsed_fields(self):
        script = '''class Example extends Emitter;
enum EStyle { First, Second };
native function Trigger();
defaultproperties
{
 begin object name="Sprite0" class=Engine.SpriteEmitter
  Texture=Texture'Effects.Particle.White'
  StartSizeRange=(X=(Min=3.0,Max=5.0))
 end object
 Emitters[0]=Sprite0
 Unknown=!unsupported
}
'''
        result = parse_uc(script, 'Effects.Example')
        self.assertEqual(result['children'][0]['properties']['Texture']['object'], 'Effects.Particle.White')
        self.assertEqual(result['properties']['Emitters'], [{'symbol': 'Sprite0'}])
        self.assertEqual(result['enums']['EStyle'], {'First': 0, 'Second': 1})
        self.assertEqual(len(result['unparsed']), 1)
        self.assertEqual(len(result['nativeDeclarations']), 1)

    def test_inheritance_merges_authored_struct_fields_without_invented_defaults(self):
        base = {'Range': {'X': 1, 'Y': 2}, 'Flag': True}
        result = merge_properties(base, {'Range': {'X': 3}})
        self.assertEqual(result, {'Range': {'X': 3, 'Y': 2}, 'Flag': True})
        result['Range']['Y'] = 4
        self.assertEqual(base['Range']['Y'], 2)
        self.assertNotIn('DrawScale', result)

    def test_reference_traversal_does_not_stop_at_emitter_identity(self):
        child = {'class': 'Engine.SpriteEmitter', 'object': 'FX.Cast.Sprite0',
            'properties': {'Texture': {'class': 'Texture', 'object': 'FXTextures.White'}}}
        refs = list(references({'children': [child]}))
        self.assertIn(('children[0]', 'Engine.SpriteEmitter', 'FX.Cast.Sprite0'), refs)
        self.assertIn(('children[0].properties.Texture', 'Texture', 'FXTextures.White'), refs)

    def test_explicit_skill_level_and_visual_reference_are_required(self):
        skill = {'data': {'skill': [{'skill_id': 1011, 'skill_level': 1, 'description': 'Skill.wh.1011'}]}}
        sound = {'data': {'skillsound': [{'skill_id': 1011, 'skill_level': 1}]}}
        self.assertEqual(select_skill_rows(skill, sound, 1011, 1)[0]['description'], 'Skill.wh.1011')
        with self.assertRaisesRegex(FormatError, 'no fallback'):
            select_skill_rows(skill, sound, 1011, 2)
        skill['data']['skill'][0]['description'] = ''
        with self.assertRaisesRegex(FormatError, 'no explicit'):
            select_skill_rows(skill, sound, 1011, 1)
        skill['data']['skill'].append(copy.deepcopy(skill['data']['skill'][0]))
        with self.assertRaisesRegex(FormatError, 'unique'):
            select_skill_rows(skill, sound, 1011, 1)

    def test_output_inside_source_is_rejected_before_any_write(self):
        # The extraction path must be rejected even if the parser is absent.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            output = root / 'do-not-create' / 'effects.json'
            with self.assertRaises(FormatError):
                extract(root, output, library=root / 'absent.dll')
            self.assertFalse(output.parent.exists())


class EffectReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.client = self.base / 'client'
        self.client.mkdir()
        self.source = self.client / 'native.bin'
        self.source.write_bytes(b'unchanged source bytes')
        self.artifact = self.base / 'class.uc'
        self.artifact.write_bytes(b'class Source extends Object;')
        self.output = self.base / 'effect.json'
        self.graph = {'schemaVersion': 1, 'sourceRoot': str(self.client), 'tools': {},
            'sourceFiles': [{'path': 'native.bin', 'bytes': self.source.stat().st_size, 'sha256': file_hash(self.source)}]}
        self.output.write_bytes(json_bytes(self.graph))
        self.receipt = {'schemaVersion': 1, 'outputSha256': file_hash(self.output), 'tools': {},
            'sourceFiles': self.graph['sourceFiles'], 'artifacts': [
                {'file': 'class.uc', 'bytes': self.artifact.stat().st_size, 'sha256': file_hash(self.artifact)}]}
        self.save_receipt()

    def save_receipt(self):
        self.output.with_suffix('.receipt.json').write_bytes(json_bytes(self.receipt))

    def test_unchanged_files_verify(self):
        self.assertEqual(verify(self.client, self.output), self.graph)

    def test_changed_original_is_rejected(self):
        self.source.write_bytes(b'changed source bytes!!')
        with self.assertRaisesRegex(FormatError, 'source hash mismatch'):
            verify(self.client, self.output)

    def test_changed_graph_and_artifact_are_rejected(self):
        self.artifact.write_bytes(b'changed generated script')
        with self.assertRaisesRegex(FormatError, 'artifact hash mismatch'):
            verify(self.client, self.output)
        self.output.write_bytes(b'{}')
        with self.assertRaisesRegex(FormatError, 'graph hash mismatch'):
            verify(self.client, self.output)

    def test_receipt_path_escape_is_rejected(self):
        self.receipt['artifacts'][0]['file'] = '../outside.uc'
        self.save_receipt()
        with self.assertRaisesRegex(FormatError, 'escapes'):
            verify(self.client, self.output)


@unittest.skipUnless((CLIENT / 'animations/Skill.usk').is_file(), 'Original native client absent')
class NativeSkillEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.packages = SourcePackages(CLIENT.resolve())

    def test_exact_heal_actions_from_source_package(self):
        root, package, item = self.packages.resolve('Skill.wh.1011', 'SkillVisualEffect')
        stages, other = skill_actions(package, item)
        self.assertEqual(root['object'], 'Skill.wh.1011')
        self.assertEqual([stage['stage'] for stage in stages], ['CastingActions', 'ShotActions'])
        self.assertEqual([stage['properties']['EffectClass']['object'] for stage in stages],
            ['LineageEffect.wh_heal_ca', 'LineageEffect.wh_heal_ta'])
        self.assertEqual(stages[0]['properties']['AttachOn'], 5)
        self.assertEqual(stages[0]['properties']['offset'], {'X': 0, 'Y': 0, 'Z': -1})
        self.assertEqual(stages[1]['properties']['bSpawnOnTarget'], True)
        self.assertEqual([(field['name'], field['value']) for field in other], [('Desc', '\ud790')])

    def test_qualified_class_identity_is_checked(self):
        record, _, _ = self.packages.resolve('lineageeffect.wh_heal_ta.SpriteEmitter1', 'Engine.SpriteEmitter')
        self.assertEqual(record['classObject'], 'Engine.SpriteEmitter')
        with self.assertRaisesRegex(FormatError, 'class mismatch'):
            self.packages.resolve('lineageeffect.wh_heal_ta.SpriteEmitter1', 'Other.SpriteEmitter')

    @unittest.skipUnless(UELIB.is_file(), 'Pinned UELib parser absent')
    def test_actor_defaults_keep_exact_head_bone_face_and_hair_mesh_bindings(self):
        with tempfile.TemporaryDirectory() as directory:
            result = read_class_defaults(CLIENT, 'LineageWarrior.MFighter', Path(directory))
        self.assertEqual(result['source']['packageSha256'], '747b1e7c3045c748c08b03b54893dc2d29cf7103379f19804ccbeb7764224558')
        self.assertEqual(result['source']['sourceOffset'], 21839)
        self.assertEqual(result['source']['sourceBytes'], 222)
        self.assertEqual(result['properties']['HeadBone'], 'Bip01_head')
        self.assertEqual(result['properties']['Mesh']['object'], 'Fighter.MFighter_m000_f')
        self.assertEqual([value['object'] for value in result['properties']['SubMeshes'][4:]],
            ['Fighter.MFighter_m000_m00_ah', 'Fighter.MFighter_m000_m00_bh'])
        self.assertNotIn('DrawScale', result['properties'])

    @unittest.skipUnless(GRAPH.is_file(), 'Local extracted effect evidence absent')
    def test_graph_has_native_dependencies_inherited_defaults_and_explicit_limits(self):
        graph = verify(CLIENT, GRAPH)
        self.assertEqual(graph['unresolvedDependencies'], [])
        self.assertEqual(graph['unparsedPropertyCount'], 0)
        objects = {row['object'].lower() for row in graph['dependencies']}
        for reference in ['LineageEffectsStaticmeshes.magiccircle.magiccirclewhite00',
                'LineageEffectsStaticmeshes.magiccircle.magiccirclewhite01',
                'LineageEffectsTextures.Particles.fx_m_t0004',
                'LineageEffectsTextures.Particles.fx_m_t0005', 'skillsound.heal.heal_cast', 'skillsound.heal.heal_shot']:
            self.assertIn(reference.lower(), objects)
        self.assertTrue(graph['stages'][0]['effectiveProperties']['bRelativeToCylinder'])
        self.assertEqual(graph['effects'][0]['effectiveProperties']['DrawScale'], 0.1)
        self.assertFalse(graph['rendererImplemented'])
        self.assertIn('native-attachment', {item['feature'] for item in graph['unsupported']})


if __name__ == '__main__':
    unittest.main()
