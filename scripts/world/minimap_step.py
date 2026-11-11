import hashlib
import json
from pathlib import Path
import struct

from native_assets import UMODEL, Converter, implementation_hash
from native_assets_lib.gltf import json_bytes
from native_assets_lib.texture_mips import UnsupportedTextureSource, build_texture_source
from native_assets_lib.texture_package_118 import read_unreal_package
from native_assets_lib.texture_source_reader import TEXTURE_FORMAT_UNSUPPORTED_REASON_PREFIX, TEXTURE_LICENSEE_UNSUPPORTED_REASON_PREFIX
from native_catalog.ue2 import FormatError
from native_store.catalog_writer import add_store_file, immutable_write, sha256_hex, verify_store_destinations
from native_store.store_paths import confined_child_path, lane_store_root, lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from reference_client_guard import require_reference_client
from world.minimap_join import (HUNTINGZONE_TABLE_ROLE, MINIMAP_JOIN_ALGORITHM_VERSION, RADAR_PACKAGE_ROLE, SCHEMA_FIELD_MEANING_LABEL,
                                TEXTURE_SOURCE_GAP_STATUS, TEXTURE_SOURCE_READABLE_STATUS, TOWN_MAP_PACKAGE_ROLE, ZONE_NAME_PACKAGE_ROLE,
                                ZONENAME_TABLE_ROLE, join_minimap_sources, locked_tile_grid)
from world.minimap_sources import (MINIMAP_PACKAGE_PATHS, MINIMAP_TABLE_PATHS, MinimapSources, decoded_table_rows, lock_equal_minimap_source_paths,
                                   locked_tile_ids, tile_frame_extent)
from world.raw_map_step import (PRODUCTS_FOLDER_NAME, RAW_STEP_NAME, read_tile_census_row, read_tile_map_lock_record, require_tile_id,
                                tile_map_path, tile_step_row, tile_unit_key)
from world.static_mesh_step import MODEL_CONVERSION_ERRORS, conversion_failure_reason
from world.tile_census import WORLD_LANE_NAME
from world.tile_census_validation import GAP_STATUS, TILE_CENSUS_RELATIVE_PATH
from world.tile_chunk_plan import CHUNK_PLAN_STEP_NAME, ChunkPlanStepError, raw_unit_fingerprint, sealed_chunk_plan
from world.tile_json_resource import write_tile_json_resource
from world.tile_step_gap_rows import TileStepGapRows, tile_step_summary_row, upstream_failed_row

MINIMAP_STEP_ALGORITHM_VERSION = 1
MINIMAP_STEP_NAME = 'minimap'
MINIMAP_PRODUCT_NAME = 'minimap.json'
NATIVE_TILE_MINIMAP_KIND = 'native-tile-minimap'
NATIVE_TILE_MINIMAP_SCHEMA_VERSION = 1
MINIMAP_STORE_FOLDER = 'maps'
MINIMAP_MANIFEST_NAME = f'{NATIVE_TILE_MINIMAP_KIND}/manifest.json'
RADAR_TEXTURE_CONVERTER_FOLDER = 'minimap-texture-converter'
TEXTURE_ARCHIVE_NAME = 'asset.l2asset'
TEXTURE_IMAGE_NAME = 'texture.png'
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
TEXTURE_CLASS_NAME = 'Texture'
DECODE_FAILED_REASON_PREFIX = 'decode-failed:'
OBJECT_GAP_REASON_PREFIXES = (TEXTURE_LICENSEE_UNSUPPORTED_REASON_PREFIX, TEXTURE_FORMAT_UNSUPPORTED_REASON_PREFIX, DECODE_FAILED_REASON_PREFIX)


class MinimapStepError(ValueError):
    pass


def minimap_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), MINIMAP_STEP_NAME, MINIMAP_STEP_ALGORITHM_VERSION)


def minimap_unit_config(raw_fingerprint, chunk_plan_fingerprint):
    return {'rawFingerprint': raw_fingerprint, 'chunkPlanFingerprint': chunk_plan_fingerprint, 'converterSha256': implementation_hash(),
            'joinAlgorithmVersion': MINIMAP_JOIN_ALGORITHM_VERSION}


def minimap_input_records(tile_id):
    return locked_input_records(sorted({tile_map_path(tile_id), *lock_equal_minimap_source_paths()}))


def minimap_product_path(ledger, unit_key):
    return ledger.unit_step_directory(unit_key) / PRODUCTS_FOLDER_NAME / MINIMAP_PRODUCT_NAME


def tile_minimap_row(tile_id, source_identity, gap_rows, evidence):
    return tile_step_summary_row(tile_id, MINIMAP_STEP_NAME, source_identity, gap_rows, evidence)


def upstream_sealed_fingerprints(project_root, tile_id, lock_record):
    try:
        raw_fingerprint, _ = raw_unit_fingerprint(project_root, tile_id, lock_record)
    except ChunkPlanStepError:
        return RAW_STEP_NAME, None
    try:
        chunk_plan_fingerprint, _, chunk_plan = sealed_chunk_plan(project_root, tile_id, lock_record)
    except ChunkPlanStepError:
        return CHUNK_PLAN_STEP_NAME, None
    return None, (minimap_unit_config(raw_fingerprint, chunk_plan_fingerprint), chunk_plan)


def current_minimap_receipt(ledger, unit_key, config, inputs):
    receipt = ledger.sealed_receipt(unit_key)
    if receipt is None or receipt['algorithmVersion'] != MINIMAP_STEP_ALGORITHM_VERSION or receipt['config'] != config or receipt['inputs'] != inputs:
        return None
    return receipt


def sealed_minimap(project_root, tile_id, lock_record):
    failed_upstream, upstream = upstream_sealed_fingerprints(project_root, tile_id, lock_record)
    if failed_upstream is not None:
        return None, None
    ledger, unit_key = minimap_ledger(project_root), tile_unit_key(tile_id)
    receipt = current_minimap_receipt(ledger, unit_key, upstream[0], minimap_input_records(tile_id))
    if receipt is None:
        return None, None
    return receipt['fingerprint'], json.loads(minimap_product_path(ledger, unit_key).read_text(encoding='utf-8'))


def texture_export_source_status(package, export):
    try:
        metadata, _ = build_texture_source(package, export)
    except UnsupportedTextureSource as error:
        return {'status': TEXTURE_SOURCE_GAP_STATUS, 'reason': error.reason}
    except FormatError as error:
        return {'status': TEXTURE_SOURCE_GAP_STATUS, 'reason': conversion_failure_reason(error)}
    return {'status': TEXTURE_SOURCE_READABLE_STATUS, 'format': metadata['format']['name']}


def texture_package_index(package, relative_path):
    return {'path': relative_path, 'sha256': package.source_hash, 'packageVersion': package.summary['version'],
            'licensee': package.summary['licenseeVersion'], 'packageName': package.package_name,
            'exports': [{'exportIndex': export['exportIndex'], 'name': export['name'], 'object': export['object'],
                         'textureSource': texture_export_source_status(package, export)}
                        for export in package.exports if export['className'] == TEXTURE_CLASS_NAME]}


def read_texture_package_index(client, relative_path):
    path = require_reference_client(client).require_equal_file(relative_path)
    return texture_package_index(read_unreal_package(path.read_bytes(), path.name), relative_path)


def read_minimap_sources(client):
    lock_equal_paths = set(lock_equal_minimap_source_paths())
    packages = {role: read_texture_package_index(client, path) if path in lock_equal_paths else None for role, path in MINIMAP_PACKAGE_PATHS.items()}
    tables = {role: decoded_table_rows(client, role) if path in lock_equal_paths else None for role, path in MINIMAP_TABLE_PATHS.items()}
    return MinimapSources(packages, tables)


def png_dimensions(png_bytes):
    if png_bytes[:8] != PNG_SIGNATURE or png_bytes[12:16] != b'IHDR':
        raise MinimapStepError('converted radar texture is not a PNG with an IHDR chunk')
    return list(struct.unpack('>II', png_bytes[16:24]))


def radar_texture_converter(project_root, client):
    return Converter(client, lane_work_root(project_root, WORLD_LANE_NAME) / RADAR_TEXTURE_CONVERTER_FOLDER, UMODEL, project_root=project_root)


def store_converted_radar_texture(store_root, conversion, radar_texture):
    archive_path = Path(conversion['file'])
    archive = archive_path.read_bytes()
    if hashlib.sha256(archive).hexdigest() != conversion['sha256']:
        raise MinimapStepError(f'converted archive {archive_path} differs from its reported SHA-256')
    dimensions = png_dimensions((archive_path.parent / TEXTURE_IMAGE_NAME).read_bytes())
    relative = f'{conversion["sha256"]}/{TEXTURE_ARCHIVE_NAME}'
    destination = {}
    add_store_file(destination, relative, archive)
    verify_store_destinations(store_root, destination)
    immutable_write(confined_child_path(store_root, relative), archive)
    record = {'archive': f'/l2/{relative}', 'archiveSha256': conversion['sha256'], 'archiveBytes': len(archive),
              'sourceObject': radar_texture['object'], 'rule': radar_texture['rule']}
    output = {'path': (store_root / relative).relative_to(store_root.parent).as_posix(), 'sha256': conversion['sha256'], 'bytes': len(archive)}
    return record, dimensions, output


def minimap_manifest(tile_id, inputs, tile_join, radar_record, extra_gaps):
    return {'kind': NATIVE_TILE_MINIMAP_KIND, 'schemaVersion': NATIVE_TILE_MINIMAP_SCHEMA_VERSION, 'tileId': tile_id,
            'sourceInputs': [{'path': record['path'], 'sha256': record['sha256']} for record in inputs], 'radarTexture': radar_record,
            'townMapTextures': tile_join['townMapTextures'], 'zoneNameTextures': tile_join['zoneNameTextures'], 'zones': tile_join['zones'],
            'huntingZones': tile_join['huntingZones'], 'projection': tile_join['projection'], 'gaps': [*tile_join['gaps'], *extra_gaps],
            'labels': {'schemaFieldMeaning': SCHEMA_FIELD_MEANING_LABEL}}


def join_tile_minimap(tile_id, frame, sources, radar_texture_dimensions=None):
    joined = join_minimap_sources([tile_id], {tile_id: frame}, sources.packages[RADAR_PACKAGE_ROLE], sources.packages[TOWN_MAP_PACKAGE_ROLE],
                                  sources.packages[ZONE_NAME_PACKAGE_ROLE], sources.tables[ZONENAME_TABLE_ROLE], sources.tables[HUNTINGZONE_TABLE_ROLE],
                                  locked_tile_grid(locked_tile_ids()), radar_texture_dimensions)
    return joined['tiles'][0]


def tile_minimap(project_root, client, store_root, tile_id, frame, sources, converter):
    tile_join = join_tile_minimap(tile_id, frame, sources)
    radar_texture = tile_join['radarTexture']
    if radar_texture is None:
        return tile_join, None, [], []
    radar_converter = converter or radar_texture_converter(project_root, client)
    try:
        conversion = radar_converter.convert({'kind': 'texture', 'package': sources.packages[RADAR_PACKAGE_ROLE]['packageName'],
                                              'object': radar_texture['object']})
    except MODEL_CONVERSION_ERRORS as error:
        return tile_join, None, [], [{'reason': conversion_failure_reason(error), 'evidence': radar_texture['object']}]
    radar_record, dimensions, output = store_converted_radar_texture(store_root, conversion, radar_texture)
    return join_tile_minimap(tile_id, frame, sources, {radar_texture['object']: dimensions}), radar_record, [output], []


def gap_object_name(gap, tile_join):
    radar_candidates = tile_join['radarCandidates']
    return radar_candidates[0]['object'] if gap['reason'].startswith(OBJECT_GAP_REASON_PREFIXES) and radar_candidates else None


def run_minimap_step(project_root, client_root, tile_id, sources=None, converter=None):
    require_tile_id(tile_id)
    census_row = read_tile_census_row(project_root, tile_id)
    lock_record = read_tile_map_lock_record(tile_id)
    source_identity = {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}
    if census_row['status'] == GAP_STATUS:
        return tile_step_row(tile_id, MINIMAP_STEP_NAME, GAP_STATUS, census_row['reason'], source_identity, TILE_CENSUS_RELATIVE_PATH)
    ledger, unit_key = minimap_ledger(project_root), tile_unit_key(tile_id)
    step_directory = ledger.unit_step_directory(unit_key)
    failed_upstream, upstream = upstream_sealed_fingerprints(project_root, tile_id, lock_record)
    if failed_upstream is not None:
        return upstream_failed_row(tile_id, MINIMAP_STEP_NAME, source_identity, failed_upstream, step_directory.relative_to(ledger.lane_folder).as_posix())
    config, chunk_plan = upstream
    inputs = minimap_input_records(tile_id)
    receipt_evidence = (step_directory / RECEIPT_RECORD_NAME).relative_to(ledger.lane_folder).as_posix()
    if current_minimap_receipt(ledger, unit_key, config, inputs) is not None:
        return tile_minimap_row(tile_id, source_identity, json.loads(minimap_product_path(ledger, unit_key).read_text(encoding='utf-8'))['gapRows'],
                                receipt_evidence)
    client = Path(client_root).resolve()
    store_root = lane_store_root(project_root, WORLD_LANE_NAME)
    tile_join, radar_record, texture_outputs, conversion_gaps = tile_minimap(project_root, client, store_root, tile_id, tile_frame_extent(chunk_plan['frame']),
                                                                            sources or read_minimap_sources(client), converter)
    manifest = minimap_manifest(tile_id, inputs, tile_join, radar_record, conversion_gaps)
    gaps = TileStepGapRows(tile_id, MINIMAP_STEP_NAME, source_identity, receipt_evidence)
    for gap in manifest['gaps']:
        gaps.add(GAP_STATUS, gap['reason'], gap_object_name(gap, tile_join))
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    products_directory = ledger.begin(unit_key, fingerprint) / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    manifest_record, manifest_output = write_tile_json_resource(store_root, MINIMAP_STORE_FOLDER, MINIMAP_MANIFEST_NAME, manifest)
    gap_rows = gaps.rows()
    product_payload = json_bytes({'tileId': tile_id, 'manifest': manifest_record, 'gapRows': gap_rows})
    product_path = products_directory / MINIMAP_PRODUCT_NAME
    product_path.write_bytes(product_payload)
    outputs = [*sorted([manifest_output, *texture_outputs], key=lambda record: record['path']),
               {'path': product_path.relative_to(ledger.lane_folder).as_posix(), 'sha256': sha256_hex(product_payload), 'bytes': len(product_payload)}]
    ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': inputs, 'outputs': outputs, 'gapRows': gap_rows})
    return tile_minimap_row(tile_id, source_identity, gap_rows, receipt_evidence)
