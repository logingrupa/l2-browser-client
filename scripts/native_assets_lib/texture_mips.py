import copy

from native_assets_lib.lineage_material_prefix import (UEVIEWER_MATERIAL_HEADER_PATH, UEVIEWER_MATERIAL_HEADER_SHA256, UEVIEWER_REPOSITORY,
                                                     UEVIEWER_REVISION)
from native_assets_lib.texture_package_118 import PACKAGE_118_LAYOUT, read_texture_source_118
from native_assets_lib.texture_source_reader import (OMITTED_FORMAT_EVIDENCE, SHADER_BLOCK_REVIEWED_LICENSEE, UnsupportedTextureSource,
                                                     read_native_texture_source, texture_licensee_unsupported_reason)

REVIEWED_VERSIONS = {(118, 0), (123, 0), (123, 16), (123, 18), (123, 20), (123, 23), (123, 25), (123, 27), (123, 28), (123, 30)}
LAYOUT_EVIDENCE = {
    'repository': UEVIEWER_REPOSITORY,
    'revision': UEVIEWER_REVISION,
    'files': {
        UEVIEWER_MATERIAL_HEADER_PATH: UEVIEWER_MATERIAL_HEADER_SHA256,
        'Unreal/UnrealMaterial/UnTexture2.cpp': '675e3afe367d1bc949fedb03d4301e3ba09391ae606a5c6b1aecb45a7ab7ad72',
        'Unreal/UnCore.h': 'da065ecf22c9f7c9d894111217fb42169691c610b6ce00a2fe62f6af0100d34f',
        'Unreal/UnCoreSerialize.cpp': 'c065a5700f63795c51ccbd98d448dd92be57b32dcbb98a5d39fe6d8c9f0600e5',
    },
    'records': ['UMaterial::Serialize Lineage licensee16..29 reserved int32',
                'UTexture::Serialize', 'FMipmap', 'TLazyArray<byte>', 'UPalette::Serialize', 'UE2 FColor RGBA'],
    'omittedFormat': OMITTED_FORMAT_EVIDENCE,
}
LICENSEE30_EVIDENCE = {
    'file': UEVIEWER_MATERIAL_HEADER_PATH, 'lines': [185, 248],
    'record': 'UMaterial::Serialize exact Lineage licensee30 branch',
    'layout': 'reserved int32; 6 bytes; 3 int32; 8 opaque128-byte blocks; 8 serialized FC color bytes; 3 FC int32 bit patterns; 16 texture FStrings; ShaderCode FString; then mip count',
    'policy': 'Preserve original fields/bytes without matrix, FC color or FC float interpretation. Licensee31+ has additional/different fields and remains unsupported.',
}


def table_layout_record(package_version, licensee):
    evidence = copy.deepcopy(LAYOUT_EVIDENCE)
    if licensee == SHADER_BLOCK_REVIEWED_LICENSEE:
        evidence['licensee30Material'] = copy.deepcopy(LICENSEE30_EVIDENCE)
    return {'packageVersion': package_version, 'licenseeVersion': licensee, 'evidence': evidence}


def read_texture_source_for_layout(package, item):
    layout = (package.summary['version'], package.summary['licenseeVersion'])
    if layout == PACKAGE_118_LAYOUT:
        return read_texture_source_118(package, item)
    return read_native_texture_source(package, item, table_layout_record(*layout))


def build_texture_source(package, item):
    layout = (package.summary['version'], package.summary['licenseeVersion'])
    if layout not in REVIEWED_VERSIONS:
        raise UnsupportedTextureSource(texture_licensee_unsupported_reason(*layout),
                                       'Native texture source layout supports the reviewed texture layouts only; got ' + repr(layout))
    return read_texture_source_for_layout(package, item)
