from actors.character_requests import FACE_FIELD_NAME, GAP_STATUS, HAIR_FIELD_NAME, HAIR_SELECTION_FIELD
from native_assets_lib.weights import native_vertices
from native_catalog.skeletal import decode_skeletal_source

SKINNED_PART_BONE_MISSING_REASON_PREFIX, RIGID_PART_BONE_UNMATCHED_REASON_PREFIX = 'skinned-part-bone-missing:', 'rigid-part-bone-unmatched:'
RIGID_HEAD_PART_ROUTE, SKINNED_HEAD_PART_ROUTE = 'rigid', 'skinned'
ROOT_BONE_INDEX = 0
RIGID_ATTACHMENT_FIELD = 'rigidAttachment'


def skeleton_summary(skeletal_source):
    bones = skeletal_source['bones']
    vertices = native_vertices(skeletal_source)[0]
    return {'object': skeletal_source['object'],
            'bones': [{'name': bone['name'], 'parentName': bones[bone['parent']]['name'] if index else None} for index, bone in enumerate(bones)],
            'influencedBoneIndexes': sorted({bone for vertex in vertices for bone, weight in vertex['influences'] if weight > 0})}


def decoded_skeleton_summary(converter, part):
    _, package = converter.package(part['package'])
    return skeleton_summary(decode_skeletal_source(package, converter.select(package, part['object'], 'SkeletalMesh')))


def bone_identity(bone):
    return bone['name'].casefold(), bone['parentName'].casefold() if bone['parentName'] is not None else None


def missing_body_bones(part_skeleton, body_skeleton):
    body_bones = {bone_identity(bone) for bone in body_skeleton['bones']}
    return [bone['name'] for bone in part_skeleton['bones'] if bone_identity(bone) not in body_bones]


def is_root_only_rigid(part_skeleton):
    return part_skeleton['influencedBoneIndexes'] == [ROOT_BONE_INDEX]


def head_part_field(part):
    return HAIR_FIELD_NAME if HAIR_SELECTION_FIELD in part else FACE_FIELD_NAME


def head_part_route(part, part_skeleton, body_skeleton):
    rigid = is_root_only_rigid(part_skeleton)
    return {'field': head_part_field(part), 'object': part['object'], 'route': RIGID_HEAD_PART_ROUTE if rigid else SKINNED_HEAD_PART_ROUTE,
            'boneCount': len(part_skeleton['bones']), 'bodyObject': body_skeleton['object'],
            'missingBones': missing_body_bones(part_skeleton, body_skeleton)}


def skinned_head_part_limitation(route):
    return (f'The {route["field"]} mesh {route["object"]} is skinned to {route["boneCount"]} bones that all exist in the '
            f'{route["bodyObject"]} skeleton; it converts as a body part.')


def unmatched_bones_gap(route):
    prefix = SKINNED_PART_BONE_MISSING_REASON_PREFIX if route['route'] == SKINNED_HEAD_PART_ROUTE else RIGID_PART_BONE_UNMATCHED_REASON_PREFIX
    return {'field': route['field'], 'reason': prefix + ','.join(route['missingBones'])}


def generated_with_head_part_routes(generated, read_skeleton):
    request = generated['request']
    head_part_indexes = [index for index, part in enumerate(request['parts']) if RIGID_ATTACHMENT_FIELD in part] if request else []
    if not head_part_indexes:
        return {**generated, 'headParts': []}
    body_skeleton = read_skeleton(request['parts'][0])
    routes = [head_part_route(request['parts'][index], read_skeleton(request['parts'][index]), body_skeleton) for index in head_part_indexes]
    unmatched = [route for route in routes if route['missingBones']]
    if any(route['field'] != HAIR_FIELD_NAME for route in unmatched):
        return {**generated, 'request': None, 'headParts': routes, 'gaps': [unmatched_bones_gap(route) for route in unmatched] + generated['gaps']}
    route_by_index = dict(zip(head_part_indexes, routes))
    parts = [{field: value for field, value in part.items() if field != RIGID_ATTACHMENT_FIELD}
             if route_by_index.get(index, {}).get('route') == SKINNED_HEAD_PART_ROUTE else part
             for index, part in enumerate(request['parts']) if not route_by_index.get(index, {}).get('missingBones')]
    limitations = request['limitations'] + [skinned_head_part_limitation(route) for route in routes
                                            if route['route'] == SKINNED_HEAD_PART_ROUTE and not route['missingBones']]
    hair_gaps = [unmatched_bones_gap(route) for route in unmatched]
    hair = ({**generated['hair'], 'status': GAP_STATUS, 'reason': generated['hair']['reason'] or hair_gaps[0]['reason']} if hair_gaps
            else generated['hair'])
    return {**generated, 'request': {**request, 'parts': parts, 'limitations': limitations}, 'headParts': routes, 'hair': hair,
            'gaps': hair_gaps + generated['gaps']}
