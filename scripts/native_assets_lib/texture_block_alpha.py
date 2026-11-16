from native_assets_lib.texture_source_reader import (BLOCK_BYTES_BY_FORMAT, DXT1_FORMAT_ID, DXT3_FORMAT_ID, DXT5_FORMAT_ID, RGBA8_FORMAT_ID,
                                                     RGBA8_PIXEL_ORDER)
from native_catalog.ue2 import FormatError

BLOCK_EDGE_TEXELS = 4
OPAQUE_ALPHA = 255
TRANSPARENT_ALPHA = 0
BC1_ENDPOINT_BYTES = 4
BC1_INDEX_BITS = 2
BC1_INDEX_MASK = (1 << BC1_INDEX_BITS) - 1
BC1_TRANSPARENT_INDEX = 3
BC2_ALPHA_BYTES = 8
BC2_ALPHA_BITS = 4
BC3_ENDPOINT_BYTES = 2
BC3_INDEX_BYTES = 6
BC3_INDEX_BITS = 3
BC3_EIGHT_VALUE_STEPS = 7
BC3_SIX_VALUE_STEPS = 5


def require_alpha_source(condition, message):
    if not condition:
        raise FormatError(message)


def little_endian_bits(data):
    return int.from_bytes(data, 'little')


def bc1_block_alpha(block):
    color0, color1 = little_endian_bits(block[0:2]), little_endian_bits(block[2:4])
    indices = little_endian_bits(block[BC1_ENDPOINT_BYTES:])
    three_color_mode = color0 <= color1
    return [TRANSPARENT_ALPHA if three_color_mode and (indices >> (BC1_INDEX_BITS * texel)) & BC1_INDEX_MASK == BC1_TRANSPARENT_INDEX else OPAQUE_ALPHA
            for texel in range(BLOCK_EDGE_TEXELS * BLOCK_EDGE_TEXELS)]


def bc2_block_alpha(block):
    alpha_bits = little_endian_bits(block[:BC2_ALPHA_BYTES])
    nibble_mask = (1 << BC2_ALPHA_BITS) - 1
    return [((alpha_bits >> (BC2_ALPHA_BITS * texel)) & nibble_mask) * (OPAQUE_ALPHA // nibble_mask)
            for texel in range(BLOCK_EDGE_TEXELS * BLOCK_EDGE_TEXELS)]


def interpolated_alpha(alpha0, alpha1, step, steps):
    return ((steps - step) * alpha0 + step * alpha1) // steps


def bc3_alpha_palette(alpha0, alpha1):
    if alpha0 > alpha1:
        return [alpha0, alpha1, *(interpolated_alpha(alpha0, alpha1, step, BC3_EIGHT_VALUE_STEPS) for step in range(1, BC3_EIGHT_VALUE_STEPS))]
    return [alpha0, alpha1, *(interpolated_alpha(alpha0, alpha1, step, BC3_SIX_VALUE_STEPS) for step in range(1, BC3_SIX_VALUE_STEPS)),
            TRANSPARENT_ALPHA, OPAQUE_ALPHA]


def bc3_block_alpha(block):
    palette = bc3_alpha_palette(block[0], block[1])
    indices = little_endian_bits(block[BC3_ENDPOINT_BYTES:BC3_ENDPOINT_BYTES + BC3_INDEX_BYTES])
    index_mask = (1 << BC3_INDEX_BITS) - 1
    return [palette[(indices >> (BC3_INDEX_BITS * texel)) & index_mask] for texel in range(BLOCK_EDGE_TEXELS * BLOCK_EDGE_TEXELS)]


BLOCK_ALPHA_DECODERS = {DXT1_FORMAT_ID: bc1_block_alpha, DXT3_FORMAT_ID: bc2_block_alpha, DXT5_FORMAT_ID: bc3_block_alpha}


def block_compressed_alpha(format_id, width, height, payload):
    block_bytes = BLOCK_BYTES_BY_FORMAT[format_id]
    blocks_wide, blocks_high = (width + BLOCK_EDGE_TEXELS - 1) // BLOCK_EDGE_TEXELS, (height + BLOCK_EDGE_TEXELS - 1) // BLOCK_EDGE_TEXELS
    require_alpha_source(len(payload) == blocks_wide * blocks_high * block_bytes, 'Native mip 0 block bytes differ from its dimensions')
    alpha = bytearray(width * height)
    for block_row in range(blocks_high):
        for block_column in range(blocks_wide):
            block_start = (block_row * blocks_wide + block_column) * block_bytes
            block_alpha = BLOCK_ALPHA_DECODERS[format_id](payload[block_start:block_start + block_bytes])
            for texel, value in enumerate(block_alpha):
                texel_column = block_column * BLOCK_EDGE_TEXELS + texel % BLOCK_EDGE_TEXELS
                texel_row = block_row * BLOCK_EDGE_TEXELS + texel // BLOCK_EDGE_TEXELS
                if texel_column < width and texel_row < height:
                    alpha[texel_row * width + texel_column] = value
    return bytes(alpha)


def rgba8_alpha(width, height, payload):
    require_alpha_source(len(payload) == width * height * len(RGBA8_PIXEL_ORDER), 'Native RGBA8 mip 0 bytes differ from its dimensions')
    return bytes(payload[RGBA8_PIXEL_ORDER.index('A')::len(RGBA8_PIXEL_ORDER)])


def native_mip0_alpha(metadata, files):
    format_id, mip0 = metadata['format']['id'], metadata['mips'][0]
    payload = files[mip0['file']]
    if format_id == RGBA8_FORMAT_ID:
        return rgba8_alpha(mip0['width'], mip0['height'], payload)
    if format_id in BLOCK_ALPHA_DECODERS:
        return block_compressed_alpha(format_id, mip0['width'], mip0['height'], payload)
    return None
