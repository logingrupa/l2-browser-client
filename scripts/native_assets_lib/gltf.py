"""Pack UModel glTF without rewriting geometry, skins, or animation accessor bytes."""
import copy
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import struct
from native_assets_lib.empty_primitives import repair_empty_primitives


def safe_name(name):
    if not isinstance(name, str) or not name or '\\' in name or ':' in name or '\x00' in name:
        raise ValueError(f'Unsafe asset path: {name!r}')
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in ('', '.', '..') for part in name.split('/')):
        raise ValueError(f'Unsafe asset path: {name!r}')
    return name


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


class Document:
    def __init__(self, path):
        self.path = Path(path)
        self.data = json.loads(self.path.read_text(encoding='utf-8'))
        self.binary = bytearray()
        self.repairs = []
        self.original_buffers = []
        offsets = []
        for buffer in self.data.get('buffers', []):
            name = safe_name(buffer['uri'])
            source = (self.path.parent / name).resolve()
            if not source.is_relative_to(self.path.parent.resolve()):
                raise ValueError('glTF buffer escapes export directory')
            payload = source.read_bytes()
            if len(payload) != buffer['byteLength']:
                raise ValueError('glTF declared buffer length does not match file')
            offsets.append(self.append(payload))
            self.original_buffers.append({'file': name, 'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)})
        for view in self.data.get('bufferViews', []):
            source_buffer = view['buffer']
            offset = view.get('byteOffset', 0)
            if offset < 0 or view['byteLength'] < 0 or offset + view['byteLength'] > self.data['buffers'][source_buffer]['byteLength']:
                raise ValueError('glTF buffer view exceeds source buffer')
            view['byteOffset'] = offset + offsets[source_buffer]
            view['buffer'] = 0
        self.data['buffers'] = [{'byteLength': len(self.binary)}]
        self._accessor_cache = {}
        empty_repair = repair_empty_primitives(self.data)
        if empty_repair:
            self.repairs.append(empty_repair)
        self.repair_bounds()
        self.repair_vertex_metadata()

    def append(self, payload):
        self.binary.extend(b'\0' * (-len(self.binary) % 4))
        offset = len(self.binary)
        self.binary.extend(payload)
        return offset

    def accessor(self, values, dimensions, bounds=False):
        values = list(values)
        if not values or not all(math.isfinite(v) for row in values for v in row):
            raise ValueError('Empty or non-finite accessor')
        payload = b''.join(struct.pack('<' + 'f' * dimensions, *row) for row in values)
        key = (dimensions, bounds, payload)
        if key in self._accessor_cache:
            return self._accessor_cache[key]
        offset = self.append(payload)
        views = self.data.setdefault('bufferViews', [])
        view = len(views)
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(payload)})
        accessors = self.data.setdefault('accessors', [])
        result = {'bufferView': view, 'componentType': 5126, 'count': len(values), 'type': {1: 'SCALAR', 3: 'VEC3', 4: 'VEC4'}[dimensions]}
        if bounds:
            rounded = list(struct.iter_unpack('<' + 'f' * dimensions, payload))
            result.update(min=[min(row[n] for row in rounded) for n in range(dimensions)], max=[max(row[n] for row in rounded) for n in range(dimensions)])
        index = len(accessors)
        accessors.append(result)
        self._accessor_cache[key] = index
        return index

    def image(self, payload, mime, name):
        offset = self.append(payload)
        views = self.data.setdefault('bufferViews', [])
        index = len(views)
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(payload)})
        images = self.data.setdefault('images', [])
        images.append({'name': name, 'bufferView': index, 'mimeType': mime})
        textures = self.data.setdefault('textures', [])
        textures.append({'source': len(images) - 1})
        return len(textures) - 1

    def repair_bounds(self):
        # UModel writes bounds with %g, losing precision. Recompute metadata only;
        # original buffer bytes stay identical, including inverse bind matrices.
        formats = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
        dimensions = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
        for accessor in self.data.get('accessors', []):
            view = self.data['bufferViews'][accessor['bufferView']]
            fmt, size = formats[accessor['componentType']]
            count = dimensions[accessor['type']]
            stride = view.get('byteStride', size * count)
            offset = accessor.get('byteOffset', 0)
            if accessor['count'] <= 0 or stride < size * count or offset < 0 or offset + (accessor['count'] - 1) * stride + size * count > view['byteLength']:
                raise ValueError('Accessor exceeds its buffer view')
            if 'min' not in accessor and 'max' not in accessor:
                continue
            rows = [struct.unpack_from('<' + fmt * count, self.binary, view['byteOffset'] + offset + n * stride) for n in range(accessor['count'])]
            if not all(math.isfinite(value) for row in rows for value in row):
                raise ValueError('Non-finite source accessor')
            accessor.update(min=[min(row[n] for row in rows) for n in range(count)], max=[max(row[n] for row in rows) for n in range(count)])

    def repair_vertex_metadata(self):
        for mesh in self.data.get('meshes', []):
            for primitive in mesh.get('primitives', []):
                attributes = primitive.get('attributes', {})
                for accessor_index in attributes.values():
                    view = self.data['bufferViews'][self.data['accessors'][accessor_index]['bufferView']]
                    view['target'] = 34962
                if 'indices' in primitive:
                    self.data['bufferViews'][self.data['accessors'][primitive['indices']]['bufferView']]['target'] = 34963
                if 'TANGENT' not in attributes:
                    continue
                accessor = self.data['accessors'][attributes['TANGENT']]
                view = self.data['bufferViews'][accessor['bufferView']]
                if accessor['componentType'] != 5126 or accessor['type'] != 'VEC4':
                    raise ValueError('Unsupported source tangent accessor')
                offset = view['byteOffset'] + accessor.get('byteOffset', 0)
                stride = view.get('byteStride', 16)
                vectors = [struct.unpack_from('<4f', self.binary, offset + index * stride) for index in range(accessor['count'])]
                if all(x == y == z == 0 for x, y, z, _ in vectors):
                    # Build1590 emits zero vectors as tangents. glTF disallows
                    # them. Preserve their accessor and bytes as evidence but
                    # omit the unusable optional attribute from primitives.
                    removed = attributes.pop('TANGENT')
                    self.repairs.append({'kind': 'omit-zero-tangent-attribute', 'accessor': removed, 'bytesPreserved': True})

    def glb(self):
        self.data['buffers'] = [{'byteLength': len(self.binary)}]
        encoded = json_bytes(self.data)
        encoded += b' ' * (-len(encoded) % 4)
        binary = bytes(self.binary) + b'\0' * (-len(self.binary) % 4)
        length = 12 + 8 + len(encoded) + 8 + len(binary)
        return struct.pack('<III', 0x46546c67, 2, length) + struct.pack('<I4s', len(encoded), b'JSON') + encoded + struct.pack('<I4s', len(binary), b'BIN\0') + binary

    def merge(self, other):
        """Join native parts, retaining each skin and all original buffer bytes."""
        source = copy.deepcopy(other.data)
        collections = ('bufferViews', 'accessors', 'images', 'samplers', 'textures', 'materials', 'meshes', 'skins', 'nodes')
        base = {name: len(self.data.setdefault(name, [])) for name in collections}
        binary_offset = self.append(bytes(other.binary))
        for view in source.get('bufferViews', []):
            view['byteOffset'] = view.get('byteOffset', 0) + binary_offset
            view['buffer'] = 0
        for accessor in source.get('accessors', []):
            accessor['bufferView'] += base['bufferViews']
        for image in source.get('images', []):
            image['bufferView'] += base['bufferViews']
        for texture in source.get('textures', []):
            texture['source'] += base['images']
            if 'sampler' in texture:
                texture['sampler'] += base['samplers']
        for material in source.get('materials', []):
            pbr = material.get('pbrMetallicRoughness', {})
            for texture in [pbr.get('baseColorTexture'), pbr.get('metallicRoughnessTexture'), material.get('normalTexture'), material.get('occlusionTexture'), material.get('emissiveTexture')]:
                if texture:
                    texture['index'] += base['textures']
        for mesh in source.get('meshes', []):
            for primitive in mesh['primitives']:
                primitive['attributes'] = {name: index + base['accessors'] for name, index in primitive['attributes'].items()}
                if 'indices' in primitive:
                    primitive['indices'] += base['accessors']
                if 'material' in primitive:
                    primitive['material'] += base['materials']
        for skin in source.get('skins', []):
            skin['joints'] = [index + base['nodes'] for index in skin['joints']]
            if 'inverseBindMatrices' in skin:
                skin['inverseBindMatrices'] += base['accessors']
            if 'skeleton' in skin:
                skin['skeleton'] += base['nodes']
        for node in source.get('nodes', []):
            if 'children' in node:
                node['children'] = [index + base['nodes'] for index in node['children']]
            if 'mesh' in node:
                node['mesh'] += base['meshes']
            if 'skin' in node:
                node['skin'] += base['skins']
        for name in collections:
            self.data[name].extend(source.get(name, []))
            if not self.data[name]:
                del self.data[name]
        self.data['scenes'][self.data.get('scene', 0)]['nodes'].extend(index + base['nodes'] for index in source['scenes'][source.get('scene', 0)]['nodes'])
        clips = {clip['name']: clip for clip in self.data.get('animations', [])}
        for clip in source.get('animations', []):
            for sampler in clip['samplers']:
                sampler['input'] += base['accessors']
                sampler['output'] += base['accessors']
            for channel in clip['channels']:
                channel['target']['node'] += base['nodes']
            if clip['name'] in clips:
                target = clips[clip['name']]
                if target.get('extras') != clip.get('extras'):
                    raise ValueError('Part animation source durations do not match')
                offset = len(target['samplers'])
                for channel in clip['channels']:
                    channel['sampler'] += offset
                target['channels'].extend(clip['channels'])
                target['samplers'].extend(clip['samplers'])
            else:
                self.data.setdefault('animations', []).append(clip)
                clips[clip['name']] = clip
        self.original_buffers.extend(other.original_buffers)
        self.repairs.extend(other.repairs)
        self._accessor_cache.clear()
