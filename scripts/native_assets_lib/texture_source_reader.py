import copy
import json

from native_assets_lib.sha256_identity import sha256_hex_digest
from native_catalog.ue2 import FormatError, Reader

FORMATS = {0: 'P8', 3: 'DXT1', 8: 'DXT5'}
P8_FORMAT_ID = 0
DXT5_FORMAT_ID = 8
DXT1_BLOCK_BYTES = 8
DXT5_BLOCK_BYTES = 16
MAX_DIMENSION = 4096
MAX_MIPS = 16
MAX_MIP_BITS = 12
MAX_PAYLOAD = 16 * 1024 * 1024
MAX_NATIVE_MIP_BYTES = 32 * 1024 * 1024
PALETTE_COLOR_COUNT = 256
PALETTE_COLOR_BYTES = 4
TEXTURE_CLASS_OBJECT = 'Engine.Texture'
PALETTE_CLASS_OBJECT = 'Engine.Palette'
BYTE_PROPERTY_TYPE = 1
INTEGER_PROPERTY_TYPE = 2
OBJECT_PROPERTY_TYPE = 5
TEXTURE_FORMAT_UNSUPPORTED_REASON_PREFIX = 'texture-format-unsupported:'
OMITTED_FORMAT_EVIDENCE = {
    'value': 0, 'class': 'Engine.BitmapMaterial', 'field': 'Format',
    'enginePackageSha256': '9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761',
    'bitmapMaterialDeclarationSha256': '5951d394edb45b30a1b0f3ca76cad36349453d8b6d7a703342ba2fbc7f7b76fa',
    'rule': 'Declared enum field zero-initialized; pinned BitmapMaterial/Texture defaults do not override Format. Omission is recorded separately from authored zero.',
}
DXT5_EVIDENCE = {
    'formatEnum': {'file': 'Unreal/UnrealMaterial/UnMaterial2.h', 'lines': [281, 291],
                   'numericValue': 8, 'name': 'TEXF_DXT5'},
    'formatMapping': {'file': 'Unreal/UnrealMaterial/UnTexture2.cpp', 'lines': [507, 509],
                      'result': 'TPF_DXT5'},
    'blockLayout': {'file': 'Unreal/UnrealMaterial/UnTexture.cpp', 'lines': [52, 64],
                    'sha256': '58bda4b6beb837ae8780395ad17ab7ee3dc049a86baa1c3ff5f4bc8a28a8f065',
                    'fourCC': 'DXT5', 'width': 4, 'height': 4, 'bytes': 16},
    'policy': 'Preserve original color and alpha blocks without decoding, normal-map swizzling or alpha interpretation.',
}


class UnsupportedTextureSource(ValueError):
    def __init__(self, reason, message):
        super().__init__(message)
        self.reason = reason


def texture_format_unsupported_reason(format_id):
    return f'{TEXTURE_FORMAT_UNSUPPORTED_REASON_PREFIX}{format_id}'


def require_texture_source(condition, message):
    if not condition:
        raise FormatError(message)


def package_byte_range(package, start, end):
    require_texture_source(type(start) is int and type(end) is int and 0 <= start <= end <= len(package.data),
                           'Texture source range exceeds package bounds')
    return bytes(package.data[start:end])


def export_source_record(package, item):
    export = package_byte_range(package, item['offset'], item['offset'] + item['size'])
    require_texture_source(0 < len(export) <= MAX_PAYLOAD, 'Texture/palette source export exceeds bounded size')
    return export, {'package': package.filename, 'packageSha256': package.source_hash,
                    'object': item['object'], 'exportIndex': item['exportIndex'],
                    'sourceOffset': item['offset'], 'sourceBytes': len(export), 'sourceExportSha256': sha256_hex_digest(export),
                    'offsetSpace': 'unwrapped-native-package'}


def scalar_property_tag(tags, name, expected_type, required=False):
    matches = [tag for tag in tags if tag['name'] == name]
    require_texture_source(len(matches) <= 1, 'Duplicate texture property: ' + name)
    require_texture_source(not required or matches, 'Missing required texture property: ' + name)
    if not matches:
        return None
    tag = matches[0]
    require_texture_source(tag.get('arrayIndex') is None and tag.get('type') == expected_type and tag.get('status') == 'decoded',
                           'Invalid scalar texture property: ' + name)
    return tag


def integer_property(tags, name, expected_type, required=False):
    tag = scalar_property_tag(tags, name, expected_type, required)
    if tag is None:
        return None
    require_texture_source(type(tag.get('value')) is int, 'Non-integer texture property: ' + name)
    return tag['value']


def native_string_record(reader):
    start = reader.position
    length = Reader(reader.data, start, reader.end).compact()
    try:
        value = reader.string()
    except UnicodeError as error:
        raise FormatError('Invalid Unreal material string encoding') from error
    raw = bytes(reader.data[start:reader.position])
    return {'sourceOffset': start, 'sourceBytes': len(raw), 'encodedLength': length,
            'encoding': 'utf-16le' if length < 0 else 'cp1252', 'value': value, 'hex': raw.hex()}


def read_licensee30_material_block(reader):
    start = reader.position
    fields = {'byteFields': {name: reader.number('B') for name in (
        'TextureTranform', 'MAX_SAMPLER_NUM', 'MAX_TEXMAT_NUM', 'MAX_PASS_NUM', 'TwoPassRenderState', 'AlphaRef')},
        'int32Fields': {name: reader.number('i') for name in ('SrcBlend', 'DestBlend', 'OverriddenFogColor')}}
    blocks = []
    for index in range(8):
        offset = reader.position
        raw = bytes(reader.take(128))
        blocks.append({'index': index, 'sourceOffset': offset, 'sourceBytes': len(raw),
                       'hex': raw.hex(), 'sha256': sha256_hex_digest(raw)})
    fields['opaqueMatrixBlocks'] = blocks
    fields['nativeFCColorSourceOffset'] = reader.position
    fields['nativeFCColorBytesHex'] = reader.take(8).hex()
    fields['fcInt32Fields'] = {name: reader.number('i') for name in ('FC_FadePeriod', 'FC_FadePhase', 'FC_ColorFadeType')}
    fields['textureStrings'] = [native_string_record(reader) for _ in range(16)]
    fields['ShaderCode'] = native_string_record(reader)
    fields['sourceOffset'], fields['sourceBytes'] = start, reader.position - start
    return fields


def read_lineage_material_prefix(reader, package_version, licensee):
    if package_version < 123:
        return {}
    prefix = {'reservedInt32': reader.number('i')}
    if licensee == 30:
        prefix['licensee30Material'] = read_licensee30_material_block(reader)
    return prefix


def read_native_palette(package, tags, format_id, files):
    tag = scalar_property_tag(tags, 'Palette', OBJECT_PROPERTY_TYPE)
    if tag is None:
        require_texture_source(format_id != P8_FORMAT_ID, 'P8 texture requires an explicit same-package palette')
        return {'status': 'omitted'}
    value = tag.get('value')
    require_texture_source(isinstance(value, dict) and type(value.get('index')) is int, 'Invalid native palette reference')
    index = value['index']
    require_texture_source(index >= 0, 'Imported palettes require a separately reviewed exact-package resolver')
    if index == 0:
        require_texture_source(value.get('object') is None, 'Null palette index has a non-null object')
        require_texture_source(format_id != P8_FORMAT_ID, 'P8 texture requires a non-null palette')
        return {'status': 'explicit-null', 'nativeObjectIndex': 0}
    require_texture_source(index <= len(package.exports), 'Native palette index exceeds export table')
    item = package.exports[index - 1]
    require_texture_source(item.get('exportIndex') == index and item.get('classObject') == PALETTE_CLASS_OBJECT and
                           item.get('className') == 'Palette', 'Native palette index does not select exact Engine.Palette')
    require_texture_source(package.object_name(index) == value.get('object') == item['object'], 'Native palette identity differs from object index')
    export, source = export_source_record(package, item)
    palette_tags, reader = package.properties(item)
    require_texture_source(not palette_tags, 'Unreviewed native palette property prefix')
    count_offset = reader.position
    count = reader.count(PALETTE_COLOR_COUNT)
    require_texture_source(count == PALETTE_COLOR_COUNT, 'Native palette must contain exactly256 colors')
    color_offset = reader.position
    colors = bytes(reader.take(count * PALETTE_COLOR_BYTES))
    require_texture_source(reader.position == reader.end == item['offset'] + item['size'], 'Unconsumed native palette bytes')
    files['native/palette-export.bin'] = export
    files['native/palette.rgba'] = colors
    return {'status': 'exact-native-object-index', 'nativeObjectIndex': index, 'source': source,
            'exportFile': 'native/palette-export.bin', 'colorsFile': 'native/palette.rgba',
            'count': count, 'countOffset': count_offset, 'sourceColorOffset': color_offset,
            'colorBytes': len(colors), 'colorSha256': sha256_hex_digest(colors), 'channelOrder': 'RGBA8',
            'entry0Alpha': colors[3], 'alphaModified': False,
            'propertyPrefixHex': package_byte_range(package, item['offset'], count_offset).hex()}


def expected_mip_bytes(format_id, width, height):
    if format_id == P8_FORMAT_ID:
        return width * height
    block_bytes = DXT5_BLOCK_BYTES if format_id == DXT5_FORMAT_ID else DXT1_BLOCK_BYTES
    return max(1, (width + 3) // 4) * max(1, (height + 3) // 4) * block_bytes


def read_native_mip_levels(package, reader, format_id, dimensions, property_bits, count, files):
    levels, total = [], 0
    for level in range(count):
        record_start = reader.position
        lazy_array_end = reader.number('i')
        size = reader.count(MAX_PAYLOAD)
        payload_start = reader.position
        require_texture_source(lazy_array_end == payload_start + size and lazy_array_end <= reader.end,
                               'Native mip lazy-array end differs from payload range')
        payload = bytes(reader.take(size))
        width, height = reader.number('i'), reader.number('i')
        u_bits, v_bits = reader.number('B'), reader.number('B')
        require_texture_source(1 <= width <= MAX_DIMENSION and 1 <= height <= MAX_DIMENSION and u_bits <= MAX_MIP_BITS and v_bits <= MAX_MIP_BITS,
                               'Native mip dimensions/bits exceed bounded range')
        require_texture_source((width, height) == (1 << u_bits, 1 << v_bits), 'Native mip dimensions disagree with bits')
        require_texture_source(size == expected_mip_bytes(format_id, width, height), 'Native mip byte count differs from texture format')
        if level == 0:
            require_texture_source([width, height] == dimensions, 'Native mip0 dimensions differ from texture properties')
            require_texture_source(all(value is None or value == actual for value, actual in zip(property_bits, (u_bits, v_bits))),
                                   'Native mip0 bits differ from texture properties')
        else:
            previous = levels[-1]
            require_texture_source((previous['width'], previous['height']) != (1, 1), 'Native mip chain repeats terminal1x1 level')
            require_texture_source((width, height) == (max(1, previous['width'] // 2), max(1, previous['height'] // 2)),
                                   'Native mip dimensions do not halve in source order')
        total += size
        require_texture_source(total <= MAX_NATIVE_MIP_BYTES, 'Native mip chain exceeds bounded bytes')
        name = f'native/mip{level:02d}.bin'
        files[name] = payload
        levels.append({'level': level, 'width': width, 'height': height, 'uBits': u_bits, 'vBits': v_bits,
                       'recordOffset': record_start, 'sourceOffset': payload_start, 'sourceBytes': size,
                       'lazyArrayEnd': lazy_array_end, 'file': name, 'sha256': sha256_hex_digest(payload),
                       'headerHex': package_byte_range(package, record_start, payload_start).hex(),
                       'trailerHex': package_byte_range(package, lazy_array_end, reader.position).hex()})
    return levels, total


def read_native_texture_source(package, item, layout):
    package_version, licensee = layout['packageVersion'], layout['licenseeVersion']
    require_texture_source(item.get('classObject') == TEXTURE_CLASS_OBJECT and item.get('className') == 'Texture',
                           'Native texture source requires exact Engine.Texture class')
    export, source = export_source_record(package, item)
    tags, reader = package.properties(item)
    format_id = integer_property(tags, 'Format', BYTE_PROPERTY_TYPE)
    format_authored = format_id is not None
    format_id = P8_FORMAT_ID if format_id is None else format_id
    if format_id not in FORMATS:
        raise UnsupportedTextureSource(texture_format_unsupported_reason(format_id), 'Native texture source format is unreviewed: ' + str(format_id))
    dimensions = [integer_property(tags, key, INTEGER_PROPERTY_TYPE, True) for key in ('USize', 'VSize')]
    require_texture_source(all(1 <= value <= MAX_DIMENSION for value in dimensions), 'Texture dimensions exceed bounded range')
    property_bits = [integer_property(tags, key, BYTE_PROPERTY_TYPE) for key in ('UBits', 'VBits')]
    prefix_start = reader.position
    require_texture_source(item['offset'] <= prefix_start <= reader.end == item['offset'] + item['size'], 'Texture property boundary differs from export')
    native_prefix = read_lineage_material_prefix(reader, package_version, licensee)
    count = reader.count(MAX_MIPS)
    require_texture_source(count > 0, 'Native texture has no authored mip levels')
    prefix_end = reader.position
    files = {'native/texture-export.bin': export}
    levels, total = read_native_mip_levels(package, reader, format_id, dimensions, property_bits, count, files)
    require_texture_source(reader.position == reader.end, 'Unconsumed native texture bytes')
    palette = read_native_palette(package, tags, format_id, files)
    layout = copy.deepcopy(layout)
    if format_id == DXT5_FORMAT_ID:
        layout['evidence']['dxt5'] = copy.deepcopy(DXT5_EVIDENCE)
    metadata = {'schemaVersion': 1, 'kind': 'native-texture-source', 'source': source, 'layout': layout,
                'format': {'id': format_id, 'name': FORMATS[format_id],
                           'propertyStatus': 'authored' if format_authored else 'omitted-native-zero-default'},
                'propertyTags': copy.deepcopy(tags), 'originalExportFile': 'native/texture-export.bin',
                'nativePrefix': {'sourceOffset': prefix_start, 'sourceBytes': prefix_end - prefix_start,
                                 'hex': package_byte_range(package, prefix_start, prefix_end).hex(), **native_prefix},
                'mips': levels, 'palette': palette, 'mipCount': len(levels), 'nativeMipBytes': total,
                'completeTo1x1': (levels[-1]['width'], levels[-1]['height']) == (1, 1),
                'sourceExportFullyConsumed': True, 'pixelDecodingApplied': False, 'mipsGenerated': False,
                'colorOrAlphaModified': False,
                'files': [{'path': path, 'bytes': len(data), 'sha256': sha256_hex_digest(data)} for path, data in sorted(files.items())]}
    files['native-texture-source.json'] = json.dumps(metadata, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')
    return metadata, files
