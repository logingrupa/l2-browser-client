"""Explicit rigid-part attachments without editing original geometry buffers.

Native Lineage rigid sections carry BoneIndex=0. Actor-level HeadBone metadata
is therefore required to assemble face/hair parts; ordinary root skinning is
not a faithful substitute for the native actor attachment behavior.
"""
import hashlib
import struct


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


def attach_rigid_part(document, bone_name):
    if not is_root_rigid(document):
        raise ValueError('Rigid attachment requires one verified root-only rigid skin')
    skin = document.data['skins'][0]
    matches = [(index, node) for index, node in enumerate(skin['joints']) if document.data['nodes'][node].get('name', '').casefold() == bone_name.casefold()]
    if len(matches) != 1:
        raise ValueError('Rigid attachment bone is missing or ambiguous')
    bone_index, joint = matches[0]
    if bone_index == 0:
        raise ValueError('Rigid attachment must resolve to a non-root actor bone')
    original_accessor = skin['inverseBindMatrices']
    accessor = document.data['accessors'][original_accessor]
    if accessor['componentType'] != 5126 or accessor['type'] != 'MAT4' or accessor['count'] != len(skin['joints']):
        raise ValueError('Rigid attachment requires one original inverse bind matrix per joint')
    view = document.data['bufferViews'][accessor['bufferView']]
    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0) + bone_index * view.get('byteStride', 64)
    matrix = bytes(document.binary[start:start + 64])
    if len(matrix) != 64:
        raise ValueError('Rigid attachment inverse bind matrix is truncated')
    offset = document.append(matrix)
    views = document.data['bufferViews']
    views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': 64})
    accessors = document.data['accessors']
    accessors.append({'bufferView': len(views) - 1, 'componentType': 5126, 'count': 1, 'type': 'MAT4'})
    original_joints = list(skin['joints'])
    # Original JOINTS_0 remains zero. Its dedicated one-joint palette now names
    # the actor's explicit attachment bone and its unchanged bind matrix.
    skin['joints'] = [joint]
    skin['inverseBindMatrices'] = len(accessors) - 1
    skin.pop('skeleton', None)
    return {'bone': document.data['nodes'][joint]['name'], 'originalBoneIndex': bone_index,
        'originalJointNodes': original_joints, 'originalInverseBindAccessor': original_accessor,
        'selectedInverseBindSha256': hashlib.sha256(matrix).hexdigest(),
        'geometryAndOriginalAccessorBytesPreserved': True,
        'method': 'explicit actor-bone rigid palette with original bone inverse bind matrix',
        'limitations': ['Native facial aim/rotation and runtime submesh attachment logic are not executed; this preview follows the selected actor HeadBone.']}
