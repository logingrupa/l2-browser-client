import hashlib
import json

ACTOR_UNIT_CENSUS_RELATIVE_PATH = 'docs/parts/npcs/actor-unit-census.json'
CENSUS_STEP_NAME = 'census'
CONVERTIBLE_UNIT_STATUS = 'convertible'
GAP_UNIT_STATUS = 'gap'
CONVERSION_PENDING_REASON = 'conversion-pending'
NO_MESH_IN_ROW_REASON = 'no-mesh-in-row'
MULTI_SLOT_BINDING_UNSUPPORTED_REASON = 'multi-slot-binding-unsupported'
NPC_PART_NAME = 'npcs'
NPC_MODEL_UNIT_KIND = 'npc-model'


class ActorUnitInventoryError(ValueError):
    pass


def conversion_unit_key(kind, selection):
    canonical_selection = json.dumps(selection, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
    return kind + ':' + hashlib.sha256(canonical_selection.encode('ascii')).hexdigest()


def decoded_table_rows(decoded_table):
    collections = [value for value in decoded_table['data'].values() if isinstance(value, list)]
    if len(collections) != 1:
        raise ActorUnitInventoryError(f'decoded table {decoded_table["source"]} must hold exactly one row collection')
    return collections[0]


def decoded_table_identity(decoded_table):
    return {'path': decoded_table['source'], 'sha256': decoded_table['sourceSha256']}


def first_gap_reason(reasons):
    return next((reason for reason in reasons if reason is not None), None)


def conversion_unit(key, part, unit_kind, reason, source_identity, selection):
    return {'key': key, 'part': part, 'unitKind': unit_kind, 'status': CONVERTIBLE_UNIT_STATUS if reason is None else GAP_UNIT_STATUS,
            'reason': reason, 'sourceIdentity': source_identity, 'selection': selection}


def census_row(key, part, unit_reason, source_identity):
    return {'key': key, 'part': part, 'step': CENSUS_STEP_NAME,
            'status': 'pending' if unit_reason is None else 'gap',
            'reason': CONVERSION_PENDING_REASON if unit_reason is None else unit_reason,
            'sourceIdentity': source_identity, 'evidence': ACTOR_UNIT_CENSUS_RELATIVE_PATH}


def non_empty_values(values):
    return [value for value in values if value]


def npc_model_gap_reason(selection, package_census):
    textures = non_empty_values(selection['textures'])
    return first_gap_reason((
        package_census.mesh_gap_reason(selection['mesh']),
        *(package_census.texture_gap_reason(texture) for texture in textures),
        MULTI_SLOT_BINDING_UNSUPPORTED_REASON if len(textures) > 1 else None,
    ))


def npc_model_unit(selection, package_census, table_identity):
    return conversion_unit(conversion_unit_key(NPC_MODEL_UNIT_KIND, selection), NPC_PART_NAME, NPC_MODEL_UNIT_KIND,
                           npc_model_gap_reason(selection, package_census),
                           package_census.mesh_source_identity(selection['mesh']) or table_identity, selection)


def npc_units_and_rows(npcgrp, package_census):
    table_identity = decoded_table_identity(npcgrp)
    units_by_key, rows = {}, []
    for npc in decoded_table_rows(npcgrp):
        row_key = f'npc:{npc["npc_id"]}'
        selection = {'mesh': npc['mesh_name'], 'textures': [slot['param_texture_name'] for slot in npc['texture_name']]}
        if not selection['mesh']:
            rows.append(census_row(row_key, NPC_PART_NAME, NO_MESH_IN_ROW_REASON, table_identity))
            continue
        unit_key = conversion_unit_key(NPC_MODEL_UNIT_KIND, selection)
        if unit_key not in units_by_key:
            units_by_key[unit_key] = npc_model_unit(selection, package_census, table_identity)
        rows.append(census_row(row_key, NPC_PART_NAME, units_by_key[unit_key]['reason'], table_identity))
    return list(units_by_key.values()), rows
