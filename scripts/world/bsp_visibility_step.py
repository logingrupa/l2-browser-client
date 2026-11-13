import json
from pathlib import Path
from typing import NamedTuple

from native_assets_lib.class_defaults import ReferenceClientClassScripts
from native_assets_lib.gltf import json_bytes
from native_catalog.ue2 import FormatError
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import sha256_hex
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from world.bsp_chunk_geometry import BSP_POLY_FLAGS_PATH
from world.bsp_leaf_membership import solidity_disagreements
from world.bsp_step import sealed_bsp_chunks
from world.bsp_visibility_payload import bsp_visibility_arrays, portal_node_indices, require_visibility_model, visibility_outdoor_zones
from world.level_model import LevelModelLayoutError, LevelModelRangeError, read_level_model
from world.level_zones import read_level_zones, sky_zone_indices
from world.map_emitter_step import sealed_map_emitters
from world.raw_map_step import PRODUCTS_FOLDER_NAME, read_tile_map_lock_record, require_tile_id, tile_map_path, tile_step_row, tile_unit_key
from world.static_mesh_step import sealed_static_meshes
from world.static_placement import ClassDefaults
from world.struct_property_tag_rules import read_struct_property_tag_rules
from world.tile_census import WORLD_LANE_NAME
from world.tile_census_validation import GAP_STATUS
from world.tile_chunk_plan import read_locked_map_package, sealed_chunk_plan
from world.typed_payload import write_tile_typed_payload_resource
from world.visibility_members import map_emitter_members, static_mesh_members

BSP_VISIBILITY_STEP_ALGORITHM_VERSION = 3
BSP_VISIBILITY_STEP_NAME = 'bsp-visibility'
BSP_VISIBILITY_PRODUCT_NAME = 'bsp-visibility.json'
TILE_BSP_VISIBILITY_FOLDER = 'native-tile-bsp-visibility'
BSP_VISIBILITY_RULES_PATH = Path(__file__).resolve().parents[2] / 'recipes' / 'world' / 'bsp-visibility.json'
MODEL_UNREADABLE_REASON_PREFIX = 'bsp-visibility-model-unreadable:'
SOLIDITY_DISAGREEMENT_REASON = 'bsp-visibility-solidity-disagreement'
POINT_CHECK_NOT_CSG_RULE = 'point-check-not-csg-node-flags'
PORTAL_FLAG_RULE = 'pf-portal'
PORTAL_FLAG_NAME = 'PF_PORTAL'
ZONE_ONE_FALLBACK_RULE = 'outdoor-zone1-fallback'
STATIC_MESH_MARGIN_RULE = 'static-mesh-margin'


class BspVisibilityUnit(NamedTuple):
    ledger: object
    unit_key: str
    fingerprint: str
    config: dict
    inputs: list
    raw_products: Path
    chunk_plan: dict
    bsp: dict
    static_meshes: dict
    map_emitters: dict


def load_bsp_visibility_rules():
    document = json.loads(BSP_VISIBILITY_RULES_PATH.read_text(encoding='utf-8'))
    return document, {row['id']: row for row in document['rows']}


def bsp_visibility_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), BSP_VISIBILITY_STEP_NAME, BSP_VISIBILITY_STEP_ALGORITHM_VERSION)


def bsp_visibility_converter_version():
    return f'{Path(__file__).name}:{BSP_VISIBILITY_STEP_ALGORITHM_VERSION}'


def bsp_visibility_unit(project_root, tile_id, lock_record):
    _, raw_products, chunk_plan = sealed_chunk_plan(project_root, tile_id, lock_record)
    bsp_fingerprint, bsp = sealed_bsp_chunks(project_root, tile_id, lock_record)
    meshes_fingerprint, static_meshes = sealed_static_meshes(project_root, tile_id, lock_record)
    emitters_fingerprint, map_emitters = sealed_map_emitters(project_root, tile_id, lock_record)
    document, _ = load_bsp_visibility_rules()
    config = {'bspFingerprint': bsp_fingerprint, 'meshesFingerprint': meshes_fingerprint, 'emittersFingerprint': emitters_fingerprint,
              'rulesSha256': sha256_hex(canonical_json_bytes(document)), 'structPropertyRulesSha256': read_struct_property_tag_rules().sha256}
    inputs = locked_input_records([tile_map_path(tile_id)])
    ledger = bsp_visibility_ledger(project_root)
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    return BspVisibilityUnit(ledger, tile_unit_key(tile_id), fingerprint, config, inputs, raw_products, chunk_plan, bsp, static_meshes, map_emitters)


def bsp_visibility_product_path(ledger, unit_key):
    return ledger.unit_step_directory(unit_key) / PRODUCTS_FOLDER_NAME / BSP_VISIBILITY_PRODUCT_NAME


def sealed_bsp_visibility(project_root, tile_id, lock_record):
    unit = bsp_visibility_unit(project_root, tile_id, lock_record)
    if not unit.ledger.is_sealed(unit.unit_key, unit.fingerprint):
        return None, None
    return unit.fingerprint, json.loads(bsp_visibility_product_path(unit.ledger, unit.unit_key).read_text(encoding='utf-8'))


def tile_bsp_visibility_row(tile_id, source_identity, gap_rows, evidence):
    if gap_rows:
        return tile_step_row(tile_id, BSP_VISIBILITY_STEP_NAME, GAP_STATUS, gap_rows[0]['reason'], source_identity, evidence)
    return tile_step_row(tile_id, BSP_VISIBILITY_STEP_NAME, 'pass', None, source_identity, evidence)


def model_unreadable_reason(error):
    return MODEL_UNREADABLE_REASON_PREFIX + error.field


def tile_node_ranges(bsp, chunk_plan):
    return [{'chunk': chunk_ordinal, **{field: node_range[field] for field in ('node', 'primitive', 'firstIndex', 'indexCount')}}
            for chunk_ordinal, chunk in enumerate(chunk_plan['chunks']) for node_range in bsp['chunks'][chunk['chunkId']]['nodeRanges']]


def store_model_reader(store_root, static_meshes):
    files = {model['id']: model['model']['file'] for model in static_meshes['models']}
    return lambda model_id: (store_root / files[model_id]).read_bytes()


def visibility_counts(model, zones, portal_nodes, node_ranges, members):
    return {'nodes': len(model.nodes), 'leaves': len(model.leaves), 'zones': len(zones), 'bounds': len(model.model_bounds),
            'portals': len(portal_nodes), 'nodeRanges': len(node_ranges), 'members': len(members)}


def sourced_portal_flag(rules):
    portal_flag = rules[PORTAL_FLAG_RULE]['runtimeDefault']
    sourced = [row['value'] for row in json.loads(BSP_POLY_FLAGS_PATH.read_text(encoding='utf-8'))['flags'] if row['name'] == PORTAL_FLAG_NAME]
    if sourced != [portal_flag]:
        raise FormatError(f'{PORTAL_FLAG_RULE} {portal_flag} differs from the sourced {PORTAL_FLAG_NAME} row of recipes/world/bsp-poly-flags.json: {sourced}')
    return portal_flag


def tile_visibility_payload(model, zones, rules, node_ranges, members):
    require_visibility_model(model, zones)
    outdoor_zones = visibility_outdoor_zones(zones, rules[ZONE_ONE_FALLBACK_RULE]['runtimeDefault'] is True)
    portal_nodes = portal_node_indices(model, sourced_portal_flag(rules))
    arrays = bsp_visibility_arrays(model, zones, outdoor_zones, portal_nodes, node_ranges, members)
    return arrays, outdoor_zones, visibility_counts(model, zones, portal_nodes, node_ranges, members)


def solidity_census(model, document, rules):
    cells_per_axis = tuple(document['censusSampleGrid']['cellsPerAxis'])
    disagreements = solidity_disagreements(model, cells_per_axis, rules[POINT_CHECK_NOT_CSG_RULE]['runtimeDefault'])
    return {'cellsPerAxis': list(cells_per_axis), 'disagreements': [record.to_record() for record in disagreements]}


def solidity_gap_rows(tile_id, source_identity, evidence, census):
    if not census['disagreements']:
        return []
    return [tile_step_row(tile_id, BSP_VISIBILITY_STEP_NAME, GAP_STATUS, SOLIDITY_DISAGREEMENT_REASON, source_identity, evidence)]


def run_bsp_visibility_step(project_root, client_root, tile_id):
    require_tile_id(tile_id)
    lock_record = read_tile_map_lock_record(tile_id)
    source_identity = {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}
    unit = bsp_visibility_unit(project_root, tile_id, lock_record)
    step_directory = unit.ledger.unit_step_directory(unit.unit_key)
    receipt_evidence = (step_directory / RECEIPT_RECORD_NAME).relative_to(unit.ledger.lane_folder).as_posix()
    step_evidence = step_directory.relative_to(unit.ledger.lane_folder).as_posix()
    if unit.ledger.is_sealed(unit.unit_key, unit.fingerprint):
        product = json.loads(bsp_visibility_product_path(unit.ledger, unit.unit_key).read_text(encoding='utf-8'))
        return tile_bsp_visibility_row(tile_id, source_identity, product['gapRows'], receipt_evidence)
    if unit.bsp is None or unit.static_meshes is None or unit.map_emitters is None:
        raise FormatError(f'bsp-visibility of {unit.unit_key} needs sealed bsp, meshes and emitters units; run --step meshes, --step bsp and '
                          '--step emitters first')
    client = Path(client_root).resolve()
    package = read_locked_map_package(client, tile_id, lock_record)
    document, rules = load_bsp_visibility_rules()
    class_defaults = ClassDefaults(lane_work_root(project_root, WORLD_LANE_NAME), ReferenceClientClassScripts(client))
    actors_by_object = {actor['object']: actor for actor in json.loads((unit.raw_products / 'actors.json').read_text(encoding='utf-8'))}
    store_root = lane_store_root(project_root, WORLD_LANE_NAME)
    try:
        model = read_level_model(package).model
        zones = read_level_zones(package, model, class_defaults)
        sky_zones = sky_zone_indices(zones)
        members = [*static_mesh_members(model, unit.static_meshes, actors_by_object, class_defaults, store_model_reader(store_root, unit.static_meshes),
                                        rules[STATIC_MESH_MARGIN_RULE]['runtimeDefault'], sky_zones),
                   *map_emitter_members(model, unit.map_emitters, sky_zones)]
        node_ranges = tile_node_ranges(unit.bsp, unit.chunk_plan)
        arrays, outdoor_zones, counts = tile_visibility_payload(model, zones, rules, node_ranges, members)
    except LevelModelLayoutError as error:
        return tile_step_row(tile_id, BSP_VISIBILITY_STEP_NAME, GAP_STATUS, error.reason, source_identity, step_evidence)
    except LevelModelRangeError as error:
        return tile_step_row(tile_id, BSP_VISIBILITY_STEP_NAME, GAP_STATUS, model_unreadable_reason(error), source_identity, step_evidence)
    metadata = {'sourceSha256': lock_record['eSha256'], 'converterVersion': bsp_visibility_converter_version()}
    products_directory = unit.ledger.begin(unit.unit_key, unit.fingerprint) / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    resource, outputs = write_tile_typed_payload_resource(store_root, TILE_BSP_VISIBILITY_FOLDER, arrays, metadata)
    census = solidity_census(model, document, rules)
    gap_rows = solidity_gap_rows(tile_id, source_identity, receipt_evidence, census)
    product = {'tileId': tile_id, 'resource': resource, 'counts': counts, 'visibilityOutdoorZones': sorted(outdoor_zones),
               'zones': [zone.to_record() for zone in zones], 'members': [member.to_record() for member in members], 'solidity': census,
               'gapRows': gap_rows}
    product_payload = json_bytes(product)
    product_path = products_directory / BSP_VISIBILITY_PRODUCT_NAME
    product_path.write_bytes(product_payload)
    outputs.append({'path': product_path.relative_to(unit.ledger.lane_folder).as_posix(), 'sha256': sha256_hex(product_payload),
                    'bytes': len(product_payload)})
    unit.ledger.seal(unit.unit_key, unit.fingerprint, {'config': unit.config, 'inputs': unit.inputs, 'outputs': outputs, 'gapRows': gap_rows})
    return tile_bsp_visibility_row(tile_id, source_identity, gap_rows, receipt_evidence)
