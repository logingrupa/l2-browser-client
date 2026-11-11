import copy

from native_assets_lib.texture_package_118 import PACKAGE_118_LAYOUT, read_texture_source_118
from native_assets_lib.texture_source_reader import OMITTED_FORMAT_EVIDENCE, UnsupportedTextureSource, read_native_texture_source

REVIEWED_VERSIONS = {(118, 0), (123, 20), (123, 28), (123, 30)}
TEXTURE_LICENSEE_UNSUPPORTED_REASON_PREFIX = 'texture-licensee-unsupported:'
LAYOUT_EVIDENCE = {
    'repository': 'gildor2/UEViewer',
    'revision': 'a0bfb468d42be831b126632fd8a0ae6b3614f981',
    'files': {
        'Unreal/UnrealMaterial/UnMaterial2.h': '9e27b80d6f8c2625decba49745bd65a7f3e54abd957ee7a627e3f4bdb3d8b0c9',
        'Unreal/UnrealMaterial/UnTexture2.cpp': '675e3afe367d1bc949fedb03d4301e3ba09391ae606a5c6b1aecb45a7ab7ad72',
        'Unreal/UnCore.h': 'da065ecf22c9f7c9d894111217fb42169691c610b6ce00a2fe62f6af0100d34f',
        'Unreal/UnCoreSerialize.cpp': 'c065a5700f63795c51ccbd98d448dd92be57b32dcbb98a5d39fe6d8c9f0600e5',
    },
    'records': ['UMaterial::Serialize Lineage licensee16..29 reserved int32',
                'UTexture::Serialize', 'FMipmap', 'TLazyArray<byte>', 'UPalette::Serialize', 'UE2 FColor RGBA'],
    'omittedFormat': OMITTED_FORMAT_EVIDENCE,
}
LICENSEE30_EVIDENCE = {
    'file': 'Unreal/UnrealMaterial/UnMaterial2.h', 'lines': [185, 248],
    'record': 'UMaterial::Serialize exact Lineage licensee30 branch',
    'layout': 'reserved int32; 6 bytes; 3 int32; 8 opaque128-byte blocks; 8 serialized FC color bytes; 3 FC int32 bit patterns; 16 texture FStrings; ShaderCode FString; then mip count',
    'policy': 'Preserve original fields/bytes without matrix, FC color or FC float interpretation. Licensee31+ has additional/different fields and remains unsupported.',
}


def texture_licensee_unsupported_reason(package_version, licensee):
    return f'{TEXTURE_LICENSEE_UNSUPPORTED_REASON_PREFIX}{package_version}/{licensee}'


def table_layout_record(package_version, licensee):
    evidence = copy.deepcopy(LAYOUT_EVIDENCE)
    if licensee == 30:
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
