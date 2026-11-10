import re

from actors.actor_unit_inventory import (ARMOR_MESH_UNIT_KIND, ARMORGRP_TABLE_NAME, CONVERSION_PENDING_REASON, NO_MESH_IN_ROW_REASON,
                                         WEAPON_MESH_UNIT_KIND, WEAPONGRP_TABLE_NAME, conversion_unit_key)
from actors.item_unit_inventory import ITEM_PART_NAME, armor_column_selection, weapon_selection
from actors.npc_requests import ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX
from native_store.gap_census import ETCITEM_PRESENTATION_UNPLANNED_REASON, ITEM_GROUP_ROW_ABSENT_REASON
from native_store.gap_rows import validate_gap_row

ITEM_ROW_COLLECTION = 'item'
ITEM_STEP = 'items'
ITEM_CENSUS_RELATIVE_PATH = 'docs/parts/items/item-census.json'
WEAPON_RECORD_KIND, ARMOR_RECORD_KIND = 'weapon', 'armor'
ITEM_MODEL_RECORD_ID_PREFIX = 'interlude:item:'
WEAPON_MESH_FIELD, WEAPON_TEXTURE_FIELD = 'mesh0', 'texture0'
ARMOR_MESH_FIELD, ARMOR_TEXTURE_FIELD = 'mtx_mesh_', 'mtx_text_'
MESH_TEXTURE_PAIRING_UNDECODED_REASON_PREFIX = 'mesh-texture-pairing-undecoded:'
EQUIPMENT_SLOT_MEANING_UNDECODED_REASON_PREFIX = 'equipment-slot-meaning-undecoded:'
PASS_STATUS, GAP_STATUS, PENDING_STATUS = 'pass', 'gap', 'pending'
MAXIMUM_LINEAGE_IDENTIFIER = 999_999_999
PACKAGE_QUALIFIED_REFERENCE_PATTERN = re.compile(r'^[^.\s]+(?:\.[^.\s]+)+$')
ITEM_REQUEST_LIMITATIONS = (
    'Generated from the decoded item group row: the mesh and its textures are copied from the cited fields; no recipe value is copied.',
    'Which character body part this item replaces or where it attaches is not decoded; presentation is unverified.',
)
TEXTURE_LIST_INDEX_SLOT_LIMITATION = ('The item group texture list index i binds material slot i by the UE2 Skins array convention, which is not '
                                      'read from the client; the binding is unverified presentation.')


class ItemRequestError(ValueError):
    pass


def require_lineage_identifier(value, label):
    if not (type(value) is int and 0 <= value <= MAXIMUM_LINEAGE_IDENTIFIER):
        raise ItemRequestError(f'{label} must be an integer from 0 to {MAXIMUM_LINEAGE_IDENTIFIER}: {value!r}')
    return value


def item_model_record_id(item_id, body_part, unit_kind, race_column_ordinal=None):
    require_lineage_identifier(item_id, 'item id')
    require_lineage_identifier(body_part, 'body_part')
    prefix = f'{ITEM_MODEL_RECORD_ID_PREFIX}{item_id}:body-part:{body_part}:'
    if unit_kind == WEAPON_RECORD_KIND and race_column_ordinal is None:
        return prefix + WEAPON_RECORD_KIND
    if unit_kind == ARMOR_RECORD_KIND and race_column_ordinal is not None:
        return f'{prefix}{ARMOR_RECORD_KIND}:{require_lineage_identifier(race_column_ordinal, "race column ordinal")}'
    raise ItemRequestError(f'item model record kind {unit_kind!r} with race column ordinal {race_column_ordinal!r} is not a weapon '
                           'without an ordinal or an armor with one')


def item_key(item_id):
    return f'item:{require_lineage_identifier(item_id, "item id")}'


def item_row_at(item_table, row_index):
    rows = item_table['data'][ITEM_ROW_COLLECTION]
    if not (type(row_index) is int and 0 <= row_index < len(rows)):
        raise ItemRequestError(f'{item_table["source"]} row index {row_index!r} is outside the decoded table of {len(rows)} rows')
    return rows[row_index]


def unqualified_reference_field(references_by_field):
    return next((field for field, references in references_by_field
                 for reference in references if reference and not PACKAGE_QUALIFIED_REFERENCE_PATTERN.fullmatch(reference)), None)


def selection_gap_reason(selection, mesh_field, texture_field):
    meshes = [mesh for mesh in selection['meshes'] if mesh]
    if not meshes:
        return NO_MESH_IN_ROW_REASON
    field = unqualified_reference_field(((mesh_field, selection['meshes']), (texture_field, selection['textures'])))
    if field:
        return ACTOR_DEFAULT_UNRESOLVED_REASON_PREFIX + field
    if len(meshes) != 1 or not selection['textures']:
        return f'{MESH_TEXTURE_PAIRING_UNDECODED_REASON_PREFIX}{len(meshes)}/{len(selection["textures"])}'
    return None


def texture_binding_and_materials(textures, texture_paths):
    if len(textures) == 1:
        return {'texturePath': texture_paths[0]}, [f'0={textures[0]}'] if textures[0] else []
    slot_bindings = [{'slot': slot, 'texturePath': path} for slot, path in enumerate(texture_paths)]
    return {'slotBindings': slot_bindings}, [f'{slot}={texture}' for slot, texture in enumerate(textures) if texture]


def selection_model_request(unit_key, table_name, item_table, selection, mesh_path_of_index, texture_path_of_index):
    mesh_index, mesh = next((index, mesh) for index, mesh in enumerate(selection['meshes']) if mesh)
    package_name, object_name = mesh.split('.', 1)
    texture_paths = [texture_path_of_index(index) for index in range(len(selection['textures']))]
    binding, materials = texture_binding_and_materials(selection['textures'], texture_paths)
    limitations = list(ITEM_REQUEST_LIMITATIONS) + ([TEXTURE_LIST_INDEX_SLOT_LIMITATION] if len(selection['textures']) > 1 else [])
    return {'kind': 'model', 'name': unit_key.replace(':', '-'), 'package': package_name, 'object': object_name, 'materials': materials,
            'sourceBinding': {'table': table_name, 'sourceSha256': item_table['sourceSha256'], 'meshPath': mesh_path_of_index(mesh_index),
                              **binding},
            'limitations': limitations}


def selection_entry(row, unit_kind, record_kind, table_name, item_table, selection, field_paths, race_column_ordinal=None):
    mesh_field, texture_field, mesh_path_of_index, texture_path_of_index = field_paths
    reason = selection_gap_reason(selection, mesh_field, texture_field)
    unit_key = conversion_unit_key(unit_kind, selection) if reason != NO_MESH_IN_ROW_REASON else None
    request = (selection_model_request(unit_key, table_name, item_table, selection, mesh_path_of_index, texture_path_of_index)
               if reason is None else None)
    return {'itemId': row['object_id'], 'bodyPart': row['body_part'], 'unitKind': unit_kind, 'raceColumnOrdinal': race_column_ordinal,
            'unitKey': unit_key, 'recordId': item_model_record_id(row['object_id'], row['body_part'], record_kind, race_column_ordinal),
            'reason': reason, 'request': request}


def build_weapon_unit_request(weapongrp_table, row_index):
    row = item_row_at(weapongrp_table, row_index)
    field_paths = (WEAPON_MESH_FIELD, WEAPON_TEXTURE_FIELD,
                   lambda index: [ITEM_ROW_COLLECTION, row_index, 'wp_mesh', 'mesh_0_', index, WEAPON_MESH_FIELD],
                   lambda index: [ITEM_ROW_COLLECTION, row_index, 'texture', index, WEAPON_TEXTURE_FIELD])
    return selection_entry(row, WEAPON_MESH_UNIT_KIND, WEAPON_RECORD_KIND, WEAPONGRP_TABLE_NAME, weapongrp_table, weapon_selection(row),
                           field_paths)


def armor_column_field_paths(row_index, column):
    compound_path = [ITEM_ROW_COLLECTION, row_index, column, 'var_0_']
    return (ARMOR_MESH_FIELD, ARMOR_TEXTURE_FIELD,
            lambda index: compound_path + ['for_mtx_size_1_', index, ARMOR_MESH_FIELD],
            lambda index: compound_path + ['for_mtx_size_2_', index, ARMOR_TEXTURE_FIELD])


def build_armor_unit_requests(armorgrp_table, row_index, armor_columns):
    row = item_row_at(armorgrp_table, row_index)
    return [{**selection_entry(row, ARMOR_MESH_UNIT_KIND, ARMOR_RECORD_KIND, ARMORGRP_TABLE_NAME, armorgrp_table,
                               armor_column_selection(row, column), armor_column_field_paths(row_index, column), ordinal),
             'raceColumn': column}
            for ordinal, column in enumerate(armor_columns)]


def item_entry_status(entry, census_units_by_key, sealed_outcomes_by_unit_key):
    if entry['reason'] is not None:
        return GAP_STATUS, entry['reason']
    census_unit = census_units_by_key.get(entry['unitKey'])
    if census_unit is None:
        raise ItemRequestError(f'item {entry["itemId"]} names unit {entry["unitKey"]}, which the actor unit census does not hold')
    if census_unit['reason'] is not None:
        return GAP_STATUS, census_unit['reason']
    outcome = sealed_outcomes_by_unit_key.get(entry['unitKey'])
    if outcome is None:
        return PENDING_STATUS, CONVERSION_PENDING_REASON
    return outcome['status'], outcome['reason']


def grouped_item_status(entries, census_units_by_key, sealed_outcomes_by_unit_key):
    entries_with_meshes = [entry for entry in entries if entry['reason'] != NO_MESH_IN_ROW_REASON]
    statuses = [item_entry_status(entry, census_units_by_key, sealed_outcomes_by_unit_key) for entry in entries_with_meshes]
    if any(status == PASS_STATUS for status, _ in statuses):
        return PASS_STATUS, None
    if any(status == PENDING_STATUS for status, _ in statuses):
        return PENDING_STATUS, CONVERSION_PENDING_REASON
    return GAP_STATUS, statuses[0][1] if statuses else NO_MESH_IN_ROW_REASON


def item_gap_row(item_id, status, reason, source_identity):
    return validate_gap_row({'key': item_key(item_id), 'part': ITEM_PART_NAME, 'step': ITEM_STEP, 'status': status, 'reason': reason,
                             'sourceIdentity': {'path': source_identity['path'], 'sha256': source_identity['sha256']},
                             'evidence': ITEM_CENSUS_RELATIVE_PATH})


def ungrouped_item_reason(item_id, etcitem_ids):
    return ETCITEM_PRESENTATION_UNPLANNED_REASON if item_id in etcitem_ids else ITEM_GROUP_ROW_ABSENT_REASON


def item_gap_rows(grouped_items, census_units_by_key, sealed_outcomes_by_unit_key, sources):
    rows = []
    for item_id, grouped in sorted(grouped_items.items()):
        status, reason = grouped_item_status(grouped['entries'], census_units_by_key, sealed_outcomes_by_unit_key)
        if status == PASS_STATUS:
            status, reason = GAP_STATUS, f'{EQUIPMENT_SLOT_MEANING_UNDECODED_REASON_PREFIX}{grouped["bodyPart"]}'
        rows.append(item_gap_row(item_id, status, reason, sources[grouped['table']]))
    return rows
