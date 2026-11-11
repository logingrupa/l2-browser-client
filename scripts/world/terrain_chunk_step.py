import copy
import hashlib
import json
from pathlib import Path
from typing import NamedTuple

from native_catalog.ue2 import FormatError
from native_store.canonical_json import canonical_json_bytes
from native_store.store_paths import lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from world.map_actor_properties import property_value
from world.map_sources import safe_path
from world.native_terrain_sectors import (read_height_samples, read_topology_words, sector_oracle, select_terrain_sectors,
                                          source_backed_terrain_points, native_terrain)
from world.raw_map_step import PRODUCTS_FOLDER_NAME, read_tile_map_lock_record, require_tile_id, tile_map_path, tile_step_row, tile_unit_key
from world.static_placement import read_class_evidence, require_terrain_not_inverted
from world.terrain_layers import (QUALIFIED_MASK_UV_FORMULA, QUALIFIED_MASK_UV_RULE_ID, is_empty_layer_slot, layer_records,
                                  terrain_layer_gap_reasons)
from world.terrain_rectangle_mesh import build_terrain_rectangle_gltf
from world.terrain_seam_strip import (seam_gap_statuses, seam_neighbour_inputs, seam_strip_summary, terrain_seam_rules_sha256,
                                      terrain_seam_strip)
from world.tile_census import WORLD_LANE_NAME, WORLD_PART_NAME
from world.tile_census_validation import GAP_STATUS
from world.tile_chunk_plan import read_locked_map_package, read_raw_terrain_record, sealed_chunk_plan, serialized_location

TERRAIN_CHUNK_STEP_ALGORITHM_VERSION = 3
TERRAIN_STEP_NAME = 'terrain'
TERRAIN_CHUNK_INDEX_PRODUCT_NAME = 'terrain-chunks.json'
TERRAIN_CHUNK_RESOURCE_NAME = 'terrain.glb'
CACHED_SECTOR_BOUNDS_POLICY = 'require-xy-preserve-z-discrepancies'
EXTRAPOLATED_MASK_UV_STATUS = 'extrapolated'
TERRAIN_CHUNK_GLTF_GENERATOR = Path(__file__).name


class TerrainChunkStepError(ValueError):
    pass


class TerrainUnit(NamedTuple):
    ledger: object
    unit_key: str
    fingerprint: str
    config: dict
    inputs: list
    chunks_fingerprint: str
    chunk_plan: dict
    raw_products: Path
    terrain: dict


def extrapolated_mask_uv_rule():
    return {'id': QUALIFIED_MASK_UV_RULE_ID, 'formula': QUALIFIED_MASK_UV_FORMULA, 'status': EXTRAPOLATED_MASK_UV_STATUS}


def tile_layer_summaries(serialized_layers, records, layer_gap_reasons):
    serialized_indices = [layer['index'] for layer in serialized_layers]
    if any(later <= earlier for earlier, later in zip(serialized_indices, serialized_indices[1:])):
        raise FormatError(f'Serialized terrain Layers indices are not ascending: {serialized_indices}')
    listed_layers = [layer for layer in serialized_layers if layer['index'] not in layer_gap_reasons]
    placeable_indices = [layer['index'] for layer in listed_layers if not is_empty_layer_slot(layer)]
    record_indices = [record['index'] for record in records]
    if record_indices != placeable_indices:
        raise FormatError(f'Terrain layer records {record_indices} differ from the placeable serialized Layers {placeable_indices}')
    records_by_index = {record['index']: record for record in records}
    summaries = []
    for layer in listed_layers:
        record = records_by_index.get(layer['index'])
        if record is None:
            summaries.append({'index': layer['index'], 'texture': None, 'alphaMap': None,
                              'useAlpha': property_value(layer['properties'], 'bUseAlpha'), 'emptySlot': True})
        else:
            summaries.append({'index': record['index'], 'texture': record['texture'], 'alphaMap': record['alphaMap'],
                              'useAlpha': record['useAlpha'], 'emptySlot': False})
    return summaries


def extrapolated_chunk_layers(layers, mask_uv_rule):
    chunk_layers = copy.deepcopy(layers)
    for layer in chunk_layers:
        layer['maskUV'] = mask_uv_rule['formula']
        layer['maskUVStatus'] = mask_uv_rule['status']
    return chunk_layers


def chunk_decode_gap_row(tile_id, source_identity, chunk, oracle_rows, error, evidence):
    failing_objects = [row['object'] for row in oracle_rows if not row['xyMatches']]
    sector_object = (failing_objects or chunk['sectorObjects'])[0]
    return {'key': tile_unit_key(tile_id), 'part': WORLD_PART_NAME, 'step': TERRAIN_STEP_NAME, 'status': GAP_STATUS,
            'reason': f'decode-failed:{error}', 'sourceIdentity': {**source_identity, 'object': sector_object}, 'evidence': evidence}


def build_tile_terrain_chunks(tile_id, native, points, words, layers, layer_summaries, chunks, source_identity, evidence, seam_far_heights):
    oracle = sector_oracle(native, points)
    oracle_rows_by_object = {row['object']: row for row in oracle['sectors']}
    mask_uv_rule = extrapolated_mask_uv_rule()
    results = []
    for chunk in chunks:
        oracle_rows = [oracle_rows_by_object[name] for name in chunk['sectorObjects']]
        chunk_layers = extrapolated_chunk_layers(layers, mask_uv_rule)
        record = {'chunkId': chunk['chunkId'], 'terrain': None, 'maskUvRule': EXTRAPOLATED_MASK_UV_STATUS,
                  'maskUvRuleSource': mask_uv_rule['id'], 'layers': layer_summaries,
                  'sectorObjects': chunk['sectorObjects'], 'cachedZBoundsMismatched': sum(not row['allBoundsMatch'] for row in oracle_rows),
                  'hiddenQuads': None, 'triangleCount': None, 'seamStripQuads': None, 'gapRows': []}
        try:
            region, _ = select_terrain_sectors(native, oracle, {'terrainSectorRectangle': chunk['sectorRectangle'],
                                                                'cachedSectorBoundsPolicy': CACHED_SECTOR_BOUNDS_POLICY})
        except FormatError as error:
            record['gapRows'] = [chunk_decode_gap_row(tile_id, source_identity, chunk, oracle_rows, error, evidence)]
            results.append((record, None))
            continue
        files, statistics = build_terrain_rectangle_gltf(native, points, words, chunk_layers, region, mask_uv_rule, chunk['sectorRectangle'],
                                                         TERRAIN_CHUNK_GLTF_GENERATOR, seam_far_heights)
        record.update(hiddenQuads=statistics['hiddenQuads'], triangleCount=statistics['triangleCount'], seamStripQuads=statistics['seamStripQuads'])
        glb = files['terrain.glb'] if statistics['triangleCount'] else None
        if glb is not None:
            record['terrain'] = {'resource': TERRAIN_CHUNK_RESOURCE_NAME, 'sha256': hashlib.sha256(glb).hexdigest(), 'bytes': len(glb)}
        results.append((record, glb))
    return results


def terrain_step_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), TERRAIN_STEP_NAME, TERRAIN_CHUNK_STEP_ALGORITHM_VERSION)


def terrain_unit_config(chunks_fingerprint, seam_neighbours, seam_rules_sha256):
    return {'chunksFingerprint': chunks_fingerprint, 'cachedSectorBoundsPolicy': CACHED_SECTOR_BOUNDS_POLICY, 'seamNeighbours': seam_neighbours,
            'seamRulesSha256': seam_rules_sha256}


def terrain_layer_gap_rows(tile_id, source_identity, terrain_object, layer_gap_reasons, evidence):
    return [tile_step_row(tile_id, TERRAIN_STEP_NAME, GAP_STATUS, reason, {**source_identity, 'object': terrain_object}, evidence)
            for _, reason in sorted(layer_gap_reasons.items())]


def terrain_seam_gap_rows(tile_id, source_identity, terrain_object, seam_statuses, evidence):
    return [tile_step_row(tile_id, TERRAIN_STEP_NAME, status, reason, {**source_identity, 'object': terrain_object}, evidence)
            for status, reason in seam_statuses]


def tile_terrain_gap_rows(layer_gap_rows, records, seam_gap_rows):
    return [*layer_gap_rows, *(row for record in records for row in record['gapRows']), *seam_gap_rows]


def tile_terrain_row(tile_id, source_identity, layer_gap_rows, records, seam_gap_rows, evidence):
    gap_rows = tile_terrain_gap_rows(layer_gap_rows, records, seam_gap_rows)
    if gap_rows:
        return tile_step_row(tile_id, TERRAIN_STEP_NAME, GAP_STATUS, gap_rows[0]['reason'], source_identity, evidence)
    return tile_step_row(tile_id, TERRAIN_STEP_NAME, 'pass', None, source_identity, evidence)


def terrain_unit(project_root, tile_id, lock_record):
    chunks_fingerprint, raw_products, chunk_plan = sealed_chunk_plan(project_root, tile_id, lock_record)
    terrain = read_raw_terrain_record(raw_products)
    inputs = locked_input_records(sorted({tile_map_path(tile_id), terrain['height']['source']['package']}))
    ledger = terrain_step_ledger(project_root)
    config = terrain_unit_config(chunks_fingerprint, seam_neighbour_inputs(project_root, tile_id), terrain_seam_rules_sha256())
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    return TerrainUnit(ledger, tile_unit_key(tile_id), fingerprint, config, inputs, chunks_fingerprint, chunk_plan, raw_products, terrain)


def sealed_terrain_chunks(project_root, tile_id, lock_record):
    unit = terrain_unit(project_root, tile_id, lock_record)
    if not unit.ledger.is_sealed(unit.unit_key, unit.fingerprint):
        raise TerrainChunkStepError(f'terrain chunks of {unit.unit_key} are not sealed; run --step terrain first')
    products_directory = unit.ledger.unit_step_directory(unit.unit_key) / PRODUCTS_FOLDER_NAME
    terrain_index = json.loads((products_directory / TERRAIN_CHUNK_INDEX_PRODUCT_NAME).read_text(encoding='utf-8'))
    return unit, terrain_index['chunks'], products_directory


def run_terrain_chunk_step(project_root, client, tile_id):
    require_tile_id(tile_id)
    lock_record = read_tile_map_lock_record(tile_id)
    source_identity = {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}
    unit = terrain_unit(project_root, tile_id, lock_record)
    ledger, unit_key, fingerprint, config, inputs = unit.ledger, unit.unit_key, unit.fingerprint, unit.config, unit.inputs
    chunk_plan, raw_products, terrain = unit.chunk_plan, unit.raw_products, unit.terrain
    step_directory = ledger.unit_step_directory(unit_key)
    receipt_evidence = (step_directory / RECEIPT_RECORD_NAME).relative_to(ledger.lane_folder).as_posix()
    index_path = step_directory / PRODUCTS_FOLDER_NAME / TERRAIN_CHUNK_INDEX_PRODUCT_NAME
    if ledger.is_sealed(unit_key, fingerprint):
        terrain_index = json.loads(index_path.read_text(encoding='utf-8'))
        return tile_terrain_row(tile_id, source_identity, terrain_index['layerGapRows'], terrain_index['chunks'], terrain_index['seamGapRows'],
                                receipt_evidence)
    actors = json.loads((raw_products / 'actors.json').read_text(encoding='utf-8'))
    terrain_actor = next(actor for actor in actors if actor['id'] == terrain['id'])
    try:
        package = read_locked_map_package(client, tile_id, lock_record)
        native = native_terrain(package)
        points = source_backed_terrain_points(native, terrain, terrain_actor, read_height_samples(raw_products, terrain))
        words = read_topology_words(raw_products, terrain, native)
        layer_gap_reasons = terrain_layer_gap_reasons(terrain['layers'])
        layers = layer_records(terrain, native, package, tile_map_path(tile_id), layer_gap_reasons)
        layer_summaries = tile_layer_summaries(terrain['layers'], layers, layer_gap_reasons)
        layer_gap_rows = terrain_layer_gap_rows(tile_id, source_identity, native['object'], layer_gap_reasons, receipt_evidence)
        require_terrain_not_inverted(terrain_actor, read_class_evidence(client, lane_work_root(project_root, WORLD_LANE_NAME)))
        seam_strip = terrain_seam_strip(project_root, client, tile_id, native, points, serialized_location(terrain_actor),
                                        config['seamNeighbours'])
        seam_gap_rows = terrain_seam_gap_rows(tile_id, source_identity, native['object'], seam_gap_statuses(seam_strip), receipt_evidence)
        results = build_tile_terrain_chunks(tile_id, native, points, words, layers, layer_summaries, chunk_plan['chunks'],
                                            source_identity, receipt_evidence, seam_strip.far_heights)
    except FormatError as error:
        return tile_step_row(tile_id, TERRAIN_STEP_NAME, 'failed', f'decode-failed:{error}', source_identity,
                             step_directory.relative_to(ledger.lane_folder).as_posix())
    products_directory = ledger.begin(unit_key, fingerprint) / PRODUCTS_FOLDER_NAME
    outputs = []

    def write_product(relative_path, payload):
        product_path = safe_path(products_directory, relative_path)
        product_path.parent.mkdir(parents=True, exist_ok=True)
        product_path.write_bytes(payload)
        outputs.append({'path': product_path.relative_to(ledger.lane_folder).as_posix(),
                        'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)})

    products_directory.mkdir()
    for record, glb in results:
        if glb is not None:
            write_product(f'{record["chunkId"]}/{TERRAIN_CHUNK_RESOURCE_NAME}', glb)
    records = [record for record, _ in results]
    write_product(TERRAIN_CHUNK_INDEX_PRODUCT_NAME, canonical_json_bytes({'tileId': tile_id, 'layerGapRows': layer_gap_rows, 'chunks': records,
                                                                          'seamStrip': seam_strip_summary(seam_strip), 'seamGapRows': seam_gap_rows}))
    ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': inputs, 'outputs': outputs,
                                        'gapRows': tile_terrain_gap_rows(layer_gap_rows, records, seam_gap_rows)})
    return tile_terrain_row(tile_id, source_identity, layer_gap_rows, records, seam_gap_rows, receipt_evidence)
