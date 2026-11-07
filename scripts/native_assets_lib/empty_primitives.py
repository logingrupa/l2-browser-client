"""Remove demonstrated UModel zero-vertex sections without touching native bytes.

Only glTF core references are supported here. Extension-bearing documents fail
closed when pruning would remap indices, rather than guessing extension-owned
references. Material slots, nonempty accessors/views, and every buffer byte stay.
"""
import copy


def _index(value, collection, path):
    if type(value) is not int or not 0 <= value < len(collection):
        raise ValueError(f'Invalid glTF reference at {path}')
    return value


def _count(value, path):
    if type(value) is not int or value < 0:
        raise ValueError(f'Invalid glTF count at {path}')
    return value


def _primitive_references(primitive, path):
    attributes = primitive.get('attributes', {})
    if not isinstance(attributes, dict) or 'POSITION' not in attributes:
        raise ValueError(f'Missing glTF POSITION at {path}')
    for name in attributes:
        yield attributes, name, f'{path}/attributes/{name}'
    if 'indices' in primitive:
        yield primitive, 'indices', f'{path}/indices'
    for index, target in enumerate(primitive.get('targets', [])):
        for name in target:
            yield target, name, f'{path}/targets/{index}/{name}'


def _accessor_references(data):
    for mesh_index, mesh in enumerate(data.get('meshes', [])):
        for primitive_index, primitive in enumerate(mesh.get('primitives', [])):
            yield from _primitive_references(primitive, f'/meshes/{mesh_index}/primitives/{primitive_index}')
    for animation_index, animation in enumerate(data.get('animations', [])):
        for sampler_index, sampler in enumerate(animation.get('samplers', [])):
            for name in ('input', 'output'):
                yield sampler, name, f'/animations/{animation_index}/samplers/{sampler_index}/{name}'
    for skin_index, skin in enumerate(data.get('skins', [])):
        if 'inverseBindMatrices' in skin:
            yield skin, 'inverseBindMatrices', f'/skins/{skin_index}/inverseBindMatrices'


def _view_references(data):
    for accessor_index, accessor in enumerate(data.get('accessors', [])):
        if 'bufferView' in accessor:
            yield accessor, 'bufferView', f'/accessors/{accessor_index}/bufferView'
        if 'sparse' in accessor:
            for name in ('indices', 'values'):
                child = accessor['sparse'][name]
                yield child, 'bufferView', f'/accessors/{accessor_index}/sparse/{name}/bufferView'
    for image_index, image in enumerate(data.get('images', [])):
        if 'bufferView' in image:
            yield image, 'bufferView', f'/images/{image_index}/bufferView'


def _reject_extensions(value, path=''):
    if isinstance(value, dict):
        for key, child in value.items():
            if key == 'extras':
                continue  # Application data has no glTF-owned index semantics.
            if key in ('extensions', 'extensionsUsed', 'extensionsRequired') and child:
                raise ValueError(f'Unreviewed glTF extension at {path}/{key}; cannot safely remap empty sections')
            _reject_extensions(child, f'{path}/{key}')
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_extensions(child, f'{path}/{index}')


def _remap(references, collection, removed):
    mapping = []
    next_index = 0
    for index in range(len(collection)):
        mapping.append(None if index in removed else next_index)
        if index not in removed:
            next_index += 1
    changes = []
    for owner, key, path in references:
        old = _index(owner[key], collection, path)
        new = mapping[old]
        if new is None:
            raise ValueError(f'Empty glTF entry remains referenced at {path}')
        owner[key] = new
        if new != old:
            changes.append({'path': path, 'old': old, 'new': new})
    return mapping, changes


def repair_empty_primitives(data):
    """Mutate a glTF dictionary transactionally; return repair evidence or None.

    Call after loading buffers and before Document.repair_bounds(). A mixed
    zero/nonzero section, wholly empty mesh, surviving reference to empty data,
    or unreviewed extension raises without mutating the original document.
    """
    working = copy.deepcopy(data)
    accessors = working.get('accessors', [])
    views = working.get('bufferViews', [])
    counts = [_count(accessor.get('count'), f'/accessors/{index}/count') for index, accessor in enumerate(accessors)]
    lengths = [_count(view.get('byteLength'), f'/bufferViews/{index}/byteLength') for index, view in enumerate(views)]
    removed_primitives, primitive_remaps = [], []
    for mesh_index, mesh in enumerate(working.get('meshes', [])):
        original = mesh.get('primitives', [])
        survivors, mapping = [], []
        for primitive_index, primitive in enumerate(original):
            path = f'/meshes/{mesh_index}/primitives/{primitive_index}'
            references = list(_primitive_references(primitive, path))
            indices = sorted({_index(owner[key], accessors, pointer) for owner, key, pointer in references})
            empty = [counts[index] == 0 for index in indices]
            if any(empty) and not all(empty):
                raise ValueError(f'Partially empty glTF primitive at {path}')
            if all(empty):
                for index in indices:
                    if accessors[index].get('sparse', {}).get('count', 0) != 0:
                        raise ValueError(f'Zero-count glTF accessor has nonempty sparse data at /accessors/{index}')
                removed_primitives.append({'mesh': mesh_index, 'primitive': primitive_index,
                    'material': primitive.get('material'), 'accessors': indices})
                mapping.append(None)
            else:
                mapping.append(len(survivors))
                survivors.append(primitive)
        if len(survivors) != len(original):
            if not survivors:
                raise ValueError(f'Wholly empty glTF mesh /meshes/{mesh_index} requires separate source review')
            mesh['primitives'] = survivors
            primitive_remaps.append({'mesh': mesh_index, 'oldToNew': mapping})

    accessor_references = list(_accessor_references(working))
    used_accessors = {_index(owner[key], accessors, path) for owner, key, path in accessor_references}
    zero_accessors = {index for index, count in enumerate(counts) if count == 0}
    if zero_accessors & used_accessors:
        raise ValueError(f'Empty glTF accessor remains referenced: {sorted(zero_accessors & used_accessors)}')
    # Validate view references even for removed accessors: corrupt indices must
    # not become acceptable just because the primitive had no active vertices.
    for owner, key, path in _view_references(working):
        _index(owner[key], views, path)
    for index in zero_accessors:
        if accessors[index].get('sparse', {}).get('count', 0) != 0:
            raise ValueError(f'Zero-count glTF accessor has nonempty sparse data at /accessors/{index}')
    accessor_map, accessor_changes = _remap(accessor_references, accessors, zero_accessors)
    working['accessors'] = [accessor for index, accessor in enumerate(accessors) if index not in zero_accessors]
    view_references = list(_view_references(working))
    used_views = {_index(owner[key], views, path) for owner, key, path in view_references}
    zero_views = {index for index, length in enumerate(lengths) if length == 0}
    if zero_views & used_views:
        raise ValueError(f'Empty glTF buffer view remains referenced: {sorted(zero_views & used_views)}')
    view_map, view_changes = _remap(view_references, views, zero_views)
    working['bufferViews'] = [view for index, view in enumerate(views) if index not in zero_views]
    if not removed_primitives and not zero_accessors and not zero_views:
        return None
    _reject_extensions(data)
    # Empty optional root arrays are invalid in glTF. No nonempty entry was
    # removed, and core references above prove these arrays are unreferenced.
    for name in ('accessors', 'bufferViews'):
        if not working[name]:
            del working[name]
    data.clear()
    data.update(working)
    return {'kind': 'omit-empty-native-primitives', 'removedPrimitives': removed_primitives,
        'primitiveRemaps': primitive_remaps, 'removedAccessors': sorted(zero_accessors),
        'accessorRemap': accessor_map, 'removedBufferViews': sorted(zero_views), 'bufferViewRemap': view_map,
        'changedReferences': accessor_changes + view_changes, 'bytesPreserved': True,
        'materialSlotsPreserved': True, 'materialSlotCount': len(working.get('materials', []))}
