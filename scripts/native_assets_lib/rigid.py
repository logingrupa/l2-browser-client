import hashlib
import struct

RIGID_ATTACHMENT_FIELD = 'rigidAttachment'
ROOT_HEAD_BONE_INDEX_FIELD, ROOT_PART_FIELD = 'rootHeadBoneIndex', 'rootPart'
MATRIX_BYTES = 64
RIGID_HEAD_ATTACHMENT_METHOD = 'root mesh head bone index with the root inverse bind at that index (RM-14)'
RIGID_HEAD_ATTACHMENT_LIMITATIONS = ['The native rigid loops skip SetTransform and keep the previous transform when the head bone is unresolved; '
                                     'that stale transform cannot be reproduced, so an unresolved head bone is a gap instead.',
                                     'GPU skinning bit identity and the RI vtable +0x118 cache predicate are open in RM-14.']


def rows(document, accessor_index):
    accessor = document.data['accessors'][accessor_index]
    view = document.data['bufferViews'][accessor['bufferView']]
    formats = {5121: 'B', 5123: 'H', 5126: 'f'}
    dimensions = {'VEC4': 4, 'MAT4': 16}
    fmt = '<' + formats[accessor['componentType']] * dimensions[accessor['type']]
    size = struct.calcsize(fmt)
    stride = view.get('byteStride', size)
    offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    return [struct.unpack_from(fmt, document.binary, offset + index * stride) for index in range(accessor['count'])]


def is_root_rigid(document):
    if len(document.data.get('skins', [])) != 1:
        return False
    found = False
    for mesh in document.data.get('meshes', []):
        for primitive in mesh.get('primitives', []):
            attributes = primitive['attributes']
            if not all(name in attributes for name in ('JOINTS_0', 'WEIGHTS_0')):
                return False
            joints = rows(document, attributes['JOINTS_0'])
            weights = rows(document, attributes['WEIGHTS_0'])
            weight_accessor = document.data['accessors'][attributes['WEIGHTS_0']]
            unit = 255 if weight_accessor['componentType'] == 5121 else 65535 if weight_accessor['componentType'] == 5123 else 1
            if len(joints) != len(weights) or not joints:
                return False
            if any(joint != (0, 0, 0, 0) or weight != (unit, 0, 0, 0) for joint, weight in zip(joints, weights)):
                return False
            found = True
    return found


def inverse_bind_matrix_bytes(document, skin, joint_index):
    accessor = document.data['accessors'][skin['inverseBindMatrices']]
    if accessor['componentType'] != 5126 or accessor['type'] != 'MAT4' or accessor['count'] != len(skin['joints']):
        raise ValueError('Rigid attachment requires one original root inverse bind matrix per joint')
    view = document.data['bufferViews'][accessor['bufferView']]
    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0) + joint_index * view.get('byteStride', MATRIX_BYTES)
    matrix = bytes(document.binary[start:start + MATRIX_BYTES])
    if len(matrix) != MATRIX_BYTES:
        raise ValueError('Rigid attachment inverse bind matrix is truncated')
    return matrix


def root_palette_index(root_layout, head_bone_index):
    rows_of_bone = [row['paletteIndex'] for row in root_layout['weights']['boneMapping'] if row['sourceBoneIndex'] == head_bone_index]
    if len(rows_of_bone) != 1:
        raise ValueError(f'Rigid attachment root head bone {head_bone_index} has no exported joint')
    return rows_of_bone[0]


def rigid_attachment_plan(document, layouts, part_index):
    attachment = layouts[part_index]['request'][RIGID_ATTACHMENT_FIELD]
    root_index, head_bone_index = attachment.get(ROOT_PART_FIELD), attachment.get(ROOT_HEAD_BONE_INDEX_FIELD)
    if not (type(root_index) is int and 0 <= root_index < len(layouts) and type(head_bone_index) is int and head_bone_index >= 0):
        raise ValueError(f'{layouts[part_index]["object"]} rigid attachment lacks its root part and root head bone index')
    root = layouts[root_index]
    if root['meshTransform']['gltfParentMatrix'] != layouts[part_index]['meshTransform']['gltfParentMatrix']:
        raise ValueError(f'{layouts[part_index]["object"]} mesh transform differs from its root {root["object"]}')
    root_skin = document.data['skins'][root['skin']]
    palette_index = root_palette_index(root, head_bone_index)
    if not 0 <= palette_index < len(root_skin['joints']):
        raise ValueError(f'Rigid attachment root head bone {head_bone_index} is outside the root skin')
    matrix = inverse_bind_matrix_bytes(document, root_skin, palette_index)
    part_skin = document.data['skins'][layouts[part_index]['skin']]
    return {'partIndex': part_index, 'rootPart': root_index, 'joint': root_skin['joints'][palette_index], 'matrix': matrix,
            'record': {'bone': document.data['nodes'][root_skin['joints'][palette_index]]['name'], 'rootObject': root['object'],
                       'rootHeadBoneIndex': head_bone_index, 'rootPaletteIndex': palette_index,
                       'originalJointCount': len(part_skin['joints']), 'originalInverseBindAccessor': part_skin['inverseBindMatrices'],
                       'rootInverseBindAccessor': root_skin['inverseBindMatrices'],
                       'selectedInverseBindSha256': hashlib.sha256(matrix).hexdigest(),
                       'geometryAndOriginalAccessorBytesPreserved': True, 'method': RIGID_HEAD_ATTACHMENT_METHOD,
                       'limitations': list(RIGID_HEAD_ATTACHMENT_LIMITATIONS)}}


def own_skeleton_nodes(document, layout):
    return [node for node in range(layout['nodeStart'], layout['nodeStart'] + layout['nodeCount']) if 'mesh' not in document.data['nodes'][node]]


def attach_rigid_head_parts(document, layouts):
    plans = [rigid_attachment_plan(document, layouts, index) for index, layout in enumerate(layouts) if RIGID_ATTACHMENT_FIELD in layout['request']]
    for plan in plans:
        offset = document.append(plan['matrix'])
        views, accessors = document.data['bufferViews'], document.data['accessors']
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': MATRIX_BYTES})
        accessors.append({'bufferView': len(views) - 1, 'componentType': 5126, 'count': 1, 'type': 'MAT4'})
        skin = document.data['skins'][layouts[plan['partIndex']]['skin']]
        skin['joints'] = [plan['joint']]
        skin['inverseBindMatrices'] = len(accessors) - 1
        skin.pop('skeleton', None)
    removed_by_part = {plan['partIndex']: own_skeleton_nodes(document, layouts[plan['partIndex']]) if plan['partIndex'] != plan['rootPart'] else []
                       for plan in plans}
    document.remove_nodes(sorted(node for nodes in removed_by_part.values() for node in nodes))
    return {plan['partIndex']: {**plan['record'], 'removedOwnSkeletonNodes': len(removed_by_part[plan['partIndex']])} for plan in plans}
