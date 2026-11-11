import json
from pathlib import Path
import re
import subprocess
from typing import NamedTuple

from actors.npc_store_records import converted_model_store_files_and_record
from native_assets import UMODEL, Converter, implementation_hash
from native_assets_lib.gltf import json_bytes
from native_assets_lib.static_materials import REVIEWED_VERSIONS, static_material_layout_unreviewed_reason
from native_catalog.ue2 import FormatError
from native_store.catalog_writer import add_store_file, immutable_write, sha256_hex, verify_store_destinations
from native_store.store_paths import REPOSITORY_ROOT, confined_child_path, lane_store_root, lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from reference_client_guard import require_reference_client
from static_material_package_census import STATIC_MESH_PACKAGE_CENSUS_RELATIVE_PATH, validate_static_mesh_package_census
from world.light_actors import reference_client_class_chains
from world.native_terrain_sectors import native_terrain
from world.raw_map_step import PRODUCTS_FOLDER_NAME, read_tile_map_lock_record, require_tile_id, tile_map_path, tile_step_row, tile_unit_key
from world.static_placement import read_class_evidence
from world.static_placement_plan import FAILED_STATUS, chunk_rectangles, plan_static_placements, static_mesh_actor_subclass_actors, static_mesh_actors
from world.tile_census import WORLD_LANE_NAME, read_package_header
from world.tile_census_validation import GAP_STATUS
from world.tile_chunk_plan import read_locked_map_package, sealed_chunk_plan

STATIC_MESH_STEP_ALGORITHM_VERSION = 3
STATIC_MESH_STEP_NAME = 'meshes'
STATIC_MESHES_PRODUCT_NAME = 'static-meshes.json'
STATIC_MESH_CONVERTER_FOLDER = 'static-mesh-converter'
STATIC_MESH_REQUESTS_PRODUCT_NAME = 'static-mesh-requests.json'
STATIC_MESH_BINDINGS_PRODUCT_NAME = 'section-bindings.json'
PLACEMENT_MATERIAL_OVERRIDE_REASON = 'placement-material-override-unsupported'
STATIC_MESH_REFERENCE_UNRESOLVED_REASON = 'static-mesh-reference-unresolved'
MODEL_CONVERSION_ERRORS = (FormatError, ValueError, subprocess.TimeoutExpired)


class StaticMeshStepError(ValueError):
    pass


class StaticMeshUnit(NamedTuple):
    ledger: object
    unit_key: str
    fingerprint: str
    config: dict
    inputs: list
    chunk_plan: dict
    raw_products: Path
    requests_by_reference: dict


class ConvertedStaticMesh(NamedTuple):
    model_record: dict
    store_files: dict


def static_mesh_requests_by_reference(raw_products):
    requests = json.loads((raw_products / STATIC_MESH_REQUESTS_PRODUCT_NAME).read_text(encoding='utf-8'))
    bindings = json.loads((raw_products / STATIC_MESH_BINDINGS_PRODUCT_NAME).read_text(encoding='utf-8'))
    if len(requests) != len(bindings) or any(request['object'].casefold() != binding['sourceObject'].casefold()
                                             for request, binding in zip(requests, bindings)):
        raise StaticMeshStepError(f'raw static mesh requests and section bindings of {raw_products} do not pair one to one')
    return {binding['sourceObject']: request for request, binding in zip(requests, bindings)}


def static_mesh_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), STATIC_MESH_STEP_NAME, STATIC_MESH_STEP_ALGORITHM_VERSION)


def read_static_mesh_package_census():
    return validate_static_mesh_package_census(json.loads((REPOSITORY_ROOT / STATIC_MESH_PACKAGE_CENSUS_RELATIVE_PATH).read_text(encoding='utf-8')))


def static_material_review_state(census, package_records):
    rows_by_casefolded_path = {row['path'].casefold(): row for row in census['packages']}
    state = []
    for record in package_records:
        row = rows_by_casefolded_path.get(record['path'].casefold())
        if row is None or row['sha256'] != record['sha256']:
            raise StaticMeshStepError(f'static mesh package census {STATIC_MESH_PACKAGE_CENSUS_RELATIVE_PATH} holds no row with the lock eSha256 '
                                      f'of {record["path"]}; regenerate it with scripts/static_material_package_census.py')
        version = (row['packageVersion'], row['licensee'])
        state.append([record['path'], *version, version in REVIEWED_VERSIONS])
    return sorted(state)


def static_mesh_unit(project_root, tile_id, lock_record):
    chunks_fingerprint, raw_products, chunk_plan = sealed_chunk_plan(project_root, tile_id, lock_record)
    requests_by_reference = static_mesh_requests_by_reference(raw_products)
    package_paths = sorted({request['package'] for request in requests_by_reference.values()})
    inputs = locked_input_records(sorted({tile_map_path(tile_id), *package_paths}))
    ledger = static_mesh_ledger(project_root)
    config = {'chunksFingerprint': chunks_fingerprint, 'converterSha256': implementation_hash(),
              'staticMaterialReviewState': static_material_review_state(read_static_mesh_package_census(),
                                                                        [record for record in inputs if record['path'] in package_paths])}
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    return StaticMeshUnit(ledger, tile_unit_key(tile_id), fingerprint, config, inputs, chunk_plan, raw_products, requests_by_reference)


def static_meshes_product_path(unit):
    return unit.ledger.unit_step_directory(unit.unit_key) / PRODUCTS_FOLDER_NAME / STATIC_MESHES_PRODUCT_NAME


def sealed_static_meshes(project_root, tile_id, lock_record):
    unit = static_mesh_unit(project_root, tile_id, lock_record)
    if not unit.ledger.is_sealed(unit.unit_key, unit.fingerprint):
        return None, None
    return unit.fingerprint, json.loads(static_meshes_product_path(unit).read_text(encoding='utf-8'))


def tile_static_mesh_row(tile_id, source_identity, gap_rows, evidence):
    if gap_rows:
        return tile_step_row(tile_id, STATIC_MESH_STEP_NAME, GAP_STATUS, gap_rows[0]['reason'], source_identity, evidence)
    return tile_step_row(tile_id, STATIC_MESH_STEP_NAME, 'pass', None, source_identity, evidence)


def package_gate_reason(header):
    if 'error' in header:
        return FAILED_STATUS, f'decode-failed:{header["error"]}'
    if (header['packageVersion'], header['licensee']) not in REVIEWED_VERSIONS:
        return GAP_STATUS, static_material_layout_unreviewed_reason(header['packageVersion'], header['licensee'])
    return None


CONVERSION_FAILURE_DETAIL_SEPARATOR = re.compile(r'[:;]')


def conversion_failure_reason(error):
    message = str(error).strip()
    sentence = CONVERSION_FAILURE_DETAIL_SEPARATOR.split(message.splitlines()[0], maxsplit=1)[0].strip() if message else ''
    return f'decode-failed:{type(error).__name__}:{sentence or "no message"}'


def model_sort_key(model_record):
    return model_record['sourceObject'].casefold(), model_record['sourceObject']


def convert_static_mesh(converter, request):
    result = converter.convert({'kind': 'model', 'package': request['package'], 'object': request['object']})
    store_files, record = converted_model_store_files_and_record(None, Path(result['file']))
    archive_relative, model_relative = record['archive'].removeprefix('/l2/'), record['model'].removeprefix('/l2/')
    model_record = {'id': record['assetId'], 'sourceObject': record['source']['object'],
                    'archive': {'file': archive_relative, 'sha256': record['archiveSha256'], 'bytes': len(store_files[archive_relative.casefold()][1])},
                    'model': {'file': model_relative, 'sha256': record['modelSha256'], 'bytes': len(store_files[model_relative.casefold()][1])}}
    return ConvertedStaticMesh(model_record, store_files)


class StaticMeshAssignment:
    def __init__(self, tile_id, source_identity, evidence):
        self.tile_id, self.source_identity, self.evidence = tile_id, source_identity, evidence
        self.placed_by_chunk, self.gapped = {}, []

    def gap(self, chunk_id, placement, status, reason):
        row = tile_step_row(self.tile_id, STATIC_MESH_STEP_NAME, status, reason, {**self.source_identity, 'object': placement['sourceActor']},
                            self.evidence)
        self.gapped.append((placement['exportIndex'], chunk_id, row))

    def place(self, chunk_id, placement, model_id):
        self.placed_by_chunk.setdefault(chunk_id, []).append({**placement, 'modelId': model_id})

    def placed_count(self):
        return sum(len(placements) for placements in self.placed_by_chunk.values())

    def gap_rows(self):
        return [row for _, _, row in sorted(self.gapped, key=lambda entry: entry[0])]

    def chunk_gap_rows(self, chunk_id):
        return [row for _, gapped_chunk_id, row in sorted(self.gapped, key=lambda entry: entry[0]) if gapped_chunk_id == chunk_id]


def assign_static_placements(plan, requests_by_reference, mesh_outcomes, assignment):
    for unplaced in plan.unplaced:
        assignment.gap(None, unplaced.placement, unplaced.status, unplaced.reason)
    for chunk_id, placements in plan.placements_by_chunk.items():
        for placement in placements:
            request = requests_by_reference.get(placement['sourceMesh'])
            if placement['materialOverrides']:
                assignment.gap(chunk_id, placement, GAP_STATUS, PLACEMENT_MATERIAL_OVERRIDE_REASON)
            elif request is None:
                assignment.gap(chunk_id, placement, GAP_STATUS, STATIC_MESH_REFERENCE_UNRESOLVED_REASON)
            elif isinstance(mesh_outcomes[request['object']], ConvertedStaticMesh):
                assignment.place(chunk_id, placement, mesh_outcomes[request['object']].model_record['id'])
            else:
                status, reason = mesh_outcomes[request['object']]
                assignment.gap(chunk_id, placement, status, reason)
    return assignment


def placeable_requests(plan, requests_by_reference):
    requests = {}
    for placements in plan.placements_by_chunk.values():
        for placement in placements:
            request = requests_by_reference.get(placement['sourceMesh'])
            if request is not None and not placement['materialOverrides']:
                requests[request['object']] = request
    return [requests[name] for name in sorted(requests, key=lambda name: (name.casefold(), name))]


def static_mesh_outcomes(project_root, client, requests):
    reference_client = require_reference_client(client)
    gate_by_package, outcomes = {}, {}
    converter = None
    for request in requests:
        if request['package'] not in gate_by_package:
            gate_by_package[request['package']] = package_gate_reason(read_package_header(reference_client, request['package']))
        gate = gate_by_package[request['package']]
        if gate is not None:
            outcomes[request['object']] = gate
            continue
        converter = converter or Converter(client, lane_work_root(project_root, WORLD_LANE_NAME) / STATIC_MESH_CONVERTER_FOLDER, UMODEL,
                                           project_root=project_root)
        try:
            outcomes[request['object']] = convert_static_mesh(converter, request)
        except MODEL_CONVERSION_ERRORS as error:
            outcomes[request['object']] = (FAILED_STATUS, conversion_failure_reason(error))
    return outcomes


def chunk_model_records(placements, models_by_id):
    placements_by_model = {}
    for placement in sorted(placements, key=lambda placement: placement['exportIndex']):
        placements_by_model.setdefault(placement['modelId'], []).append(placement)
    models = sorted((models_by_id[model_id] for model_id in placements_by_model), key=model_sort_key)
    return [{'id': model['id'], 'archive': '/l2/' + model['archive']['file'], 'archiveSha256': model['archive']['sha256'],
             'placements': placements_by_model[model['id']]} for model in models]


def static_meshes_product(tile_id, chunk_plan, assignment, mesh_outcomes):
    converted = [outcome for outcome in mesh_outcomes.values() if isinstance(outcome, ConvertedStaticMesh)]
    placed_model_ids = {placement['modelId'] for placements in assignment.placed_by_chunk.values() for placement in placements}
    models_by_id = {outcome.model_record['id']: outcome.model_record for outcome in converted if outcome.model_record['id'] in placed_model_ids}
    chunks = {chunk['chunkId']: {'models': chunk_model_records(assignment.placed_by_chunk.get(chunk['chunkId'], []), models_by_id),
                                 'gapRows': assignment.chunk_gap_rows(chunk['chunkId'])}
              for chunk in chunk_plan['chunks']}
    return {'tileId': tile_id, 'models': sorted(models_by_id.values(), key=model_sort_key), 'chunks': chunks,
            'unplacedGapRows': assignment.chunk_gap_rows(None), 'gapRows': assignment.gap_rows()}


def placement_accounting_difference(actors, class_chains, assignment):
    expected = len(static_mesh_actors(actors)) + len(static_mesh_actor_subclass_actors(actors, class_chains))
    accounted = assignment.placed_count() + len(assignment.gapped)
    return None if accounted == expected else (f'{accounted} placed or gapped of {expected} StaticMeshActor exports with a StaticMesh reference '
                                               'or of a StaticMeshActor subclass')


def write_static_mesh_store_files(project_root, product, mesh_outcomes):
    store_root = lane_store_root(project_root, WORLD_LANE_NAME)
    model_ids = {model['id'] for model in product['models']}
    store_files = {}
    for outcome in mesh_outcomes.values():
        if isinstance(outcome, ConvertedStaticMesh) and outcome.model_record['id'] in model_ids:
            for relative, payload in outcome.store_files.values():
                add_store_file(store_files, relative, payload)
    verify_store_destinations(store_root, store_files)
    for relative, payload in store_files.values():
        immutable_write(confined_child_path(store_root, relative), payload)
    return [{'path': (store_root / relative).relative_to(store_root.parent).as_posix(), 'sha256': sha256_hex(payload), 'bytes': len(payload)}
            for relative, payload in sorted(store_files.values())]


def run_static_mesh_step(project_root, client_root, tile_id):
    require_tile_id(tile_id)
    lock_record = read_tile_map_lock_record(tile_id)
    source_identity = {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}
    unit = static_mesh_unit(project_root, tile_id, lock_record)
    step_directory = unit.ledger.unit_step_directory(unit.unit_key)
    receipt_evidence = (step_directory / RECEIPT_RECORD_NAME).relative_to(unit.ledger.lane_folder).as_posix()
    if unit.ledger.is_sealed(unit.unit_key, unit.fingerprint):
        receipt = json.loads((step_directory / RECEIPT_RECORD_NAME).read_text(encoding='utf-8'))
        product = json.loads(static_meshes_product_path(unit).read_text(encoding='utf-8'))
        if len(receipt['gapRows']) != len(product['gapRows']):
            raise StaticMeshStepError(f'sealed static mesh receipt of {unit.unit_key} differs from its product gap rows')
        return tile_static_mesh_row(tile_id, source_identity, product['gapRows'], receipt_evidence)
    client = Path(client_root).resolve()
    actors = json.loads((unit.raw_products / 'actors.json').read_text(encoding='utf-8'))
    class_chains = reference_client_class_chains(read_class_evidence(client, lane_work_root(project_root, WORLD_LANE_NAME)))
    try:
        rectangles = chunk_rectangles(unit.chunk_plan, native_terrain(read_locked_map_package(client, tile_id, lock_record)))
        plan = plan_static_placements(actors, rectangles, class_chains)
    except FormatError as error:
        return tile_step_row(tile_id, STATIC_MESH_STEP_NAME, FAILED_STATUS, f'decode-failed:{error}', source_identity,
                             step_directory.relative_to(unit.ledger.lane_folder).as_posix())
    mesh_outcomes = static_mesh_outcomes(project_root, client, placeable_requests(plan, unit.requests_by_reference))
    assignment = assign_static_placements(plan, unit.requests_by_reference, mesh_outcomes,
                                          StaticMeshAssignment(tile_id, source_identity, receipt_evidence))
    difference = placement_accounting_difference(actors, class_chains, assignment)
    if difference is not None:
        return tile_step_row(tile_id, STATIC_MESH_STEP_NAME, FAILED_STATUS, f'decode-failed:placement accounting: {difference}', source_identity,
                             step_directory.relative_to(unit.ledger.lane_folder).as_posix())
    product = static_meshes_product(tile_id, unit.chunk_plan, assignment, mesh_outcomes)
    products_directory = unit.ledger.begin(unit.unit_key, unit.fingerprint) / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    outputs = write_static_mesh_store_files(project_root, product, mesh_outcomes)
    product_payload = json_bytes(product)
    product_path = products_directory / STATIC_MESHES_PRODUCT_NAME
    product_path.write_bytes(product_payload)
    outputs.append({'path': product_path.relative_to(unit.ledger.lane_folder).as_posix(), 'sha256': sha256_hex(product_payload),
                    'bytes': len(product_payload)})
    unit.ledger.seal(unit.unit_key, unit.fingerprint, {'config': unit.config, 'inputs': unit.inputs, 'outputs': outputs,
                                                       'gapRows': product['gapRows']})
    return tile_static_mesh_row(tile_id, source_identity, product['gapRows'], receipt_evidence)
