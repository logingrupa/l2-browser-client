import xml.etree.ElementTree as ElementTree

from actors.actor_unit_inventory import (NO_MESH_IN_ROW_REASON, ActorUnitInventoryError, census_row, conversion_unit, conversion_unit_key,
                                         decoded_table_identity, decoded_table_rows, first_gap_reason, mesh_and_texture_gap_reason,
                                         non_empty_values)
from native_catalog.tables import SCHEMA_ROOT, checked_bytes

ITEM_PART_NAME = 'items'
WEAPON_MESH_UNIT_KIND = 'weapon-mesh'
ARMOR_MESH_UNIT_KIND = 'armor-mesh'
MESH_TEXTURE_COMPOUND_READER = 'MTX'


def armorgrp_mtx_column_names(armorgrp):
    schema = armorgrp['schema']
    layouts = [layout for layout in ElementTree.fromstring(checked_bytes(SCHEMA_ROOT / schema['file'], schema['sha256']))
               if layout.get('pattern') == schema['layout']]
    if len(layouts) != 1:
        raise ActorUnitInventoryError(f'armorgrp schema {schema["file"]} has no single {schema["layout"]} layout')
    columns = [node.get('name') for node in layouts[0].iter('node') if node.get('reader') == MESH_TEXTURE_COMPOUND_READER]
    if not columns:
        raise ActorUnitInventoryError(f'armorgrp layout {schema["layout"]} declares no {MESH_TEXTURE_COMPOUND_READER} column')
    return columns


def weapon_selection(weapon):
    return {'meshes': [slot['mesh0'] for slot in weapon['wp_mesh']['mesh_0_']],
            'textures': [slot['texture0'] for slot in weapon['texture']]}


def armor_column_selection(armor, column):
    if column not in armor:
        raise ActorUnitInventoryError(f'armorgrp row {armor["object_id"]} has no decoded column {column}')
    compound = armor[column]['var_0_']
    return {'column': column, 'meshes': [slot['mtx_mesh_'] for slot in compound['for_mtx_size_1_']],
            'textures': [slot['mtx_text_'] for slot in compound['for_mtx_size_2_']]}


def item_mesh_unit(units_by_key, unit_kind, selection, package_census, table_identity):
    unit_key = conversion_unit_key(unit_kind, selection)
    if unit_key not in units_by_key:
        first_mesh = non_empty_values(selection['meshes'])[0]
        units_by_key[unit_key] = conversion_unit(
            unit_key, ITEM_PART_NAME, unit_kind, mesh_and_texture_gap_reason(selection['meshes'], selection['textures'], package_census),
            package_census.mesh_source_identity(first_mesh) or table_identity, selection)
    return units_by_key[unit_key]


def item_row(object_id, row_units, table_identity):
    reason = first_gap_reason(unit['reason'] for unit in row_units) if row_units else NO_MESH_IN_ROW_REASON
    return census_row(f'item:{object_id}', ITEM_PART_NAME, reason, table_identity)


def item_units_and_rows(weapongrp, armorgrp, armor_mesh_columns, package_census):
    units_by_key, rows = {}, []
    weapon_identity = decoded_table_identity(weapongrp)
    for weapon in decoded_table_rows(weapongrp):
        selection = weapon_selection(weapon)
        row_units = ([item_mesh_unit(units_by_key, WEAPON_MESH_UNIT_KIND, selection, package_census, weapon_identity)]
                     if non_empty_values(selection['meshes']) else [])
        rows.append(item_row(weapon['object_id'], row_units, weapon_identity))
    armor_identity = decoded_table_identity(armorgrp)
    for armor in decoded_table_rows(armorgrp):
        selections = [armor_column_selection(armor, column) for column in armor_mesh_columns]
        row_units = [item_mesh_unit(units_by_key, ARMOR_MESH_UNIT_KIND, selection, package_census, armor_identity)
                     for selection in selections if non_empty_values(selection['meshes'])]
        rows.append(item_row(armor['object_id'], row_units, armor_identity))
    return list(units_by_key.values()), rows
