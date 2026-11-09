import json
import math
from pathlib import Path
import struct

from native_catalog.ue2 import FormatError
from world.native_terrain_sectors import bit, quad_triangles, read_topology_words
from world.terrain_coordinates import coords_point, cross, native_to_gltf, subtract, unit, xyz


def reference_surface_candidate(manifest, points, maps, origins):
    native = manifest['nativeTerrain']
    region = manifest.get('selectedRegion', manifest.get('selectedSector'))
    ox, oy = region['offset']
    qx, qy = region['quads']
    reference = manifest['referenceActor']
    anchor = reference['location']
    grid = coords_point(native['toHeightmap'], anchor)
    if not (ox <= grid[0] <= ox+qx and oy <= grid[1] <= oy+qy):
        raise FormatError('Reference actor XY lies outside the selected terrain rectangle')
    gx, gy = min(math.floor(grid[0]), ox+qx-1), min(math.floor(grid[1]), oy+qy-1)
    if not bit(maps['QuadVisibilityBitmap'], native['width'], gx, gy):
        raise FormatError('Reference actor XY lies on a hidden native terrain quad')
    a = (gy-oy)*(qx+1)+(gx-ox)
    corners = [points[i] for i in (a, a+1, a+qx+1, a+qx+2)]
    turned = bit(maps['EdgeTurnBitmap'], native['width'], gx, gy)
    fx, fy = grid[0]-gx, grid[1]-gy
    face = ((0, 1, 2) if fx+fy <= 1 else (2, 1, 3)) if turned else ((0, 1, 3) if fy <= fx else (0, 3, 2))
    p, q, r = [corners[i] for i in face]
    determinant = (q[1]-r[1])*(p[0]-r[0])+(r[0]-q[0])*(p[1]-r[1])
    if not math.isfinite(determinant) or determinant == 0:
        raise FormatError('Reference terrain triangle has degenerate XY')
    first = ((q[1]-r[1])*(anchor[0]-r[0])+(r[0]-q[0])*(anchor[1]-r[1]))/determinant
    second = ((r[1]-p[1])*(anchor[0]-r[0])+(p[0]-r[0])*(anchor[1]-r[1]))/determinant
    weights = [first, second, 1-first-second]
    if any(not math.isfinite(value) or not -1e-6 <= value <= 1+1e-6 for value in weights):
        raise FormatError('Reference XY does not lie on the selected native triangle')
    point = [anchor[0], anchor[1], sum(weight*corner[2] for weight, corner in zip(weights, (p, q, r)))]
    slope = max(math.degrees(math.acos(max(-1, min(1, unit(cross(subtract(corners[j], corners[i]), subtract(corners[k], corners[i])))[2]))))
                for i, j, k in quad_triangles(0, 1, 2, 3, turned))
    clearance = min((math.hypot(point[0]-origin[0], point[1]-origin[1]) for origin in origins), default=0)
    return {'sourcePosition': point, 'gltfGroundPosition': native_to_gltf(point), 'cell': [gx, gy], 'edgeTurn': turned,
            'cornerSourcePositions': corners, 'triangleCornerIndices': list(face), 'triangleBarycentricWeights': weights,
            'maxCellSlopeDegrees': slope, 'nearestStaticActorOriginDistanceMetres': clearance*.01,
            'referenceActor': {'object': reference['object'], 'authoredSourcePosition': list(anchor),
                               'authoredHeightAboveTerrainNativeUnits': anchor[2]-point[2]},
            'selection': 'exact authored reference actor XY; original terrain triangle interpolation',
            'heightRule': 'barycentric interpolation on the native diagonal using original float32 world vertices; authored reference Z retained separately',
            'collisionVerified': False, 'nativeSpawnVerified': False,
            'limitation': 'Reference selection is source-backed; live native pawn/camera, actor collision height and mesh/BSP/server collision remain unverified. No native transform or terrain sample is changed.'}


def surface_spawn_candidate(section_output, raw_output, placements):
    section_output, raw_output = Path(section_output), Path(raw_output)
    manifest = json.loads((section_output/'manifest.json').read_text(encoding='utf-8'))
    native = manifest['nativeTerrain']
    sector = manifest['selectedRegion'] if 'selectedRegion' in manifest else manifest['selectedSector']
    ox, oy = sector['offset']
    qx, qy = sector['quads']
    points = list(struct.iter_unpack('<3f', (section_output/'native-section-positions.float32le').read_bytes()))
    terrain = json.loads((raw_output/'terrain.json').read_text(encoding='utf-8'))[0]
    maps = read_topology_words(raw_output, terrain, native)
    origins = [xyz(row['resolvedProperties']['Location']['value']) for row in placements]
    if manifest['recipe'].get('sourceSpawnReferenceActor', False):
        return reference_surface_candidate(manifest, points, maps, origins)
    candidates = []
    for y in range(1, qy-1):
        for x in range(1, qx-1):
            if not bit(maps['QuadVisibilityBitmap'], native['width'], ox+x, oy+y):
                continue
            a = y*(qx+1)+x
            corner_ids = (a, a+1, a+qx+1, a+qx+2)
            corners = [points[i] for i in corner_ids]
            turned = bit(maps['EdgeTurnBitmap'], native['width'], ox+x, oy+y)
            first, last = (corners[1], corners[2]) if turned else (corners[0], corners[3])
            point = [(first[i]+last[i])/2 for i in range(3)]
            slope = max(math.degrees(math.acos(max(-1, min(1, unit(cross(subtract(corners[j], corners[i]), subtract(corners[k], corners[i])))[2]))))
                        for i, j, k in quad_triangles(0, 1, 2, 3, turned))
            if slope > 20:
                continue
            clearance = min((math.hypot(point[0]-origin[0], point[1]-origin[1]) for origin in origins), default=0)
            candidates.append({'sourcePosition': point, 'gltfGroundPosition': native_to_gltf(point),
                               'cell': [ox+x, oy+y], 'edgeTurn': turned, 'cornerSourcePositions': corners,
                               'maxCellSlopeDegrees': slope, 'nearestStaticActorOriginDistanceMetres': clearance*.01})
    if not candidates:
        raise FormatError('No visible interior terrain cell meets the declared 20-degree candidate slope threshold')
    chosen = max(candidates, key=lambda row: (row['nearestStaticActorOriginDistanceMetres'], -row['cell'][1], -row['cell'][0]))
    selection = 'visible interior cell centre, <=20 degree face slope, maximum XY distance from the seven serialized static origins'
    if 'selectedRegion' in manifest:
        selection = f'visible interior cell centre, <=20 degree face slope, maximum XY distance from the {len(origins)} selected serialized static origins'
    return {**chosen, 'selection': selection,
            'heightRule': 'interpolation at the midpoint of the native diagonal, using source float32 world vertices',
            'collisionVerified': False, 'nativeSpawnVerified': False,
            'limitation': 'Origin clearance does not measure mesh bounds, BSP or collision; validate actual movement and geometry before treating this as a walkable spawn.'}
