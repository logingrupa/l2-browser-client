import hashlib

from native_catalog.ue2 import FormatError
from world.reader_licensee_layouts import REVIEWED_PACKAGE_VERSION

LEVEL_CLASS = 'engine.level'
MODEL_CLASS = 'engine.model'
EMPTY_PROPERTY_STREAM = 'None'
URL_STRING_COUNT = 4
URL_TRAILING_INTEGER_COUNT = 2
WIDE_CHARACTER_BYTES = 2
NARROW_CHARACTER_BYTES = 1


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def serialized_level_export(adapter, reader_module):
    levels = [export for export in adapter.exports
              if export.class_index and reader_module.qualified_ref(adapter, export.class_index).lower() == LEVEL_CLASS]
    if len(levels) != 1:
        raise FormatError('expected exactly one qualified Engine.Level export')
    level = levels[0]
    if level.package_index != 0 or level.object_flags & reader_module.RF_HAS_STACK:
        raise FormatError('unsupported Level outer or state-frame prefix')
    if level.serial_offset < 0 or level.serial_size <= 0 or level.serial_offset + level.serial_size > len(adapter.data):
        raise FormatError('Level export outside package')
    return level


def read_reference_array(adapter, reader, raw, native_field):
    count, duplicate = reader.i32(), reader.i32()
    if count < 0 or count != duplicate or count > len(raw) - reader.pos:
        raise FormatError('invalid or noncanonical Level actor-array counts')
    references = []
    for _ in range(count):
        value = reader.compact()
        if value:
            adapter.resolve_ref(value)
        references.append(value)
    return {'nativeField': native_field, 'count': count, 'duplicateCount': duplicate, 'references': references}


def skip_url_string(reader):
    size = reader.compact()
    if size == 0:
        return
    width = WIDE_CHARACTER_BYTES if size < 0 else NARROW_CHARACTER_BYTES
    value = bytes(reader.bytes(abs(size) * width))
    if value[-width:] != bytes(width):
        raise FormatError('unterminated Level URL string')
    if width == WIDE_CHARACTER_BYTES:
        value[:-WIDE_CHARACTER_BYTES].decode('utf-16-le', 'strict')


def skip_level_url(reader, raw):
    for _ in range(URL_STRING_COUNT):
        skip_url_string(reader)
    options = reader.compact()
    if options < 0 or options > len(raw) - reader.pos:
        raise FormatError('invalid Level URL option count')
    for _ in range(options):
        skip_url_string(reader)
    for _ in range(URL_TRAILING_INTEGER_COUNT):
        reader.i32()
    return options


def read_level_model_reference(adapter, reader_module, rules):
    if adapter.file_version != REVIEWED_PACKAGE_VERSION:
        raise FormatError(f'unsupported serialized Level layout (requires package version {REVIEWED_PACKAGE_VERSION})')
    level = serialized_level_export(adapter, reader_module)
    start = level.serial_offset
    raw = adapter.data[start:start + level.serial_size]
    reader = reader_module.Reader(raw, path=str(adapter.path) + ':Level')
    spans = {}
    if adapter.name(reader.compact()) != EMPTY_PROPERTY_STREAM:
        raise FormatError('unsupported nonempty Level property stream')
    spans['properties'] = [start, start + reader.pos]
    arrays = []
    for array_rule in rules['levelBaseReferenceArrays']['arrays']:
        if adapter.licensee_version < array_rule['minimumLicensee']:
            continue
        begin = reader.pos
        arrays.append(read_reference_array(adapter, reader, raw, array_rule['nativeField']))
        spans['array' + array_rule['nativeField']] = [start + begin, start + reader.pos]
    begin = reader.pos
    options = skip_level_url(reader, raw)
    spans['url'] = [start + begin, start + reader.pos]
    begin = reader.pos
    reference = reader.compact()
    if reference <= 0:
        raise FormatError('Level.Model must reference a local Model export')
    model = adapter.resolve_ref(reference)
    if reader_module.qualified_ref(adapter, model.class_index).lower() != MODEL_CLASS or model.serial_size <= 0:
        raise FormatError('Level.Model does not reference a serialized Engine.Model')
    spans['modelReference'] = [start + begin, start + reader.pos]
    evidence = {'selection': 'serialized ULevel.Model', 'nativeField': rules['levelModelReference']['nativeField'],
                'level': {'reference': level.index + 1, 'qualified': reader_module.qualified_ref(adapter, level.index + 1)},
                'levelSerialOffset': start, 'levelSerialSize': level.serial_size,
                'levelSHA256': sha256_hex(raw), 'decodedPrefixSHA256': sha256_hex(raw[:reader.pos]),
                'decodedPrefixBytes': reader.pos, 'remainingTailBytes': len(raw) - reader.pos,
                'remainingTailSHA256': sha256_hex(raw[reader.pos:]), 'spans': spans,
                'actorArrays': arrays, 'urlOptionCount': options,
                'model': {'reference': reference, 'qualified': reader_module.qualified_ref(adapter, reference)}}
    return model, evidence
