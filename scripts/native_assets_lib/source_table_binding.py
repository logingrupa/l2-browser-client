SINGLE_SLOT_BINDING_KEYS = frozenset({'table', 'sourceSha256', 'meshPath', 'texturePath'})
SINGLE_SLOT_BINDING_KEYS_WITH_SLOT = SINGLE_SLOT_BINDING_KEYS | {'slot'}
SLOT_LIST_BINDING_KEYS = frozenset({'table', 'sourceSha256', 'meshPath', 'slotBindings'})
SLOT_BINDING_ENTRY_KEYS = frozenset({'slot', 'texturePath'})
TABLE_FIELD_MISMATCH_MESSAGE = 'Recipe mesh/texture binding differs from its cited native table fields'
UNCITED_OVERRIDE_MESSAGE = 'Recipe material override is not cited by its native table binding'


def require_material_slot_number(slot):
    if type(slot) is not int or slot < 0:
        raise ValueError(f'Source binding slot must be a non-negative integer: {slot!r}')
    return slot


def require_table_field_path(path):
    if not isinstance(path, list):
        raise ValueError(f'Source binding table field path must be a list: {path!r}')
    return path


def source_slot_bindings(binding):
    if not isinstance(binding, dict):
        raise ValueError('Source binding must be an object')
    binding_keys = set(binding)
    if binding_keys in (SINGLE_SLOT_BINDING_KEYS, SINGLE_SLOT_BINDING_KEYS_WITH_SLOT):
        return [(require_material_slot_number(binding.get('slot', 0)), require_table_field_path(binding['texturePath']))]
    if binding_keys != SLOT_LIST_BINDING_KEYS:
        raise ValueError('Source binding must use either texturePath or slotBindings')
    entries = binding['slotBindings']
    if not isinstance(entries, list) or not entries:
        raise ValueError('Source binding slotBindings must be a non-empty list')
    slot_bindings = []
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != SLOT_BINDING_ENTRY_KEYS:
            raise ValueError('Each source slot binding must hold exactly slot and texturePath')
        slot_bindings.append((require_material_slot_number(entry['slot']), require_table_field_path(entry['texturePath'])))
    slots = [slot for slot, _ in slot_bindings]
    if len(set(slots)) != len(slots):
        raise ValueError('Source binding lists a material slot twice')
    return slot_bindings


def material_overrides_by_slot(material_entries):
    overrides = {}
    for entry in material_entries:
        if not isinstance(entry, str) or '=' not in entry:
            raise ValueError(f'Material override must be <slot>=<reference>: {entry!r}')
        slot_text, reference = entry.split('=', 1)
        slot = int(slot_text)
        if slot in overrides:
            raise ValueError('Duplicate material override')
        overrides[slot] = reference
    return overrides


def decoded_table_field(decoded_table, path):
    value = decoded_table['data']
    for key in path:
        value = value[key]
    return value


def qualified_request_mesh_reference(request):
    return request['object'] if '.' in request['object'] else request['package'] + '.' + request['object']


def verify_source_table_binding(request, decoded_table):
    binding = request['sourceBinding']
    slot_bindings = source_slot_bindings(binding)
    mesh_path = require_table_field_path(binding['meshPath'])
    mesh = decoded_table_field(decoded_table, mesh_path)
    if not isinstance(mesh, str) or qualified_request_mesh_reference(request).casefold() != mesh.casefold():
        raise ValueError(TABLE_FIELD_MISMATCH_MESSAGE)
    overrides = material_overrides_by_slot(request.get('materials', []))
    cited_slots = set()
    slot_binding_evidence = []
    for slot, texture_path in slot_bindings:
        texture = decoded_table_field(decoded_table, texture_path)
        if not isinstance(texture, str):
            raise ValueError(f'Native table texture field is not a string: {texture_path!r}')
        if texture:
            if slot not in overrides or overrides[slot].casefold() != texture.casefold():
                raise ValueError(TABLE_FIELD_MISMATCH_MESSAGE)
            cited_slots.add(slot)
        slot_binding_evidence.append({'slot': slot, 'texturePath': texture_path, 'textureReference': texture})
    if set(overrides) != cited_slots:
        raise ValueError(UNCITED_OVERRIDE_MESSAGE)
    return {'table': binding['table'], 'sourceSha256': binding['sourceSha256'], 'meshPath': mesh_path, 'meshReference': mesh,
            'slotBindings': slot_binding_evidence, 'schema': decoded_table['schema'], 'decodedSha256': decoded_table['decodedSha256']}
