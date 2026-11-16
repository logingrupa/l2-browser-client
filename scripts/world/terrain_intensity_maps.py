from typing import NamedTuple

from native_catalog.ue2 import FormatError, Reader
from world.map_actor_properties import actor_properties

INTENSITY_MAPS_FIELD = 'TIntMap'
INTENSITY_MAP_COUNT_FIELD = 'NumIntMap'
INTENSITY_MAP_TIME_FIELD = 'Time'
INTENSITY_MAP_VALUES_FIELD = 'Intensity'
INTEGER_PROPERTY_TYPE = 2
FLOAT_PROPERTY_TYPE = 4
ARRAY_PROPERTY_TYPE = 9
MAXIMUM_INTENSITY_MAPS = 64
SEAMLESS_SAMPLE_EDGE_EXTENSION = 1


class TerrainIntensityMaps(NamedTuple):
    times: tuple
    width: int
    height: int
    intensities: tuple


def single_tag(properties, name, label):
    matches = [prop for prop in properties if prop['name'] == name]
    if len(matches) > 1:
        raise FormatError(f'{label} holds {len(matches)} {name} tags')
    return matches[0] if matches else None


def typed_tag(properties, name, property_type, label):
    tag = single_tag(properties, name, label)
    if tag is not None and tag['type'] != property_type:
        raise FormatError(f'{label} {name} is tag type {tag["type"]}, not {property_type}')
    return tag


def array_tag_reader(package, tag):
    return Reader(package.data, tag['payloadOffset'], tag['payloadOffset'] + len(tag['payloadHex']) // 2)


def intensity_values(package, tag, sample_count, label):
    reader = array_tag_reader(package, tag)
    count = reader.compact()
    if count != sample_count:
        raise FormatError(f'{label} holds {count} intensity samples, not the {sample_count} of its seamless heightmap')
    values = bytes(reader.take(count))
    if reader.position != reader.end:
        raise FormatError(f'{label} holds {reader.end - reader.position} bytes after its intensity samples')
    return values


def read_intensity_map(package, reader, sample_count, label):
    properties, tail = package.properties({'offset': reader.position, 'size': reader.end - reader.position})
    reader.position = tail.position
    time = typed_tag(properties, INTENSITY_MAP_TIME_FIELD, FLOAT_PROPERTY_TYPE, label)
    intensity = typed_tag(properties, INTENSITY_MAP_VALUES_FIELD, ARRAY_PROPERTY_TYPE, label)
    if time is None or intensity is None:
        raise FormatError(f'{label} lacks its {INTENSITY_MAP_TIME_FIELD} or {INTENSITY_MAP_VALUES_FIELD} tag')
    return time['value'], intensity_values(package, intensity, sample_count, label)


def read_intensity_map_list(package, maps_tag, sample_count, label):
    reader = array_tag_reader(package, maps_tag)
    map_count = reader.compact()
    if not 0 <= map_count <= MAXIMUM_INTENSITY_MAPS:
        raise FormatError(f'{label} declares {map_count} intensity maps')
    maps = [read_intensity_map(package, reader, sample_count, f'{label} {INTENSITY_MAPS_FIELD}[{index}]') for index in range(map_count)]
    if reader.position != reader.end:
        raise FormatError(f'{label} holds {reader.end - reader.position} bytes after its {INTENSITY_MAPS_FIELD} elements')
    return maps


def read_terrain_intensity_maps(package, terrain):
    label = f'terrain {terrain["object"]}'
    properties, _, _, _ = actor_properties(package, package.exports[terrain['exportIndex'] - 1])
    maps_tag = typed_tag(properties, INTENSITY_MAPS_FIELD, ARRAY_PROPERTY_TYPE, label)
    count_tag = typed_tag(properties, INTENSITY_MAP_COUNT_FIELD, INTEGER_PROPERTY_TYPE, label)
    width, height = terrain['width'] + SEAMLESS_SAMPLE_EDGE_EXTENSION, terrain['height'] + SEAMLESS_SAMPLE_EDGE_EXTENSION
    maps = [] if maps_tag is None else read_intensity_map_list(package, maps_tag, width * height, label)
    declared_count = 0 if count_tag is None else count_tag['value']
    if declared_count != len(maps):
        raise FormatError(f'{label} {INTENSITY_MAP_COUNT_FIELD} is {declared_count}, but {INTENSITY_MAPS_FIELD} holds {len(maps)} maps')
    times = tuple(time for time, _ in maps)
    if any(following <= current for current, following in zip(times, times[1:])):
        raise FormatError(f'{label} intensity map times {times} are not strictly ascending')
    return TerrainIntensityMaps(times, width, height, tuple(values for _, values in maps))
