import json

from native_assets_lib.gltf import json_bytes
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import add_store_file, merge_catalog_slice, read_store_catalog, sha256_hex, validate_catalog_record, write_store
from native_store.store_paths import confined_child_path, lane_store_root, lane_work_root, require_converter_output
from native_store.tile_manifest_validation import (FRAME_FIELDS, TILE_CHUNK_MANIFEST_KIND, TILE_MANIFEST_KIND, TILE_MANIFEST_SCHEMA_VERSION,
                                                   validate_tile_chunk_manifest, validate_tile_manifest)
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger
from world.raw_map_step import read_tile_map_lock_record, require_tile_id, tile_map_path, tile_step_row, tile_unit_key
from world.static_mesh_step import STATIC_MESH_STEP_NAME, sealed_static_meshes, tile_static_mesh_row
from world.terrain_chunk_step import TERRAIN_CHUNK_RESOURCE_NAME, TERRAIN_STEP_NAME, sealed_terrain_chunks
from world.tile_chunk_plan import chunk_plan_ledger
from world.tile_census import WORLD_LANE_NAME
from world.tile_census_validation import GAP_STATUS

TILE_MANIFEST_STEP_ALGORITHM_VERSION = 2
TILE_MANIFEST_STEP_NAME = 'manifest'
TILE_CATALOG_CAPACITY = 163
PENDING_TILE_STEPS = ('meshes', 'bsp', 'collision', 'movers', 'sky', 'audio', 'minimap', 'terrain-material')
PENDING_CHUNK_STEPS = ('meshes', 'bsp', 'collision', 'terrain-material')
PENDING_STATUS = 'pending'
TERRAIN_QUADS_ALL_HIDDEN_REASON = 'terrain-quads-all-hidden'
CHUNK_TERRAIN_FOLDER = 'native-tile-chunk-terrain'
CHUNK_MANIFEST_FOLDER = 'native-tile-chunk-runtime'
CHUNK_MANIFEST_NAME = 'manifest.json'
TILE_MANIFEST_NAME = 'tile.json'
TILES_CATALOG_SLICE = 'tiles'


class TileManifestStepError(ValueError):
    pass


def pending_step_row(tile_id, step, source_identity, evidence):
    return tile_step_row(tile_id, step, PENDING_STATUS, f'step-pending:{step}', source_identity, evidence)


def pending_step_rows(tile_id, steps, source_identity, evidence):
    return [pending_step_row(tile_id, step, source_identity, evidence) for step in steps]


def sorted_by_step(rows):
    return sorted(rows, key=lambda row: row['step'])


def chunk_terrain_store_path(terrain_sha256):
    return f'maps/{terrain_sha256}/{CHUNK_TERRAIN_FOLDER}/{TERRAIN_CHUNK_RESOURCE_NAME}'


def chunk_manifest_store_path(manifest_sha256):
    return f'maps/{manifest_sha256}/{CHUNK_MANIFEST_FOLDER}/{CHUNK_MANIFEST_NAME}'


def tile_manifest_store_path(manifest_sha256):
    return f'tiles/{manifest_sha256}/{TILE_MANIFEST_NAME}'


def chunk_terrain_gap_rows(tile_id, chunk_record, chunk_plan_entry, source_identity, evidence):
    if chunk_record['terrain'] is not None:
        return []
    if chunk_record['gapRows']:
        return chunk_record['gapRows']
    return [tile_step_row(tile_id, TERRAIN_STEP_NAME, GAP_STATUS, TERRAIN_QUADS_ALL_HIDDEN_REASON,
                          {**source_identity, 'object': chunk_plan_entry['sectorObjects'][0]}, evidence)]


def pending_steps_after_static_meshes(steps, static_meshes):
    return steps if static_meshes is None else tuple(step for step in steps if step != STATIC_MESH_STEP_NAME)


def chunk_static_mesh_parts(static_meshes, chunk_id):
    if static_meshes is None:
        return [], []
    chunk = static_meshes['chunks'].get(chunk_id)
    if chunk is None:
        raise TileManifestStepError(f'sealed static meshes list no chunk {chunk_id}')
    return chunk['models'], chunk['gapRows'][:1]


def build_tile_chunk_manifest(tile_id, chunk_record, chunk_plan_entry, source_identity, evidence, static_meshes=None):
    if chunk_record['chunkId'] != chunk_plan_entry['chunkId']:
        raise TileManifestStepError(f'terrain record {chunk_record["chunkId"]} does not match chunk plan entry {chunk_plan_entry["chunkId"]}')
    terrain = chunk_record['terrain']
    models, static_mesh_gap_rows = chunk_static_mesh_parts(static_meshes, chunk_plan_entry['chunkId'])
    gaps = [*pending_step_rows(tile_id, pending_steps_after_static_meshes(PENDING_CHUNK_STEPS, static_meshes), source_identity, evidence),
            *static_mesh_gap_rows, *chunk_terrain_gap_rows(tile_id, chunk_record, chunk_plan_entry, source_identity, evidence)]
    manifest = {'kind': TILE_CHUNK_MANIFEST_KIND, 'schemaVersion': TILE_MANIFEST_SCHEMA_VERSION, 'tileId': tile_id,
                'chunkId': chunk_plan_entry['chunkId'], 'sectorRange': dict(chunk_plan_entry['sectorRange']),
                'terrain': None if terrain is None else {'resource': '/l2/' + chunk_terrain_store_path(terrain['sha256']),
                                                         'sha256': terrain['sha256'], 'maskUvRule': chunk_record['maskUvRule']},
                'models': models, 'bsp': None, 'collision': None, 'gaps': sorted_by_step(gaps)}
    return validate_tile_chunk_manifest(manifest)


def tile_level_gap_rows(tile_id, source_identity, evidence, static_meshes):
    rows = pending_step_rows(tile_id, pending_steps_after_static_meshes(PENDING_TILE_STEPS, static_meshes), source_identity, evidence)
    if static_meshes is not None and static_meshes['gapRows']:
        rows.append(tile_static_mesh_row(tile_id, source_identity, static_meshes['gapRows'], evidence))
    return rows


def build_tile_manifest(tile_id, source_identity, chunk_plan, chunk_manifest_records, evidence, static_meshes=None):
    manifest = {'kind': TILE_MANIFEST_KIND, 'schemaVersion': TILE_MANIFEST_SCHEMA_VERSION, 'tileId': tile_id,
                'sourceMap': tile_map_path(tile_id), 'sourceSha256': source_identity['sha256'],
                'frame': {field: chunk_plan['frame'][field] for field in FRAME_FIELDS}, 'anchor': dict(chunk_plan['anchor']),
                'chunks': list(chunk_manifest_records), 'resources': [],
                'gaps': sorted_by_step(tile_level_gap_rows(tile_id, source_identity, evidence, static_meshes))}
    return validate_tile_manifest(manifest)


def pinned_manifest_entry(relative_path, payload):
    return {'manifest': '/l2/' + relative_path, 'manifestSha256': sha256_hex(payload), 'manifestBytes': len(payload)}


def tile_store_files(tile_id, source_identity, chunk_plan, terrain_records, terrain_glbs_by_chunk, evidence, static_meshes=None):
    if chunk_plan['anchor'] is None:
        raise TileManifestStepError(f'chunk plan of tile {tile_id} has no anchor; a tile without an anchor gets no manifest')
    terrain_records_by_chunk = {record['chunkId']: record for record in terrain_records}
    if list(terrain_records_by_chunk) != [chunk['chunkId'] for chunk in chunk_plan['chunks']]:
        raise TileManifestStepError(f'terrain records of tile {tile_id} do not list the chunk plan chunks in order')
    files, chunk_manifest_records = {}, []
    for chunk_plan_entry in chunk_plan['chunks']:
        chunk_record = terrain_records_by_chunk[chunk_plan_entry['chunkId']]
        if chunk_record['terrain'] is not None:
            terrain_glb = terrain_glbs_by_chunk[chunk_plan_entry['chunkId']]
            if sha256_hex(terrain_glb) != chunk_record['terrain']['sha256']:
                raise TileManifestStepError(f'terrain GLB of {chunk_plan_entry["chunkId"]} differs from its terrain record SHA-256')
            files[chunk_terrain_store_path(chunk_record['terrain']['sha256'])] = terrain_glb
        chunk_manifest = build_tile_chunk_manifest(tile_id, chunk_record, chunk_plan_entry, source_identity, evidence, static_meshes)
        chunk_payload = canonical_json_bytes(chunk_manifest)
        chunk_path = chunk_manifest_store_path(sha256_hex(chunk_payload))
        files[chunk_path] = chunk_payload
        chunk_manifest_records.append({'chunkId': chunk_plan_entry['chunkId'], **pinned_manifest_entry(chunk_path, chunk_payload)})
    tile_payload = canonical_json_bytes(build_tile_manifest(tile_id, source_identity, chunk_plan, chunk_manifest_records, evidence, static_meshes))
    tile_path = tile_manifest_store_path(sha256_hex(tile_payload))
    files[tile_path] = tile_payload
    return files, validate_catalog_record(TILES_CATALOG_SLICE, {'id': tile_id, **pinned_manifest_entry(tile_path, tile_payload)})


def is_earlier_tile_record_of_this_store(store_root, existing):
    manifest_path = confined_child_path(store_root, existing['manifest'].removeprefix('/l2/'))
    if not manifest_path.is_file():
        return False
    payload = manifest_path.read_bytes()
    if sha256_hex(payload) != existing['manifestSha256'] or len(payload) != existing['manifestBytes']:
        return False
    try:
        return validate_tile_manifest(json.loads(payload))['tileId'] == existing['id']
    except (ValueError, KeyError, TypeError):
        return False


def catalog_with_tile_record(store_root, catalog, record):
    existing_records = [existing for existing in catalog.get(TILES_CATALOG_SLICE, []) if existing.get('id') == record['id']]
    if existing_records and all(is_earlier_tile_record_of_this_store(store_root, existing) for existing in existing_records):
        catalog = {**catalog, TILES_CATALOG_SLICE: [existing for existing in catalog[TILES_CATALOG_SLICE] if existing.get('id') != record['id']]}
    return merge_catalog_slice(catalog, TILES_CATALOG_SLICE, record, TILE_CATALOG_CAPACITY)


def tile_manifest_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), TILE_MANIFEST_STEP_NAME, TILE_MANIFEST_STEP_ALGORITHM_VERSION)


def tile_manifest_unit_config(chunks_fingerprint, terrain_fingerprint, static_meshes_fingerprint):
    return {'chunksFingerprint': chunks_fingerprint, 'terrainFingerprint': terrain_fingerprint, 'meshesFingerprint': static_meshes_fingerprint}


def require_world_lane_store(project_root, output):
    store_root = require_converter_output(project_root, output)
    if store_root != lane_store_root(project_root, WORLD_LANE_NAME):
        raise TileManifestStepError(f'tile manifests are sealed only in the world lane store {lane_store_root(project_root, WORLD_LANE_NAME)}: {store_root}')
    return store_root


def tile_manifest_step_rows(tile_id, source_identity, evidence, static_meshes):
    return [tile_step_row(tile_id, TILE_MANIFEST_STEP_NAME, 'pass', None, source_identity, evidence),
            *pending_step_rows(tile_id, pending_steps_after_static_meshes(PENDING_TILE_STEPS, static_meshes), source_identity, evidence)]


def run_tile_manifest_step(project_root, tile_id, output):
    require_tile_id(tile_id)
    store_root = require_world_lane_store(project_root, output)
    lock_record = read_tile_map_lock_record(tile_id)
    source_identity = {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}
    terrain_unit, terrain_records, terrain_products = sealed_terrain_chunks(project_root, tile_id, lock_record)
    chunk_plan = terrain_unit.chunk_plan
    unit_key = tile_unit_key(tile_id)
    if chunk_plan['anchor'] is None:
        chunk_plan_receipt = chunk_plan_ledger(project_root).unit_step_directory(unit_key) / RECEIPT_RECORD_NAME
        return [tile_step_row(tile_id, TILE_MANIFEST_STEP_NAME, GAP_STATUS, chunk_plan['anchorGap']['reason'], source_identity,
                              chunk_plan_receipt.relative_to(terrain_unit.ledger.lane_folder).as_posix())]
    static_meshes_fingerprint, static_meshes = sealed_static_meshes(project_root, tile_id, lock_record)
    ledger = tile_manifest_ledger(project_root)
    config = tile_manifest_unit_config(terrain_unit.chunks_fingerprint, terrain_unit.fingerprint, static_meshes_fingerprint)
    fingerprint = ledger.unit_fingerprint([lock_record['eSha256']], config)
    receipt_evidence = (ledger.unit_step_directory(unit_key) / RECEIPT_RECORD_NAME).relative_to(ledger.lane_folder).as_posix()
    if ledger.is_sealed(unit_key, fingerprint):
        return tile_manifest_step_rows(tile_id, source_identity, receipt_evidence, static_meshes)
    terrain_glbs_by_chunk = {record['chunkId']: (terrain_products / record['chunkId'] / TERRAIN_CHUNK_RESOURCE_NAME).read_bytes()
                             for record in terrain_records if record['terrain'] is not None}
    files, record = tile_store_files(tile_id, source_identity, chunk_plan, terrain_records, terrain_glbs_by_chunk, receipt_evidence, static_meshes)
    catalog, before = read_store_catalog(store_root)
    catalog = catalog_with_tile_record(store_root, catalog, record)
    ledger.begin(unit_key, fingerprint)
    store_files = {}
    for relative_path, payload in files.items():
        add_store_file(store_files, relative_path, payload)
    write_store(store_root, store_files, before, json_bytes(catalog))
    outputs = [{'path': (store_root / relative_path).relative_to(ledger.lane_folder).as_posix(), 'sha256': sha256_hex(payload),
                'bytes': len(payload)} for relative_path, payload in sorted(files.items())]
    ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': [source_identity], 'gapRows': [], 'outputs': outputs})
    return tile_manifest_step_rows(tile_id, source_identity, receipt_evidence, static_meshes)
