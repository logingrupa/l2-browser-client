import hashlib
import io

from PIL import Image

from native_assets_lib.texture_source_reader import (BYTE_PROPERTY_TYPE, INTEGER_PROPERTY_TYPE, MAX_MIPS, MAX_PAYLOAD, integer_property)
from native_catalog.ue2 import FormatError
from world.minimap_radar_route_recipe import read_minimap_radar_route_recipe
from world.pinned_image_decoder import require_pinned_image_decoder

RGBA_CHANNELS = ('R', 'G', 'B', 'A')
PNG_DECODE_MODE = 'RGBA'


class Format5PixelMismatch(ValueError):
    def __init__(self, message, position):
        super().__init__(message)
        self.position = position


def format5_rule():
    return read_minimap_radar_route_recipe()['document']['textureFormat5']


def texture_format_id(package, export):
    tags, _ = package.properties(export)
    return integer_property(tags, 'Format', BYTE_PROPERTY_TYPE)


def skip_material_int(reader, package, rule):
    material_int = rule['materialInt']
    if package.summary['version'] >= material_int['minimumPackageVersion'] and package.summary['licenseeVersion'] >= material_int['minimumLicensee']:
        reader.take(material_int['bytes'])


def format5_mip0(package, export, rule=None):
    rule = rule or format5_rule()
    tags, reader = package.properties(export)
    if integer_property(tags, 'Format', BYTE_PROPERTY_TYPE) != rule['formatId']:
        raise FormatError(f'{export["object"]} is not texture format {rule["formatId"]}')
    dimensions = [integer_property(tags, name, INTEGER_PROPERTY_TYPE, True) for name in ('USize', 'VSize')]
    skip_material_int(reader, package, rule)
    if reader.count(MAX_MIPS) < 1:
        raise FormatError(f'{export["object"]} has no mip')
    lazy_array_end = reader.number('i')
    size = reader.count(MAX_PAYLOAD)
    payload_start = reader.position
    if lazy_array_end != payload_start + size:
        raise FormatError(f'{export["object"]} mip 0 lazy-array end differs from its payload range')
    pixels = bytes(reader.take(size))
    width, height = reader.number('i'), reader.number('i')
    if [width, height] != dimensions or size != width * height * rule['bytesPerPixel']:
        raise FormatError(f'{export["object"]} mip 0 is {width} x {height} with {size} bytes, not {dimensions} tight rows of {rule["bytesPerPixel"]} bytes')
    return width, height, pixels


def rgba_of_stored_pixels(pixels, pixel_order):
    channels = [pixels[pixel_order.index(channel)::len(pixel_order)] for channel in RGBA_CHANNELS]
    rgba = bytearray(len(pixels))
    for offset, channel in enumerate(channels):
        rgba[offset::len(RGBA_CHANNELS)] = channel
    return bytes(rgba)


def decoded_png_rgba(png_bytes):
    require_pinned_image_decoder()
    image = Image.open(io.BytesIO(png_bytes))
    image.load()
    return image.size, image.convert(PNG_DECODE_MODE).tobytes()


def first_differing_pixel(expected, actual, width):
    for offset in range(0, len(expected), len(RGBA_CHANNELS)):
        if expected[offset:offset + len(RGBA_CHANNELS)] != actual[offset:offset + len(RGBA_CHANNELS)]:
            pixel = offset // len(RGBA_CHANNELS)
            return [pixel % width, pixel // width]
    return None


def require_png_equals_format5_pixels(object_name, width, height, stored_pixels, png_bytes, rule):
    expected = rgba_of_stored_pixels(stored_pixels, rule['pixelOrder'])
    size, actual = decoded_png_rgba(png_bytes)
    if list(size) != [width, height]:
        raise Format5PixelMismatch(f'{object_name} PNG is {size[0]} x {size[1]}, mip 0 is {width} x {height}', None)
    if actual != expected:
        position = first_differing_pixel(expected, actual, width)
        raise Format5PixelMismatch(f'{object_name} PNG differs from the {"".join(rule["pixelOrder"])} decode of mip 0 at pixel {position}', position)
    return {'status': 'equal', 'width': width, 'height': height, 'pixelOrder': list(rule['pixelOrder']),
            'decodedRgbaSha256': hashlib.sha256(actual).hexdigest()}


def require_png_equals_format5_mip0(package, export, png_bytes, rule=None):
    rule = rule or format5_rule()
    width, height, stored_pixels = format5_mip0(package, export, rule)
    return require_png_equals_format5_pixels(export['object'], width, height, stored_pixels, png_bytes, rule)
