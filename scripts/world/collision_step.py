import json
from pathlib import Path
from typing import NamedTuple

from native_assets_lib.gltf import json_bytes
from native_catalog.ue2 import FormatError
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import sha256_hex
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from world.blocking_volume_geometry import read_volume
from world.bsp_chunk_geometry import unsigned_flags
from world.bsp_step import sealed_bsp_chunks
from world.collision_payload_groups import (NO_MESH, STATIC_SLOT_ENABLE_COLLISION_SOURCE, bspt_arrays, movr_arrays, plac_arrays, smsh_arrays, terr_arrays,
                                            vols_arrays)
from world.level_model import LevelModelLayoutError, read_level_model
from world.map_sources import MapSources
from world.mover_step import sealed_movers
from world.native_terrain_sectors import read_height_samples, read_topology_words, native_terrain
from world.raw_map_step import PRODUCTS_FOLDER_NAME, read_tile_map_lock_record, require_tile_id, tile_map_path, tile_step_row, tile_unit_key
from world.static_collision_sources import (COLLISION_RULES_PATH, COLLISION_UNREADABLE_REASON, GAP_DECISION, SLOTS_DECISION,
                                            decide_placement_collision, load_collision_rules, model_slot_properties, static_mesh_collision_triangles,
                                            static_mesh_selectors)
from world.static_mesh_step import conversion_failure_reason, sealed_static_meshes, static_mesh_requests_by_reference
from world.static_placement import TransformFieldError, read_class_evidence, resolved_static_values, static_matrix
from world.static_placement_plan import FAILED_STATUS, chunk_for_origin, chunk_rectangles, static_mesh_actors
from world.terrain_chunk_step import sealed_terrain_chunks
from world.terrain_collision_source import read_terrain_collision
from world.tile_census import WORLD_LANE_NAME
from world.tile_census_validation import GAP_STATUS
from world.tile_chunk_plan import read_locked_map_package, sealed_chunk_plan
from world.typed_payload import write_tile_typed_payload_resource

COLLISION_STEP_ALGORITHM_VERSION = 2
COLLISION_STEP_NAME = 'collision'
COLLISION_PRODUCT_NAME = 'collision.json'
TILE_COLLISION_FOLDER = 'native-tile-collision'
CHUNK_COLLISION_FOLDER = 'native-tile-chunk-collision'
TRANSFORM_FIELD_UNREADABLE_REASON_PREFIX = 'collision-transform-field-unreadable:'
TRANSFORM_FIELD_EVIDENCE_PREFIX = 'transform-field:'
MOVER_OUTSIDE_CHUNK_GRID_EVIDENCE = 'chunk:outside-grid'
ZERO_MATRIX = [[0.0] * 4 for _ in range(4)]


class CollisionUnit(NamedTuple):
    ledger: object
    unit_key: str
    fingerprint: str
    config: dict
    inputs: list
    raw_products: Path
    chunk_plan: dict
    static_meshes: object
    requests: dict
    movers: object


def collision_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), COLLISION_STEP_NAME, COLLISION_STEP_ALGORITHM_VERSION)


def collision_converter_version():
    return f'{Path(__file__).name}:{COLLISION_STEP_ALGORITHM_VERSION}'


def collision_unit(project_root, tile_id, lock_record):
    chunks_fingerprint, raw_products, chunk_plan = sealed_chunk_plan(project_root, tile_id, lock_record)
    meshes_fingerprint, static_meshes = sealed_static_meshes(project_root, tile_id, lock_record)
    bsp_fingerprint, _ = sealed_bsp_chunks(project_root, tile_id, lock_record)
    movers_fingerprint, movers = sealed_movers(project_root, tile_id, lock_record)
    requests = static_mesh_requests_by_reference(raw_products)
    inputs = locked_input_records(sorted({tile_map_path(tile_id), *(request['package'] for request in requests.values())}))
    rules_sha256 = sha256_hex(canonical_json_bytes(json.loads(COLLISION_RULES_PATH.read_text(encoding='utf-8'))))
    config = {'chunksFingerprint': chunks_fingerprint, 'meshesFingerprint': meshes_fingerprint, 'bspFingerprint': bsp_fingerprint,
              'moversFingerprint': movers_fingerprint, 'rulesSha256': rules_sha256}
    ledger = collision_ledger(project_root)
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    return CollisionUnit(ledger, tile_unit_key(tile_id), fingerprint, config, inputs, raw_products, chunk_plan, static_meshes, requests, movers)


def collision_product_path(ledger, unit_key):
    return ledger.unit_step_directory(unit_key) / PRODUCTS_FOLDER_NAME / COLLISION_PRODUCT_NAME


def sealed_collision(project_root, tile_id, lock_record):
    unit = collision_unit(project_root, tile_id, lock_record)
    if not unit.ledger.is_sealed(unit.unit_key, unit.fingerprint):
        return None, None
    return unit.fingerprint, json.loads(collision_product_path(unit.ledger, unit.unit_key).read_text(encoding='utf-8'))


def tile_collision_row(tile_id, source_identity, gap_rows, evidence):
    if gap_rows:
        return tile_step_row(tile_id, COLLISION_STEP_NAME, GAP_STATUS, gap_rows[0]['reason'], source_identity, evidence)
    return tile_step_row(tile_id, COLLISION_STEP_NAME, 'pass', None, source_identity, evidence)


def gap_reason_of(evidence):
    transform = [entry for entry in evidence if entry.startswith(TRANSFORM_FIELD_EVIDENCE_PREFIX)]
    return TRANSFORM_FIELD_UNREADABLE_REASON_PREFIX + transform[0].removeprefix(TRANSFORM_FIELD_EVIDENCE_PREFIX) if transform else COLLISION_UNREADABLE_REASON


def chunk_of_placement(static_meshes):
    chunk_by_object = {}
    for chunk_id, chunk in static_meshes['chunks'].items():
        for model in chunk['models']:
            for placement in model['placements']:
                chunk_by_object[placement['sourceActor']] = (chunk_id, model['id'])
        for row in chunk['gapRows']:
            chunk_by_object.setdefault(row['sourceIdentity'].get('object'), (chunk_id, None))
    return chunk_by_object


def placement_matrix(actor, class_evidence):
    try:
        return static_matrix(resolved_static_values(actor, class_evidence)), []
    except TransformFieldError as error:
        return ZERO_MATRIX, [TRANSFORM_FIELD_EVIDENCE_PREFIX + error.field]
    except FormatError:
        return ZERO_MATRIX, ['transform-singular-scale']


def placement_records(context, actors):
    chunk_by_object, models_by_id = chunk_of_placement(context['staticMeshes']), {model['id']: model for model in context['staticMeshes']['models']}
    placements_by_chunk, meshes_by_chunk, decisions = {}, {}, []
    for actor in static_mesh_actors(actors):
        chunk_id, model_id = chunk_by_object.get(actor['object'], (None, None))
        model = models_by_id.get(model_id)
        glb = (context['storeRoot'] / model['model']['file']).read_bytes() if model else None
        request = context['requests'].get(actor['staticMesh']['object'])
        decision = decide_placement_collision(actor, context['classEvidence'], model_slot_properties(glb) if glb else None,
                                              static_mesh_selectors(context['mapSources'], request, context['rules']), context['rules'])
        matrix, transform_evidence = placement_matrix(actor, context['classEvidence'])
        if transform_evidence and decision['decision'] == SLOTS_DECISION:
            decision = {**decision, 'decision': GAP_DECISION, 'slots': [], 'evidence': transform_evidence}
        decisions.append({**decision, 'object': actor['object'], 'chunkId': chunk_id})
        if chunk_id is None:
            continue
        mesh_index = NO_MESH
        if decision['decision'] == SLOTS_DECISION:
            chunk_meshes = meshes_by_chunk.setdefault(chunk_id, {})
            key = (model_id, tuple(decision['slots']))
            if key not in chunk_meshes:
                positions, indices = static_mesh_collision_triangles(glb, set(decision['slots']))
                chunk_meshes[key] = {'index': len(chunk_meshes), 'modelId': model_id, 'slots': list(decision['slots']), 'positions': positions,
                                     'indices': indices}
            mesh_index = chunk_meshes[key]['index']
        placements_by_chunk.setdefault(chunk_id, []).append({'exportIndex': actor['exportIndex'], 'decision': decision['decision'],
                                                              'mesh': mesh_index, 'matrix': matrix})
    return placements_by_chunk, meshes_by_chunk, decisions


def mover_slot_records(context, movers, rectangles, meshes_by_chunk):
    movers_by_chunk, decisions = {}, []
    for mover in movers['movers']:
        chunk_id = chunk_for_origin(rectangles, mover['origin'][0], mover['origin'][1])
        decision = mover['collision']
        if decision['decision'] == SLOTS_DECISION and chunk_id is None:
            decision = {**decision, 'decision': GAP_DECISION, 'slots': [], 'evidence': [MOVER_OUTSIDE_CHUNK_GRID_EVIDENCE]}
        decisions.append({**decision, 'object': mover['object'], 'exportIndex': mover['exportIndex'], 'chunkId': chunk_id})
        if decision['decision'] != SLOTS_DECISION:
            continue
        glb = (context['storeRoot'] / mover['model']['file']).read_bytes()
        chunk_meshes = meshes_by_chunk.setdefault(chunk_id, {})
        for slot in decision['slots']:
            key = ('mover', mover['modelId'], (slot,))
            if key not in chunk_meshes:
                positions, indices = static_mesh_collision_triangles(glb, {slot})
                chunk_meshes[key] = {'index': len(chunk_meshes), 'modelId': mover['modelId'], 'slots': [slot], 'positions': positions, 'indices': indices}
            movers_by_chunk.setdefault(chunk_id, []).append({'moverId': mover['id'], 'exportIndex': mover['exportIndex'], 'slot': slot,
                                                             'collisionSource': STATIC_SLOT_ENABLE_COLLISION_SOURCE, 'mesh': chunk_meshes[key]['index'],
                                                             'closedMatrix': mover['closedSourceRows'], 'openMatrix': mover['openSourceRows']})
    return movers_by_chunk, decisions


def volume_records(context, package, level, actors, rectangles):
    volumes_by_chunk, records = {}, []
    for actor in sorted((actor for actor in actors if actor['classObject'] in context['rules'].volume_classes), key=lambda actor: actor['exportIndex']):
        volume = read_volume(package, level.adapter, level.reader, actor, context['classEvidence'], context['rules'])
        chunk_id = chunk_for_origin(rectangles, volume['centroid'][0], volume['centroid'][1]) if volume['centroid'] else None
        records.append({key: value for key, value in volume.items() if key != 'nodes'} | {'chunkId': chunk_id, 'nodeCount': len(volume['nodes'])})
        if chunk_id is not None:
            volumes_by_chunk.setdefault(chunk_id, []).append(volume)
    return volumes_by_chunk, records


def object_gap_rows(tile_id, source_identity, evidence_path, records):
    return [tile_step_row(tile_id, COLLISION_STEP_NAME, GAP_STATUS, gap_reason_of(record['evidence']), {**source_identity, 'object': record['object']},
                          evidence_path) for record in records if record['decision'] == GAP_DECISION]


def terrain_by_chunk(project_root, tile_id, lock_record, package, actors, chunk_plan):
    terrain_unit, _, _ = sealed_terrain_chunks(project_root, tile_id, lock_record)
    terrain = terrain_unit.terrain
    if terrain is None:
        return {}
    native = native_terrain(package)
    samples, words = read_height_samples(terrain_unit.raw_products, terrain), read_topology_words(terrain_unit.raw_products, terrain, native)
    terrain_actor = next(actor for actor in actors if actor['id'] == terrain['id'])
    return {chunk['chunkId']: read_terrain_collision(native, samples, words, terrain, terrain_actor, chunk) for chunk in chunk_plan['chunks']}


def chunk_collision_records(context, chunk_plan, placements_by_chunk, meshes_by_chunk, volumes_by_chunk, movers_by_chunk, terrains, gap_rows_by_chunk):
    records, outputs = {}, []
    for chunk in chunk_plan['chunks']:
        chunk_id = chunk['chunkId']
        placements = sorted(placements_by_chunk.get(chunk_id, []), key=lambda placement: placement['exportIndex'])
        meshes = sorted(meshes_by_chunk.get(chunk_id, {}).values(), key=lambda mesh: mesh['index'])
        volumes = volumes_by_chunk.get(chunk_id, [])
        mover_slots = sorted(movers_by_chunk.get(chunk_id, []), key=lambda record: (record['exportIndex'], record['slot']))
        arrays = [*vols_arrays(volumes), *smsh_arrays(meshes), *plac_arrays(placements), *movr_arrays(mover_slots), *terr_arrays(terrains.get(chunk_id))]
        resource, written = write_tile_typed_payload_resource(context['storeRoot'], CHUNK_COLLISION_FOLDER, arrays, context['metadata'])
        outputs.extend(written)
        records[chunk_id] = {**resource, 'volumes': len(volumes), 'meshes': len(meshes), 'placements': len(placements),
                             'terrainSamples': len(terrains[chunk_id]['heights']) if chunk_id in terrains else 0,
                             'meshModels': [{'modelId': mesh['modelId'], 'slots': mesh['slots']} for mesh in meshes],
                             'movers': [{key: record[key] for key in ('moverId', 'slot', 'collisionSource', 'mesh')} for record in mover_slots],
                             'gapRows': gap_rows_by_chunk.get(chunk_id, [])}
    return records, outputs


def collision_context(project_root, client, unit, lock_record):
    return {'storeRoot': lane_store_root(project_root, WORLD_LANE_NAME), 'rules': load_collision_rules(), 'requests': unit.requests,
            'classEvidence': read_class_evidence(client, lane_work_root(project_root, WORLD_LANE_NAME)), 'mapSources': MapSources(client),
            'staticMeshes': unit.static_meshes, 'metadata': {'sourceSha256': lock_record['eSha256'], 'converterVersion': collision_converter_version()}}


def run_collision_step(project_root, client_root, tile_id):
    require_tile_id(tile_id)
    lock_record = read_tile_map_lock_record(tile_id)
    source_identity = {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}
    unit = collision_unit(project_root, tile_id, lock_record)
    ledger, unit_key, fingerprint, config, inputs, raw_products, chunk_plan, static_meshes = unit[:8]
    step_directory = ledger.unit_step_directory(unit_key)
    receipt_evidence = (step_directory / RECEIPT_RECORD_NAME).relative_to(ledger.lane_folder).as_posix()
    if ledger.is_sealed(unit_key, fingerprint):
        return tile_collision_row(tile_id, source_identity, json.loads(collision_product_path(ledger, unit_key).read_text(encoding='utf-8'))['gapRows'],
                                  receipt_evidence)
    if static_meshes is None or config['bspFingerprint'] is None or unit.movers is None:
        raise FormatError(f'collision of {unit_key} needs sealed meshes, bsp and movers units; run --step meshes, --step bsp and --step movers first')
    client = Path(client_root).resolve()
    package = read_locked_map_package(client, tile_id, lock_record)
    actors = json.loads((raw_products / 'actors.json').read_text(encoding='utf-8'))
    try:
        level = read_level_model(package)
        rectangles = chunk_rectangles(chunk_plan, native_terrain(package))
    except LevelModelLayoutError as error:
        return tile_step_row(tile_id, COLLISION_STEP_NAME, GAP_STATUS, error.reason, source_identity, step_directory.relative_to(ledger.lane_folder).as_posix())
    except ValueError as error:
        return tile_step_row(tile_id, COLLISION_STEP_NAME, FAILED_STATUS, conversion_failure_reason(error), source_identity,
                             step_directory.relative_to(ledger.lane_folder).as_posix())
    context = collision_context(project_root, client, unit, lock_record)
    placements_by_chunk, meshes_by_chunk, decisions = placement_records(context, actors)
    volumes_by_chunk, volumes = volume_records(context, package, level, actors, rectangles)
    movers_by_chunk, mover_decisions = mover_slot_records(context, unit.movers, rectangles, meshes_by_chunk)
    terrains = terrain_by_chunk(project_root, tile_id, lock_record, package, actors, chunk_plan)
    placement_gaps = object_gap_rows(tile_id, source_identity, receipt_evidence, decisions)
    volume_gaps = object_gap_rows(tile_id, source_identity, receipt_evidence, volumes)
    mover_gaps = object_gap_rows(tile_id, source_identity, receipt_evidence, mover_decisions)
    gap_rows = sorted([*placement_gaps, *volume_gaps, *mover_gaps], key=lambda row: (row['sourceIdentity']['object'].casefold(), row['reason']))
    gap_rows_by_chunk = {}
    for record, row in zip([record for record in [*decisions, *volumes, *mover_decisions] if record['decision'] == GAP_DECISION],
                           [*placement_gaps, *volume_gaps, *mover_gaps]):
        gap_rows_by_chunk.setdefault(record['chunkId'], []).append(row)
    ledger.begin(unit_key, fingerprint)
    surface_flags = lambda node: unsigned_flags(level.model.surfs[node.i_surf].flags)
    tile_resource, outputs = write_tile_typed_payload_resource(context['storeRoot'], TILE_COLLISION_FOLDER, bspt_arrays(level.model, surface_flags), context['metadata'])
    chunks, chunk_outputs = chunk_collision_records(context, chunk_plan, placements_by_chunk, meshes_by_chunk, volumes_by_chunk, movers_by_chunk, terrains,
                                                    gap_rows_by_chunk)
    product = {'tileId': tile_id, 'tile': {**tile_resource, 'nodeCount': len(level.model.nodes), 'leafHulls': len(level.model.leaf_hulls),
                                           'rootOutside': level.model.root_outside},
               'chunks': chunks, 'decisions': sorted(decisions, key=lambda record: record['exportIndex']),
               'moverDecisions': sorted(mover_decisions, key=lambda record: record['exportIndex']), 'volumes': volumes, 'gapRows': gap_rows}
    products_directory = step_directory / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    product_payload = json_bytes(product)
    (products_directory / COLLISION_PRODUCT_NAME).write_bytes(product_payload)
    outputs = sorted({record['path']: record for record in [*outputs, *chunk_outputs]}.values(), key=lambda record: record['path'])
    outputs.append({'path': (products_directory / COLLISION_PRODUCT_NAME).relative_to(ledger.lane_folder).as_posix(),
                    'sha256': sha256_hex(product_payload), 'bytes': len(product_payload)})
    ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': inputs, 'outputs': outputs, 'gapRows': gap_rows})
    return tile_collision_row(tile_id, source_identity, gap_rows, receipt_evidence)
