from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from material_graph_fixture import build_synthetic_material_package, synthetic_export
from native_assets_lib.class_defaults import ReferenceClientClassScripts
from native_assets_lib.material_graph import MaterialGraphError, REVIEWED_MATERIAL_CLASSES, read_material_graph
from native_assets_lib.material_program import MaterialProgramError, derive_material_program, read_material_class_defaults
from native_assets_lib.material_resources import MaterialResourceError, write_native_material_resources
from native_catalog.effects import UELIB
from native_catalog.ue2 import Package
from native_store.canonical_json import canonical_json_bytes
from native_store.gap_rows import SEED_GAP_REASONS_PATH, load_gap_reason_patterns
from native_store.store_paths import ConverterOutputRefusedError
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, require_reference_client
from synthetic_class_scripts import SyntheticClassScripts, scratch_work_root

CONVERSION_CLIENT_ROOT = Path('E:/Lineage2-client')
MAIN_FIXTURE = 'shader-combiner-panner-texture.json'
UNPORTED_FIXTURE = 'unported-classes-and-features.json'
SYNTHETIC_OUTPUT_BLENDING_MEMBERS = ['OB_Zero', 'OB_One', 'OB_Two', 'OB_Three']
SYNTHETIC_FRAME_BUFFER_BLENDING_MEMBERS = ['FB_Overwrite', 'FB_Modulate', 'FB_AlphaBlend', 'FB_AlphaModulate_MightNotFogCorrectly',
                                           'FB_Translucent', 'FB_Darken', 'FB_Brighten', 'FB_Invisible', 'FB_Add']
SYNTHETIC_TRIGGER_ACTION_MEMBERS = ['MSTA_Ignore', 'MSTA_Reset', 'MSTA_Pause', 'MSTA_Stop']


def declaration(field, declared_type, declaring_class, provenance='ue-zero', value=None, value_declaring_class=None, enum_members=None):
    return {'field': field, 'declaredType': declared_type, 'declaringClass': declaring_class, 'enumMembers': enum_members,
            'classDefault': {'field': field, 'value': value, 'provenance': provenance,
                             'declaringClass': value_declaring_class or declaring_class}}


SYNTHETIC_CLASS_DEFAULTS = {
    'Engine.Shader': [
        declaration('FallbackMaterial', 'Material', 'Engine.Material'),
        declaration('Diffuse', 'editinlineuse Material', 'Engine.Shader'),
        declaration('Opacity', 'editinlineuse Material', 'Engine.Shader'),
        declaration('Specular', 'editinlineuse Material', 'Engine.Shader'),
        declaration('SelfIllumination', 'editinlineuse Material', 'Engine.Shader'),
        declaration('OutputBlending', 'Shader.EOutputBlending', 'Engine.Shader', enum_members=SYNTHETIC_OUTPUT_BLENDING_MEMBERS),
        declaration('TwoSided', 'bool', 'Engine.Shader'),
        declaration('DetailScale', 'float', 'Engine.Shader', 'authored', 8.0),
    ],
    'Engine.Combiner': [
        declaration('CombineOperation', 'Combiner.EColorOperation', 'Engine.Combiner', enum_members=['CO_A', 'CO_B', 'CO_C']),
        declaration('Material1', 'editinlineuse Material', 'Engine.Combiner'),
        declaration('Material2', 'editinlineuse Material', 'Engine.Combiner'),
        declaration('Modulate2X', 'bool', 'Engine.Combiner'),
    ],
    'Engine.TexPanner': [
        declaration('Material', 'editinlineuse Material', 'Engine.Modifier'),
        declaration('TexCoordSource', 'TexModifier.ETexCoordSrc', 'Engine.TexModifier', 'class-default', 1, 'Engine.TexModifier',
                    ['TCS_Zero', 'TCS_One']),
        declaration('PanDirection', 'Rotator', 'Engine.TexPanner'),
        declaration('PanRate', 'float', 'Engine.TexPanner', 'authored', 0.1),
    ],
    'Engine.Texture': [
        declaration('USize', 'const int', 'Engine.BitmapMaterial'),
        declaration('Format', 'BitmapMaterial.ETextureFormat', 'Engine.BitmapMaterial', enum_members=['F0', 'F1', 'F2', 'F3']),
        declaration('Palette', 'Palette', 'Engine.Texture'),
        declaration('bMasked', 'bool', 'Engine.Texture'),
        declaration('AnimNext', 'Texture', 'Engine.Texture'),
    ],
    'Engine.MaterialSequence': [
        declaration('SequenceItems', 'array<MaterialSequenceItem>', 'Engine.MaterialSequence'),
        declaration('TriggerAction', 'MaterialSequence.EMaterialSequenceTriggerActon', 'Engine.MaterialSequence',
                    enum_members=SYNTHETIC_TRIGGER_ACTION_MEMBERS),
        declaration('Loop', 'bool', 'Engine.MaterialSequence', 'authored', True),
    ],
    'Engine.FinalBlend': [
        declaration('Material', 'editinlineuse Material', 'Engine.Modifier'),
        declaration('FrameBufferBlending', 'FinalBlend.EFrameBufferBlending', 'Engine.FinalBlend',
                    enum_members=SYNTHETIC_FRAME_BUFFER_BLENDING_MEMBERS),
    ],
}


def graph_of(fixture_name, root_name):
    package = build_synthetic_material_package(fixture_name)
    return package, read_material_graph(package, synthetic_export(package, root_name))


def fields_of(program, node_id):
    node = next(node for node in program['nodes'] if node['id'] == node_id)
    return {field['field']: field for field in node['fields']}


class MaterialGraphReaderTests(unittest.TestCase):
    def test_shader_combiner_panner_texture_graph_keeps_every_node_tag_and_reference(self):
        package, graph = graph_of(MAIN_FIXTURE, 'SkyShader')
        self.assertEqual((graph['schemaVersion'], graph['kind'], graph['root']), (1, 'ue2-material-graph', 'SyntheticMaterials.SkyShader'))
        self.assertEqual(graph['package'], {'file': 'SyntheticMaterials.utx', 'sha256': package.source_hash, 'packageVersion': 123, 'licensee': 28})
        self.assertEqual([(node['object'], node['classObject'], node['status']) for node in graph['nodes']], [
            ('SyntheticMaterials.SkyShader', 'Engine.Shader', 'reviewed'),
            ('SyntheticMaterials.SkyCombiner', 'Engine.Combiner', 'reviewed'),
            ('SyntheticMaterials.SkyPanner', 'Engine.TexPanner', 'reviewed'),
            ('SyntheticMaterials.SkyTexture', 'Engine.Texture', 'reviewed')])
        for node in graph['nodes']:
            item = package.exports[node['exportIndex'] - 1]
            self.assertEqual(node['propertyTags'], package.properties(item)[0])
            export_bytes = package.data[item['offset']:item['offset'] + item['size']]
            self.assertEqual(node['export'], {'offset': item['offset'], 'bytes': item['size'], 'sha256': hashlib.sha256(export_bytes).hexdigest()})
        texture_tail = graph['nodes'][3]['nativeTail']
        self.assertEqual((texture_tail['bytes'], texture_tail['sha256']), (5, hashlib.sha256(bytes.fromhex('0102030405')).hexdigest()))
        self.assertEqual([(reference['from'].split('.')[1], reference['property'], reference['to'], reference['target']) for reference in graph['references']], [
            ('SkyShader', 'Diffuse', 'SyntheticMaterials.SkyCombiner', 'export'),
            ('SkyShader', 'Opacity', 'SharedTextures.Mask', 'import'),
            ('SkyCombiner', 'Material1', 'SyntheticMaterials.SkyPanner', 'export'),
            ('SkyCombiner', 'Material2', 'SyntheticMaterials.SkyTexture', 'export'),
            ('SkyPanner', 'Material', 'SyntheticMaterials.SkyTexture', 'export')])
        self.assertEqual(graph['references'][1]['importClass'], 'Engine.Texture')
        self.assertEqual(graph['gapReasons'], [])
        self.assertEqual(json.loads(canonical_json_bytes(graph)), graph)

    def test_unreviewed_class_returns_its_reason_and_the_raw_graph_stays_whole(self):
        package, graph = graph_of(UNPORTED_FIXTURE, 'TriggeredOscillator')
        self.assertEqual(graph['gapReasons'], ['material-class-unported:Engine.TexOscillatorTriggered'])
        self.assertEqual([(node['object'].split('.')[1], node['status'], node['gapReasons']) for node in graph['nodes']], [
            ('TriggeredOscillator', 'unported', ['material-class-unported:Engine.TexOscillatorTriggered']),
            ('PlainTexture', 'reviewed', []),
            ('PlainPalette', 'preserved-data', [])])
        self.assertEqual(graph['nodes'][0]['propertyTags'], package.properties(synthetic_export(package, 'TriggeredOscillator'))[0])
        self.assertEqual(graph['nodes'][2]['nativeTail']['bytes'], 4)

    def test_an_array_property_of_a_reviewed_class_returns_a_feature_reason(self):
        _, graph = graph_of(UNPORTED_FIXTURE, 'TriggeredSequence')
        self.assertEqual(graph['gapReasons'], ['material-feature-unported:SequenceItems'])

    def test_an_animation_chain_may_loop_and_is_kept_as_references(self):
        _, graph = graph_of(UNPORTED_FIXTURE, 'LoopFrameA')
        self.assertEqual([node['object'] for node in graph['nodes']], ['SyntheticUnported.LoopFrameA', 'SyntheticUnported.LoopFrameB'])
        self.assertEqual([(reference['from'], reference['property'], reference['to']) for reference in graph['references']], [
            ('SyntheticUnported.LoopFrameA', 'AnimNext', 'SyntheticUnported.LoopFrameB'),
            ('SyntheticUnported.LoopFrameB', 'AnimNext', 'SyntheticUnported.LoopFrameA')])

    def test_cycles_foreign_roots_and_forged_references_are_refused(self):
        package = build_synthetic_material_package(UNPORTED_FIXTURE)
        with self.assertRaisesRegex(MaterialGraphError, r'cycle through SyntheticUnported\.Cycle'):
            read_material_graph(package, synthetic_export(package, 'CycleShader'))
        with self.assertRaisesRegex(MaterialGraphError, 'not an export'):
            read_material_graph(package, dict(synthetic_export(package, 'PlainTexture')))
        forged = build_synthetic_material_package(MAIN_FIXTURE)
        original_properties = forged.properties

        def forged_properties(item):
            tags, tail = original_properties(item)
            for tag in tags:
                if tag['name'] == 'Diffuse':
                    tag['value'] = {'index': tag['value']['index'], 'object': 'SyntheticMaterials.Elsewhere'}
            return tags, tail
        forged.properties = forged_properties
        with self.assertRaisesRegex(MaterialGraphError, 'not its table entry'):
            read_material_graph(forged, synthetic_export(forged, 'SkyShader'))

    def test_the_reviewed_class_list_is_the_material_runtime_list(self):
        self.assertEqual(REVIEWED_MATERIAL_CLASSES, (
            'Engine.Shader', 'Engine.Combiner', 'Engine.FinalBlend', 'Engine.ColorModifier', 'Engine.FadeColor', 'Engine.ConstantColor',
            'Engine.TexPanner', 'Engine.TexRotator', 'Engine.TexOscillator', 'Engine.TexScaler', 'Engine.TexEnvMap',
            'Engine.TexCoordSource', 'Engine.MaterialSequence', 'Engine.Texture'))


class MaterialProgramTests(unittest.TestCase):
    def test_every_field_is_authored_a_class_default_or_a_ue_zero(self):
        _, graph = graph_of(MAIN_FIXTURE, 'SkyShader')
        program = derive_material_program(graph, SYNTHETIC_CLASS_DEFAULTS)
        self.assertEqual((program['schemaVersion'], program['kind'], program['root'], program['gapReasons']),
                         (1, 'ue2-material-program', 'SyntheticMaterials.SkyShader', []))
        self.assertEqual(program['graphSha256'], hashlib.sha256(canonical_json_bytes(graph)).hexdigest())
        shader = fields_of(program, 'SyntheticMaterials.SkyShader')
        self.assertEqual({name: (field['provenance'], field['value']) for name, field in shader.items()}, {
            'FallbackMaterial': ('ue-zero', None),
            'Diffuse': ('authored', {'node': 'SyntheticMaterials.SkyCombiner'}),
            'Opacity': ('authored', {'externalObject': 'SharedTextures.Mask'}),
            'Specular': ('authored', None),
            'SelfIllumination': ('ue-zero', None),
            'OutputBlending': ('authored', {'ordinal': 3, 'name': 'OB_Three'}),
            'TwoSided': ('authored', True),
            'DetailScale': ('class-default', 8.0)})
        self.assertEqual(shader['DetailScale']['valueDeclaringClass'], 'Engine.Shader')
        panner = fields_of(program, 'SyntheticMaterials.SkyPanner')
        self.assertEqual((panner['TexCoordSource']['provenance'], panner['TexCoordSource']['value']),
                         ('class-default', {'ordinal': 1, 'name': 'TCS_One'}))
        self.assertEqual((panner['PanRate']['provenance'], panner['PanRate']['value']), ('authored', 0.25))
        self.assertEqual((panner['PanDirection']['status'], panner['PanDirection']['value']),
                         ('raw', {'rawHex': '000000000040000000000000', 'propertyType': 10, 'structName': 'Rotator'}))
        texture = fields_of(program, 'SyntheticMaterials.SkyTexture')
        self.assertEqual({name: field['provenance'] for name, field in texture.items()},
                         {'USize': 'authored', 'Format': 'authored', 'Palette': 'ue-zero', 'bMasked': 'authored', 'AnimNext': 'ue-zero'})
        for node in program['nodes']:
            for field in node['fields']:
                self.assertIn(field['provenance'], ('authored', 'class-default', 'ue-zero'))

    def test_an_unreviewed_class_has_no_typed_fields_and_keeps_its_reason(self):
        _, graph = graph_of(UNPORTED_FIXTURE, 'TriggeredOscillator')
        program = derive_material_program(graph, SYNTHETIC_CLASS_DEFAULTS)
        oscillator = program['nodes'][0]
        self.assertEqual((oscillator['status'], oscillator['fields'], oscillator['gapReasons']),
                         ('unported', [], ['material-class-unported:Engine.TexOscillatorTriggered']))
        self.assertEqual(program['nodes'][2]['status'], 'preserved-data')
        self.assertEqual(program['gapReasons'], ['material-class-unported:Engine.TexOscillatorTriggered'])

    def test_triggered_modifiers_and_undeclared_properties_stay_unported_without_evaluation(self):
        _, graph = graph_of(UNPORTED_FIXTURE, 'TriggeredSequence')
        program = derive_material_program(graph, SYNTHETIC_CLASS_DEFAULTS)
        self.assertEqual(program['gapReasons'], ['material-feature-unported:SequenceItems', 'material-feature-unported:TriggerAction',
                                                 'material-feature-unported:UnknownSetting'])
        sequence = fields_of(program, 'SyntheticUnported.TriggeredSequence')
        self.assertEqual((sequence['TriggerAction']['status'], sequence['TriggerAction']['value']),
                         ('unported', {'ordinal': 2, 'name': 'MSTA_Pause'}))
        self.assertEqual((sequence['UnknownSetting']['status'], sequence['UnknownSetting']['declaredType']), ('unported', None))
        self.assertEqual(sequence['SequenceItems']['status'], 'unported')
        self.assertEqual((sequence['Loop']['provenance'], sequence['Loop']['status']), ('class-default', 'typed'))
        _, quiet_graph = graph_of(UNPORTED_FIXTURE, 'QuietSequence')
        self.assertEqual(derive_material_program(quiet_graph, SYNTHETIC_CLASS_DEFAULTS)['gapReasons'], [])

    def test_final_blend_add_stays_unconfirmed_with_a_feature_reason(self):
        _, graph = graph_of(UNPORTED_FIXTURE, 'AddBlend')
        program = derive_material_program(graph, SYNTHETIC_CLASS_DEFAULTS)
        final_blend = fields_of(program, 'SyntheticUnported.AddBlend')
        self.assertEqual((final_blend['FrameBufferBlending']['status'], final_blend['FrameBufferBlending']['value']),
                         ('unconfirmed', {'ordinal': 8, 'name': 'FB_Add'}))
        self.assertEqual(program['gapReasons'], ['material-feature-unported:FrameBufferBlending'])

    def test_malformed_enums_and_missing_class_defaults_are_refused(self):
        _, graph = graph_of(MAIN_FIXTURE, 'SkyShader')
        with self.assertRaisesRegex(MaterialProgramError, 'no class defaults'):
            derive_material_program(graph, {key: value for key, value in SYNTHETIC_CLASS_DEFAULTS.items() if key != 'Engine.Combiner'})
        narrow_enums = copy.deepcopy(SYNTHETIC_CLASS_DEFAULTS)
        narrow_enums['Engine.Shader'][5]['enumMembers'] = ['OB_Zero']
        with self.assertRaisesRegex(MaterialProgramError, 'outside 1 declared members'):
            derive_material_program(graph, narrow_enums)

    def test_class_defaults_are_read_once_per_reviewed_class_without_core_object_fields(self):
        scripts = SyntheticClassScripts({
            'Core.Object': (None, 'class Object;\nvar int ObjectInternal;\n'),
            'Engine.Material': ('Core.Object', 'class Material extends Object;\nvar() Material FallbackMaterial;\n'),
            'Engine.Texture': ('Engine.Material', 'class Texture extends Material;\nvar() Palette Palette;\nvar() int USize;\n'
                                                  'defaultproperties\n{\n    USize=8\n}\n'),
        })
        _, graph = graph_of(UNPORTED_FIXTURE, 'PlainTexture')
        class_defaults = read_material_class_defaults(graph, scratch_work_root(self, 'material-program-'), scripts)
        self.assertEqual(class_defaults, {'Engine.Texture': [
            {'field': 'FallbackMaterial', 'declaredType': 'Material', 'declaringClass': 'Engine.Material', 'enumMembers': None,
             'classDefault': {'field': 'FallbackMaterial', 'value': None, 'provenance': 'ue-zero', 'declaringClass': 'Engine.Material'}},
            {'field': 'Palette', 'declaredType': 'Palette', 'declaringClass': 'Engine.Texture', 'enumMembers': None,
             'classDefault': {'field': 'Palette', 'value': None, 'provenance': 'ue-zero', 'declaringClass': 'Engine.Texture'}},
            {'field': 'USize', 'declaredType': 'int', 'declaringClass': 'Engine.Texture', 'enumMembers': None,
             'classDefault': {'field': 'USize', 'value': 8, 'provenance': 'authored', 'declaringClass': 'Engine.Texture'}}]})
        self.assertEqual(scripts.decompiled_classes, ['Engine.Texture', 'Engine.Material', 'Core.Object'])
        texture = fields_of(derive_material_program(graph, class_defaults), 'SyntheticUnported.PlainTexture')
        self.assertEqual({name: (field['provenance'], field['value']) for name, field in texture.items()}, {
            'FallbackMaterial': ('ue-zero', None), 'Palette': ('authored', {'node': 'SyntheticUnported.PlainPalette'}),
            'USize': ('authored', 64)})


class MaterialResourceWriterTests(unittest.TestCase):
    def test_writer_refuses_the_shared_store_and_writes_graph_and_program_with_matching_records(self):
        _, graph = graph_of(MAIN_FIXTURE, 'SkyShader')
        program = derive_material_program(graph, SYNTHETIC_CLASS_DEFAULTS)
        with self.assertRaises(ConverterOutputRefusedError):
            write_native_material_resources(ROOT / 'public' / 'l2', graph, program)
        output_root = scratch_work_root(self, 'material-resources-') / 'l2'
        written = write_native_material_resources(output_root, graph, program)
        self.assertRegex(written['directory'], r'^native-materials/[0-9a-f]{64}$')
        self.assertEqual([record['path'].rsplit('/', 1)[1] for record in written['files']], ['graph.json', 'program.json'])
        for record in written['files']:
            payload = (output_root / record['path']).read_bytes()
            self.assertEqual((record['sha256'], record['bytes']), (hashlib.sha256(payload).hexdigest(), len(payload)))
        self.assertEqual(json.loads((output_root / written['files'][0]['path']).read_bytes()), graph)
        self.assertEqual(written['directory'], 'native-materials/' + hashlib.sha256(canonical_json_bytes(program)).hexdigest())
        self.assertEqual(write_native_material_resources(output_root, graph, program), written)
        with self.assertRaisesRegex(MaterialResourceError, 'another graph'):
            write_native_material_resources(output_root, graph, {**program, 'graphSha256': '0' * 64})


@unittest.skipUnless(CONVERSION_CLIENT_ROOT.is_dir() and REFERENCE_CLIENT_LOCK_PATH.is_file() and UELIB.is_file(),
                     'needs --client E:/Lineage2-client, the committed reference client lock and the pinned UELib')
class ReferenceClientMaterialGraphTests(unittest.TestCase):
    def test_every_effect_material_root_of_fx_e_t_converts_with_named_gaps_only(self):
        client_access = require_reference_client(CONVERSION_CLIENT_ROOT)
        package_path = client_access.require_equal_file('textures/FX_E_T.utx')
        package = Package(package_path.read_bytes(), package_path.name)
        work_root = scratch_work_root(self, 'material-graph-client-')
        class_scripts = ReferenceClientClassScripts(CONVERSION_CLIENT_ROOT)
        roots = [item for item in package.exports if item['classObject'] in ('Engine.Shader', 'Engine.Combiner', 'Engine.FinalBlend')]
        gap_reasons, provenances = set(), set()
        for root in roots:
            graph = read_material_graph(package, root)
            program = derive_material_program(graph, read_material_class_defaults(graph, work_root, class_scripts))
            gap_reasons.update(program['gapReasons'])
            provenances.update(field['provenance'] for node in program['nodes'] for field in node['fields'])
            self.assertFalse([field for node in program['nodes'] for field in node['fields'] if field['declaredType'] is None])
        self.assertEqual(len(roots), 46)
        self.assertEqual(gap_reasons, {'material-class-unported:Engine.TexOscillatorTriggered'})
        self.assertEqual(provenances, {'authored', 'class-default', 'ue-zero'})


class MaterialGapReasonTests(unittest.TestCase):
    def test_the_seed_list_names_both_material_reasons_and_no_effect_class_reason(self):
        seed = json.loads(SEED_GAP_REASONS_PATH.read_text(encoding='utf-8'))
        self.assertEqual(seed['listVersion'], 2)
        self.assertIn('material-class-unported:<class>', seed['reasons'])
        self.assertIn('material-feature-unported:<property>', seed['reasons'])
        self.assertFalse([reason for reason in seed['reasons'] if reason.startswith('effect-class-unsupported')])
        patterns = load_gap_reason_patterns()
        for reason in ('material-class-unported:Engine.TexOscillatorTriggered', 'material-feature-unported:FrameBufferBlending'):
            self.assertTrue(any(pattern.fullmatch(reason) for pattern in patterns.values()), reason)
        self.assertFalse(any(pattern.fullmatch('effect-class-unsupported:Engine.SpriteEmitter') for pattern in patterns.values()))


if __name__ == '__main__':
    unittest.main()
