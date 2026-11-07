"""Preserve reviewed native texture mip/palette bytes; never decode pixels.

build_texture_source(package, item) returns (metadata, files). Files include the
canonical native-texture-source.json sidecar and all original native payloads.
Only UnsupportedTextureSource may be treated as an explicit coverage gap by a
caller. Malformed supported data raises FormatError and must fail conversion.
"""
import copy
import hashlib
import json

from native_catalog.ue2 import FormatError, Reader


REVIEWED_VERSIONS = {(123, 20), (123, 28), (123, 30)}
FORMATS = {0: 'P8', 3: 'DXT1', 8: 'DXT5'}
MAX_DIMENSION = 4096
MAX_MIPS = 16
MAX_PAYLOAD = 16 * 1024 * 1024
MAX_NATIVE_MIP_BYTES = 32 * 1024 * 1024
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
    'omittedFormat': {
        'value': 0, 'class': 'Engine.BitmapMaterial', 'field': 'Format',
        'enginePackageSha256': '9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761',
        'bitmapMaterialDeclarationSha256': '5951d394edb45b30a1b0f3ca76cad36349453d8b6d7a703342ba2fbc7f7b76fa',
        'rule': 'Declared enum field zero-initialized; pinned BitmapMaterial/Texture defaults do not override Format. Omission is recorded separately from authored zero.',
    },
}
LICENSEE30_EVIDENCE = {
    'file': 'Unreal/UnrealMaterial/UnMaterial2.h', 'lines': [185, 248],
    'record': 'UMaterial::Serialize exact Lineage licensee30 branch',
    'layout': 'reserved int32; 6 bytes; 3 int32; 8 opaque128-byte blocks; 8 serialized FC color bytes; 3 FC int32 bit patterns; 16 texture FStrings; ShaderCode FString; then mip count',
    'policy': 'Preserve original fields/bytes without matrix, FC color or FC float interpretation. Licensee31+ has additional/different fields and remains unsupported.',
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
    """A numeric format or package layout outside this reviewed adapter."""


def _require(condition, message):
    if not condition:
        raise FormatError(message)


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _bytes(package, start, end):
    _require(type(start) is int and type(end) is int and 0 <= start <= end <= len(package.data),
             'Texture source range exceeds package bounds')
    return bytes(package.data[start:end])


def _source(package, item):
    raw = _bytes(package, item['offset'], item['offset'] + item['size'])
    _require(0 < len(raw) <= MAX_PAYLOAD, 'Texture/palette source export exceeds bounded size')
    return raw, {'package': package.filename, 'packageSha256': package.source_hash,
                 'object': item['object'], 'exportIndex': item['exportIndex'],
                 'sourceOffset': item['offset'], 'sourceBytes': len(raw), 'sourceExportSha256': _sha(raw),
                 'offsetSpace': 'unwrapped-native-package'}


def _tag(tags, name, expected_type, required=False):
    matches = [tag for tag in tags if tag['name'] == name]
    _require(len(matches) <= 1, 'Duplicate texture property: ' + name)
    _require(not required or matches, 'Missing required texture property: ' + name)
    if not matches:
        return None
    tag = matches[0]
    _require(tag.get('arrayIndex') is None and tag.get('type') == expected_type and tag.get('status') == 'decoded',
             'Invalid scalar texture property: ' + name)
    return tag


def _integer(tags, name, expected_type, required=False):
    tag = _tag(tags, name, expected_type, required)
    if tag is None:
        return None
    _require(type(tag.get('value')) is int, 'Non-integer texture property: ' + name)
    return tag['value']


def _native_string(reader):
    start = reader.position
    length = Reader(reader.data, start, reader.end).compact()
    try:
        value = reader.string()
    except UnicodeError as error:
        raise FormatError('Invalid Unreal material string encoding') from error
    raw = bytes(reader.data[start:reader.position])
    return {'sourceOffset': start, 'sourceBytes': len(raw), 'encodedLength': length,
            'encoding': 'utf-16le' if length < 0 else 'cp1252', 'value': value, 'hex': raw.hex()}


def _material_prefix(reader, licensee):
    prefix = {'reservedInt32': reader.number('i')}
    if licensee != 30:
        return prefix
    start = reader.position
    fields = {'byteFields': {name: reader.number('B') for name in (
        'TextureTranform', 'MAX_SAMPLER_NUM', 'MAX_TEXMAT_NUM', 'MAX_PASS_NUM', 'TwoPassRenderState', 'AlphaRef')},
        'int32Fields': {name: reader.number('i') for name in ('SrcBlend', 'DestBlend', 'OverriddenFogColor')}}
    blocks = []
    for index in range(8):
        offset = reader.position
        raw = bytes(reader.take(128))
        blocks.append({'index': index, 'sourceOffset': offset, 'sourceBytes': len(raw),
                       'hex': raw.hex(), 'sha256': _sha(raw)})
    fields['opaqueMatrixBlocks'] = blocks
    fields['nativeFCColorSourceOffset'] = reader.position
    fields['nativeFCColorBytesHex'] = reader.take(8).hex()
    # The reference reads signed int32 but questions their meaning ("really, floats?").
    # Keep the original bit patterns in prefix hex; never reinterpret as floats.
    fields['fcInt32Fields'] = {name: reader.number('i') for name in ('FC_FadePeriod', 'FC_FadePhase', 'FC_ColorFadeType')}
    fields['textureStrings'] = [_native_string(reader) for _ in range(16)]
    fields['ShaderCode'] = _native_string(reader)
    fields['sourceOffset'], fields['sourceBytes'] = start, reader.position - start
    prefix['licensee30Material'] = fields
    return prefix


def _palette(package, tags, format_id, files):
    tag = _tag(tags, 'Palette', 5)
    if tag is None:
        _require(format_id != 0, 'P8 texture requires an explicit same-package palette')
        return {'status': 'omitted'}
    value = tag.get('value')
    _require(isinstance(value, dict) and type(value.get('index')) is int, 'Invalid native palette reference')
    index = value['index']
    _require(index >= 0, 'Imported palettes require a separately reviewed exact-package resolver')
    if index == 0:
        _require(value.get('object') is None, 'Null palette index has a non-null object')
        _require(format_id != 0, 'P8 texture requires a non-null palette')
        return {'status': 'explicit-null', 'nativeObjectIndex': 0}
    _require(index <= len(package.exports), 'Native palette index exceeds export table')
    item = package.exports[index - 1]
    _require(item.get('exportIndex') == index and item.get('classObject') == 'Engine.Palette' and
             item.get('className') == 'Palette', 'Native palette index does not select exact Engine.Palette')
    _require(package.object_name(index) == value.get('object') == item['object'], 'Native palette identity differs from object index')
    export, source = _source(package, item)
    palette_tags, reader = package.properties(item)
    _require(not palette_tags, 'Unreviewed native palette property prefix')
    count_offset = reader.position
    count = reader.count(256)
    _require(count == 256, 'Native palette must contain exactly256 colors')
    color_offset = reader.position
    colors = bytes(reader.take(count * 4))
    _require(reader.position == reader.end == item['offset'] + item['size'], 'Unconsumed native palette bytes')
    files['native/palette-export.bin'] = export
    files['native/palette.rgba'] = colors
    return {'status': 'exact-native-object-index', 'nativeObjectIndex': index, 'source': source,
            'exportFile': 'native/palette-export.bin', 'colorsFile': 'native/palette.rgba',
            'count': count, 'countOffset': count_offset, 'sourceColorOffset': color_offset,
            'colorBytes': len(colors), 'colorSha256': _sha(colors), 'channelOrder': 'RGBA8',
            'entry0Alpha': colors[3], 'alphaModified': False,
            'propertyPrefixHex': _bytes(package, item['offset'], count_offset).hex()}


def build_texture_source(package, item):
    """Return deterministic sidecar metadata/payloads without modifying inputs.

    A partial authored mip chain is valid and remains partial. All level payloads
    and the complete original export are retained, including compressed2x2/1x1
    blocks and palette entry0 alpha. No data is inferred from texture names.
    """
    version = (package.summary['version'], package.summary['licenseeVersion'])
    if version not in REVIEWED_VERSIONS:
        raise UnsupportedTextureSource('Native texture source layout supports reviewed UE123/licensee20,28,30 only; got ' + repr(version))
    _require(item.get('classObject') == 'Engine.Texture' and item.get('className') == 'Texture',
             'Native texture source requires exact Engine.Texture class')
    export, source = _source(package, item)
    tags, reader = package.properties(item)
    format_id = _integer(tags, 'Format', 1)
    format_authored = format_id is not None
    format_id = 0 if format_id is None else format_id
    if format_id not in FORMATS:
        raise UnsupportedTextureSource('Native texture source format is unreviewed: ' + str(format_id))
    dimensions = [_integer(tags, key, 2, True) for key in ('USize', 'VSize')]
    _require(all(1 <= value <= MAX_DIMENSION for value in dimensions), 'Texture dimensions exceed bounded range')
    bits = [_integer(tags, key, 1) for key in ('UBits', 'VBits')]
    prefix_start = reader.position
    _require(item['offset'] <= prefix_start <= reader.end == item['offset'] + item['size'], 'Texture property boundary differs from export')
    native_prefix = _material_prefix(reader, version[1])
    count = reader.count(MAX_MIPS)
    _require(count > 0, 'Native texture has no authored mip levels')
    prefix_end = reader.position
    files = {'native/texture-export.bin': export}
    levels, total = [], 0
    for level in range(count):
        record_start = reader.position
        skip = reader.number('i')
        size = reader.count(MAX_PAYLOAD)
        payload_start = reader.position
        _require(skip == payload_start + size and skip <= reader.end, 'Native mip lazy-array end differs from payload range')
        payload = bytes(reader.take(size))
        width, height = reader.number('i'), reader.number('i')
        ubits, vbits = reader.number('B'), reader.number('B')
        _require(1 <= width <= MAX_DIMENSION and 1 <= height <= MAX_DIMENSION and ubits <= 12 and vbits <= 12,
                 'Native mip dimensions/bits exceed bounded range')
        _require((width, height) == (1 << ubits, 1 << vbits), 'Native mip dimensions disagree with bits')
        block_bytes = 16 if format_id == 8 else 8
        expected = width * height if format_id == 0 else max(1, (width + 3)//4) * max(1, (height + 3)//4) * block_bytes
        _require(size == expected, 'Native mip byte count differs from texture format')
        if level == 0:
            _require([width, height] == dimensions, 'Native mip0 dimensions differ from texture properties')
            _require(all(value is None or value == actual for value, actual in zip(bits, (ubits, vbits))),
                     'Native mip0 bits differ from texture properties')
        else:
            previous = levels[-1]
            _require((previous['width'], previous['height']) != (1, 1), 'Native mip chain repeats terminal1x1 level')
            _require((width, height) == (max(1, previous['width']//2), max(1, previous['height']//2)),
                     'Native mip dimensions do not halve in source order')
        total += size
        _require(total <= MAX_NATIVE_MIP_BYTES, 'Native mip chain exceeds bounded bytes')
        name = f'native/mip{level:02d}.bin'
        files[name] = payload
        levels.append({'level': level, 'width': width, 'height': height, 'uBits': ubits, 'vBits': vbits,
                       'recordOffset': record_start, 'sourceOffset': payload_start, 'sourceBytes': size,
                       'lazyArrayEnd': skip, 'file': name, 'sha256': _sha(payload),
                       'headerHex': _bytes(package, record_start, payload_start).hex(),
                       'trailerHex': _bytes(package, skip, reader.position).hex()})
    _require(reader.position == reader.end, 'Unconsumed native texture bytes')
    palette = _palette(package, tags, format_id, files)
    metadata = {'schemaVersion': 1, 'kind': 'native-texture-source', 'source': source,
                'layout': {'packageVersion': version[0], 'licenseeVersion': version[1], 'evidence': copy.deepcopy(LAYOUT_EVIDENCE)},
                'format': {'id': format_id, 'name': FORMATS[format_id],
                           'propertyStatus': 'authored' if format_authored else 'omitted-native-zero-default'},
                'propertyTags': copy.deepcopy(tags), 'originalExportFile': 'native/texture-export.bin',
                'nativePrefix': {'sourceOffset': prefix_start, 'sourceBytes': prefix_end-prefix_start,
                                 'hex': _bytes(package, prefix_start, prefix_end).hex(), **native_prefix},
                'mips': levels, 'palette': palette, 'mipCount': len(levels), 'nativeMipBytes': total,
                'completeTo1x1': (levels[-1]['width'], levels[-1]['height']) == (1, 1),
                'sourceExportFullyConsumed': True, 'pixelDecodingApplied': False, 'mipsGenerated': False,
                'colorOrAlphaModified': False,
                'files': [{'path': path, 'bytes': len(data), 'sha256': _sha(data)} for path, data in sorted(files.items())]}
    if version[1] == 30:
        metadata['layout']['evidence']['licensee30Material'] = copy.deepcopy(LICENSEE30_EVIDENCE)
    if format_id == 8:
        # Keep preexisting P8/DXT1 source sidecars byte-identical.
        metadata['layout']['evidence']['dxt5'] = copy.deepcopy(DXT5_EVIDENCE)
    files['native-texture-source.json'] = json.dumps(metadata, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')
    return metadata, files
