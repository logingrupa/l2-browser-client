import math

from native_catalog.ue2 import FormatError
from world.map_actor_properties import property_value
from world.map_sources import sha
from world.terrain_coordinates import dot, f32

UV_TOLERANCE = 0.00001
QUALIFIED_MASK_UV_RULE_ID = 'interlude-20_20-submitted-mask-uv-20261106'
QUALIFIED_MASK_UV_FORMULA = '(gridXY + 0.5) / heightmapDimensions - max(gridXY - 240, 0) / 4096'


def serialized_matrix(properties):
    rows = property_value(properties, 'TerrainMatrix')
    if not isinstance(rows, list):
        raise FormatError('Missing serialized terrain material matrix')
    result = []
    for label in ('XPlane', 'YPlane', 'ZPlane', 'WPlane'):
        plane = property_value(rows, label)
        if not isinstance(plane, list):
            raise FormatError('Missing material matrix plane')
        values = [property_value(plane, axis) for axis in 'XYZW']
        if not all(type(v) in (int, float) and math.isfinite(v) for v in values):
            raise FormatError('Incomplete material matrix fields')
        result.append(values)
    return result


def texture_uv(matrix, native_point):
    p = [*native_point, 1]
    return [sum(p[row]*matrix[row][column] for row in range(4)) for column in (0, 1)]


def terrain_mask_uv(x, y, width, height, mask_uv_rule):
    if mask_uv_rule['formula'] != QUALIFIED_MASK_UV_FORMULA:
        raise FormatError(f'Unsupported terrain mask UV formula: {mask_uv_rule["formula"]!r}')
    half_texel = [(x+.5)/width, (y+.5)/height]
    return [half_texel[0] - max(x-240, 0)/4096, half_texel[1] - max(y-240, 0)/4096]


def layer_sampling_source(layer, package, terrain_export, source_path):
    names = ('Scale', 'ToWorld', 'ToMaskmap', 'bUseAlpha')
    properties = []
    start, end = terrain_export['offset'], terrain_export['offset'] + terrain_export['size']
    for prop in layer['properties']:
        if prop['name'] not in names:
            continue
        payload = prop['payload']
        tag_start, payload_start, size = prop['offset'], payload['offset'], payload['bytes']
        if (payload['path'] != 'raw/map.unwrapped.bin' or
                not all(type(value) is int for value in (tag_start, payload_start, size)) or size < 0 or
                not 0 <= start <= tag_start < payload_start <= payload_start + size <= end <= len(package.data)):
            raise FormatError('Terrain layer property exceeds its native export')
        raw_payload = package.data[payload_start:payload_start+size]
        if sha(raw_payload) != payload['sha256']:
            raise FormatError('Terrain layer property payload hash differs from native source')
        serialized = package.data[tag_start:payload_start+size]
        properties.append({'property': prop, 'serializedTagAndPayload': {
            'offset': tag_start, 'bytes': len(serialized), 'payloadOffsetWithinRecord': payload_start-tag_start,
            'sha256': sha(serialized), 'hex': serialized.hex()}})
    return {'package': source_path, 'packageSha256': package.source_hash,
            'object': terrain_export['object'], 'exportIndex': terrain_export['exportIndex'],
            'layerIndex': layer['index'], 'offsetBasis': 'unwrapped native package; raw map property paths are provenance only',
            'properties': properties, 'omittedProperties': [name for name in names if not any(p['name'] == name for p in layer['properties'])],
            'interpretation': 'Original property tags, array indices and bytes; no defaults, resampling or native sampling/blend semantics inferred.'}


def layer_records(terrain, native, package, source_path):
    terrain_export = package.exports[native['exportIndex']-1]
    if terrain['id'] != 'interlude:'+terrain_export['object'] or native['object'] != terrain_export['object']:
        raise FormatError('Terrain layer source identity differs from native export')
    records = []
    for layer in terrain['layers']:
        props = layer['properties']
        texture, alpha = property_value(props, 'Texture'), property_value(props, 'AlphaMap')
        if not texture or not texture['object'] or not alpha or not alpha['object']:
            continue
        matrix = serialized_matrix(props)
        scale = [property_value(props, name) for name in ('UScale', 'VScale')]
        rot = property_value(props, 'LayerRotation')
        if property_value(props, 'TextureMapAxis') != 0 or property_value(props, 'TextureRotation') != 0 or rot != {'Pitch': 0, 'Yaw': 0, 'Roll': 0}:
            raise FormatError('Non-XY/rotated layer requires a separately verified UV adapter')
        if any(property_value(props, key) != 0 for key in ('UPan', 'VPan')) or any(v is None or v <= 0 for v in scale):
            raise FormatError('Nonzero pan/invalid layer scale is outside this verified UV case')
        inv = native['toHeightmap']
        transposed_origin = [-f32(dot(inv['origin'], axis)) for axis in inv['axes']]
        tex_origin = [f32(dot([-v for v in transposed_origin], axis)) for axis in inv['axes']]
        errors = []
        for axis in (0, 1):
            coefficient = f32(inv['axes'][axis][axis]/scale[axis])
            expected_translation = f32(-tex_origin[axis]*coefficient)
            errors += [abs(matrix[axis][axis]-coefficient), abs(matrix[3][axis]-expected_translation)]
            errors += [abs(matrix[row][axis]) for row in range(3) if row != axis]
        if max(errors) > UV_TOLERANCE:
            raise FormatError('Serialized terrain UV matrix differs from native reference calculation')
        records.append({'index': layer['index'], 'texture': texture['object'], 'alphaMap': alpha['object'],
                        'useAlpha': property_value(props, 'bUseAlpha'), 'worldToTextureRowMajor': matrix,
                        'uvCoefficientMaxError': max(errors), 'maskUV': '(gridXY + 0.5) / heightmapDimensions',
                        'maskUVStatus': 'inspection-candidate; native mask sampling remains unverified',
                        'nativeSamplingSource': layer_sampling_source(layer, package, terrain_export, source_path),
                        'channelAndBlendStatus': 'Lineage compressed alpha-map channel selection and layer blending remain unverified; source references and bUseAlpha are preserved'})
    if not records:
        raise FormatError('No supported native terrain layers')
    return records
