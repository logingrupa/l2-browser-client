from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from world import sky_root_conversion
from world.bsp_material_mapping_size import MAPPING_SIZE_ZERO_REASON, MaterialMappingSize
from world.sky_root_conversion import SkyRootConversion

SKY_MATERIAL = 'Sky_T.Shaders.Haze'
SKY_TEXTURE = 'Sky_T.Textures.Ring'
ROOT_EXPORT = {'object': SKY_MATERIAL, 'exportIndex': 1}
TEXTURE_RECEIPT = {'sourceReference': SKY_TEXTURE, 'width': 64, 'height': 32, 'png': {'file': 'Ring.png'}}
ROOT_PROGRAM = {'root': SKY_MATERIAL, 'nodes': [{'id': SKY_MATERIAL, 'fields': [
    {'field': 'Color', 'value': {'rawHex': 'ce9600ff', 'structName': 'Color'}, 'provenance': 'authored'},
    {'field': 'AlphaBlend', 'value': True, 'provenance': 'authored'},
    {'field': 'RenderTwoSided', 'value': False, 'provenance': 'authored'}]}]}


class SkyRootMappingSizeTests(unittest.TestCase):
    def setUp(self):
        material = SimpleNamespace(graph={'nodes': [{'exportIndex': 1, 'status': 'reviewed'}]}, gap_reasons=[])
        packages = mock.Mock(resolve=mock.Mock(return_value=('package', ROOT_EXPORT)))
        replacements = {'SkyMaterialPackages': mock.Mock(return_value=packages), 'ReferenceClientClassScripts': mock.Mock(),
                        'read_sky_material_graph': mock.Mock(return_value=[material]),
                        'sky_texture_products_by_node': mock.Mock(return_value=({SKY_TEXTURE: (TEXTURE_RECEIPT, {'Ring.png': b'ring'})}, [])),
                        'sky_texture_pngs_by_node': mock.Mock(return_value={}), 'sky_material_program': mock.Mock(return_value=ROOT_PROGRAM),
                        'write_material_program_record': mock.Mock(return_value=({'programSha256': 'a' * 64}, [])),
                        'write_material_texture_images': mock.Mock(return_value=[]),
                        'single_graph_texture_export': mock.Mock(return_value={'object': SKY_TEXTURE})}
        for name, replacement in replacements.items():
            patcher = mock.patch.object(sky_root_conversion, name, replacement)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.gaps = mock.Mock()
        self.conversion = SkyRootConversion('client', 'store', 'work', self.gaps)

    def converted_root(self, mapping_outcome):
        with mock.patch.object(sky_root_conversion, 'mapping_size_outcome', return_value=mapping_outcome) as outcome:
            root = self.conversion.convert(SKY_MATERIAL)
        self.assertEqual(outcome.call_args.args[:2], (SKY_MATERIAL, self.conversion.packages))
        return root

    def test_a_sky_root_carries_the_mapping_size_of_its_material(self):
        root = self.converted_root((MaterialMappingSize(1024, 512), []))
        self.assertEqual((root.mapping_size, root.texture), (MaterialMappingSize(1024, 512), TEXTURE_RECEIPT))
        self.gaps.add.assert_not_called()

    def test_a_sky_root_without_a_mapping_size_is_dropped_with_its_named_gap(self):
        self.assertIsNone(self.converted_root((None, [MAPPING_SIZE_ZERO_REASON])))
        self.gaps.add.assert_called_once_with('gap', MAPPING_SIZE_ZERO_REASON, SKY_MATERIAL)
        self.assertEqual(self.conversion.texture_files, {})

    def test_an_undecodable_mapping_size_is_a_failed_row(self):
        reason = 'decode-failed:FormatError:material export missing or ambiguous'
        self.assertIsNone(self.converted_root((None, [reason])))
        self.gaps.add.assert_called_once_with('failed', reason, SKY_MATERIAL)


if __name__ == '__main__':
    unittest.main()
