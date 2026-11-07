"""Exact selected Elbera source readers; see SOURCE.json and LICENSE.

Only file123/licensee28, exact pinned20_20 and empty Model properties are
admitted by native_bsp_floor.py. There is no native executable invocation,
material policy, exporter or package search here. Adapter is deliberately
stricter than the upstream parser's property-format fallback.
"""
from collections import Counter
import hashlib
import math
import struct
from native_catalog.ue2 import Reader as ExistingReader, FormatError

L2Error = FormatError
RF_HAS_STACK = 0x02000000
sha = lambda data: hashlib.sha256(data).hexdigest()

class Reader(ExistingReader):
    def __init__(self, data, pos=0, path='<bytes>'):
        super().__init__(data, pos)
        self.path = path
    @property
    def pos(self):
        return self.position
    @pos.setter
    def pos(self, value):
        if not 0 <= value <= self.end:
            raise FormatError('Reader position outside bounded data')
        self.position = value
    def bytes(self, size): return self.take(size)
    def i32(self): return self.number('i')
    def u32(self): return self.number('I')
    def u8(self): return self.number('B')
    def f32(self): return self.number('f')

def qualified_ref(package, reference):
    if not reference:
        raise FormatError('Null reference is not a qualified object')
    return package.source.object_name(reference)

def read_properties(package, reader):
    if package.name(reader.compact()) != 'None':
        raise FormatError('Scoped BSP reader requires empty native Model properties')
    return {}

class BspNode(object):
    # The last three i32 of an FBspNode used to be read and thrown away
    # under the comment "render-section indices". They are kept now because
    # they are the only link the file has between a BSP node and the retail
    # renderer's own data, and each one is named from a MEASUREMENT, not a
    # header (17_25, 20_16, 20_21, 22_22 unless stated):
    #   i_section     0 .. NumSections-1 of the region-A render section
    #                 table, on every node of every tile (22_22: 0..65 with
    #                 all 66 sections hit; 20_21: 0..42 of 43).
    #   i_vert_offset the node's first vertex inside that section's vertex
    #                 block: Points[Verts[iVertPool+k]] equals the render
    #                 vertex at (i_vert_offset + k) to the BIT on 13050
    #                 (22_22), 8686 (17_25), 21291 (20_21) and 5616 (20_16)
    #                 node vertices -- 0 mismatches, worst |delta| 0.0.
    #   i_light_map   -1, or an index into the region-B lightmap record
    #                 array. Its maximum is exactly N-1 for that array's own
    #                 count N on every tile measured (594/595, 271/272,
    #                 1887/1888, 409/410) -- see tools/world/bsplight.py.
    __slots__ = ("plane", "zone_mask", "flags", "i_vert_pool", "i_surf",
                 "i_back", "i_front", "i_plane", "num_vertices", "i_zone",
                 "i_section", "i_vert_offset", "i_light_map",
                 "i_collision_bound", "i_render_bound", "exclusive_sphere",
                 "reserved", "i_leaf")


class BspSurf(object):
    __slots__ = ("material", "flags", "p_base", "v_normal", "v_texture_u",
                 "v_texture_v", "i_brush_poly", "actor", "plane",
                 "light_map_scale", "i_lightmap_index")


class Model(object):
    """A parsed UModel. `is_level` marks the post-CSG world BSP."""

    __slots__ = ("export", "bounds", "vectors", "points", "nodes", "surfs",
                 "verts", "num_shared_sides", "zones", "polys",
                 "root_outside", "linked", "lightmap_tail", "bounding_sphere",
                 "model_bounds", "leaf_hulls", "leaves", "lights", "source_spans")

    @property
    def is_level(self):
        return bool(self.zones)


def _read_fplane(r):
    return struct.unpack("<4f", r.bytes(16))


def _read_model(pkg, export, extra_field):
    end = export.serial_offset + export.serial_size
    if not 0 <= export.serial_offset <= end <= len(pkg.data):
        raise L2Error("%s: UModel export lies outside package" % pkg.path)
    # A truncated record cannot borrow bytes from the next export. Absolute
    # offsets are retained for source receipts and the existing lightmap reader.
    r = Reader(memoryview(pkg.data)[:end], export.serial_offset, path=pkg.path)
    spans = {}
    start = r.pos
    read_properties(pkg, r)
    spans["properties"] = (start, r.pos)
    start = r.pos
    box = r.bytes(41)                      # FBox (25) + FSphere (16)
    spans["primitive"] = (start, r.pos)
    m = Model()
    m.export = export
    m.bounds = (struct.unpack("<3f", box[0:12]),
                struct.unpack("<3f", box[12:24]), box[24])
    m.bounding_sphere = struct.unpack("<4f", box[25:41])

    def farray(n, what):
        if not 0 <= n < 4000000:
            raise L2Error("%s: %s: implausible %s count %d"
                          % (pkg.path, pkg.export_name(export), what, n))
        return n

    start = r.pos
    n = farray(r.compact(), "Vectors")
    m.vectors = [struct.unpack("<3f", r.bytes(12)) for _ in range(n)]
    spans["vectors"] = (start, r.pos)
    start = r.pos
    n = farray(r.compact(), "Points")
    m.points = [struct.unpack("<3f", r.bytes(12)) for _ in range(n)]
    spans["points"] = (start, r.pos)

    start = r.pos
    n = farray(r.compact(), "Nodes")
    m.nodes = []
    for i in range(n):
        nd = BspNode()
        nd.plane = _read_fplane(r)
        if abs(nd.plane[0] ** 2 + nd.plane[1] ** 2
               + nd.plane[2] ** 2 - 1.0) > 2e-3:
            raise L2Error("%s: %s: node %d plane is not unit-length "
                          "(parse desync)"
                          % (pkg.path, pkg.export_name(export), i))
        nd.zone_mask = struct.unpack("<Q", r.bytes(8))[0]
        nd.flags = r.u8()
        nd.i_vert_pool = r.compact()
        nd.i_surf = r.compact()
        nd.i_back = r.compact()
        nd.i_front = r.compact()
        nd.i_plane = r.compact()
        nd.i_collision_bound = r.compact()
        nd.i_render_bound = r.compact()
        nd.exclusive_sphere = struct.unpack("<4f", r.bytes(16))
        nd.reserved = bytes(r.bytes(16))
        nd.i_zone = (r.u8(), r.u8())
        nd.num_vertices = r.u8()
        nd.i_leaf = struct.unpack("<2i", r.bytes(8))
        (nd.i_section, nd.i_vert_offset,
         nd.i_light_map) = struct.unpack("<3i", r.bytes(12))
        m.nodes.append(nd)
    spans["nodes"] = (start, r.pos)

    start = r.pos
    n = farray(r.compact(), "Surfs")
    m.surfs = []
    for i in range(n):
        s = BspSurf()
        s.material = r.compact()
        s.flags = r.u32()
        s.p_base = r.compact()
        s.v_normal = r.compact()
        s.v_texture_u = r.compact()
        s.v_texture_v = r.compact()
        s.i_brush_poly = r.compact()
        s.actor = r.compact()
        s.plane = _read_fplane(r)
        if abs(s.plane[0] ** 2 + s.plane[1] ** 2
               + s.plane[2] ** 2 - 1.0) > 2e-3:
            raise L2Error("%s: %s: surf %d plane is not unit-length "
                          "(parse desync)"
                          % (pkg.path, pkg.export_name(export), i))
        s.light_map_scale = r.f32()
        s.i_lightmap_index = r.i32() if extra_field else None
        m.surfs.append(s)
    spans["surfs"] = (start, r.pos)

    start = r.pos
    n = farray(r.compact(), "Verts")
    m.verts = [(r.compact(), r.compact()) for _ in range(n)]
    spans["verts"] = (start, r.pos)

    start = r.pos
    m.num_shared_sides = r.i32()
    nz = r.i32()
    if not 0 <= nz <= 64:                  # FZoneSet is a 64-bit mask
        raise L2Error("%s: %s: implausible NumZones %d"
                      % (pkg.path, pkg.export_name(export), nz))
    m.zones = []
    for _ in range(nz):
        actor = r.compact()
        conn, vis = struct.unpack("<QQ", r.bytes(16))
        m.zones.append((actor, conn, vis, r.f32()))

    m.polys = r.compact()
    spans["zones_and_polys"] = (start, r.pos)
    start = r.pos
    m.model_bounds = [struct.unpack("<6fB", r.bytes(25))
                      for _ in range(farray(r.compact(), "Bounds"))]
    spans["bounds"] = (start, r.pos)
    start = r.pos
    m.leaf_hulls = [r.i32() for _ in range(farray(r.compact(), "LeafHulls"))]
    spans["leaf_hulls"] = (start, r.pos)
    start = r.pos
    m.leaves = []
    for _ in range(farray(r.compact(), "Leaves")):
        m.leaves.append((r.compact(), r.compact(), r.compact(),
                         struct.unpack("<Q", r.bytes(8))[0]))
    spans["leaves"] = (start, r.pos)
    start = r.pos
    m.lights = [r.compact() for _ in range(farray(r.compact(), "Lights"))]
    spans["lights"] = (start, r.pos)
    start = r.pos
    m.root_outside = r.i32()
    m.linked = r.i32()
    spans["root_outside_and_linked"] = (start, r.pos)
    m.lightmap_tail = end - r.pos
    spans["undecoded_tail"] = (r.pos, end)
    m.source_spans = spans
    if m.lightmap_tail < 0:
        raise L2Error("%s: %s: UModel body overran by %d bytes"
                      % (pkg.path, pkg.export_name(export), -m.lightmap_tail))

    # structural cross-checks: every index the renderer follows must resolve
    for i, nd in enumerate(m.nodes):
        if not 0 <= nd.i_surf < len(m.surfs):
            raise L2Error("%s: %s: node %d iSurf %d out of range"
                          % (pkg.path, pkg.export_name(export), i, nd.i_surf))
        if nd.i_vert_pool + nd.num_vertices > len(m.verts):
            raise L2Error("%s: %s: node %d vert pool out of range"
                          % (pkg.path, pkg.export_name(export), i))
    for i, s in enumerate(m.surfs):
        if not 0 <= s.p_base < max(1, len(m.points)) or \
                not 0 <= s.v_texture_u < max(1, len(m.vectors)) or \
                not 0 <= s.v_texture_v < max(1, len(m.vectors)):
            raise L2Error("%s: %s: surf %d references a missing point/vector"
                          % (pkg.path, pkg.export_name(export), i))
    for i, nd in enumerate(m.nodes):
        for k in range(nd.num_vertices):
            pv = m.verts[nd.i_vert_pool + k][0]
            if not 0 <= pv < len(m.points):
                raise L2Error("%s: %s: node %d FVert pVertex %d out of range"
                              % (pkg.path, pkg.export_name(export), i, pv))
    return m


def level_model_binding(pkg):
    """Read the ordinary saved ULevel prefix through its actual Model reference.

    Owned Interlude ULevelBase::Serialize 105cf150 writes two fixed-count
    reference arrays (the first for LicenseeVer >= 23), then FURL. The derived
    ULevel::Serialize 105d086e passes field+c0 to the archive object-reference
    operator. This same field is the BSP receiver in MultiLineCheck105c5e48.
    The qualified supplemental import comparison is reproducible with
    --native-binding-check; no engine code is executed.

    This bounded reader admits the reviewed version123 ordinary saved-level
    layout, with an empty UObject property stream and canonical duplicate
    array counts. It does not decode the later ULevel tail, transaction archives,
    external Model imports, runtime reassignment or arbitrary Level subclasses.
    """
    if pkg.file_version != 123 or pkg.licensee_version < 23:
        raise ValueError('unsupported serialized Level layout (requires version123/licensee>=23)')
    levels = [e for e in pkg.exports if e.class_index and
              qualified_ref(pkg, e.class_index).lower() == 'engine.level']
    if len(levels) != 1:
        raise ValueError('expected exactly one qualified Engine.Level export')
    level = levels[0]
    if level.package_index != 0 or level.object_flags & RF_HAS_STACK:
        raise ValueError('unsupported Level outer or state-frame prefix')
    start, end = level.serial_offset, level.serial_offset + level.serial_size
    if start < 0 or level.serial_size <= 0 or end > len(pkg.data):
        raise ValueError('Level export outside package')
    raw = pkg.data[start:end]
    r = Reader(raw, path=str(pkg.path) + ':Level')
    spans = {}
    if pkg.name(r.compact()) != 'None':
        raise ValueError('unsupported nonempty Level property stream')
    spans['properties'] = [start, start+r.pos]
    arrays = []
    for field in ('0x48', '0x38'):
        begin = r.pos
        count, duplicate = r.i32(), r.i32()
        # Both words are initialized from ArrayNum in the writer. The loader
        # uses the first; noncanonical unequal pairs stay outside this reader.
        if count < 0 or count != duplicate or count > len(raw)-r.pos:
            raise ValueError('invalid or noncanonical Level actor-array counts')
        references = []
        for _ in range(count):
            value = r.compact()
            if value: pkg.resolve_ref(value)  # preserve legal null slots
            references.append(value)
        spans['array'+field] = [start+begin, start+r.pos]
        arrays.append({'nativeField': field, 'count': count, 'duplicateCount': duplicate,
                       'references': references})

    def string():
        size = r.compact()
        if size == 0: return
        width = 2 if size < 0 else 1
        value = r.bytes(abs(size)*width)
        if value[-width:] != bytes(width):
            raise ValueError('unterminated Level URL string')
        if width == 2: value[:-2].decode('utf-16-le', 'strict')

    begin = r.pos
    for _ in range(4): string()  # FURL +0,+c,+1c,+34
    options = r.compact()
    if options < 0 or options > len(raw)-r.pos:
        raise ValueError('invalid Level URL option count')
    for _ in range(options): string()
    r.i32(); r.i32()  # FURL +18 and +40, not world coordinates
    spans['url'] = [start+begin, start+r.pos]
    begin = r.pos
    reference = r.compact()
    if reference <= 0:
        raise ValueError('Level.Model must reference a local Model export')
    model = pkg.resolve_ref(reference)
    if (qualified_ref(pkg, model.class_index).lower() != 'engine.model' or
            model.serial_size <= 0):
        raise ValueError('Level.Model does not reference a serialized Engine.Model')
    spans['modelReference'] = [start+begin, start+r.pos]
    evidence = {'selection': 'serialized ULevel.Model', 'nativeField': '0xc0',
                'level': {'reference': level.index+1, 'qualified': qualified_ref(pkg, level.index+1)},
                'levelSerialOffset': start, 'levelSerialSize': level.serial_size,
                'levelSHA256': sha(raw), 'decodedPrefixSHA256': sha(raw[:r.pos]),
                'decodedPrefixBytes': r.pos, 'remainingTailBytes': len(raw)-r.pos,
                'remainingTailSHA256': sha(raw[r.pos:]), 'spans': spans,
                'actorArrays': arrays, 'urlOptionCount': options,
                'model': {'reference': reference, 'qualified': qualified_ref(pkg, reference)}}
    return model, evidence


def finite(values, size, label):
    if len(values) != size or not all(math.isfinite(v) for v in values):
        raise ValueError('nonfinite or malformed ' + label)


def index(value, size, label, nullable=False):
    if type(value) is not int or not (0 <= value < size or nullable and value == -1):
        raise ValueError('out-of-range ' + label)


def validate_graph(nodes):
    """Validate all three serialized links, rejecting cycles even off root0."""
    links = [(n.i_front, n.i_back, n.i_plane) for n in nodes]
    for row in links:
        for child in row: index(child, len(nodes), 'BSP child', nullable=True)
    colors = bytearray(len(nodes))
    reached = set()
    for root in range(len(nodes)):
        if colors[root]: continue
        stack = [(root, False)]
        while stack:
            current, leaving = stack.pop()
            if leaving:
                colors[current] = 2
                continue
            if colors[current] == 1: raise ValueError('cyclic BSP node graph')
            if colors[current] == 2: continue
            colors[current] = 1
            if root == 0: reached.add(current)
            stack.append((current, True))
            stack.extend((child, False) for child in reversed(links[current]) if child != -1)
    return len(reached)


def validate_model(model):
    reached = validate_graph(model.nodes)
    finite(model.bounds[0], 3, 'model minimum'); finite(model.bounds[1], 3, 'model maximum')
    if model.bounds[2] not in (0, 1): raise ValueError('invalid model bounds flag')
    if model.bounds[2] and any(a > b for a, b in zip(model.bounds[0], model.bounds[1])):
        raise ValueError('inverted model bounds')
    finite(model.bounding_sphere, 4, 'model sphere')
    if model.root_outside not in (0, 1): raise ValueError('unsupported RootOutside value')
    for v in model.points: finite(v, 3, 'point')
    for v in model.vectors: finite(v, 3, 'vector')
    used = set()
    for node in model.nodes:
        finite(node.plane, 4, 'node plane'); finite(node.exclusive_sphere, 4, 'node sphere')
        if abs(sum(v*v for v in node.plane[:3]) - 1) > .002:
            raise ValueError('non-unit node plane')
        if len(node.reserved) != 16: raise ValueError('invalid reserved node span')
        index(node.i_surf, len(model.surfs), 'node surface')
        if node.i_vert_pool < 0 or node.i_vert_pool + node.num_vertices > len(model.verts):
            raise ValueError('out-of-range node vertex span')
        for slot in range(node.i_vert_pool, node.i_vert_pool + node.num_vertices):
            index(model.verts[slot][0], len(model.points), 'active vertex point'); used.add(slot)
        for leaf in node.i_leaf: index(leaf, len(model.leaves), 'node leaf', nullable=True)
        for zone in node.i_zone: index(zone, len(model.zones), 'node zone')
    for surface in model.surfs:
        finite(surface.plane, 4, 'surface plane')
        if not math.isfinite(surface.light_map_scale): raise ValueError('nonfinite lightmap scale')
        index(surface.p_base, len(model.points), 'surface base point')
        for v in (surface.v_normal, surface.v_texture_u, surface.v_texture_v):
            index(v, len(model.vectors), 'surface vector')
    for bound in model.model_bounds:
        finite(bound[:6], 6, 'saved bounds')
        if bound[6] not in (0, 1): raise ValueError('invalid saved bounds flag')
        if bound[6] and any(a > b for a, b in zip(bound[:3], bound[3:6])):
            raise ValueError('inverted saved bounds')
    for leaf in model.leaves: index(leaf[0], len(model.zones), 'leaf zone')
    spans = model.source_spans
    cursor = model.export.serial_offset
    for name, (start, end) in spans.items():
        if start != cursor or end < start: raise ValueError('noncontiguous model source spans: ' + name)
        cursor = end
    if cursor != model.export.serial_offset + model.export.serial_size:
        raise ValueError('model source span does not end at export boundary')
    if spans['undecoded_tail'][1] - spans['undecoded_tail'][0] != model.lightmap_tail:
        raise ValueError('model tail span mismatch')
    return {'root0ReachableNodes': reached, 'unreachableNodes': len(model.nodes)-reached,
            'activeVertexSlots': len(used), 'unusedVertexSlots': len(model.verts)-len(used),
            # The original retains unused vertices that no longer index Points.
            # They are preserved, never followed or silently discarded.
            'unusedOutOfRangePointSlots': sum(i not in used and not 0 <= v[0] < len(model.points)
                                               for i, v in enumerate(model.verts)),
            'nodeFlagHistogram': dict(sorted(Counter(n.flags for n in model.nodes).items()))}

