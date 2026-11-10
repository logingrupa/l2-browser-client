import json
from pathlib import Path

from native_assets import UMODEL, Converter, implementation_hash
from native_assets_lib.class_defaults import ReferenceClientClassScripts
from native_assets_lib.gltf import json_bytes
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import immutable_write, sha256_hex, verify_store_destinations
from native_store.gap_rows import QUALIFIED_OBJECT_NAME_PATTERN
from native_store.store_paths import confined_child_path, lane_store_root, lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from world.bsp_chunk_geometry import (BSP_POLY_FLAGS_PATH, BspPolygonError, assign_nodes_to_chunks, build_chunk_sections, chunk_bsp_glb, chunk_bsp_record,
                                      drawn_node_indices, fan_triangle_indices, load_bsp_poly_flags, node_source_polygon)
from world.bsp_surface_materials import convert_surface_material, surface_material_identities
from world.level_model import LevelModelLayoutError, read_level_model
from world.level_zones import outdoor_zone_indices, read_level_zones, sky_zone_indices
from world.map_sources import MapSources
from world.native_terrain_sectors import native_terrain
from world.raw_map_step import PRODUCTS_FOLDER_NAME, read_tile_map_lock_record, require_tile_id, tile_map_path, tile_step_row, tile_unit_key
from world.static_mesh_step import STATIC_MESH_CONVERTER_FOLDER, conversion_failure_reason
from world.static_placement import ClassDefaults
from world.static_placement_plan import FAILED_STATUS, chunk_rectangles
from world.tile_census import WORLD_LANE_NAME
from world.tile_census_validation import GAP_STATUS
from world.tile_chunk_plan import read_locked_map_package, sealed_chunk_plan

BSP_STEP_ALGORITHM_VERSION = 1
BSP_STEP_NAME = 'bsp'
BSP_CHUNKS_PRODUCT_NAME = 'bsp-chunks.json'
CHUNK_BSP_FOLDER = 'native-tile-chunk-bsp'
CHUNK_BSP_RESOURCE_NAME = 'bsp.glb'
BSP_NODE_OUTSIDE_CHUNK_GRID_REASON = 'bsp-node-outside-chunk-grid'
UNDECODED_LIGHTMAP_TEXTURE_OF_RECORD = {}


def bsp_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), BSP_STEP_NAME, BSP_STEP_ALGORITHM_VERSION)


def chunk_bsp_store_path(glb_sha256):
    return f'maps/{glb_sha256}/{CHUNK_BSP_FOLDER}/{CHUNK_BSP_RESOURCE_NAME}'


def poly_flags_recipe_sha256():
    return sha256_hex(canonical_json_bytes(json.loads(BSP_POLY_FLAGS_PATH.read_text(encoding='utf-8'))))


def bsp_unit_config(chunks_fingerprint):
    return {'chunksFingerprint': chunks_fingerprint, 'converterSha256': implementation_hash(), 'polyFlagsSha256': poly_flags_recipe_sha256()}


def bsp_product_path(ledger, unit_key):
    return ledger.unit_step_directory(unit_key) / PRODUCTS_FOLDER_NAME / BSP_CHUNKS_PRODUCT_NAME


def current_sealed_receipt(ledger, unit_key, tile_id, config):
    receipt = ledger.sealed_receipt(unit_key)
    if receipt is None or receipt['algorithmVersion'] != BSP_STEP_ALGORITHM_VERSION or receipt['config'] != config:
        return None
    paths = [record['path'] for record in receipt['inputs']]
    if tile_map_path(tile_id) not in paths or locked_input_records(paths) != receipt['inputs']:
        return None
    return receipt


def sealed_bsp_chunks(project_root, tile_id, lock_record):
    chunks_fingerprint, _, _ = sealed_chunk_plan(project_root, tile_id, lock_record)
    ledger, unit_key = bsp_ledger(project_root), tile_unit_key(tile_id)
    receipt = current_sealed_receipt(ledger, unit_key, tile_id, bsp_unit_config(chunks_fingerprint))
    if receipt is None:
        return None, None
    return receipt['fingerprint'], json.loads(bsp_product_path(ledger, unit_key).read_text(encoding='utf-8'))


def tile_bsp_row(tile_id, source_identity, gap_rows, evidence):
    if gap_rows:
        return tile_step_row(tile_id, BSP_STEP_NAME, GAP_STATUS, gap_rows[0]['reason'], source_identity, evidence)
    return tile_step_row(tile_id, BSP_STEP_NAME, 'pass', None, source_identity, evidence)


def object_gap_row(tile_id, source_identity, evidence, status, reason, object_name):
    identity = {**source_identity, 'object': object_name} if QUALIFIED_OBJECT_NAME_PATTERN.fullmatch(object_name or '') else source_identity
    return tile_step_row(tile_id, BSP_STEP_NAME, status, reason, identity, evidence)


class BspGapRows:
    def __init__(self, tile_id, source_identity, evidence):
        self.tile_id, self.source_identity, self.evidence = tile_id, source_identity, evidence
        self.rows_by_identity = {}

    def add(self, status, reason, object_name):
        row = object_gap_row(self.tile_id, self.source_identity, self.evidence, status, reason, object_name)
        self.rows_by_identity.setdefault((reason, object_name or ''), row)
        return self.rows_by_identity[(reason, object_name or '')]

    def rows(self):
        return [self.rows_by_identity[key] for key in sorted(self.rows_by_identity, key=lambda key: (key[1].casefold(), key[0]))]


def drawable_chunk_nodes(model, package, nodes_by_chunk, gaps):
    kept = {}
    for chunk_id, node_indices in nodes_by_chunk.items():
        kept[chunk_id] = []
        for index in node_indices:
            node = model.nodes[index]
            try:
                fan_triangle_indices(node_source_polygon(model, node), node.plane[:3], 0, index)
            except BspPolygonError as error:
                gaps.add(FAILED_STATUS, conversion_failure_reason(error), package.object_name(model.surfs[node.i_surf].actor))
                continue
            kept[chunk_id].append(index)
    return kept


def surface_materials(identities, client, project_root):
    converter = Converter(client, lane_work_root(project_root, WORLD_LANE_NAME) / STATIC_MESH_CONVERTER_FOLDER, UMODEL, project_root=project_root)
    map_sources, class_scripts = MapSources(client), ReferenceClientClassScripts(client)
    store_root, class_work_root = lane_store_root(project_root, WORLD_LANE_NAME), lane_work_root(project_root, WORLD_LANE_NAME)
    return {identity: convert_surface_material(identity, map_sources, converter, class_work_root, class_scripts, store_root)
            for identity in sorted(identities, key=lambda identity: (identity.casefold(), identity))}, map_sources


def material_package_paths(map_sources, identities):
    return sorted({paths[0] for identity in identities if len(paths := map_sources.paths.get(identity.split('.')[0].casefold(), [])) == 1})


def write_chunk_glbs(project_root, chunk_glbs):
    store_root = lane_store_root(project_root, WORLD_LANE_NAME)
    files = {chunk_bsp_store_path(sha256_hex(glb)): glb for glb in chunk_glbs.values()}
    verify_store_destinations(store_root, {relative.casefold(): (relative, payload) for relative, payload in files.items()})
    for relative, payload in files.items():
        immutable_write(confined_child_path(store_root, relative), payload)
    return [{'path': (store_root / relative).relative_to(store_root.parent).as_posix(), 'sha256': sha256_hex(payload), 'bytes': len(payload)}
            for relative, payload in sorted(files.items())]


def material_store_outputs(project_root, outcomes):
    store_root = lane_store_root(project_root, WORLD_LANE_NAME)
    records = {record['path']: record for outcome in outcomes.values() for record in outcome.store_outputs}
    return [{**record, 'path': (store_root / path).relative_to(store_root.parent).as_posix()} for path, record in sorted(records.items())]


def chunk_records(level, chunk_plan, kept_nodes, identities, outcomes, flags, outdoor_zones, gaps):
    records, glbs = {}, {}
    materials = {identity: outcome.material for identity, outcome in outcomes.items()}
    for chunk in chunk_plan['chunks']:
        chunk_id, node_indices = chunk['chunkId'], kept_nodes.get(chunk['chunkId'], [])
        used = sorted({identities[level.model.nodes[index].i_surf] for index in node_indices})
        material_gaps = [gaps.add(GAP_STATUS if reason.startswith('material-') else FAILED_STATUS, reason, identity)
                         for identity in used for reason in outcomes[identity].gap_reasons]
        if not node_indices:
            records[chunk_id] = chunk_bsp_record(chunk_id, None, None, None, 0, [], [], 0, [])
            continue
        sections = build_chunk_sections(level.model, node_indices, identities, flags, UNDECODED_LIGHTMAP_TEXTURE_OF_RECORD, outdoor_zones)
        glb, section_records, node_ranges, triangle_count = chunk_bsp_glb(level.model, chunk_id, sections, materials)
        glbs[chunk_id] = glb
        records[chunk_id] = chunk_bsp_record(chunk_id, '/l2/' + chunk_bsp_store_path(sha256_hex(glb)), sha256_hex(glb), glb, len(node_indices),
                                             section_records, node_ranges, triangle_count, material_gaps)
    return records, glbs


def run_bsp_step(project_root, client_root, tile_id):
    require_tile_id(tile_id)
    lock_record = read_tile_map_lock_record(tile_id)
    source_identity = {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}
    chunks_fingerprint, _, chunk_plan = sealed_chunk_plan(project_root, tile_id, lock_record)
    ledger, unit_key, config = bsp_ledger(project_root), tile_unit_key(tile_id), bsp_unit_config(chunks_fingerprint)
    step_directory = ledger.unit_step_directory(unit_key)
    receipt_evidence = (step_directory / RECEIPT_RECORD_NAME).relative_to(ledger.lane_folder).as_posix()
    step_evidence = step_directory.relative_to(ledger.lane_folder).as_posix()
    if current_sealed_receipt(ledger, unit_key, tile_id, config) is not None:
        return tile_bsp_row(tile_id, source_identity, json.loads(bsp_product_path(ledger, unit_key).read_text(encoding='utf-8'))['gapRows'],
                            receipt_evidence)
    client = Path(client_root).resolve()
    package = read_locked_map_package(client, tile_id, lock_record)
    try:
        level = read_level_model(package)
        rectangles = chunk_rectangles(chunk_plan, native_terrain(package))
        zones = read_level_zones(package, level.model, ClassDefaults(lane_work_root(project_root, WORLD_LANE_NAME), ReferenceClientClassScripts(client)))
    except LevelModelLayoutError as error:
        return tile_step_row(tile_id, BSP_STEP_NAME, GAP_STATUS, error.reason, source_identity, step_evidence)
    except ValueError as error:
        return tile_step_row(tile_id, BSP_STEP_NAME, FAILED_STATUS, conversion_failure_reason(error), source_identity, step_evidence)
    gaps, flags, sky_zones = BspGapRows(tile_id, source_identity, receipt_evidence), load_bsp_poly_flags(), sky_zone_indices(zones)
    outdoor_zones = outdoor_zone_indices(zones)
    drawn = drawn_node_indices(level.model, flags, sky_zones)
    nodes_by_chunk, outside = assign_nodes_to_chunks(level.model, drawn, rectangles)
    for index in outside:
        gaps.add(GAP_STATUS, BSP_NODE_OUTSIDE_CHUNK_GRID_REASON, package.object_name(level.model.surfs[level.model.nodes[index].i_surf].actor))
    kept_nodes = drawable_chunk_nodes(level.model, package, nodes_by_chunk, gaps)
    identities = surface_material_identities(package, level.model)
    used_identities = {identities[level.model.nodes[index].i_surf] for indices in kept_nodes.values() for index in indices}
    outcomes, map_sources = surface_materials(used_identities, client, project_root)
    inputs = locked_input_records(sorted({tile_map_path(tile_id), *material_package_paths(map_sources, used_identities)}))
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    records, glbs = chunk_records(level, chunk_plan, kept_nodes, identities, outcomes, flags, outdoor_zones, gaps)
    gap_rows = gaps.rows()
    product = {'tileId': tile_id, 'levelModel': level.binding['model'], 'nodeCount': len(level.model.nodes), 'drawnNodeCount': len(drawn),
               'outdoorZones': sorted(outdoor_zones), 'skyZones': sorted(sky_zones), 'chunks': records,
               'materials': [{'identity': identity, 'program': outcome.material.program, 'textured': outcome.material.png is not None,
                              'translucent': outcome.material.translucent, 'gapReasons': outcome.gap_reasons}
                             for identity, outcome in sorted(outcomes.items())],
               'gapRows': gap_rows}
    products_directory = ledger.begin(unit_key, fingerprint) / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    outputs = write_chunk_glbs(project_root, glbs) + material_store_outputs(project_root, outcomes)
    product_payload = json_bytes(product)
    product_path = products_directory / BSP_CHUNKS_PRODUCT_NAME
    product_path.write_bytes(product_payload)
    outputs.append({'path': product_path.relative_to(ledger.lane_folder).as_posix(), 'sha256': sha256_hex(product_payload), 'bytes': len(product_payload)})
    ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': inputs, 'outputs': outputs, 'gapRows': gap_rows})
    return tile_bsp_row(tile_id, source_identity, gap_rows, receipt_evidence)
