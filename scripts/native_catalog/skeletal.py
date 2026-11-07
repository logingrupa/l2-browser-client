"""Bounded native Lineage UE2 123/28 and 123/30 skeletal serialization.

Layout source: pinned UEViewer UnMesh2.{h,cpp}, UPrimitive, ULodMesh,
USkeletalMesh and FStaticLODModel. No native offsets or asset names are used.
"""
import base64
import hashlib
import math
import struct

from .ue2 import FormatError

LAYOUT_EVIDENCE = {
    'revision': 'a0bfb468d42be831b126632fd8a0ae6b3614f981',
    'files': {
        'Unreal/UnrealMesh/UnMesh2.h': '8557058200be31a6bd133e0a9bbd912b06360475dd10f7fcf085f311eb38dfcb',
        'Unreal/UnrealMesh/UnMesh2.cpp': 'c1c2778392b39aad168fe7a31893ea9f64b90e34945868d00b7bd948b373df46',
        'Unreal/UnrealMesh/UnMesh.h': 'c990ef8e15b3551090de7dd93c52aa727bf17d7c61ea0fa531849ecdfe3d95be',
        'Unreal/UnCore.h': 'da065ecf22c9f7c9d894111217fb42169691c610b6ce00a2fe62f6af0100d34f',
    },
}


def require(condition, message):
    if not condition:
        raise FormatError(message)


class SkeletalReader:
    def __init__(self, package, item):
        version = (package.summary['version'], package.summary['licenseeVersion'])
        require(version in ((123, 28), (123, 30)), 'Skeletal source reader supports reviewed UE2 123/28 and 123/30 only')
        require(item['className'] == 'SkeletalMesh', 'Native weight source must be a SkeletalMesh')
        self.package, self.item = package, item
        self.properties, self.reader = package.properties(item)
        self.records = []

    def record(self, name, start, data_start, end, count=None, fmt=None):
        data = self.package.data[data_start:end]
        result = {'name': name, 'offset': start, 'dataOffset': data_start, 'end': end,
                  'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        if count is not None:
            result.update(count=count, format=fmt)
        self.records.append(result)
        return result

    def array(self, name, fmt, lazy=False, retain=False, maximum=1_000_000):
        reader = self.reader
        start = reader.position
        limit = reader.number('i') if lazy else None
        count = reader.count(maximum)
        data_start = reader.position
        raw = reader.take(count * struct.calcsize('<' + fmt))
        if lazy:
            require(reader.position == limit, 'Native lazy-array boundary differs: ' + name)
        record = self.record(name, start, data_start, reader.position, count, '<' + fmt)
        values = list(struct.iter_unpack('<' + fmt, raw)) if retain else None
        if values is not None and 'f' in fmt:
            require(all(math.isfinite(value) for row in values for value in row), 'Non-finite native array: ' + name)
        return {'record': record, 'values': values}

    def references(self, name, names=False):
        reader = self.reader
        start = reader.position
        result = []
        for _ in range(reader.count(4096)):
            index = reader.compact()
            result.append(self.package.name(index) if names else self.package.object_name(index))
        self.record(name, start, start, reader.position)
        return result

    def attachments(self, bones):
        """Retain native socket data without assigning runtime attachment rules."""
        first_record = len(self.records)
        aliases = self.references('AttachAliases', names=True)
        names = self.references('AttachBoneNames', names=True)
        coords = self.array('AttachCoords', '12f', retain=True, maximum=4096)
        require(len(aliases) == len(names) == coords['record']['count'], 'Native attachment array counts differ')
        entries = []
        for index, (alias, name, values) in enumerate(zip(aliases, names, coords['values'])):
            matches = [i for i, bone in enumerate(bones) if bone['name'].casefold() == name.casefold()]
            entries.append({'index': index, 'alias': alias, 'bone': name, 'boneIndices': matches,
                            'boneResolution': 'unique' if len(matches) == 1 else 'missing' if not matches else 'ambiguous',
                            'nativeCoords': {'origin': list(values[:3]),
                                             'axes': [list(values[start:start+3]) for start in (3, 6, 9)]}})
        arrays = {}
        for record in self.records[first_record:]:
            raw = bytes(self.package.data[record['offset']:record['end']])
            arrays[record['name']] = {'offset': record['offset'], 'bytes': len(raw),
                                     'payloadOffsetWithinRecord': record['dataOffset']-record['offset'],
                                     'sha256': hashlib.sha256(raw).hexdigest(), 'hex': raw.hex()}
        return {'schemaVersion': 1, 'sourceObject': self.item['object'],
                'sourceSha256': self.package.source_hash, 'offsetSpace': 'unwrapped-native-package',
                'entries': entries, 'arrays': arrays,
                'coordinateLayout': 'FCoords: Origin, XAxis, YAxis, ZAxis; native float32 components',
                'runtimeInterpretation': 'unverified; source socket data does not establish hand-mesh, effect or actor attachment formulas'}

    def sections(self, label):
        reader = self.reader
        sections = []
        for index in range(reader.count(4096)):
            start = reader.position
            values = struct.unpack('<9H', reader.take(18))
            bones = [row[0] for row in self.array(label + '.boneMap', 'i', retain=True, maximum=4096)['values']]
            sections.append({'material': values[0], 'minStreamIndex': values[1], 'minWedgeIndex': values[2],
                             'maxWedgeIndex': values[3], 'numStreamIndices': values[4], 'bone': values[5],
                             'unused': values[6], 'firstFace': values[7], 'numFaces': values[8], 'boneMap': bones,
                             'offset': start, 'end': reader.position})
        return sections

    def lod(self, index):
        reader = self.reader
        prefix = f'lods[{index}]'
        start = reader.position
        self.array(prefix + '.SkinningData', 'I')
        self.array(prefix + '.SkinPoints', '3fI')
        soft_wedges = reader.number('i')
        soft, rigid = self.sections(prefix + '.SoftSections'), self.sections(prefix + '.RigidSections')
        soft_indices = self.array(prefix + '.SoftIndices', 'H', retain=True)
        soft_revision = reader.number('i')
        rigid_indices = self.array(prefix + '.RigidIndices', 'H', retain=True)
        rigid_revision = reader.number('i')
        vertex_stream_header = struct.unpack('<3i', reader.take(12))
        rigid_vertices = self.array(prefix + '.VertexStream', '8f', retain=True)
        influences = self.array(prefix + '.VertInfluences', 'fHH', lazy=True, retain=True)
        wedges = self.array(prefix + '.Wedges', 'Hff', lazy=True, retain=True)
        faces = self.array(prefix + '.Faces', '4H', lazy=True, retain=True)
        points = self.array(prefix + '.Points', '3f', lazy=True, retain=True)
        lod_parameters = struct.unpack('<2f4i', reader.take(24))
        use_new = reader.number('i')
        lineage = self.array(prefix + '.LineageWedges', '8f4B4f', retain=True)
        return {'offset': start, 'end': reader.position, 'influences': influences, 'wedges': wedges,
                'faces': faces, 'points': points, 'lineageWedges': lineage,
                'softSections': soft, 'rigidSections': rigid,
                'softIndices': soft_indices, 'rigidIndices': rigid_indices,
                'rigidVertices': rigid_vertices, 'vertexStreamHeader': vertex_stream_header,
                'softRevision': soft_revision, 'rigidRevision': rigid_revision,
                'numSoftWedges': soft_wedges, 'parameters': lod_parameters, 'useNewWedges': use_new}

    def decode(self):
        reader = self.reader
        # UPrimitive: FBox(min,max,valid), FSphere(center,radius).
        bounds = struct.unpack('<6fB4f', reader.take(41))
        require(all(math.isfinite(value) for value in bounds), 'Non-finite native mesh bounds')
        version, vertex_count = reader.number('i'), reader.number('i')
        require(2 <= version <= 6, 'Unreviewed native ULodMesh version: ' + str(version))
        self.array('ULodMesh.Verts', 'I')
        textures = self.references('ULodMesh.Textures')
        scale = struct.unpack('<3f', reader.take(12))
        origin = struct.unpack('<3f', reader.take(12))
        rotation = struct.unpack('<3i', reader.take(12))
        self.array('ULodMesh.FaceLevel', 'H')
        self.array('ULodMesh.Faces', '4H')
        self.array('ULodMesh.CollapseWedgeThus', 'H')
        self.array('ULodMesh.Wedges', 'Hff')
        materials = self.array('ULodMesh.Materials', 'Ii', retain=True)
        lod_settings = struct.unpack('<3fiff', reader.take(24))
        if version >= 3:
            reader.number('i')  # HasImpostor
            self.package.object_name(reader.compact())  # SpriteMaterial
            reader.take(52)  # location/rotation/scale/color/space/draw/light
        if version >= 4:
            reader.number('f')  # SkinTesselationFactor
        if version >= 5:
            reader.number('i')  # Lineage-specific field
        if version >= 6:
            reader.number('B')
        self.array('Points2', '3f')
        bone_start = reader.position
        bones = []
        for _ in range(reader.count(4096)):
            name = self.package.name(reader.compact())
            flags = reader.number('I')
            pose = struct.unpack('<11f', reader.take(44))
            children, parent = reader.number('i'), reader.number('i')
            require(all(math.isfinite(value) for value in pose), 'Non-finite native bind pose')
            bones.append({'name': name, 'flags': flags, 'orientation': pose[:4], 'position': pose[4:7],
                          'length': pose[7], 'size': pose[8:], 'children': children, 'parent': parent})
        bone_record = self.record('RefSkeleton', bone_start, bone_start, reader.position)
        require(bones and all(0 <= bone['parent'] < len(bones) and 0 <= bone['children'] < len(bones) for bone in bones), 'Native bone hierarchy exceeds bounds')
        animation = self.package.object_name(reader.compact())
        depth = reader.number('i')
        for index in range(reader.count(4096)):
            self.array(f'WeightIndices[{index}]', 'H')
            reader.number('i')
        self.array('BoneInfluences', '2H')
        attachments = self.attachments(bones)
        lods = [self.lod(index) for index in range(reader.count(16))]
        self.package.object_name(reader.compact())  # f224
        base_points = self.array('Points', '3f', lazy=True, retain=True)
        base_wedges = self.array('Wedges', 'Hff', lazy=True, retain=True)
        base_faces = self.array('Triangles', '3H2BI', lazy=True, retain=True)
        base_influences = self.array('VertInfluences', 'fHH', lazy=True, retain=True)
        self.array('CollapseWedge', 'H', lazy=True)
        self.array('f1C8', 'H', lazy=True)
        reader.number('i')  # Lineage >=118/licensee>=3
        self.array('LineageUnknownFloats', 'f')  # >=123/licensee>=18
        reader.number('i')  # Lineage >=120 AuthKey
        require(reader.position == reader.end, 'Native skeletal export has trailing or unconsumed bytes')
        return {'object': self.item['object'], 'packageSha256': self.package.source_hash,
                'packageVersion': self.package.summary['version'], 'licenseeVersion': self.package.summary['licenseeVersion'],
                'meshVersion': version, 'vertexCount': vertex_count, 'bounds': bounds,
                'meshScale': scale, 'meshOrigin': origin, 'rotOrigin': rotation, 'lodSettings': lod_settings,
                'materials': materials, 'textures': textures, 'bones': bones, 'boneRecord': bone_record,
                'animation': animation, 'skeletalDepth': depth, 'attachments': attachments, 'lods': lods,
                'base': {'points': base_points, 'wedges': base_wedges, 'faces': base_faces, 'influences': base_influences},
                'records': self.records, 'bytesConsumed': self.item['size'], 'layoutEvidence': LAYOUT_EVIDENCE}


def decode_skeletal_source(package, item):
    return SkeletalReader(package, item).decode()


def raw_record(package, record):
    """Exact source data bytes, in addition to lossless JSON float values."""
    data = package.data[record['dataOffset']:record['end']]
    require(hashlib.sha256(data).hexdigest() == record['sha256'], 'Source array changed while retaining weight evidence')
    return {**record, 'base64': base64.b64encode(data).decode('ascii')}
