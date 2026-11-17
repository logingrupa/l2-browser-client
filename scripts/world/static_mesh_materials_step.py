import json
from pathlib import Path

from native_assets import implementation_hash
from native_assets_lib.gltf import json_bytes
from native_catalog.ue2 import FormatError
from native_store.catalog_writer import sha256_hex
from native_store.glb_container import glb_document_and_binary
from native_store.store_paths import confined_child_path, lane_store_root, lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from world.locked_input_receipt import receipt_with_current_version_config_and_locked_inputs
from world.native_material_listings import publish_native_material_listing, static_mesh_materials_listing, unique_native_material_files
from world.raw_map_step import PRODUCTS_FOLDER_NAME, read_tile_map_lock_record, require_tile_id, tile_map_path, tile_step_row, tile_unit_key
from world.static_mesh_step import sealed_static_meshes
from world.surface_material_programs import (material_outcome_gap_rows, material_package_paths, material_program_outcome, program_root_is_ported,
                                             world_material_sources)
from world.world_lane_names import WORLD_LANE_NAME
from world.tile_census_validation import GAP_STATUS

STATIC_MESH_MATERIALS_STEP_ALGORITHM_VERSION = 1
STATIC_MESH_MATERIALS_STEP_NAME = 'static-mesh-materials'
STATIC_MESH_MATERIALS_PRODUCT_NAME = 'static-mesh-materials.json'
SOURCE_REFERENCE_EXTRAS_FIELD = 'nativeSourceReference'


class StaticMeshMaterialsStepError(ValueError):
    pass


def static_mesh_materials_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), STATIC_MESH_MATERIALS_STEP_NAME, STATIC_MESH_MATERIALS_STEP_ALGORITHM_VERSION)


def static_mesh_materials_unit_config(project_root, tile_id, lock_record):
    meshes_fingerprint, _ = sealed_static_meshes(project_root, tile_id, lock_record)
    return {'meshesFingerprint': meshes_fingerprint, 'converterSha256': implementation_hash()}


def static_mesh_materials_product_path(ledger, unit_key):
    return ledger.unit_step_directory(unit_key) / PRODUCTS_FOLDER_NAME / STATIC_MESH_MATERIALS_PRODUCT_NAME


def sealed_static_mesh_materials(project_root, tile_id, lock_record):
    ledger, unit_key = static_mesh_materials_ledger(project_root), tile_unit_key(tile_id)
    config = static_mesh_materials_unit_config(project_root, tile_id, lock_record)
    receipt = receipt_with_current_version_config_and_locked_inputs(ledger, unit_key, tile_id, config)
    if receipt is None:
        return None, None
    return receipt['fingerprint'], json.loads(static_mesh_materials_product_path(ledger, unit_key).read_text(encoding='utf-8'))


def tile_static_mesh_materials_row(tile_id, source_identity, gap_rows, evidence):
    if gap_rows:
        return tile_step_row(tile_id, STATIC_MESH_MATERIALS_STEP_NAME, GAP_STATUS, gap_rows[0]['reason'], source_identity, evidence)
    return tile_step_row(tile_id, STATIC_MESH_MATERIALS_STEP_NAME, 'pass', None, source_identity, evidence)


def model_slot_source_references(store_root, model):
    glb = confined_child_path(store_root, model['model']['file']).read_bytes()
    if sha256_hex(glb) != model['model']['sha256']:
        raise StaticMeshMaterialsStepError(f'static mesh model {model["model"]["file"]} differs from its sealed SHA-256 {model["model"]["sha256"]}')
    document, _ = glb_document_and_binary(glb)
    references = []
    for material in document.get('materials', []):
        extras = material.get('extras') if isinstance(material, dict) else None
        reference = extras.get(SOURCE_REFERENCE_EXTRAS_FIELD) if isinstance(extras, dict) else None
        if reference is not None and not (isinstance(reference, str) and reference.strip()):
            raise StaticMeshMaterialsStepError(f'static mesh model {model["id"]} names a slot material that is no object name: {reference!r}')
        if reference is not None:
            references.append(reference)
    return references


def static_mesh_material_identities(store_root, static_meshes):
    identities = {}
    for model in static_meshes['models']:
        for reference in model_slot_source_references(store_root, model):
            identities.setdefault(reference.casefold(), reference)
    return sorted(identities.values(), key=lambda identity: (identity.casefold(), identity))


def listed_static_mesh_materials(outcomes):
    return [{'sourceObject': identity, 'program': outcome.program_record,
             'rootPorted': outcome.program is not None and program_root_is_ported(outcome.program), 'gapReasons': outcome.gap_reasons}
            for identity, outcome in outcomes.items()]


def write_static_mesh_materials_listing(store_root, tile_id, outcomes):
    material_files = unique_native_material_files(tile_id, [outcome.store_outputs for outcome in outcomes.values()])
    relative_path, payload = static_mesh_materials_listing(tile_id, listed_static_mesh_materials(outcomes), material_files)
    return publish_native_material_listing(store_root, relative_path, payload, material_files)


def run_static_mesh_materials_step(project_root, client_root, tile_id):
    require_tile_id(tile_id)
    lock_record = read_tile_map_lock_record(tile_id)
    source_identity = {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}
    ledger, unit_key = static_mesh_materials_ledger(project_root), tile_unit_key(tile_id)
    receipt_evidence = (ledger.unit_step_directory(unit_key) / RECEIPT_RECORD_NAME).relative_to(ledger.lane_folder).as_posix()
    config = static_mesh_materials_unit_config(project_root, tile_id, lock_record)
    if receipt_with_current_version_config_and_locked_inputs(ledger, unit_key, tile_id, config) is not None:
        product = json.loads(static_mesh_materials_product_path(ledger, unit_key).read_text(encoding='utf-8'))
        return tile_static_mesh_materials_row(tile_id, source_identity, product['gapRows'], receipt_evidence)
    _, static_meshes = sealed_static_meshes(project_root, tile_id, lock_record)
    if static_meshes is None:
        raise FormatError(f'static-mesh-materials of {unit_key} needs a sealed meshes unit; run --step meshes first')
    store_root = lane_store_root(project_root, WORLD_LANE_NAME)
    identities = static_mesh_material_identities(store_root, static_meshes)
    sources = world_material_sources(Path(client_root).resolve(), project_root)
    outcomes = {identity: material_program_outcome(identity, *sources) for identity in identities}
    inputs = locked_input_records(sorted({tile_map_path(tile_id), *material_package_paths(sources.map_sources, identities)}))
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    gap_rows = material_outcome_gap_rows(tile_id, STATIC_MESH_MATERIALS_STEP_NAME, source_identity, receipt_evidence, outcomes)
    products_directory = ledger.begin(unit_key, fingerprint) / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    listing, store_records = write_static_mesh_materials_listing(store_root, tile_id, outcomes) if outcomes else (None, [])
    product = {'tileId': tile_id, 'listing': listing, 'materialCount': len(outcomes), 'gapRows': gap_rows}
    product_payload = json_bytes(product)
    product_path = products_directory / STATIC_MESH_MATERIALS_PRODUCT_NAME
    product_path.write_bytes(product_payload)
    outputs = [{**record, 'path': (store_root / record['path']).relative_to(store_root.parent).as_posix()} for record in store_records]
    outputs.append({'path': product_path.relative_to(ledger.lane_folder).as_posix(), 'sha256': sha256_hex(product_payload),
                    'bytes': len(product_payload)})
    ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': inputs, 'outputs': outputs, 'gapRows': gap_rows})
    return tile_static_mesh_materials_row(tile_id, source_identity, gap_rows, receipt_evidence)
