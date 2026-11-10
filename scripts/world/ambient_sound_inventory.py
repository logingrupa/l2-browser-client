from typing import NamedTuple

from native_assets_lib.footstep_config import REFERENCE
from native_assets_lib.world_ambience import FIELDS
from native_catalog.ue2 import FormatError
from world.map_actor_properties import ambient_sound_object

AMBIENT_SOUND_OBJECT_CLASS = 'Engine.AmbientSoundObject'
AMBIENT_SOUND_PROPERTY = 'AmbientSound'
AUTHORED_REFERENCE_STATUS = 'authored-reference'
OMITTED_REFERENCE_STATUS = 'omitted-reference-unresolved'
SERIALIZED_NULL_REFERENCE_STATUS = 'serialized-null-reference'
DECLARATION_DECODE_ERROR_STATUS = 'declaration-decode-error'
AMBIENT_EMITTER_UNREADABLE_REASON = 'ambient-emitter-unreadable'
AMBIENT_EMITTER_STATUSES = (AUTHORED_REFERENCE_STATUS, OMITTED_REFERENCE_STATUS, SERIALIZED_NULL_REFERENCE_STATUS, DECLARATION_DECODE_ERROR_STATUS)


class AmbientEmitterUnreadable(ValueError):
    pass


class AmbientInventory(NamedTuple):
    items: list
    references: dict
    counts: dict


def ambient_reference(declaration):
    fields = [prop for prop in declaration['properties'] if prop['name'] == AMBIENT_SOUND_PROPERTY]
    if not fields:
        return OMITTED_REFERENCE_STATUS, None
    if len(fields) != 1 or fields[0]['arrayIndex'] not in (None, 0):
        raise FormatError(f'{declaration["object"]} serializes AmbientSound {len(fields)} times')
    value = fields[0].get('value')
    if not (isinstance(value, dict) and 'object' in value):
        raise FormatError(f'{declaration["object"]} AmbientSound reference is undecoded')
    if value['object'] is None:
        return SERIALIZED_NULL_REFERENCE_STATUS, None
    if not (isinstance(value['object'], str) and REFERENCE.fullmatch(value['object'])):
        raise FormatError(f'{declaration["object"]} AmbientSound is not a qualified reference: {value["object"]!r}')
    return AUTHORED_REFERENCE_STATUS, value['object']


def inventory_ambient_sounds(package, raw_path):
    items, references = [], {}
    for item in sorted((export for export in package.exports if export['classObject'] == AMBIENT_SOUND_OBJECT_CLASS),
                       key=lambda export: export['exportIndex']):
        row = {'id': 'interlude:' + item['object'], 'object': item['object'], 'exportIndex': item['exportIndex'], 'status': DECLARATION_DECODE_ERROR_STATUS}
        items.append(row)
        try:
            declaration = ambient_sound_object(package, item, raw_path)
            status, reference = ambient_reference(declaration)
        except (ValueError, KeyError, TypeError) as error:
            row['error'] = str(error)
            continue
        row.update(status=status, declaration=declaration)
        if reference is not None:
            row['soundReference'] = reference
            use = references.setdefault(reference.casefold(), {'references': set(), 'declarations': []})
            use['references'].add(reference)
            use['declarations'].append(row['id'])
    counts = {'declarations': len(items), **{status: sum(row['status'] == status for row in items) for status in AMBIENT_EMITTER_STATUSES},
              'distinctReferences': len(references)}
    return AmbientInventory(items, references, counts)


def declared_values(declaration):
    values = {}
    for prop in declaration['properties']:
        if prop['name'] in values or prop['arrayIndex'] is not None:
            raise AmbientEmitterUnreadable(f'{declaration["object"]} serializes {prop["name"]} twice or as an array element')
        values[prop['name']] = prop.get('value')
    return values


def ambient_emitter_row(item, sound_keys):
    declaration = item.get('declaration')
    if declaration is None:
        raise AmbientEmitterUnreadable(f'{item["object"]} declaration did not decode: {item.get("error")}')
    values = declared_values(declaration)
    location = values.get('Location')
    if not (isinstance(location, dict) and all(isinstance(location.get(axis), (int, float)) for axis in 'XYZ')):
        raise AmbientEmitterUnreadable(f'{item["object"]} has no decoded Location')
    reference = item.get('soundReference')
    sound = reference.casefold() if reference is not None and reference.casefold() in sound_keys else None
    region = {field['name']: field.get('value') for field in values['Region']} if isinstance(values.get('Region'), list) else {}
    zone = region.get('Zone')
    row = {'id': item['object'], 'exportIndex': item['exportIndex'], 'x': location['X'], 'y': location['Y'], 'z': location['Z'],
           'soundRadius': values.get('SoundRadius'), 'soundVolume': values.get('SoundVolume'), 'soundPitch': values.get('SoundPitch'),
           'ambientSoundType': values.get('AmbientSoundType'), 'ambientRandom': values.get('AmbientRandom'),
           'ambientSoundStartTime': values.get('AmbientSoundStartTime'), 'sound': sound,
           'zone': zone.get('object') if isinstance(zone, dict) else None, 'zoneNumber': region.get('ZoneNumber'), 'group': values.get('Group')}
    return [row[name] for name in FIELDS]
