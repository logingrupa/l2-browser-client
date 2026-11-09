import math

from native_catalog.ue2 import FormatError, Reader
from world.map_sources import sha
from world.reader_licensee_layouts import require_reviewed_reader_layout

HAS_STACK = 0x02000000
TRANSFORMS = ('Location', 'Rotation', 'DrawScale', 'DrawScale3D', 'PrePivot')
COLLISION = ('bCollideActors', 'bBlockActors', 'bBlockPlayers', 'bBlockKarma',
             'bBlockZeroExtentTraces', 'bBlockNonZeroExtentTraces', 'bUseCylinderCollision',
             'CollisionRadius', 'CollisionHeight')
BITMAPS = ('QuadVisibilityBitmap', 'EdgeTurnBitmap', 'QuadVisibilityBitmapOrig', 'EdgeTurnBitmapOrig')
MAXIMUM_PROPERTY_NESTING_DEPTH = 8
MAXIMUM_BITMAP_WORDS = 1_048_576
MAXIMUM_ARRAY_ELEMENTS = 4096


def source_range(data, path, start, end):
    if not 0 <= start <= end <= len(data):
        raise FormatError('Raw map range exceeds source')
    return {'path': path, 'offset': start, 'bytes': end - start, 'sha256': sha(data[start:end])}


def actor_properties(package, item):
    require_reviewed_reader_layout("map-actor", package.summary)
    reader = Reader(package.data, item['offset'], item['offset'] + item['size'])
    state = None
    if item['flags'] & HAS_STACK:
        state = {'nodeIndex': reader.compact(), 'stateNodeIndex': reader.compact(),
                 'probeMaskHex': f'{reader.number("Q"):016x}', 'latentAction': reader.number('I')}
        state['offset'] = reader.compact() if state['nodeIndex'] else None
        package.object_name(state['nodeIndex'])
        package.object_name(state['stateNodeIndex'])
    prefix_end = reader.position
    props, tail = package.properties({**item, 'offset': reader.position, 'size': reader.end - reader.position})
    return props, tail, state, prefix_end


def bitmap_words(raw):
    reader = Reader(raw)
    count = reader.count(MAXIMUM_BITMAP_WORDS)
    offset = reader.position
    words = [reader.number('I') for _ in range(count)]
    if reader.position != reader.end:
        raise FormatError('Bitmap contains bytes beyond its declared uint32 count')
    return {'wordCount': count, 'bitCapacity': count * 32, 'setBitCount': sum(word.bit_count() for word in words),
            'dataOffset': offset, 'words': words}


def decode_property(package, prop, raw_path, depth=0):
    if depth > MAXIMUM_PROPERTY_NESTING_DEPTH:
        raise FormatError('Map property nesting exceeds eight levels')
    raw = bytes.fromhex(prop['payloadHex'])
    result = {key: prop[key] for key in ('name', 'type', 'arrayIndex', 'structName', 'offset', 'status')}
    result['payload'] = source_range(package.data, raw_path, prop['payloadOffset'], prop['payloadOffset'] + len(raw))
    if 'value' in prop:
        result['value'] = prop['value']
    elif prop['type'] == 10 and prop['structName'] in ('Vector', 'Rotator'):
        kind = prop['structName']
        labels = {'Vector': ('X', 'Y', 'Z'), 'Rotator': ('Pitch', 'Yaw', 'Roll')}
        reader = Reader(raw)
        values = [reader.number('i' if kind == 'Rotator' else 'f') for _ in labels[kind]]
        if reader.position != reader.end or not all(math.isfinite(value) for value in values):
            raise FormatError('Invalid map numeric struct: ' + kind)
        result['value'] = dict(zip(labels[kind], values))
        result['status'] = 'decoded'
    elif prop['type'] == 10 and prop['structName'] in ('TerrainLayer', 'Matrix', 'Plane', 'Range', 'RangeVector', 'PointRegion'):
        nested, tail = package.properties({'offset': prop['payloadOffset'], 'size': len(raw)})
        if tail.position != tail.end:
            raise FormatError(prop['structName'] + ' has unconsumed tagged bytes')
        result.update(status='decoded-tags', value=[decode_property(package, field, raw_path, depth + 1) for field in nested])
    elif prop['type'] == 9 and prop['name'] == 'DecoLayers':
        reader = Reader(package.data, prop['payloadOffset'], prop['payloadOffset'] + len(raw))
        values = []
        for _ in range(reader.count(MAXIMUM_ARRAY_ELEMENTS)):
            nested, tail = package.properties({'offset': reader.position, 'size': reader.end - reader.position})
            reader.position = tail.position
            values.append([decode_property(package, field, raw_path, depth + 1) for field in nested])
        if reader.position != reader.end:
            raise FormatError('DecoLayers has trailing bytes')
        result.update(status='decoded-tags', value=values)
    elif prop['type'] == 9 and prop['name'] in BITMAPS:
        result.update(status='decoded-uint32-array', value=bitmap_words(raw))
    elif prop['type'] == 9 and prop['name'] == 'Skins':
        reader = Reader(raw)
        references = [reader.compact() for _ in range(reader.count(MAXIMUM_ARRAY_ELEMENTS))]
        if reader.position != reader.end:
            raise FormatError('Skins has trailing bytes')
        result.update(status='decoded', value=[{'index': ref, 'object': package.object_name(ref)} for ref in references])
    return result


def property_value(properties, name):
    matches = [prop for prop in properties if prop['name'] == name and prop['arrayIndex'] in (None, 0)]
    if len(matches) > 1:
        raise FormatError('Ambiguous scalar map property: ' + name)
    return matches[0].get('value') if matches else None


def explicit_properties(properties, names):
    return {name: {'status': 'serialized', 'value': property_value(properties, name)}
            if any(prop['name'] == name for prop in properties) else {'status': 'omitted-class-default-unresolved'}
            for name in names}


def ambient_sound_object(package, item, raw_path):
    if item['classObject'] != 'Engine.AmbientSoundObject' or item['flags'] & HAS_STACK:
        raise FormatError('Unsupported ambient LevelObject class/state-frame layout')
    props, tail, state, prefix_end = actor_properties(package, item)
    if state is not None or prefix_end != item['offset']:
        raise FormatError('Ambient LevelObject unexpectedly has an Actor prefix')
    return {'id': 'interlude:' + item['object'], 'object': item['object'],
            'class': item['className'], 'classObject': item['classObject'],
            'exportIndex': item['exportIndex'], 'objectFlags': item['flags'],
            'authoredPropertiesOnly': True,
            'properties': [decode_property(package, prop, raw_path) for prop in props],
            'nativePayload': source_range(package.data, raw_path, item['offset'], item['offset'] + item['size']),
            'nativeTail': source_range(package.data, raw_path, tail.position, tail.end),
            'classDefaults': 'not-resolved-by-raw-map-export', 'nativePlayback': 'unverified'}
