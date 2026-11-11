import struct
import zlib

from native_assets_lib.lineage_material_prefix import RESERVED_INT32_MATERIAL_PREFIX
from native_catalog.ue2 import FormatError
from world.map_actor_properties import property_value
from world.map_sources import sha
from world.reader_licensee_layouts import require_reviewed_reader_layout

TEXF_G16_FORMAT = 10
MAXIMUM_MIP_LEVELS = 32
MAXIMUM_MIP_BYTES = 128 * 1024 * 1024
MAXIMUM_TEXTURE_SIDE = 16384
MAXIMUM_MIP_SIDE_BITS = 14
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'


def read_g16(package, item):
    layout = require_reviewed_reader_layout("g16-heightmap", package.summary)
    properties, reader = package.properties(item)
    if property_value(properties, 'Format') != TEXF_G16_FORMAT:
        raise FormatError('Terrain height texture must be native TEXF_G16 (10)')
    reserved = reader.number('i') if layout['materialPrefix'] == RESERVED_INT32_MATERIAL_PREFIX else None
    mips = []
    for level in range(reader.count(MAXIMUM_MIP_LEVELS)):
        skip = reader.number('i')
        length = reader.count(MAXIMUM_MIP_BYTES)
        start = reader.position
        raw = reader.take(length)
        if skip != reader.position:
            raise FormatError('G16 lazy array end differs from its declared skip position')
        width, height = reader.number('i'), reader.number('i')
        ubits, vbits = reader.number('B'), reader.number('B')
        if not 1 <= width <= MAXIMUM_TEXTURE_SIDE or not 1 <= height <= MAXIMUM_TEXTURE_SIDE or length != width * height * 2:
            raise FormatError('G16 sample dimensions/bytes disagree')
        if ubits > MAXIMUM_MIP_SIDE_BITS or vbits > MAXIMUM_MIP_SIDE_BITS or width != 1 << ubits or height != 1 << vbits:
            raise FormatError('G16 mip dimensions/bits disagree')
        mips.append({'level': level, 'width': width, 'height': height, 'uBits': ubits, 'vBits': vbits,
                     'sourceOffset': start, 'sourceBytes': length, 'sha256': sha(raw), 'raw': raw})
    if reader.position != reader.end or not mips:
        raise FormatError('Missing G16 mips or unconsumed texture bytes')
    if (mips[0]['width'], mips[0]['height']) != (property_value(properties, 'USize'), property_value(properties, 'VSize')):
        raise FormatError('G16 mip0 dimensions differ from texture tags')
    return {'format': 'TEXF_G16', 'reservedNativeInt': reserved, 'mips': mips}


def png_chunk(kind, payload):
    return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))


def png16(raw, width, height):
    if len(raw) != width * height * 2:
        raise ValueError('PNG dimensions disagree with G16 bytes')
    big_endian_samples = bytearray(len(raw))
    big_endian_samples[0::2], big_endian_samples[1::2] = raw[1::2], raw[0::2]
    scanlines = b''.join(b'\0' + big_endian_samples[row * width * 2:(row + 1) * width * 2] for row in range(height))
    header = struct.pack('>IIBBBBB', width, height, 16, 0, 0, 0, 0)
    return PNG_SIGNATURE + png_chunk(b'IHDR', header) + png_chunk(b'IDAT', zlib.compress(scanlines, 9)) + png_chunk(b'IEND', b'')
