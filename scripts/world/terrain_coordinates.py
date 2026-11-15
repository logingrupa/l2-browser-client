import math
import struct

from native_catalog.ue2 import FormatError

SOURCE_TO_GLTF = [.01, 0, 0, 0, 0, 0, .01, 0, 0, .01, 0, 0, 0, 0, 0, 1]


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def xyz(value):
    result = [value[axis] for axis in 'XYZ']
    if not all(type(v) in (int, float) and math.isfinite(v) for v in result):
        raise FormatError('Non-finite native vector')
    return result


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def subtract(a, b):
    return [x - y for x, y in zip(a, b)]


def cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


def unit(v):
    length = math.sqrt(dot(v, v))
    if length <= 0 or not math.isfinite(length):
        raise FormatError('Degenerate terrain normal')
    return [x/length for x in v]


def native_to_gltf(point):
    return [point[0] * .01, point[2] * .01, point[1] * .01]


def coords_point(coords, point):
    delta = [f32(a-b) for a, b in zip(point, coords['origin'])]
    return [f32(sum(f32(a*b) for a, b in zip(delta, axis))) for axis in coords['axes']]


def calculated_coords(location, scale, width, height):
    if any(v <= 0 for v in scale):
        raise FormatError('Unsupported non-positive terrain scale')
    origin = [f32(f32(-location[0]/scale[0]) + width//2),
              f32(f32(-location[1]/scale[1]) + height//2),
              f32(f32(f32(-256.0*location[2])/scale[2]) + 32767)]
    return {'origin': origin, 'axes': [[scale[0], 0, 0], [0, scale[1], 0], [0, 0, f32(scale[2]/256)]]}


def read_coords(reader):
    values = [[reader.number('f') for _ in range(3)] for _ in range(4)]
    if not all(math.isfinite(v) for row in values for v in row):
        raise FormatError('Non-finite native terrain FCoords')
    return {'origin': values[0], 'axes': values[1:]}
