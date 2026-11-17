from actors.character_requests import FACE_FIELD_NAME, GAP_STATUS, HAIR_FIELD_NAME, HAIR_SELECTION_FIELD
from native_assets_lib.weights import native_vertices
from native_catalog.skeletal import decode_skeletal_source

SKINNED_PART_BONE_MISSING_REASON_PREFIX, RIGID_HEAD_BONE_UNRESOLVED_REASON_PREFIX = 'skinned-part-bone-missing:', 'rigid-head-bone-unresolved:'
RIGID_HEAD_PART_ROUTE, SKINNED_HEAD_PART_ROUTE = 'rigid', 'skinned'
ROOT_BONE_INDEX = 0
UNRESOLVED_BONE_INDEX = -1
RIGID_ATTACHMENT_FIELD = 'rigidAttachment'
ROOT_HEAD_BONE_INDEX_FIELD, ROOT_PART_FIELD = 'rootHeadBoneIndex', 'rootPart'


def skeleton_summary(skeletal_source):
    bones = skeletal_source['bones']
    vertices = native_vertices(skeletal_source)[0]
    return {'object': skeletal_source['object'],
            'bones': [{'name': bone['name'], 'parentName': bones[bone['parent']]['name'] if index else None} for index, bone in enumerate(bones)],
            'aliases': skeletal_source['attachmentAliases'],
            'meshTransform': {field: list(skeletal_source[field]) for field in ('meshScale', 'meshOrigin', 'rotOrigin')},
            'influencedBoneIndexes': sorted({bone for vertex in vertices for bone, weight in vertex['influences'] if weight > 0})}


def decoded_skeleton_summary(converter, part):
    _, package = converter.package(part['package'])
    return skeleton_summary(decode_skeletal_source(package, converter.select(package, part['object'], 'SkeletalMesh')))


def match_reference_bone(skeleton, bone_name):
    name = next((pair['bone'] for pair in skeleton['aliases'] if pair['alias'].casefold() == bone_name.casefold()), bone_name)
    return next((index for index, bone in enumerate(skeleton['bones']) if bone['name'].casefold() == name.casefold()), UNRESOLVED_BONE_INDEX)


def is_resolved_head_bone_index(index, root_skeleton):
    return root_skeleton is not None and 0 <= index < len(root_skeleton['bones'])


def bone_identity(bone):
    return bone['name'].casefold(), bone['parentName'].casefold() if bone['parentName'] is not None else None


def missing_body_bones(part_skeleton, body_skeleton):
    body_bones = {bone_identity(bone) for bone in body_skeleton['bones']}
    return [bone['name'] for bone in part_skeleton['bones'] if bone_identity(bone) not in body_bones]


def is_root_only_rigid(part_skeleton):
    return part_skeleton['influencedBoneIndexes'] == [ROOT_BONE_INDEX]


def head_part_field(part):
    return HAIR_FIELD_NAME if HAIR_SELECTION_FIELD in part else FACE_FIELD_NAME


def head_part_label(part):
    return part[HAIR_SELECTION_FIELD]['half'] if HAIR_SELECTION_FIELD in part else FACE_FIELD_NAME


def is_same_mesh(part, root_mesh):
    return root_mesh['reason'] is None and ((part['package'].casefold(), part['object'].casefold())
                                            == (root_mesh['package'].casefold(), root_mesh['object'].casefold()))


def head_part_route(part, part_skeleton, body_skeleton, root_skeleton):
    route = {'field': head_part_field(part), 'label': head_part_label(part), 'object': part['object'], 'boneCount': len(part_skeleton['bones'])}
    if not is_root_only_rigid(part_skeleton):
        return {**route, 'route': SKINNED_HEAD_PART_ROUTE, 'bodyObject': body_skeleton['object'],
                'missingBones': missing_body_bones(part_skeleton, body_skeleton)}
    index = match_reference_bone(root_skeleton, part[RIGID_ATTACHMENT_FIELD]['bone']) if root_skeleton else UNRESOLVED_BONE_INDEX
    differing_transform = (root_skeleton is not None and part_skeleton['meshTransform'] != root_skeleton['meshTransform']
                           and {'part': part_skeleton['meshTransform'], 'root': root_skeleton['meshTransform']})
    return {**route, 'route': RIGID_HEAD_PART_ROUTE, 'rootObject': root_skeleton and root_skeleton['object'], ROOT_HEAD_BONE_INDEX_FIELD: index,
            **({'nativeMeshTransformDifference': differing_transform} if differing_transform else {})}


def head_part_gap_reason(route, root_skeleton):
    if route['route'] == SKINNED_HEAD_PART_ROUTE:
        return SKINNED_PART_BONE_MISSING_REASON_PREFIX + ','.join(route['missingBones']) if route['missingBones'] else None
    return None if is_resolved_head_bone_index(route[ROOT_HEAD_BONE_INDEX_FIELD], root_skeleton) else RIGID_HEAD_BONE_UNRESOLVED_REASON_PREFIX + route['label']


def skinned_head_part_limitation(route):
    return (f'The {route["field"]} mesh {route["object"]} is skinned to {route["boneCount"]} bones that all exist in the '
            f'{route["bodyObject"]} skeleton; it converts as a body part.')


def rigid_head_part_limitation(route):
    if route['object'] == route['rootObject']:
        return (f'The {route["field"]} mesh {route["object"]} is the rigid root mesh; it follows its own bone {route[ROOT_HEAD_BONE_INDEX_FIELD]} '
                'with its own inverse bind at that index (RM-14).')
    limitation = (f'The {route["field"]} mesh {route["object"]} is rigid; it follows bone {route[ROOT_HEAD_BONE_INDEX_FIELD]} of the root mesh '
                  f'{route["rootObject"]} with the root inverse bind at that index (RM-14) and carries no skeleton or animation of its own.')
    difference = route.get('nativeMeshTransformDifference')
    if difference:
        limitation += (f' Its native float32 mesh transform {difference["part"]} differs from the root {difference["root"]}; the converter applies '
                       'the transform both derive from the UEViewer dump, which is the same for both.')
    return limitation


def routed_part(part, route):
    if route['route'] == SKINNED_HEAD_PART_ROUTE:
        return {field: value for field, value in part.items() if field != RIGID_ATTACHMENT_FIELD}
    return {**part, RIGID_ATTACHMENT_FIELD: {**part[RIGID_ATTACHMENT_FIELD], ROOT_HEAD_BONE_INDEX_FIELD: route[ROOT_HEAD_BONE_INDEX_FIELD]}}


def with_root_part(parts, root_mesh):
    root_indexes = [index for index, part in enumerate(parts) if is_same_mesh(part, root_mesh)]
    return [{**part, RIGID_ATTACHMENT_FIELD: {**part[RIGID_ATTACHMENT_FIELD], ROOT_PART_FIELD: root_indexes[0]}} if RIGID_ATTACHMENT_FIELD in part else part
            for part in parts]


def generated_with_head_part_routes(generated, read_skeleton):
    request = generated['request']
    head_part_indexes = [index for index, part in enumerate(request['parts']) if RIGID_ATTACHMENT_FIELD in part] if request else []
    if not head_part_indexes:
        return {**generated, 'headParts': []}
    body_skeleton = read_skeleton(request['parts'][0])
    skeletons = {index: read_skeleton(request['parts'][index]) for index in head_part_indexes}
    root_indexes = [index for index in head_part_indexes if is_same_mesh(request['parts'][index], generated['rootMesh'])]
    root_skeleton = skeletons[root_indexes[0]] if len(root_indexes) == 1 else None
    routes = {index: head_part_route(request['parts'][index], skeletons[index], body_skeleton, root_skeleton) for index in head_part_indexes}
    gaps = {index: {'field': route['field'], 'reason': reason} for index, route in routes.items()
            if (reason := head_part_gap_reason(route, root_skeleton))}
    route_list = list(routes.values())
    if any(gap['field'] != HAIR_FIELD_NAME for gap in gaps.values()):
        return {**generated, 'request': None, 'headParts': route_list, 'gaps': list(gaps.values()) + generated['gaps']}
    parts = with_root_part([routed_part(part, routes[index]) if index in routes else part
                            for index, part in enumerate(request['parts']) if index not in gaps], generated['rootMesh'])
    limitations = request['limitations'] + [skinned_head_part_limitation(route) if route['route'] == SKINNED_HEAD_PART_ROUTE
                                            else rigid_head_part_limitation(route) for index, route in routes.items() if index not in gaps]
    hair_gaps = list(gaps.values())
    hair = ({**generated['hair'], 'status': GAP_STATUS, 'reason': generated['hair']['reason'] or hair_gaps[0]['reason']} if hair_gaps
            else generated['hair'])
    return {**generated, 'request': {**request, 'parts': parts, 'limitations': limitations}, 'headParts': route_list, 'hair': hair,
            'gaps': hair_gaps + generated['gaps']}
