from world.typed_payload import TypedPayloadArray

DECISION_CODE = {'declared-none': 0, 'slots': 1, 'blocking': 1, 'gap': 2}
VOLUME_KIND_CODE = {'Engine.BlockingVolume': 0, 'Engine.PhysicsVolume': 1}
PROVENANCE_CODE = {'authored': 0, 'class-default': 1, 'ue-zero': 2}
STATIC_SLOT_ENABLE_COLLISION_SOURCE = 'static-slot-enable-collision'
COLLISION_SOURCE_CODE = {STATIC_SLOT_ENABLE_COLLISION_SOURCE: 0}
TRANSFORM_FIELDS = ('Location', 'Rotation', 'DrawScale', 'DrawScale3D', 'PrePivot')
VECTOR_AXES = ('X', 'Y', 'Z')
ROTATOR_AXES = ('Pitch', 'Yaw', 'Roll')
NO_MESH = -1


def array(name, kind, values):
    return TypedPayloadArray(name, kind, tuple(values))


def bspt_arrays(model, surface_flags_of_node):
    nodes = model.nodes
    return [array('BSPT.planes', 'float32', [value for node in nodes for value in node.plane]),
            array('BSPT.front', 'int32', [node.i_front for node in nodes]), array('BSPT.back', 'int32', [node.i_back for node in nodes]),
            array('BSPT.coplanar', 'int32', [node.i_plane for node in nodes]), array('BSPT.nodeFlags', 'uint8', [node.flags for node in nodes]),
            array('BSPT.numVertices', 'uint8', [node.num_vertices for node in nodes]),
            array('BSPT.collisionBound', 'int32', [node.i_collision_bound for node in nodes]),
            array('BSPT.vertexPool', 'int32', [node.i_vert_pool for node in nodes]),
            array('BSPT.vertexPoints', 'int32', [vertex[0] for vertex in model.verts]),
            array('BSPT.points', 'float32', [value for point in model.points for value in point]),
            array('BSPT.leafHulls', 'int32', model.leaf_hulls), array('BSPT.rootOutside', 'uint8', [model.root_outside]),
            array('BSPT.surfaceFlags', 'uint32', [surface_flags_of_node(node) for node in nodes])]


def transform_values(volume, field):
    value = volume['transform'][field]['value'] if volume['transform'] else None
    if field == 'Rotation':
        return [value[axis] for axis in ROTATOR_AXES] if value else [0, 0, 0]
    if field == 'DrawScale':
        return [value if value is not None else 0.0]
    return [value[axis] for axis in VECTOR_AXES] if value else [0.0, 0.0, 0.0]


def vols_arrays(volumes):
    nodes = [node for volume in volumes for node in volume['nodes']]
    node_starts, vertex_starts, first_node, first_vertex = [], [], 0, 0
    for volume in volumes:
        node_starts.append(first_node)
        first_node += len(volume['nodes'])
    for node in nodes:
        vertex_starts.append(first_vertex)
        first_vertex += len(node['polygon'])
    provenance = [PROVENANCE_CODE[volume['transform'][field]['provenance']] if volume['transform'] else PROVENANCE_CODE['ue-zero']
                  for volume in volumes for field in TRANSFORM_FIELDS]
    return [array('VOLS.exportIndex', 'uint32', [volume['exportIndex'] for volume in volumes]),
            array('VOLS.kind', 'uint8', [VOLUME_KIND_CODE[volume['classObject']] for volume in volumes]),
            array('VOLS.decision', 'uint8', [DECISION_CODE[volume['decision']] for volume in volumes]),
            *(array(f'VOLS.{field[0].lower()}{field[1:]}', 'int32' if field == 'Rotation' else 'float32',
                    [value for volume in volumes for value in transform_values(volume, field)]) for field in TRANSFORM_FIELDS),
            array('VOLS.transformProvenance', 'uint8', provenance),
            array('VOLS.rootOutside', 'uint8', [volume['rootOutside'] or 0 for volume in volumes]),
            array('VOLS.nodeStart', 'uint32', node_starts), array('VOLS.nodeCount', 'uint32', [len(volume['nodes']) for volume in volumes]),
            array('VOLS.planes', 'float32', [value for node in nodes for value in node['plane']]),
            array('VOLS.front', 'int32', [node['front'] for node in nodes]), array('VOLS.back', 'int32', [node['back'] for node in nodes]),
            array('VOLS.nodeFlags', 'uint8', [node['flags'] for node in nodes]),
            array('VOLS.vertexStart', 'uint32', vertex_starts), array('VOLS.vertexCount', 'uint32', [len(node['polygon']) for node in nodes]),
            array('VOLS.vertices', 'float32', [value for node in nodes for point in node['polygon'] for value in point])]


def smsh_arrays(meshes):
    vertex_starts, index_starts, first_vertex, first_index = [], [], 0, 0
    for mesh in meshes:
        vertex_starts.append(first_vertex)
        index_starts.append(first_index)
        first_vertex += len(mesh['positions'])
        first_index += len(mesh['indices'])
    return [array('SMSH.vertexStart', 'uint32', vertex_starts), array('SMSH.vertexCount', 'uint32', [len(mesh['positions']) for mesh in meshes]),
            array('SMSH.indexStart', 'uint32', index_starts), array('SMSH.indexCount', 'uint32', [len(mesh['indices']) for mesh in meshes]),
            array('SMSH.positions', 'float32', [value for mesh in meshes for position in mesh['positions'] for value in position]),
            array('SMSH.indices', 'uint32', [index for mesh in meshes for index in mesh['indices']])]


def plac_arrays(placements):
    return [array('PLAC.exportIndex', 'uint32', [placement['exportIndex'] for placement in placements]),
            array('PLAC.decision', 'uint8', [DECISION_CODE[placement['decision']] for placement in placements]),
            array('PLAC.mesh', 'int32', [placement['mesh'] for placement in placements]),
            array('PLAC.matrix', 'float32', [value for placement in placements for row in placement['matrix'] for value in row])]


def movr_arrays(mover_slots):
    return [array('MOVR.exportIndex', 'uint32', [record['exportIndex'] for record in mover_slots]),
            array('MOVR.slot', 'uint32', [record['slot'] for record in mover_slots]),
            array('MOVR.collisionSource', 'uint8', [COLLISION_SOURCE_CODE[record['collisionSource']] for record in mover_slots]),
            array('MOVR.mesh', 'int32', [record['mesh'] for record in mover_slots]),
            *(array(f'MOVR.{name}', 'float32', [value for record in mover_slots for row in record[name] for value in row])
              for name in ('closedMatrix', 'openMatrix'))]


def terr_arrays(terrain):
    if terrain is None:
        return [array(f'TERR.{name}', kind, []) for name, kind in (('location', 'float32'), ('terrainScale', 'float32'), ('heightmapSize', 'uint32'),
                                                                   ('vertexRectangle', 'uint32'), ('heights', 'uint32'), ('quadVisibility', 'uint8'),
                                                                   ('edgeTurn', 'uint8'))]
    return [array('TERR.location', 'float32', terrain['location']), array('TERR.terrainScale', 'float32', terrain['terrainScale']),
            array('TERR.heightmapSize', 'uint32', terrain['heightmapSize']), array('TERR.vertexRectangle', 'uint32', terrain['vertexRectangle']),
            array('TERR.heights', 'uint32', terrain['heights']), array('TERR.quadVisibility', 'uint8', [int(bit) for bit in terrain['quadVisibility']]),
            array('TERR.edgeTurn', 'uint8', [int(bit) for bit in terrain['edgeTurn']])]
