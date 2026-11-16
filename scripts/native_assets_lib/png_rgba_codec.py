import struct
import zlib

from native_catalog.ue2 import FormatError

PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
IMAGE_HEADER_CHUNK = b'IHDR'
IMAGE_DATA_CHUNK = b'IDAT'
IMAGE_END_CHUNK = b'IEND'
IMAGE_HEADER_LAYOUT = '>IIBBBBB'
CHUNK_LENGTH_LAYOUT = '>I'
CHUNK_FRAME_BYTES = 12
EIGHT_BIT_DEPTH = 8
RGB_COLOR_TYPE = 2
RGBA_COLOR_TYPE = 6
GRAYSCALE_ALPHA_COLOR_TYPE = 4
COLOR_TYPES_WITH_ALPHA_CHANNEL = (GRAYSCALE_ALPHA_COLOR_TYPE, RGBA_COLOR_TYPE)
DEFLATE_COMPRESSION_METHOD = 0
ADAPTIVE_FILTER_METHOD = 0
NOT_INTERLACED = 0
RGB_BYTES_PER_PIXEL = 3
RGBA_BYTES_PER_PIXEL = 4
NONE_FILTER, SUB_FILTER, UP_FILTER, AVERAGE_FILTER, PAETH_FILTER = range(5)
MAX_DECODED_IMAGE_BYTES = 64 * 1024 * 1024
ENCODER_COMPRESSION_LEVEL = 9


def require_png(condition, message):
    if not condition:
        raise FormatError(message)


def png_chunks(png):
    require_png(png.startswith(PNG_SIGNATURE), 'Texture image is not a PNG')
    chunks, position = [], len(PNG_SIGNATURE)
    while position < len(png):
        require_png(position + CHUNK_FRAME_BYTES <= len(png), 'PNG chunk frame exceeds the image')
        length, = struct.unpack_from(CHUNK_LENGTH_LAYOUT, png, position)
        chunk_type = png[position + 4:position + 8]
        data_end = position + 8 + length
        require_png(data_end + 4 <= len(png), 'PNG chunk data exceeds the image')
        data = png[position + 8:data_end]
        require_png(struct.unpack_from(CHUNK_LENGTH_LAYOUT, png, data_end)[0] == zlib.crc32(chunk_type + data), 'PNG chunk CRC differs')
        chunks.append((chunk_type, data))
        position = data_end + 4
    require_png(chunks and chunks[0][0] == IMAGE_HEADER_CHUNK and chunks[-1][0] == IMAGE_END_CHUNK, 'PNG chunks do not run from IHDR to IEND')
    return chunks


def png_image_header(chunks):
    _, data = chunks[0]
    require_png(len(data) == struct.calcsize(IMAGE_HEADER_LAYOUT), 'PNG IHDR has the wrong size')
    width, height, bit_depth, color_type, compression, filter_method, interlace = struct.unpack(IMAGE_HEADER_LAYOUT, data)
    return {'width': width, 'height': height, 'bitDepth': bit_depth, 'colorType': color_type,
            'compression': compression, 'filterMethod': filter_method, 'interlace': interlace}


def png_has_alpha_channel(chunks):
    return png_image_header(chunks)['colorType'] in COLOR_TYPES_WITH_ALPHA_CHANNEL


def paeth_predictor(left, above, upper_left):
    estimate = left + above - upper_left
    left_distance, above_distance, upper_left_distance = abs(estimate - left), abs(estimate - above), abs(estimate - upper_left)
    if left_distance <= above_distance and left_distance <= upper_left_distance:
        return left
    return above if above_distance <= upper_left_distance else upper_left


def unfiltered_row(filter_type, filtered, previous, bytes_per_pixel):
    row = bytearray(filtered)
    for index in range(len(row)):
        left = row[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
        above = previous[index]
        upper_left = previous[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
        if filter_type == SUB_FILTER:
            row[index] = (row[index] + left) & 0xFF
        elif filter_type == UP_FILTER:
            row[index] = (row[index] + above) & 0xFF
        elif filter_type == AVERAGE_FILTER:
            row[index] = (row[index] + (left + above) // 2) & 0xFF
        elif filter_type == PAETH_FILTER:
            row[index] = (row[index] + paeth_predictor(left, above, upper_left)) & 0xFF
        else:
            require_png(filter_type == NONE_FILTER, f'PNG row filter {filter_type} is not a PNG filter type')
    return bytes(row)


def decoded_rgb_png_pixels(chunks):
    header = png_image_header(chunks)
    require_png((header['bitDepth'], header['colorType'], header['compression'], header['filterMethod'], header['interlace']) ==
                (EIGHT_BIT_DEPTH, RGB_COLOR_TYPE, DEFLATE_COMPRESSION_METHOD, ADAPTIVE_FILTER_METHOD, NOT_INTERLACED),
                f'Texture PNG without alpha must be 8-bit non-interlaced RGB, got {header}')
    width, height = header['width'], header['height']
    row_bytes = width * RGB_BYTES_PER_PIXEL
    require_png(0 < width and 0 < height and height * row_bytes <= MAX_DECODED_IMAGE_BYTES, 'PNG dimensions exceed the bounded image size')
    decompressor = zlib.decompressobj()
    try:
        filtered = decompressor.decompress(b''.join(data for chunk_type, data in chunks if chunk_type == IMAGE_DATA_CHUNK),
                                           height * (row_bytes + 1) + 1)
    except zlib.error as error:
        raise FormatError('PNG image data does not inflate') from error
    require_png(decompressor.eof and len(filtered) == height * (row_bytes + 1), 'PNG image data size differs from its rows')
    rows, previous = [], bytes(row_bytes)
    for row_index in range(height):
        start = row_index * (row_bytes + 1)
        previous = unfiltered_row(filtered[start], filtered[start + 1:start + 1 + row_bytes], previous, RGB_BYTES_PER_PIXEL)
        rows.append(previous)
    return width, height, b''.join(rows)


def png_chunk(chunk_type, data):
    return struct.pack(CHUNK_LENGTH_LAYOUT, len(data)) + chunk_type + data + struct.pack(CHUNK_LENGTH_LAYOUT, zlib.crc32(chunk_type + data))


def encoded_rgba_png(width, height, rgba):
    row_bytes = width * RGBA_BYTES_PER_PIXEL
    require_png(len(rgba) == height * row_bytes, 'RGBA pixels differ from the image dimensions')
    unfiltered_rows = b''.join(bytes([NONE_FILTER]) + rgba[row * row_bytes:(row + 1) * row_bytes] for row in range(height))
    header = struct.pack(IMAGE_HEADER_LAYOUT, width, height, EIGHT_BIT_DEPTH, RGBA_COLOR_TYPE,
                         DEFLATE_COMPRESSION_METHOD, ADAPTIVE_FILTER_METHOD, NOT_INTERLACED)
    return (PNG_SIGNATURE + png_chunk(IMAGE_HEADER_CHUNK, header) +
            png_chunk(IMAGE_DATA_CHUNK, zlib.compress(unfiltered_rows, ENCODER_COMPRESSION_LEVEL)) + png_chunk(IMAGE_END_CHUNK, b''))


def rgba_png_of_rgb_png_and_alpha(chunks, width, height, alpha):
    png_width, png_height, rgb = decoded_rgb_png_pixels(chunks)
    require_png((png_width, png_height) == (width, height), f'Texture PNG is {png_width} x {png_height}, native mip 0 is {width} x {height}')
    require_png(len(alpha) == width * height, 'Native alpha differs from the mip 0 texel count')
    rgba = bytearray(width * height * RGBA_BYTES_PER_PIXEL)
    for channel in range(RGB_BYTES_PER_PIXEL):
        rgba[channel::RGBA_BYTES_PER_PIXEL] = rgb[channel::RGB_BYTES_PER_PIXEL]
    rgba[RGB_BYTES_PER_PIXEL::RGBA_BYTES_PER_PIXEL] = alpha
    return encoded_rgba_png(width, height, bytes(rgba))
