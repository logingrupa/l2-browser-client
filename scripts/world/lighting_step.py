import json
from pathlib import Path
from typing import NamedTuple

from native_assets import MAX_PAYLOAD
from native_assets_lib.class_defaults import ReferenceClientClassScripts
from native_assets_lib.gltf import json_bytes
from native_catalog.ue2 import FormatError
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import sha256_hex
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from reference_client_guard import require_reference_client
from world.bsp_lightmaps import read_bsp_lightmaps
from world.bsp_step import sealed_bsp_chunks
from world.bsp_visibility_step import tile_node_ranges
from world.collision_step import sealed_collision
from world.environment_program import environment_lock_input_records, read_environment_program
from world.level_model import LevelModelLayoutError, read_level_model
from world.level_zones import read_level_zones
from world.light_actors import read_lighting_actors, read_static_mesh_light_lists, reference_client_class_chains
from world.lighting_payload import (bsp_lightmap_arrays, lighting_records_array, static_mesh_light_list_arrays, terrain_lighting_arrays,
                                    typed_payload_byte_count)
from world.native_terrain_sectors import native_terrain
from world.raw_map_step import PRODUCTS_FOLDER_NAME, read_tile_map_lock_record, require_tile_id, tile_map_path, tile_step_row, tile_unit_key
from world.static_mesh_step import conversion_failure_reason
from world.static_placement import ClassDefaults
from world.static_placement_plan import FAILED_STATUS
from world.struct_property_tag_rules import read_struct_property_tag_rules
from world.terrain_lighting import read_terrain_lighting
from world.tile_census import WORLD_LANE_NAME
from world.tile_census_validation import GAP_STATUS
from world.tile_chunk_plan import read_locked_map_package, sealed_chunk_plan
from world.typed_payload import write_tile_typed_payload_resource

LIGHTING_STEP_ALGORITHM_VERSION = 3
LIGHTING_STEP_NAME = 'lighting'
LIGHTING_PRODUCT_NAME = 'lighting.json'
TILE_LIGHTING_FOLDER = 'native-tile-lighting'
LIGHTING_RECORDS_KIND = 'native-tile-lighting-records'
LIGHTING_RECORDS_SCHEMA_VERSION = 1
LIGHTING_RULES_PATH = Path(__file__).resolve().parents[2] / 'recipes' / 'world' / 'lighting-rules.json'
APPLIED_LIGHTING_RULES = ('lightmap-render-section-texture', 'lightmap-record-layout', 'lightmap-page-layout', 'lightmap-render-vertex-uv',
                          'bsp-lightmap-slot', 'static-mesh-instance-layout', 'terrain-sector-lighting-layout', 'time-slot-center')
LIGHTING_PAYLOAD_TOO_LARGE_REASON = 'lighting-payload-too-large'
WATER_VOLUME_UNLINKED_REASON_PREFIX = 'lighting-water-volume-unlinked:'
CLASS_CHAIN_UNRESOLVED_REASON_PREFIX = 'lighting-class-chain-unresolved:'


class LightingUnit(NamedTuple):
    ledger: object
    unit_key: str
    fingerprint: str
    config: dict
    inputs: list
    raw_products: Path
    chunk_plan: dict
    bsp: dict
    collision: dict


def load_lighting_rules():
    document = json.loads(LIGHTING_RULES_PATH.read_text(encoding='utf-8'))
    rules = {row['id']: row for row in document['rows']}
    missing = [rule for rule in APPLIED_LIGHTING_RULES if rule not in rules]
    if missing:
        raise FormatError(f'recipes/world/lighting-rules.json has no row for the applied rules {missing}')
    return document


def lighting_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), LIGHTING_STEP_NAME, LIGHTING_STEP_ALGORITHM_VERSION)


def lighting_converter_version():
    return f'{Path(__file__).name}:{LIGHTING_STEP_ALGORITHM_VERSION}'


def lighting_unit(project_root, tile_id, lock_record):
    chunks_fingerprint, raw_products, chunk_plan = sealed_chunk_plan(project_root, tile_id, lock_record)
    bsp_fingerprint, bsp = sealed_bsp_chunks(project_root, tile_id, lock_record)
    collision_fingerprint, collision = sealed_collision(project_root, tile_id, lock_record)
    config = {'chunksFingerprint': chunks_fingerprint, 'bspFingerprint': bsp_fingerprint, 'collisionFingerprint': collision_fingerprint,
              'rulesSha256': sha256_hex(canonical_json_bytes(load_lighting_rules())), 'structPropertyRulesSha256': read_struct_property_tag_rules().sha256}
    inputs = sorted([*locked_input_records([tile_map_path(tile_id)]), *environment_lock_input_records()], key=lambda record: record['path'])
    ledger = lighting_ledger(project_root)
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    return LightingUnit(ledger, tile_unit_key(tile_id), fingerprint, config, inputs, raw_products, chunk_plan, bsp, collision)


def lighting_product_path(ledger, unit_key):
    return ledger.unit_step_directory(unit_key) / PRODUCTS_FOLDER_NAME / LIGHTING_PRODUCT_NAME


def sealed_lighting(project_root, tile_id, lock_record):
    unit = lighting_unit(project_root, tile_id, lock_record)
    if not unit.ledger.is_sealed(unit.unit_key, unit.fingerprint):
        return None, None
    return unit.fingerprint, json.loads(lighting_product_path(unit.ledger, unit.unit_key).read_text(encoding='utf-8'))


def tile_lighting_row(tile_id, source_identity, gap_rows, evidence):
    if gap_rows:
        return tile_step_row(tile_id, LIGHTING_STEP_NAME, GAP_STATUS, gap_rows[0]['reason'], source_identity, evidence)
    return tile_step_row(tile_id, LIGHTING_STEP_NAME, 'pass', None, source_identity, evidence)


def lighting_gap_rows(tile_id, source_identity, evidence, reasons):
    return [tile_step_row(tile_id, LIGHTING_STEP_NAME, GAP_STATUS, reason, source_identity, evidence) for reason in reasons]


def water_volume_unlinked_reason(class_object):
    return f'{WATER_VOLUME_UNLINKED_REASON_PREFIX}{class_object}'


def class_chain_unresolved_reasons(unresolved_classes):
    return [f'{CLASS_CHAIN_UNRESOLVED_REASON_PREFIX}{class_object}' for class_object in unresolved_classes]


def water_volume_links(water_volumes, collision):
    volumes_by_export = {volume['exportIndex']: volume for volume in collision['volumes']}
    links = []
    for water_volume in water_volumes:
        volume = volumes_by_export.get(water_volume.export_index)
        links.append({**water_volume.to_record(), 'volsChunkId': None if volume is None else volume['chunkId'],
                      'volsDecision': None if volume is None else volume['decision']})
    reasons = sorted({water_volume_unlinked_reason(link['actorClass']) for link in links if link['volsDecision'] is None})
    return links, reasons


def lighting_records(actors, zones, water_volumes, program, rules):
    return {'schemaVersion': LIGHTING_RECORDS_SCHEMA_VERSION, 'kind': LIGHTING_RECORDS_KIND, 'lights': [light.to_record() for light in actors.lights],
            'fogInfos': [fog_info.to_record() for fog_info in actors.fog_infos],
            'levelInfos': [level_info.to_record() for level_info in actors.level_infos], 'zones': [zone.to_record() for zone in zones],
            'waterVolumes': water_volumes, 'environmentProgram': program, 'rules': rules['rows']}


def tile_lighting_payload(package, client, unit, class_defaults):
    model = read_level_model(package).model
    lightmaps = read_bsp_lightmaps(package, model)
    bsp_arrays, reasons, bsp_counts = bsp_lightmap_arrays(package, lightmaps, model, tile_node_ranges(unit.bsp, unit.chunk_plan))
    actors = json.loads((unit.raw_products / 'actors.json').read_text(encoding='utf-8'))
    class_chains = reference_client_class_chains(class_defaults)
    lighting_actors = read_lighting_actors(package, model, actors, class_chains)
    light_lists = read_static_mesh_light_lists(package, actors)
    sectors = read_terrain_lighting(package, native_terrain(package))
    program = read_environment_program(require_reference_client(client))
    water_volumes, water_reasons = water_volume_links(lighting_actors.water_volumes, unit.collision)
    records = lighting_records(lighting_actors, read_level_zones(package, model, class_defaults), water_volumes, program, load_lighting_rules())
    arrays = [*bsp_arrays, *static_mesh_light_list_arrays(light_lists), *terrain_lighting_arrays(sectors), lighting_records_array(records)]
    counts = {'bspLightmaps': bsp_counts, 'lights': len(lighting_actors.lights), 'fogInfos': len(lighting_actors.fog_infos),
              'levelInfos': len(lighting_actors.level_infos), 'zones': len(records['zones']),
              'waterVolumes': len(records['waterVolumes']), 'staticMeshLightLists': len(light_lists),
              'staticMeshSceneLights': sum(len(light_list.scene_lights) for light_list in light_lists),
              'staticMeshEnvironmentLights': sum(len(light_list.environment_lights) for light_list in light_lists),
              'terrainSectors': len(sectors), 'terrainSectorLights': sum(len(sector.lights) for sector in sectors),
              'terrainShadowMaps': sum(len(sector.shadow_maps) for sector in sectors),
              'environmentTypes': len(program['environmentTypes']), 'unresolvedEnvironmentFiles': program['unresolved']}
    chain_reasons = class_chain_unresolved_reasons(lighting_actors.unresolved_classes)
    return arrays, sorted({*reasons, *program['unresolved'], *water_reasons, *chain_reasons}), counts


def run_lighting_step(project_root, client_root, tile_id):
    require_tile_id(tile_id)
    lock_record = read_tile_map_lock_record(tile_id)
    source_identity = {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}
    unit = lighting_unit(project_root, tile_id, lock_record)
    step_directory = unit.ledger.unit_step_directory(unit.unit_key)
    receipt_evidence = (step_directory / RECEIPT_RECORD_NAME).relative_to(unit.ledger.lane_folder).as_posix()
    step_evidence = step_directory.relative_to(unit.ledger.lane_folder).as_posix()
    if unit.ledger.is_sealed(unit.unit_key, unit.fingerprint):
        product = json.loads(lighting_product_path(unit.ledger, unit.unit_key).read_text(encoding='utf-8'))
        return tile_lighting_row(tile_id, source_identity, product['gapRows'], receipt_evidence)
    if unit.bsp is None or unit.collision is None:
        raise FormatError(f'lighting of {unit.unit_key} needs sealed bsp and collision units; run --step bsp and --step collision first')
    client = Path(client_root).resolve()
    package = read_locked_map_package(client, tile_id, lock_record)
    class_defaults = ClassDefaults(lane_work_root(project_root, WORLD_LANE_NAME), ReferenceClientClassScripts(client))
    try:
        arrays, reasons, counts = tile_lighting_payload(package, client, unit, class_defaults)
    except LevelModelLayoutError as error:
        return tile_step_row(tile_id, LIGHTING_STEP_NAME, GAP_STATUS, error.reason, source_identity, step_evidence)
    except FormatError as error:
        return tile_step_row(tile_id, LIGHTING_STEP_NAME, FAILED_STATUS, conversion_failure_reason(error), source_identity, step_evidence)
    payload_bytes = typed_payload_byte_count(arrays)
    if payload_bytes > MAX_PAYLOAD:
        return tile_step_row(tile_id, LIGHTING_STEP_NAME, FAILED_STATUS, LIGHTING_PAYLOAD_TOO_LARGE_REASON, source_identity, step_evidence)
    metadata = {'sourceSha256': lock_record['eSha256'], 'converterVersion': lighting_converter_version()}
    products_directory = unit.ledger.begin(unit.unit_key, unit.fingerprint) / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    resource, outputs = write_tile_typed_payload_resource(lane_store_root(project_root, WORLD_LANE_NAME), TILE_LIGHTING_FOLDER, arrays, metadata)
    gap_rows = lighting_gap_rows(tile_id, source_identity, receipt_evidence, reasons)
    product = {'tileId': tile_id, 'resource': resource, 'payloadBytes': payload_bytes, 'counts': counts, 'gapRows': gap_rows}
    product_payload = json_bytes(product)
    product_path = products_directory / LIGHTING_PRODUCT_NAME
    product_path.write_bytes(product_payload)
    outputs.append({'path': product_path.relative_to(unit.ledger.lane_folder).as_posix(), 'sha256': sha256_hex(product_payload),
                    'bytes': len(product_payload)})
    unit.ledger.seal(unit.unit_key, unit.fingerprint, {'config': unit.config, 'inputs': unit.inputs, 'outputs': outputs, 'gapRows': gap_rows})
    return tile_lighting_row(tile_id, source_identity, gap_rows, receipt_evidence)
