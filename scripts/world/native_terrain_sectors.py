import math
import struct

from native_catalog.ue2 import FormatError
from world.map_actor_properties import actor_properties
from world.map_sources import safe_path, sha
from world.reader_licensee_layouts import require_reviewed_reader_layout
from world.terrain_coordinates import calculated_coords, coords_point, cross, read_coords, subtract, unit, xyz

BOUND_TOLERANCE = 0.001
TOPOLOGY_BITMAP_NAMES = ('QuadVisibilityBitmap', 'EdgeTurnBitmap')


def native_terrain(package):
    require_reviewed_reader_layout("terrain-info", package.summary)
    items = [item for item in package.exports if item['classObject'] == 'Engine.TerrainInfo']
    if len(items) != 1:
        raise FormatError('Expected exactly one Engine.TerrainInfo')
    item = items[0]
    _, reader, _, _ = actor_properties(package, item)
    start = reader.position
    references = [reader.compact() for _ in range(reader.count(4096))]
    sectors_x, sectors_y = reader.number('i'), reader.number('i')
    to_world, to_height = read_coords(reader), read_coords(reader)
    width, height = reader.number('i'), reader.number('i')
    if not 2 <= width <= 4096 or not 2 <= height <= 4096 or sectors_x*sectors_y != len(references):
        raise FormatError('Native terrain dimensions/sector count disagree')
    colors = reader.count(4096*4096)
    if colors != width*height:
        raise FormatError('Native terrain vertex-color count disagrees with dimensions')
    color_bytes = reader.take(colors*4)
    if reader.position != reader.end:
        raise FormatError('Native TerrainInfo layout has trailing bytes')
    sectors = []
    for reference in references:
        if not 1 <= reference <= len(package.exports):
            raise FormatError('Terrain sector reference outside export table')
        sector = package.exports[reference-1]
        if sector['classObject'] != 'Engine.TerrainSector' or sector['outerIndex'] != item['exportIndex']:
            raise FormatError('Terrain sector class/owner differs')
        props, tail = package.properties(sector)
        if props or tail.compact() != item['exportIndex']:
            raise FormatError('Unsupported TerrainSector properties/owner')
        qx, qy, ox, oy = [tail.number('i') for _ in range(4)]
        bounds = [tail.number('f') for _ in range(6)]
        valid = tail.number('B')
        if valid != 1 or not all(math.isfinite(v) for v in bounds) or not (0 <= ox < ox+qx < width and 0 <= oy < oy+qy < height):
            raise FormatError('Invalid native terrain sector extent/bounds')
        sectors.append({'object': sector['object'], 'exportIndex': reference, 'offset': [ox, oy],
                        'quads': [qx, qy], 'bounds': bounds, 'nativePayloadOffset': sector['offset'],
                        'remainingNativeBytes': tail.end-tail.position})
    if len({tuple(row['offset']) for row in sectors}) != len(sectors):
        raise FormatError('Duplicate native sector origin')
    return {'object': item['object'], 'exportIndex': item['exportIndex'], 'toWorld': to_world, 'toHeightmap': to_height,
            'width': width, 'height': height, 'sectorsX': sectors_x, 'sectorsY': sectors_y,
            'sectors': sectors, 'vertexColorsBGRA': color_bytes,
            'nativePayload': {'offset': start, 'bytes': reader.end-start, 'sha256': sha(package.data[start:reader.end])}}


def bit(words, width, x, y):
    index = x+y*width
    if index < 0 or index//32 >= len(words):
        raise FormatError('Terrain bitmap index outside source words')
    return bool(words[index//32] & (1 << (index & 31)))


def quad_triangles(a, b, c, d, turned, native_render_order=False):
    faces = [(a, b, c), (c, b, d)] if turned else [(a, b, d), (a, d, c)]
    return [(a, c, b) for a, b, c in faces] if native_render_order else faces


def terrain_points(native, samples):
    w, h = native['width'], native['height']
    if len(samples) != w*h:
        raise FormatError('Height sample count disagrees with native terrain dimensions')
    return [coords_point(native['toWorld'], [x, y, samples[y*w+x]]) for y in range(h) for x in range(w)]


def sector_oracle(native, points):
    w = native['width']
    results = []
    for sector in native['sectors']:
        ox, oy = sector['offset']
        qx, qy = sector['quads']
        vertices = [points[y*w+x] for y in range(oy, oy+qy+1) for x in range(ox, ox+qx+1)]
        measured = [min(p[i] for p in vertices) for i in range(3)] + [max(p[i] for p in vertices) for i in range(3)]
        errors = [abs(a-b) for a, b in zip(measured, sector['bounds'])]
        results.append({**sector, 'reconstructedBounds': measured, 'absoluteErrors': errors,
                        'xyMatches': max(errors[i] for i in (0, 1, 3, 4)) <= BOUND_TOLERANCE,
                        'allBoundsMatch': max(errors) <= BOUND_TOLERANCE})
    return {'toleranceNativeUnits': BOUND_TOLERANCE, 'compared': len(results),
            'xyMatches': sum(row['xyMatches'] for row in results),
            'allBoundsMatch': sum(row['allBoundsMatch'] for row in results),
            'maxHeightError': max(max(row['absoluteErrors'][2], row['absoluteErrors'][5]) for row in results),
            'interpretation': 'Serialized sector bounds are cached; UE2 CheckComputeDataOnLoad rebuilds vertices and GenerateTriangles updates bounds. Differences are retained, never used to fit samples.',
            'sectors': results}


def select_terrain_sectors(native, oracle, recipe):
    if ('terrainSector' in recipe) == ('terrainSectorRectangle' in recipe):
        raise FormatError('Declare exactly one terrainSector or terrainSectorRectangle')
    policy = recipe.get('cachedSectorBoundsPolicy', 'require-all')
    if policy not in ('require-all', 'require-xy-preserve-z-discrepancies'):
        raise FormatError('Unsupported cached sector bounds policy')
    if 'terrainSector' in recipe:
        selected = [row for row in oracle['sectors'] if row['object'] == recipe['terrainSector']]
        if policy != 'require-all' or len(selected) != 1 or not selected[0]['allBoundsMatch']:
            raise FormatError('Selected sector has not passed the independent native bounds oracle')
        return selected[0], selected
    rectangle = recipe['terrainSectorRectangle']
    if not isinstance(rectangle, dict) or set(rectangle) != {'minOffset', 'maxOffset'}:
        raise FormatError('Rectangle requires explicit minOffset/maxOffset native sector origins')
    for key in ('minOffset', 'maxOffset'):
        value = rectangle[key]
        if not isinstance(value, list) or len(value) != 2 or any(type(v) is not int or v < 0 for v in value):
            raise FormatError('Sector rectangle offsets must be pairs of nonnegative integers')
    minimum, maximum = rectangle['minOffset'], rectangle['maxOffset']
    if any(minimum[i] > maximum[i] for i in range(2)):
        raise FormatError('Sector rectangle has reversed origin bounds')
    selected = sorted((row for row in oracle['sectors'] if all(minimum[i] <= row['offset'][i] <= maximum[i] for i in range(2))),
                      key=lambda row: (row['offset'][1], row['offset'][0]))
    lookup = {tuple(row['offset']): row for row in selected}
    if not selected or len(lookup) != len(selected) or tuple(minimum) not in lookup or tuple(maximum) not in lookup:
        raise FormatError('Sector rectangle corners must identify unique native sector origins')
    xs, ys = sorted({row['offset'][0] for row in selected}), sorted({row['offset'][1] for row in selected})
    if len(selected) != len(xs)*len(ys):
        raise FormatError('Sector rectangle contains missing cells')
    widths = {x: lookup[(x, ys[0])]['quads'][0] for x in xs}
    heights = {y: lookup[(xs[0], y)]['quads'][1] for y in ys}
    if (any(type(q) is not int or q <= 0 for q in [*widths.values(), *heights.values()]) or
            any(row['quads'] != [widths[row['offset'][0]], heights[row['offset'][1]]] for row in selected) or
            any(x+widths[x] != following for x, following in zip(xs, xs[1:])) or
            any(y+heights[y] != following for y, following in zip(ys, ys[1:]))):
        raise FormatError('Sector rectangle is not a contiguous native quad grid')
    quads = [xs[-1]+widths[xs[-1]]-xs[0], ys[-1]+heights[ys[-1]]-ys[0]]
    if any(minimum[i]+quads[i] >= native[key] for i, key in enumerate(('width', 'height'))):
        raise FormatError('Sector rectangle exceeds native height samples')
    if any(not row['xyMatches'] or (policy == 'require-all' and not row['allBoundsMatch']) for row in selected):
        raise FormatError('Selected rectangle has not passed its declared native bounds oracle policy')
    bounds = [min(row['reconstructedBounds'][i] for row in selected) for i in range(3)]
    bounds += [max(row['reconstructedBounds'][i] for row in selected) for i in range(3, 6)]
    region = {'object': native['object'], 'kind': 'native-sector-rectangle', 'offset': list(minimum), 'quads': quads,
              'bounds': bounds, 'boundsBasis': 'reconstructed original source samples; cached bounds retained per selected sector',
              'sectorGrid': [len(xs), len(ys)], 'sectorObjects': [row['object'] for row in selected],
              'cachedBoundsPolicy': policy, 'cachedBoundsToleranceNativeUnits': BOUND_TOLERANCE,
              'cachedZBoundsMatched': sum(row['allBoundsMatch'] for row in selected),
              'cachedZBoundsMismatched': sum(not row['allBoundsMatch'] for row in selected)}
    return region, selected


def read_height_samples(raw_root, terrain):
    payload = safe_path(raw_root, terrain['height']['mips'][0]['rawPath']).read_bytes()
    return struct.unpack('<'+str(len(payload)//2)+'H', payload)


def read_topology_words(raw_root, terrain, native):
    words = {}
    for name in TOPOLOGY_BITMAP_NAMES:
        record = next(r for r in terrain['bitmaps'] if r['name'] == name)
        payload = safe_path(raw_root, record['path']).read_bytes()
        words[name] = struct.unpack('<'+str(len(payload)//4)+'I', payload)
        if len(words[name])*32 != native['width']*native['height']:
            raise FormatError('Topology word count disagrees with native dimensions')
    return words


def source_backed_terrain_points(native, terrain, terrain_actor, samples):
    calc = calculated_coords(xyz(terrain_actor['sourceTransform']['Location']['value']), xyz(terrain['terrainScale']), native['width'], native['height'])
    if calc != native['toWorld']:
        raise FormatError('Native ToWorld differs from source-backed CalcCoords; no geometry emitted')
    return terrain_points(native, samples)


def vertex_normal(points, words, width, height, x, y):
    normals = []
    for cy in (y, y-1):
        for cx in (x, x-1):
            if not (0 <= cx < width-1 and 0 <= cy < height-1):
                continue
            a = cy*width+cx
            for i, j, k in quad_triangles(a, a+1, a+width, a+width+1, bit(words, width, cx, cy)):
                normals.append(unit(cross(subtract(points[j], points[i]), subtract(points[k], points[i]))))
    return unit([sum(row[i] for row in normals) for i in range(3)])
