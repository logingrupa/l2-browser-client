from __future__ import annotations

from functools import cached_property
import re

from native_store.catalog_index_keys import (ITEM_MODEL_RECORD_ID_PATTERN, SKILL_EFFECT_COMPONENT_ID_PATTERN,
                                             legacy_single_mesh_candidate_model_ids_by_source_object, model_source_objects_by_id,
                                             npc_profile_model_id, npc_profile_npc_key, read_profile_manifest_profiles, store_root_candidates,
                                             validated_slice_records)
from native_store.catalog_writer import read_pinned_file, require_file_pin
from native_store.verified_file_writes import CatalogWriteError
from side_by_side.pair_queue_union import PairQueueError, decode_strict_store_json, read_strict_json_file

TILE_CENSUS_PATH = 'docs/parts/world/tile-census.json'
WINDOW_CENSUS_PATH = 'docs/parts/ui/interface-window-census.json'
ACTOR_UNIT_CENSUS_PATH = 'docs/parts/npcs/actor-unit-census.json'
ITEM_CENSUS_PATH = 'docs/parts/items/item-census.json'
NPC_NAME_TABLE_ID = 'npcname-e'
NPC_NAME_ROWS_FIELD = 'npc'
DRAW_STYLE_FIELD = 'DrawStyle'
MINIMAP_RESOURCE_KIND = 'minimap'
WEAPON_UNIT_KIND = 'weapon-mesh'
ARMOR_UNIT_KIND = 'armor-mesh'
RADAR_WINDOW_FUNCTION_PATTERN = re.compile(r'^[A-Za-z]\w*\.(?P<window>[A-Za-z]\w*)\.[A-Za-z]\w*$')


def census_list(project_root, relative_path, field):
    document = read_strict_json_file(project_root / relative_path, relative_path)
    values = document.get(field) if isinstance(document, dict) else None
    if not (isinstance(values, list) and all(isinstance(value, dict) for value in values)):
        raise PairQueueError(f'{relative_path} must hold a {field} list of objects')
    return values


def unique_index(values, field, label):
    indexed = {}
    for value in values:
        if value.get(field) in indexed:
            raise PairQueueError(f'{label} lists {field} {value.get(field)!r} twice')
        indexed[value.get(field)] = value
    return indexed


class PairQueueKeyFacts:
    def __init__(self, union):
        self.union = union
        self.project_root = union.project_root
        self.manifests_by_sha256 = {}

    def pinned_manifest(self, record, label):
        if record['manifestSha256'] not in self.manifests_by_sha256:
            try:
                payload = read_pinned_file(self.union.store_root, require_file_pin(record, 'manifest', 'manifestSha256', None, label))
            except CatalogWriteError as error:
                raise PairQueueError(f'{label} manifest is not readable: {error}') from error
            self.manifests_by_sha256[record['manifestSha256']] = decode_strict_store_json(payload, f'{label} manifest')
        return self.manifests_by_sha256[record['manifestSha256']]

    @cached_property
    def models_by_id(self):
        return {model['id']: model for model in validated_slice_records(self.union.catalog, 'models')}

    @cached_property
    def actor_units_by_key(self):
        return unique_index(census_list(self.project_root, ACTOR_UNIT_CENSUS_PATH, 'units'), 'key', ACTOR_UNIT_CENSUS_PATH)

    @cached_property
    def npc_model_ids_by_key(self):
        source_objects_by_model_id = model_source_objects_by_id(self.models_by_id.values())
        model_ids_by_object = legacy_single_mesh_candidate_model_ids_by_source_object(source_objects_by_model_id)
        store_roots = store_root_candidates(self.union.store_root, None)
        model_ids_by_key = {}
        for pack_record in validated_slice_records(self.union.catalog, 'npcProfiles'):
            for profile in read_profile_manifest_profiles('npcProfiles', pack_record, store_roots):
                model_id = npc_profile_model_id(pack_record['id'], profile, source_objects_by_model_id, model_ids_by_object)
                if model_id is not None:
                    model_ids_by_key[npc_profile_npc_key(profile)] = model_id
        return model_ids_by_key

    def npc_selection(self, key):
        model_id = self.npc_model_ids_by_key[key]
        unit = self.actor_units_by_key.get(model_id)
        if unit is None:
            raise PairQueueError(f'{key} joins model {model_id}, which {ACTOR_UNIT_CENSUS_PATH} does not hold')
        selection = unit['selection']
        if not (isinstance(selection.get('mesh'), str) and isinstance(selection.get('textures'), list)):
            raise PairQueueError(f'{ACTOR_UNIT_CENSUS_PATH} unit {model_id} selection needs a mesh text and a texture list')
        return selection

    def npc_texture_texts(self, key):
        return [texture for texture in self.npc_selection(key)['textures'] if texture]

    @cached_property
    def npc_names_by_id(self):
        tables = unique_index(validated_slice_records(self.union.catalog, 'tables'), 'id', 'union tables slice')
        if NPC_NAME_TABLE_ID not in tables:
            raise PairQueueError(f'the union catalog has no decoded {NPC_NAME_TABLE_ID} table')
        rows = self.pinned_manifest(tables[NPC_NAME_TABLE_ID], f'table {NPC_NAME_TABLE_ID}').get('records', {}).get(NPC_NAME_ROWS_FIELD)
        if not (isinstance(rows, list) and all(isinstance(row, dict) and type(row.get('id')) is int and isinstance(row.get('name'), str)
                                               for row in rows)):
            raise PairQueueError(f'decoded {NPC_NAME_TABLE_ID} records.{NPC_NAME_ROWS_FIELD} must be rows with an integer id and a name')
        return {row['id']: row['name'] for row in unique_index(rows, 'id', f'decoded {NPC_NAME_TABLE_ID}').values()}

    def npc_name(self, key):
        npc_id = int(key.split(':', 1)[1])
        if npc_id not in self.npc_names_by_id:
            raise PairQueueError(f'decoded {NPC_NAME_TABLE_ID} has no row for {key}')
        return self.npc_names_by_id[npc_id]

    @cached_property
    def item_model_ids_by_key(self):
        model_ids_by_key = {}
        for model_id in self.models_by_id:
            match = ITEM_MODEL_RECORD_ID_PATTERN.fullmatch(model_id)
            if match:
                model_ids_by_key.setdefault(f'item:{match["item"]}', []).append(model_id)
        return {key: sorted(model_ids) for key, model_ids in model_ids_by_key.items()}

    @cached_property
    def item_unit_keys_by_record_id(self):
        unit_keys_by_record_id = {}
        for sealed_unit in census_list(self.project_root, ITEM_CENSUS_PATH, 'sealedUnits'):
            for record_id in sealed_unit.get('recordIds', []):
                unit_keys_by_record_id[record_id] = sealed_unit['unitKey']
        return unit_keys_by_record_id

    def item_record_units(self, key):
        units = []
        for record_id in self.item_model_ids_by_key[key]:
            unit = self.actor_units_by_key.get(self.item_unit_keys_by_record_id.get(record_id))
            if unit is None or unit['unitKind'] not in (WEAPON_UNIT_KIND, ARMOR_UNIT_KIND):
                raise PairQueueError(f'{key} model record {record_id} joins no weapon or armor unit of {ITEM_CENSUS_PATH} and '
                                     f'{ACTOR_UNIT_CENSUS_PATH}')
            units.append(unit)
        return units

    def item_packages(self, key):
        return sorted({self.models_by_id[model_id]['source']['package'] for model_id in self.item_model_ids_by_key[key]})

    def npc_packages(self, key):
        return [self.models_by_id[self.npc_model_ids_by_key[key]]['source']['package']]

    @cached_property
    def armor_columns(self):
        return frozenset(unit['selection'].get('column') for unit in self.actor_units_by_key.values() if unit['unitKind'] == ARMOR_UNIT_KIND)

    @cached_property
    def skill_component_records_by_key(self):
        records_by_key = {}
        for record in validated_slice_records(self.union.catalog, 'effectComponents'):
            match = SKILL_EFFECT_COMPONENT_ID_PATTERN.match(record['id'])
            if match:
                records_by_key.setdefault(f'skill:{match["skill"]}:{match["level"]}', []).append(record)
        return records_by_key

    def skill_components(self, key):
        components = []
        for record in self.skill_component_records_by_key[key]:
            manifest = self.pinned_manifest(record, f'effect component {record["id"]}')
            if not (isinstance(manifest.get('components'), list) and all(isinstance(component, dict) for component in manifest['components'])):
                raise PairQueueError(f'effect component {record["id"]} manifest needs a components list')
            components.extend((manifest, component) for component in manifest['components'])
        return components

    def skill_component_classes(self, key):
        return sorted({component.get('class') for _, component in self.skill_components(key)})

    def skill_draw_styles(self, key):
        return {effective_draw_style(manifest, component) for manifest, component in self.skill_components(key)} - {None}

    @cached_property
    def tile_census_by_key(self):
        return unique_index(census_list(self.project_root, TILE_CENSUS_PATH, 'maps'), 'key', TILE_CENSUS_PATH)

    def tile_licensee(self, key):
        if key not in self.tile_census_by_key:
            raise PairQueueError(f'{TILE_CENSUS_PATH} has no row for {key}')
        return self.tile_census_by_key[key]['licensee']

    @cached_property
    def tile_records_by_key(self):
        return {f'tile:{record["id"]}': record for record in validated_slice_records(self.union.catalog, 'tiles')}

    def tile_minimap_resource(self, key):
        manifest = self.pinned_manifest(self.tile_records_by_key[key], f'tile {key}')
        resources = [resource for resource in manifest.get('resources', [])
                     if isinstance(resource, dict) and resource.get('kind') == MINIMAP_RESOURCE_KIND]
        if len(resources) > 1:
            raise PairQueueError(f'tile {key} manifest pins {len(resources)} minimap resources; a tile pins at most one')
        return resources[0] if resources else None

    def minimap_window_id(self, key):
        tile_minimap = self.pinned_manifest(self.tile_minimap_resource(key), f'tile {key} minimap')
        route = tile_minimap.get('route')
        if not isinstance(route, dict):
            raise PairQueueError(f'tile {key} minimap manifest pins no minimap route')
        radar = self.pinned_manifest(route, f'tile {key} minimap route').get('radar', {})
        function = radar.get('getLocInfo', {}).get('function') if isinstance(radar, dict) else None
        match = RADAR_WINDOW_FUNCTION_PATTERN.fullmatch(function) if isinstance(function, str) else None
        if match is None or match['window'] not in self.window_types_by_id:
            raise PairQueueError(f'tile {key} minimap route radar getLocInfo function {function!r} names no interface window of '
                                 f'{WINDOW_CENSUS_PATH}')
        return match['window']

    @cached_property
    def window_types_by_id(self):
        return {window_id: window['type'] for window_id, window
                in unique_index(census_list(self.project_root, WINDOW_CENSUS_PATH, 'windows'), 'windowId', WINDOW_CENSUS_PATH).items()}

    def window_type(self, key):
        window_id = key.split(':', 1)[1]
        if window_id not in self.window_types_by_id:
            raise PairQueueError(f'{WINDOW_CENSUS_PATH} has no window {window_id}')
        return self.window_types_by_id[window_id]


def enum_value_of_symbol(manifest, symbol):
    values = {enum_values[symbol] for class_enums in manifest.get('classEnums', []) if isinstance(class_enums, dict)
              for enum_values in class_enums.get('enums', {}).values() if isinstance(enum_values, dict) and symbol in enum_values}
    if len(values) != 1:
        raise PairQueueError(f'effect manifest {manifest.get("id")!r} classEnums give {len(values)} values for the symbol {symbol!r}')
    return next(iter(values))


def effective_draw_style(manifest, component):
    value = component.get('effectiveProperties', {}).get(DRAW_STYLE_FIELD)
    if isinstance(value, dict) and isinstance(value.get('symbol'), str):
        value = value['symbol']
    if isinstance(value, str):
        return enum_value_of_symbol(manifest, value)
    if value is None or type(value) is int:
        return value
    raise PairQueueError(f'effect manifest {manifest.get("id")!r} component {component.get("object")!r} DrawStyle is neither an integer '
                         f'nor an enum symbol: {value!r}')
