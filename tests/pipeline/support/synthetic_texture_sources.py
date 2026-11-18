from unittest.mock import patch

from native_assets_lib.texture_source_reader import UnsupportedTextureSource, texture_format_unsupported_reason
from world import surface_material_programs

SYNTHETIC_TEXTURE_SOURCE_FORMAT = 'synthetic'


def synthetic_texture_without_a_native_body(package, item):
    return UnsupportedTextureSource(texture_format_unsupported_reason(SYNTHETIC_TEXTURE_SOURCE_FORMAT),
                                    f'synthetic texture {item["object"]} carries properties only and no native mip body')


def use_synthetic_textures_without_a_native_body(test_case):
    patcher = patch.object(surface_material_programs, 'texture_source_or_unsupported', side_effect=synthetic_texture_without_a_native_body)
    patcher.start()
    test_case.addCleanup(patcher.stop)
