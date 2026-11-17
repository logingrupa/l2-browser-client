import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from material_graph_fixture import build_synthetic_material_package
from support.mapping_size_class_defaults import use_synthetic_mapping_class_defaults
from support.synthetic_map_sources import SyntheticMapSources
from synthetic_class_scripts import scratch_work_root
from test_material_graph import SYNTHETIC_CLASS_DEFAULTS
from test_material_program_images import synthetic_png_bytes
from world import bsp_surface_materials, surface_material_programs
from world.bsp_material_mapping_size import MAPPING_SIZE_ZERO_REASON, MaterialMappingSize
from world.bsp_surface_materials import convert_surface_material, program_blend_is_translucent
from world.error_detail import conversion_failure_reason

TEXTURED_MATERIAL_FIXTURE = 'shader-combiner-panner-texture.json'
TEXTURED_MATERIAL = 'SyntheticMaterials.SkyShader'
TEXTURED_MATERIAL_TEXTURE = 'SyntheticMaterials.SkyTexture'


def blend_root_program(class_name, field_name, members, ordinal):
    root = {'id': 'Synthetic.Root', 'class': class_name, 'status': 'reviewed',
            'fields': [{'field': field_name, 'value': {'ordinal': ordinal, 'name': members[ordinal]}}]}
    return {'root': root['id'], 'nodes': [root]}


class SurfaceMaterialTests(unittest.TestCase):
    def textured_surface_outcome(self, convert_texture, bake_material_texture=lambda work, identity: (synthetic_png_bytes(), {}, identity, [])):
        map_sources = SyntheticMapSources(build_synthetic_material_package(TEXTURED_MATERIAL_FIXTURE))
        converted_references = []

        def texture(work, reference):
            converted_references.append(reference)
            return convert_texture(reference), {}, reference

        converter = SimpleNamespace(output=scratch_work_root(self, 'bsp-material-'), texture=texture, material_texture=bake_material_texture)
        store_root = scratch_work_root(self, 'bsp-store-') / 'l2'
        use_synthetic_mapping_class_defaults(self)
        with patch.object(surface_material_programs, 'kept_material_class_defaults', return_value=SYNTHETIC_CLASS_DEFAULTS):
            outcome = convert_surface_material(TEXTURED_MATERIAL, map_sources, converter, store_root, None, store_root)
        program_path = store_root / outcome.material.program['directory'] / 'program.json'
        return outcome, json.loads(program_path.read_bytes()), store_root, converted_references

    def test_every_reviewed_texture_node_is_pinned_by_its_png_and_a_sizeless_material_is_not_baked(self):
        png = synthetic_png_bytes()
        outcome, program, store_root, converted_references = self.textured_surface_outcome(
            lambda reference: png, lambda work, identity: self.fail('a material without a mapping size must not be baked'))
        png_sha256 = hashlib.sha256(png).hexdigest()
        image = {'path': f'/l2/native-materials/textures/{png_sha256}/texture.png', 'sha256': png_sha256, 'bytes': len(png)}
        self.assertEqual(converted_references, [TEXTURED_MATERIAL_TEXTURE])
        self.assertEqual({node['id']: node['image'] for node in program['nodes'] if node['class'] == 'Engine.Texture'},
                         {TEXTURED_MATERIAL_TEXTURE: image})
        self.assertEqual((store_root / image['path'].removeprefix('/l2/')).read_bytes(), png)
        self.assertEqual(sorted(record['path'] for record in outcome.store_outputs),
                         sorted([f'{outcome.material.program["directory"]}/graph.json', f'{outcome.material.program["directory"]}/program.json',
                                 image['path'].removeprefix('/l2/')]))
        self.assertEqual((outcome.material.png, outcome.material.mapping_size), (None, None))
        self.assertIn(MAPPING_SIZE_ZERO_REASON, outcome.gap_reasons)

    def test_a_failed_bake_keeps_the_mapping_size_and_names_its_conversion_gap(self):
        failure = ValueError('UModel failed or reported an error; inspect export.log')

        def refuse_bake(work, identity):
            raise failure

        mapping_size = MaterialMappingSize(256, 256)
        with patch.object(bsp_surface_materials, 'mapping_size_outcome', return_value=(mapping_size, [])):
            outcome, _, _, _ = self.textured_surface_outcome(lambda reference: synthetic_png_bytes(), refuse_bake)
        self.assertEqual((outcome.material.png, outcome.material.mapping_size), (None, mapping_size))
        self.assertIn(conversion_failure_reason(failure), outcome.gap_reasons)

    def test_a_texture_that_fails_conversion_keeps_a_null_image_and_its_conversion_gap_reason(self):
        failure = ValueError('UModel failed or reported an error; inspect export.log')

        def refuse(reference):
            raise failure

        outcome, program, _, _ = self.textured_surface_outcome(refuse)
        self.assertEqual([node['image'] for node in program['nodes'] if node['class'] == 'Engine.Texture'], [None])
        self.assertIn(conversion_failure_reason(failure), outcome.gap_reasons)
        self.assertEqual([record['path'].rsplit('/', 1)[1] for record in outcome.store_outputs], ['graph.json', 'program.json'])

    def test_an_unported_material_class_gets_its_gap_reason_and_no_substitute_texture(self):
        map_sources = SyntheticMapSources(build_synthetic_material_package('unported-classes-and-features.json'))
        converter = SimpleNamespace(output=scratch_work_root(self, 'bsp-material-'),
                                    texture=lambda work, reference: (synthetic_png_bytes(), {}, reference),
                                    material_texture=lambda *arguments: self.fail('an unported root must not be textured'))
        store_root = scratch_work_root(self, 'bsp-store-')
        use_synthetic_mapping_class_defaults(self)
        texture_declarations = [{'field': 'USize', 'declaredType': 'int', 'declaringClass': 'Engine.Texture', 'enumMembers': None,
                                 'classDefault': {'field': 'USize', 'value': None, 'provenance': 'ue-zero', 'declaringClass': 'Engine.Texture'}}]
        with patch.object(surface_material_programs, 'kept_material_class_defaults', return_value={'Engine.Texture': texture_declarations}):
            outcome = convert_surface_material('SyntheticUnported.UnportedGlow', map_sources, converter, store_root, None, store_root)
        self.assertEqual((outcome.material.png, outcome.material.mapping_size), (None, None))
        self.assertIn('material-class-unported:Engine.GlowModifier', outcome.gap_reasons)
        self.assertIn(MAPPING_SIZE_ZERO_REASON, outcome.gap_reasons)
        self.assertTrue(outcome.material.program['directory'].startswith('native-materials/'))

    def test_only_the_depth_writing_shader_and_final_blend_members_are_opaque(self):
        output_blending = ('OB_Normal', 'OB_Masked', 'OB_Modulate', 'OB_Translucent', 'OB_Invisible', 'OB_Brighten', 'OB_Darken')
        frame_buffer_blending = ('FB_Overwrite', 'FB_Modulate', 'FB_AlphaBlend', 'FB_AlphaModulate_MightNotFogCorrectly', 'FB_Translucent',
                                 'FB_Darken', 'FB_Brighten', 'FB_Invisible', 'FB_Add')
        shader = {member: program_blend_is_translucent(blend_root_program('Engine.Shader', 'OutputBlending', output_blending, ordinal))
                  for ordinal, member in enumerate(output_blending)}
        final_blend = {member: program_blend_is_translucent(blend_root_program('Engine.FinalBlend', 'FrameBufferBlending', frame_buffer_blending,
                                                                                ordinal))
                       for ordinal, member in enumerate(frame_buffer_blending)}
        self.assertEqual({member for member, translucent in shader.items() if not translucent}, {'OB_Normal', 'OB_Masked'})
        self.assertEqual({member for member, translucent in final_blend.items() if not translucent}, {'FB_Overwrite'})

    def test_an_ob_normal_shader_with_an_opacity_input_blends_like_the_runtime_and_is_translucent(self):
        program = blend_root_program('Engine.Shader', 'OutputBlending', ('OB_Normal',), 0)
        program['nodes'][0]['fields'].append({'field': 'Opacity', 'value': {'node': 'Synthetic.OpacityTexture'}})
        self.assertTrue(program_blend_is_translucent(program))
        program['nodes'][0]['fields'][-1] = {'field': 'Opacity', 'value': {'externalObject': 'Other.OpacityTexture'}}
        self.assertTrue(program_blend_is_translucent(program))
        program['nodes'][0]['fields'][-1] = {'field': 'Opacity', 'value': None}
        self.assertFalse(program_blend_is_translucent(program))

    def test_a_root_without_a_blend_field_is_opaque(self):
        self.assertFalse(program_blend_is_translucent(blend_root_program('Engine.Texture', 'OutputBlending', ('OB_Translucent',), 0)))
        program = blend_root_program('Engine.Shader', 'OutputBlending', ('OB_Translucent',), 0)
        program['nodes'][0]['fields'] = []
        self.assertFalse(program_blend_is_translucent(program))

    def test_a_missing_material_export_is_a_decode_failure(self):
        map_sources = SyntheticMapSources()
        outcome = convert_surface_material('Missing.Material', map_sources, None, None, None, None)
        self.assertEqual((outcome.material.png, outcome.gap_reasons), (None, ['decode-failed:FormatError:material package missing or ambiguous']))


if __name__ == '__main__':
    unittest.main()
