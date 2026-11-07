"""Bounded UE2 package reader and reviewed 123/28, 123/30 animation layouts.

Format cross-check: UEViewer a0bfb468d42be831b126632fd8a0ae6b3614f981,
UnMesh2.h FMeshAnimSeq/FMeshAnimNotify and UnAnim2.cpp SerializeLineageMoves.
Unknown fields are preserved; no native scripts are executed.
"""
from collections import Counter
import hashlib
import math
import struct


class FormatError(ValueError):
    pass


ANIMATION_LAYOUT_EVIDENCE = {
    'revision': 'a0bfb468d42be831b126632fd8a0ae6b3614f981',
    'file': 'Unreal/UnrealMesh/UnMesh2.h',
    'sha256': '8557058200be31a6bd133e0a9bbd912b06360475dd10f7fcf085f311eb38dfcb',
    'records': ['FMeshAnimSeq', 'FMeshAnimNotify', 'FLineageUnk4', 'AnalogTrack', 'MotionChunk'],
    'policy': 'UE123 licensee28 and30 share the reviewed Lineage sequence extension (licensee>=27) and uncompressed AnalogTrack layout; other versions remain rejected.',
}


def animation_layout(package_summary):
    version = (package_summary['version'], package_summary['licenseeVersion'])
    if version not in ((123, 28), (123, 30)):
        raise FormatError('Native animation/notify adapter supports reviewed UE2 123/28 and 123/30 only')
    return {'packageVersion': version[0], 'licenseeVersion': version[1], 'evidence': dict(ANIMATION_LAYOUT_EVIDENCE)}


class Reader:
    def __init__(self, data, position=0, end=None):
        self.data = data
        self.position = position
        self.end = len(data) if end is None else end
        if not 0 <= self.position <= self.end <= len(data):
            raise FormatError('Reader bounds exceed input')

    def take(self, size):
        if size < 0 or self.position + size > self.end:
            raise FormatError(f'Truncated input at {self.position}, requested {size}, end {self.end}')
        data = self.data[self.position:self.position + size]
        self.position += size
        return data

    def number(self, fmt):
        return struct.unpack('<' + fmt, self.take(struct.calcsize('<' + fmt)))[0]

    def compact(self):
        first = self.number('B')
        value, shift = first & 63, 6
        if first & 64:
            for index in range(4):
                byte = self.number('B')
                if index == 3 and byte & 0xe0:
                    raise FormatError('Compact index exceeds 32 bits')
                value |= (byte & (31 if index == 3 else 127)) << shift
                shift += 7
                if not byte & 128:
                    break
        return -value if first & 128 else value

    def count(self, maximum=1_000_000):
        count = self.compact()
        if not 0 <= count <= maximum:
            raise FormatError(f'Invalid collection count: {count}')
        return count

    def string(self):
        length = self.compact()
        if not -65536 <= length <= 65536:
            raise FormatError('Oversized Unreal string')
        raw = self.take(abs(length) * (2 if length < 0 else 1))
        if raw and not raw.endswith(b'\0\0' if length < 0 else b'\0'):
            raise FormatError('Unterminated Unreal string')
        return raw.decode('utf-16le' if length < 0 else 'cp1252').rstrip('\0')


def unwrap(data, filename):
    wrapper = data[:28].decode('utf-16le', errors='replace')
    if wrapper in ('Lineage2Ver111', 'Lineage2Ver121'):
        key = 0xac if wrapper.endswith('111') else sum(filename.lower().encode('ascii')) & 255
        data = data[28:].translate(bytes(value ^ key for value in range(256)))
    elif data[:4] == b'\xc1\x83\x2a\x9e':
        wrapper = 'UnrealPackage'
    else:
        raise FormatError(f'Unsupported native wrapper: {wrapper!r}')
    if data[:4] != b'\xc1\x83\x2a\x9e':
        raise FormatError('Unwrapped bytes do not have the Unreal package signature')
    return wrapper, data


def summary(data, filename):
    wrapper, decoded = unwrap(data, filename)
    if len(decoded) < 36:
        raise FormatError('Truncated package summary')
    fields = struct.unpack_from('<IHHIIIIIII', decoded)
    return {'wrapper': wrapper, **dict(zip(('signature', 'version', 'licenseeVersion', 'flags',
        'nameCount', 'nameOffset', 'exportCount', 'exportOffset', 'importCount', 'importOffset'), fields))}


class Package:
    def __init__(self, data, filename):
        self.filename = filename
        self.package_name = filename.rsplit('.', 1)[0]
        self.source_hash = hashlib.sha256(data).hexdigest()
        self.summary = summary(data[:128], filename)
        if self.summary['version'] != 123 or not 0 <= self.summary['licenseeVersion'] <= 31:
            raise FormatError('Package table adapter supports UE2 123/licensee0..31; other original bytes remain preserved')
        _, self.data = unwrap(data, filename)
        for field in ('nameCount', 'exportCount', 'importCount'):
            if self.summary[field] > 1_000_000:
                raise FormatError('Oversized package table')
        reader = Reader(self.data, self.summary['nameOffset'])
        self.names = []
        for _ in range(self.summary['nameCount']):
            self.names.append(reader.string())
            reader.number('I')
        reader = Reader(self.data, self.summary['importOffset'])
        self.imports = []
        for _ in range(self.summary['importCount']):
            self.imports.append({'classPackage': self.name(reader.compact()), 'className': self.name(reader.compact()),
                'outerIndex': reader.number('i'), 'name': self.name(reader.compact())})
        reader = Reader(self.data, self.summary['exportOffset'])
        self.exports = []
        for index in range(self.summary['exportCount']):
            item = {'exportIndex': index + 1, 'classIndex': reader.compact(), 'superIndex': reader.compact(),
                'outerIndex': reader.number('i'), 'name': self.name(reader.compact()), 'flags': reader.number('I'),
                'size': reader.compact()}
            item['offset'] = reader.compact() if item['size'] else 0
            if item['size'] < 0 or item['offset'] < 0 or item['offset'] + item['size'] > len(self.data):
                raise FormatError('Export payload outside package')
            self.exports.append(item)
        for item in self.exports:
            item['object'] = self.object_name(item['exportIndex'])
            item['classObject'] = self.object_name(item['classIndex']) or 'Core.Class'
            item['className'] = item['classObject'].rsplit('.', 1)[-1]
        for index, item in enumerate(self.imports, 1):
            item['object'] = self.object_name(-index)

    def name(self, index):
        if not 0 <= index < len(self.names):
            raise FormatError(f'Name index outside table: {index}')
        return self.names[index]

    def object_name(self, index, visited=None):
        if index == 0:
            return None
        visited = set() if visited is None else visited
        if index in visited or len(visited) > 100:
            raise FormatError('Cyclic package object outer')
        visited.add(index)
        table, offset = (self.exports, index - 1) if index > 0 else (self.imports, -index - 1)
        if not 0 <= offset < len(table):
            raise FormatError(f'Object reference outside package: {index}')
        item = table[offset]
        parent = self.object_name(item['outerIndex'], visited) if item['outerIndex'] else (self.package_name if index > 0 else '')
        return f'{parent}.{item["name"]}' if parent else item['name']

    def properties(self, item):
        reader = Reader(self.data, item['offset'], item['offset'] + item['size'])
        properties = []
        while reader.position < reader.end:
            start = reader.position
            name = self.name(reader.compact())
            if name == 'None':
                return properties, reader
            info = reader.number('B')
            kind, size_code = info & 15, (info >> 4) & 7
            struct_name = self.name(reader.compact()) if kind == 10 else None
            size = (1, 2, 4, 12, 16)[size_code] if size_code < 5 else reader.number({5: 'B', 6: 'H', 7: 'i'}[size_code])
            array_index = None
            if kind != 3 and info & 128:
                first = reader.number('B')
                if not first & 128:
                    array_index = first
                elif first & 192 == 128:
                    array_index = ((first & 127) << 8) | reader.number('B')
                else:
                    array_index = ((first & 63) << 24) | int.from_bytes(reader.take(3), 'big')
            payload_offset = reader.position
            raw = reader.take(0 if kind == 3 else size)
            value_reader = Reader(raw)
            record = {'name': name, 'type': kind, 'arrayIndex': array_index, 'structName': struct_name,
                'offset': start, 'payloadOffset': payload_offset, 'payloadHex': raw.hex(), 'status': 'raw-preserved'}
            if kind in (5, 8):
                reference = value_reader.compact()
                record.update(value={'index': reference, 'object': self.object_name(reference)}, status='decoded')
            elif kind == 6:
                record.update(value=self.name(value_reader.compact()), status='decoded')
            elif kind in (1, 2, 4):
                value = value_reader.number({1: 'B', 2: 'i', 4: 'f'}[kind])
                if isinstance(value, float) and not math.isfinite(value):
                    raise FormatError('Non-finite property')
                record.update(value=value, status='decoded')
            elif kind == 3:
                record.update(value=bool(info & 128), status='decoded')
            elif kind in (7, 13):
                record.update(value=value_reader.string(), status='decoded')
            if record['status'] == 'decoded' and value_reader.position != value_reader.end:
                raise FormatError(f'Unconsumed typed property bytes: {name}')
            properties.append(record)
            if len(properties) > 100_000:
                raise FormatError('Too many property tags')
        raise FormatError('Missing property terminator')

    def animation(self, item):
        animation_layout(self.summary)
        properties, reader = self.properties(item)
        version = reader.number('i')
        bones = [{'name': self.name(reader.compact()), 'flags': reader.number('I'), 'parentIndex': reader.number('i')}
                 for _ in range(reader.count(4096))]
        moves_end = reader.number('i')
        move_count = reader.count(10000)
        moves = []
        for _ in range(move_count):
            move_end = reader.number('i')
            move_start = reader.position
            if not move_start + 24 <= move_end <= moves_end <= reader.end:
                raise FormatError('Invalid Lineage motion skip offset')
            root_speed = [reader.number('f') for _ in range(3)]
            track_time = reader.number('f')
            start_bone, flags = reader.number('i'), reader.number('I')
            if not all(math.isfinite(value) for value in root_speed + [track_time]):
                raise FormatError('Non-finite motion metadata')
            moves.append({'offset': move_start, 'bytes': move_end - move_start, 'rootSpeed3D': root_speed,
                'trackTime': track_time, 'startBone': start_bone, 'flags': flags,
                'sha256': hashlib.sha256(self.data[move_start:move_end]).hexdigest()})
            reader.position = move_end
        if reader.position != moves_end:
            raise FormatError('Lineage motion records do not end at their declared boundary')
        sequences = []
        for _ in range(reader.count(10000)):
            offset = reader.position
            unknown_float = reader.number('f')
            name = self.name(reader.compact())
            groups = [self.name(reader.compact()) for _ in range(reader.count(1000))]
            start_frame, frames = reader.number('i'), reader.number('i')
            events = []
            for _ in range(reader.count(10000)):
                time = reader.number('f')
                function = self.name(reader.compact())
                reference = reader.compact()
                if not math.isfinite(time):
                    raise FormatError('Non-finite notification time')
                events.append({'timeNormalized': time, 'function': function,
                    'notifyObject': self.object_name(reference), 'notifyIndex': reference})
            rate = reader.number('f')
            if frames < 0 or not math.isfinite(rate) or rate <= 0:
                raise FormatError('Invalid animation frame count/rate')
            extra_start = reader.position
            unknown_ints = [reader.number('i') for _ in range(3)]
            unknown_object = reader.compact()
            self.object_name(unknown_object)
            unknown_ints += [reader.number('i') for _ in range(2)]
            unknown_byte = reader.number('B')
            first_pairs = [[reader.number('i'), reader.number('i')] for _ in range(reader.count(100000))]
            nested = []
            for _ in range(reader.count(100000)):
                nested.append({'value': reader.number('i'), 'pairs': [[reader.number('i'), reader.number('i')]
                    for _ in range(reader.count(100000))]})
            unknown_ints += [reader.number('i') for _ in range(2)]
            last_pairs = [[reader.number('i'), reader.number('i')] for _ in range(reader.count(100000))]
            sequences.append({'name': name, 'groups': groups, 'startFrame': start_frame, 'numFrames': frames,
                'rate': rate, 'sourceDurationSeconds': frames / rate, 'events': events, 'offset': offset,
                'lineageFields': {'uninterpretedFloat': unknown_float, 'integers': unknown_ints,
                    'objectIndex': unknown_object, 'byte': unknown_byte, 'pairsA': first_pairs,
                    'nested': nested, 'pairsB': last_pairs, 'rawHex': self.data[extra_start:reader.position].hex()}})
        if len(sequences) != move_count or reader.position != reader.end:
            raise FormatError('Animation records do not fully consume the export or match motion count')
        return {'object': item['object'], 'version': version, 'properties': properties, 'bones': bones,
            'motionMetadata': moves, 'sequences': sequences, 'bytesConsumed': item['size'],
            'motionTracksDecoded': False, 'note': 'Original tracks remain in source; exporter owns geometry/track conversion.'}

    def notification_sidecar(self):
        layout = animation_layout(self.summary)
        notifies, animations, unsupported = [], [], []
        for item in self.exports:
            if item['className'].startswith('AnimNotify_'):
                try:
                    properties, reader = self.properties(item)
                    if reader.position != reader.end:
                        raise FormatError('Notification has trailing undecoded bytes')
                    notifies.append({'object': item['object'], 'classObject': item['classObject'],
                        'exportIndex': item['exportIndex'], 'sourceOffset': item['offset'], 'sourceBytes': item['size'],
                        'properties': properties, 'authoredPropertiesOnly': True,
                        'rawPayloadHex': self.data[item['offset']:item['offset'] + item['size']].hex()})
                except FormatError as error:
                    unsupported.append({'object': item['object'], 'reason': str(error)})
            elif item['className'] == 'MeshAnimation':
                try:
                    animations.append(self.animation(item))
                except FormatError as error:
                    unsupported.append({'object': item['object'], 'reason': str(error)})
        notify_by_object = {item['object']: item for item in notifies}
        animation_events = []
        for animation in animations:
            for sequence in animation['sequences']:
                for event in sequence['events']:
                    notify = notify_by_object.get(event['notifyObject'])
                    values = {}
                    if notify:
                        counts = Counter(prop['name'] for prop in notify['properties'])
                        for prop in notify['properties']:
                            value = prop.get('value', {'unparsedHex': prop['payloadHex']})
                            if isinstance(value, dict) and 'object' in value:
                                value = value['object']
                            if counts[prop['name']] > 1 or prop['arrayIndex'] is not None:
                                array = values.setdefault(prop['name'], [])
                                index = prop['arrayIndex'] or 0
                                if index > 4096:
                                    raise FormatError('Oversized notify static array index')
                                while len(array) <= index:
                                    array.append(None)
                                array[index] = value
                            else:
                                values[prop['name']] = value
                    animation_events.append({'animationSet': animation['object'], 'clip': sequence['name'],
                        'timeSeconds': event['timeNormalized'] * sequence['sourceDurationSeconds'],
                        'normalizedTime': event['timeNormalized'], 'type': notify['classObject'].rsplit('.', 1)[-1] if notify else 'unresolved-native-notify',
                        'object': event['notifyObject'], 'properties': values, 'sound': values.get('Sound'),
                        'function': event['function'], 'sourceFrames': sequence['numFrames'], 'sourceRate': sequence['rate'],
                        'timingBasis': 'source normalized notification time * (NumFrames / Rate)'})
        return {'schemaVersion': 1, 'edition': 'interlude', 'sourceSha256': self.source_hash,
            'package': self.package_name, 'packageVersion': layout['packageVersion'], 'licenseeVersion': layout['licenseeVersion'],
            'nativeAnimationLayout': layout,
            'notifies': notifies, 'animations': animations, 'animationEvents': animation_events, 'unsupported': unsupported,
            'classCounts': dict(Counter(item['className'] for item in self.exports)),
            'limitations': ['Authored properties and source references only; omitted class defaults are not invented.',
                'Event functions are preserved as data, never executed.',
                'Audio export/dependency resolution and Babylon dispatch require separate adapters.',
                'Normalized times are source sequence values; runtime playback equivalence is not asserted.']}


def read_package_index(path):
    """Return source-qualified objects without interpreting asset payloads or executing scripts."""
    from pathlib import Path
    path = Path(path)
    package = Package(path.read_bytes(), path.name)
    return {'package': package.package_name, 'sourceSha256': package.source_hash, 'summary': package.summary,
        'exports': package.exports, 'imports': package.imports}


def read_animation_events(path):
    from pathlib import Path
    path = Path(path)
    return Package(path.read_bytes(), path.name).notification_sidecar()
