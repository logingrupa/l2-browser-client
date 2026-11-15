"""Wrap original DXT1/DXT5 mip blocks in deterministic legacy DDS, without decoding.

build_texture_dds(native_metadata, native_files) returns (metadata, files).
Only UnsupportedTextureDDS denotes a coverage gap. Inconsistent or altered
supported source sidecars raise FormatError and must fail conversion.
"""
import copy
import hashlib
import json
import struct

from native_catalog.ue2 import FormatError


MAX_DIMENSION = 4096
MAX_MIPS = 13
MAX_BYTES = 32 * 1024 * 1024
SOURCE_MANIFEST = 'native-texture-source.json'
DDS_FILE = 'texture.dds'
MANIFEST_FILE = 'native-texture-dds.json'


class UnsupportedTextureDDS(ValueError):
    """Native pixels require a separate reviewed derivative adapter."""


def _require(condition, message):
    if not condition:
        raise FormatError(message)


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _json(data):
    return json.dumps(data, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=False, allow_nan=False).encode('utf-8')


def _file(files, path):
    value = files.get(path)
    _require(type(value) is bytes and 0 < len(value) <= MAX_BYTES,
             'Missing or invalid native texture payload: ' + path)
    return value


def build_texture_dds(native_metadata, native_files):
    """Package every original DXT1/DXT5 mip; retain incomplete chains unchanged.

    This is a container derivative, not a compressor or a runtime material.
    Native alpha interpretation, filtering/blending, orientation and color space
    still need explicit runtime validation. No filesystem or GPU is accessed.
    """
    _require(isinstance(native_metadata, dict) and isinstance(native_files, dict),
             'DDS input must contain native metadata and in-memory files')
    _require(native_metadata.get('schemaVersion') == 1 and
             native_metadata.get('kind') == 'native-texture-source',
             'DDS input is not a supported native texture source sidecar')
    source_json = _file(native_files, SOURCE_MANIFEST)
    try:
        parsed = json.loads(source_json)
    except (ValueError, UnicodeError) as error:
        raise FormatError('Invalid native texture source JSON') from error
    _require(parsed == native_metadata, 'Native texture metadata differs from its sidecar')
    fmt = native_metadata.get('format')
    _require(isinstance(fmt, dict) and type(fmt.get('id')) is int and
             isinstance(fmt.get('name'), str), 'Invalid native texture format')
    formats = {3: ('DXT1', 8, 0x31545844), 8: ('DXT5', 16, 0x35545844)}
    if fmt['id'] not in formats:
        if fmt['id'] == 0:
            _require(fmt['name'] == 'P8', 'Native P8 format identity is inconsistent')
            raise UnsupportedTextureDDS('DDS block preservation does not support P8; native indices and palette remain preserved')
        raise UnsupportedTextureDDS('DDS block preservation supports DXT1/DXT5 only; ' +
                                    fmt['name'] + ' remains in its editable/native source form')
    format_name, block_bytes, fourcc = formats[fmt['id']]
    _require(fmt['name'] == format_name, 'Native ' + format_name + ' format identity is inconsistent')
    _require(native_metadata.get('sourceExportFullyConsumed') is True and
             native_metadata.get('pixelDecodingApplied') is False and
             native_metadata.get('mipsGenerated') is False and
             native_metadata.get('colorOrAlphaModified') is False,
             'DDS requires unmodified, fully parsed native source bytes')
    source = native_metadata.get('source')
    _require(isinstance(source, dict) and type(source.get('sourceOffset')) is int and
             source['sourceOffset'] >= 0, 'Invalid native texture export source range')
    _require(native_metadata.get('originalExportFile') == 'native/texture-export.bin',
             'Unexpected original native texture export path')
    export = _file(native_files, 'native/texture-export.bin')
    _require(len(export) == source.get('sourceBytes') and
             _sha(export) == source.get('sourceExportSha256'),
             'Original native texture export size/hash mismatch')
    levels = native_metadata.get('mips')
    _require(isinstance(levels, list) and 1 <= len(levels) <= MAX_MIPS and
             type(native_metadata.get('mipCount')) is int and
             len(levels) == native_metadata['mipCount'], 'Invalid native mip count')
    payloads, mip_rows = [], []
    offset = 128
    previous = None
    for level, mip in enumerate(levels):
        _require(isinstance(mip, dict) and type(mip.get('level')) is int and
                 mip['level'] == level, 'Native mip levels are not in original order')
        width, height = mip.get('width'), mip.get('height')
        _require(all(type(value) is int and 1 <= value <= MAX_DIMENSION and
                     value & (value - 1) == 0 for value in (width, height)),
                 'Native DDS dimensions must be bounded powers of two')
        if previous:
            _require(previous != (1, 1) and
                     (width, height) == tuple(max(1, value // 2) for value in previous),
                     'Native DDS mip dimensions do not halve in source order')
        previous = width, height
        expected_name = f'native/mip{level:02d}.bin'
        _require(mip.get('file') == expected_name, 'Native DDS mip path is inconsistent')
        payload = _file(native_files, expected_name)
        expected_size = max(1, (width + 3) // 4) * max(1, (height + 3) // 4) * block_bytes
        _require(len(payload) == expected_size == mip.get('sourceBytes'),
                 'Native ' + format_name + ' mip byte count is invalid')
        digest = _sha(payload)
        _require(digest == mip.get('sha256'), 'Native ' + format_name + ' mip hash mismatch')
        source_offset = mip.get('sourceOffset')
        _require(type(source_offset) is int, 'Invalid native ' + format_name + ' mip source offset')
        local_offset = source_offset - source['sourceOffset']
        _require(0 <= local_offset <= len(export) - len(payload) and
                 export[local_offset:local_offset + len(payload)] == payload,
                 'Native ' + format_name + ' mip differs from original native export bytes')
        _require(offset + len(payload) <= MAX_BYTES + 128, 'DDS exceeds bounded size')
        payloads.append(payload)
        mip_rows.append({'level': level, 'width': width, 'height': height,
                         'sourceFile': expected_name, 'sourceSha256': digest,
                         'ddsOffset': offset, 'bytes': len(payload)})
        offset += len(payload)
    native_bytes = sum(len(payload) for payload in payloads)
    complete = previous == (1, 1)
    _require(native_metadata.get('nativeMipBytes') == native_bytes and
             native_metadata.get('completeTo1x1') is complete,
             'Native texture mip summary is inconsistent')

    # DDS_HEADER follows the four-byte magic. Its pixel format is legacy FourCC;
    # dwPitchOrLinearSize contains the top-level compressed byte count only.
    # No sRGB, alpha-mode or orientation metadata is invented in legacy DDS.
    header = [0] * 32
    header[0:8] = [0x20534444, 124, 0x81007, levels[0]['height'],
                   levels[0]['width'], len(payloads[0]), 0, len(levels)]
    header[19:22] = [32, 4, fourcc]  # DDS_PIXELFORMAT, DDPF_FOURCC, native format
    header[27] = 0x1000  # DDSCAPS_TEXTURE
    if len(levels) > 1:
        header[2] |= 0x20000  # DDSD_MIPMAPCOUNT
        header[27] |= 0x400008  # DDSCAPS_MIPMAP | DDSCAPS_COMPLEX
    dds = struct.pack('<32I', *header) + b''.join(payloads)
    limits = [
        'Requires S3TC/BC1 capability; no universal/mobile compressed fallback is generated.',
        'Legacy DDS does not define native color space, orientation, filtering or blend equations; these are unverified.',
        'Babylon 9.27.1 selects RGBA DXT1. Native opaque-versus-one-bit-alpha interpretation remains a material decision.',
    ]
    if format_name == 'DXT5':
        limits[0] = 'Requires S3TC/BC3 capability; no universal/mobile compressed fallback is generated.'
        limits[2] = 'Babylon 9.27.1 selects RGBA DXT5. Original alpha blocks are preserved; native alpha testing, blending and material interpretation remain unverified.'
    if not complete and len(levels) > 1:
        limits.append('Babylon 9.27.1 standard 2D DDS loader uploads only mip0 from incomplete chains; all authored levels remain in this DDS.')
    compatible_header = len(dds) >= 140
    if not compatible_header:
        limits.append('Legal 136-byte DXT1 DDS is below Babylon 9.27.1 GetDDSInfo\'s unconditional 140-byte view; no padding or altered source payload is added.')
    metadata = {
        'schemaVersion': 1, 'kind': 'native-texture-dds', 'file': DDS_FILE,
        'bytes': len(dds), 'sha256': _sha(dds),
        'format': format_name, 'width': levels[0]['width'], 'height': levels[0]['height'],
        'mipCount': len(levels), 'completeTo1x1': complete,
        'source': copy.deepcopy(source),
        'sourceManifest': {'file': SOURCE_MANIFEST, 'sha256': _sha(source_json)},
        'mips': mip_rows, 'nativeMipBytes': native_bytes,
        'sourceMipPayloadsPreserved': True, 'compressionApplied': False,
        'pixelDecodingApplied': False, 'mipsGenerated': False, 'colorOrAlphaModified': False,
        'consumer': {'babylonVersion': '9.27.1', 'requiresS3TC': True,
                     'headerParserCompatible': compatible_header,
                     'mipUploadPolicy': 'all-authored-levels' if complete else 'mip0-only',
                     'requiresMipmapsEnabledForAllLevels': len(levels) > 1},
        'limitations': limits,
    }
    return metadata, {DDS_FILE: dds, MANIFEST_FILE: _json(metadata)}
