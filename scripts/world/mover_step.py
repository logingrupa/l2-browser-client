import json
from pathlib import Path
from typing import NamedTuple

from native_assets import implementation_hash
from native_assets_lib.gltf import json_bytes
from native_catalog.ue2 import FormatError
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import sha256_hex
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from world.map_sources import MapSources
from world.mover_class_defaults import MOVER_CLASS, MOVER_CLASS_UNIT_KEY, mover_class_evidence, sealed_mover_class_receipt_sha256
from world.mover_records import MoverUnsupportedError, read_mover_actor
from world.raw_map_step import PRODUCTS_FOLDER_NAME, read_tile_map_lock_record, require_tile_id, tile_map_path, tile_step_row, tile_unit_key
from world.static_collision_sources import COLLISION_RULES_PATH, decide_placement_collision, load_collision_rules, model_slot_properties, static_mesh_selectors
from world.static_mesh_step import ConvertedStaticMesh, conversion_failure_reason, model_sort_key, static_mesh_outcomes, write_static_mesh_store_files
from world.static_placement import read_class_evidence
from world.static_placement_plan import FAILED_STATUS
from world.tile_census import WORLD_LANE_NAME
from world.tile_census_validation import GAP_STATUS
from world.tile_json_resource import write_tile_json_resource
from world.tile_chunk_plan import read_locked_map_package, sealed_chunk_plan

MOVER_STEP_ALGORITHM_VERSION = 1
MOVER_STEP_NAME = 'movers'
MOVERS_PRODUCT_NAME = 'movers.json'
TILE_MOVERS_KIND = 'native-tile-movers'
TILE_MOVERS_SCHEMA_VERSION = 1
TILE_MOVERS_FOLDER = 'movers'
TILE_MOVERS_NAME = 'tile-movers.json'
RAW_MAP_PRODUCT_PATH = 'raw/map.unwrapped.bin'
TILE_MOVER_FIELDS = ('id', 'actorName', 'modelId', 'serverObject', 'closedMatrix', 'openMatrix', 'moveTimeSeconds', 'initialKey', 'initiallyClosed',
                     'keys', 'sounds')


class MoverStepError(ValueError):
    pass


class MoverUnit(NamedTuple):
    ledger: object
    unit_key: str
    fingerprint: str
    config: dict
    inputs: list
    raw_products: Path


class ReadMover(NamedTuple):
    item: dict
    record: dict
    mesh_source: dict
    source_rows: dict


def mover_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), MOVER_STEP_NAME, MOVER_STEP_ALGORITHM_VERSION)


def collision_rules_sha256():
    return sha256_hex(canonical_json_bytes(json.loads(COLLISION_RULES_PATH.read_text(encoding='utf-8'))))


def mover_unit_config(chunks_fingerprint, class_receipt_sha256):
    return {'chunksFingerprint': chunks_fingerprint, 'classDefaultsReceiptSha256': class_receipt_sha256, 'converterSha256': implementation_hash(),
            'collisionRulesSha256': collision_rules_sha256()}


def mover_actors(raw_products):
    actors = json.loads((raw_products / 'actors.json').read_text(encoding='utf-8'))
    return sorted((actor for actor in actors if actor['classObject'] == MOVER_CLASS), key=lambda actor: actor['exportIndex'])


def mover_mesh_packages(actors, sources):
    packages = set()
    for actor in actors:
        for prop in actor['properties']:
            reference = prop.get('value', {}).get('object') if prop['name'] == 'StaticMesh' and isinstance(prop.get('value'), dict) else None
            candidates = sources.paths.get(reference.split('.')[0].casefold(), []) if isinstance(reference, str) else []
            if len(candidates) == 1:
                packages.add(candidates[0])
    return sorted(packages)


def mover_unit(project_root, tile_id, lock_record, class_receipt_sha256, sources):
    chunks_fingerprint, raw_products, _ = sealed_chunk_plan(project_root, tile_id, lock_record)
    inputs = locked_input_records(sorted({tile_map_path(tile_id), *mover_mesh_packages(mover_actors(raw_products), sources)}))
    ledger = mover_ledger(project_root)
    config = mover_unit_config(chunks_fingerprint, class_receipt_sha256)
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    return MoverUnit(ledger, tile_unit_key(tile_id), fingerprint, config, inputs, raw_products)


def movers_product_path(ledger, unit_key):
    return ledger.unit_step_directory(unit_key) / PRODUCTS_FOLDER_NAME / MOVERS_PRODUCT_NAME


def sealed_movers(project_root, tile_id, lock_record):
    class_receipt_sha256 = sealed_mover_class_receipt_sha256(project_root)
    if class_receipt_sha256 is None:
        return None, None
    chunks_fingerprint, _, _ = sealed_chunk_plan(project_root, tile_id, lock_record)
    ledger, unit_key = mover_ledger(project_root), tile_unit_key(tile_id)
    receipt = ledger.sealed_receipt(unit_key)
    if (receipt is None or receipt['algorithmVersion'] != MOVER_STEP_ALGORITHM_VERSION
            or receipt['config'] != mover_unit_config(chunks_fingerprint, class_receipt_sha256)):
        return None, None
    paths = [record['path'] for record in receipt['inputs']]
    if tile_map_path(tile_id) not in paths or locked_input_records(paths) != receipt['inputs']:
        return None, None
    return receipt['fingerprint'], json.loads(movers_product_path(ledger, unit_key).read_text(encoding='utf-8'))


def tile_mover_row(tile_id, source_identity, gap_rows, evidence):
    if gap_rows:
        return tile_step_row(tile_id, MOVER_STEP_NAME, GAP_STATUS, gap_rows[0]['reason'], source_identity, evidence)
    return tile_step_row(tile_id, MOVER_STEP_NAME, 'pass', None, source_identity, evidence)


def read_tile_movers(package, sources, defaults, tile_id, object_gap):
    read_movers = []
    items = sorted((item for item in package.exports if item['classObject'] == MOVER_CLASS), key=lambda item: item['exportIndex'])
    for item in items:
        try:
            record, mesh_source, source_rows = read_mover_actor(package, item, sources, defaults, tile_map_path(tile_id), RAW_MAP_PRODUCT_PATH)
        except MoverUnsupportedError as error:
            object_gap(item, GAP_STATUS, error.reason)
            continue
        except FormatError as error:
            object_gap(item, FAILED_STATUS, conversion_failure_reason(error))
            continue
        read_movers.append(ReadMover(item, record, mesh_source, source_rows))
    return items, read_movers


def mesh_requests(read_movers):
    requests = {mover.mesh_source['object']: {'kind': 'model', 'package': mover.mesh_source['package'], 'object': mover.mesh_source['object']}
                for mover in read_movers}
    return [requests[name] for name in sorted(requests, key=lambda name: (name.casefold(), name))]


def model_glb(outcome):
    model_file = outcome.model_record['model']['file']
    return outcome.store_files[model_file.casefold()][1]


def tile_mover_entry(mover, collision):
    return {**{field: mover.record[field] for field in TILE_MOVER_FIELDS}, 'exportIndex': mover.item['exportIndex'], 'collision': collision}


def mover_collision(mover, actor, class_evidence, outcome, sources, rules):
    request = {'package': mover.mesh_source['package'], 'object': mover.mesh_source['object']}
    decision = decide_placement_collision(actor, class_evidence, model_slot_properties(model_glb(outcome)), static_mesh_selectors(sources, request, rules), rules)
    return {'decision': decision['decision'], 'slots': decision['slots'], 'evidence': decision['evidence']}


def tile_model_entry(model_record):
    return {'id': model_record['id'], 'sourceObject': model_record['sourceObject'],
            **{part: {'resource': '/l2/' + model_record[part]['file'], 'sha256': model_record[part]['sha256'], 'bytes': model_record[part]['bytes']}
               for part in ('archive', 'model')}}


def product_mover_entry(mover, collision, model_record):
    location = mover.record['resolvedProperties']['Location']['value']
    return {'id': mover.record['id'], 'object': mover.item['object'], 'exportIndex': mover.item['exportIndex'], 'modelId': model_record['id'],
            'model': model_record['model'], 'origin': [location[axis] for axis in 'XYZ'], 'closedSourceRows': mover.source_rows['closed'],
            'openSourceRows': mover.source_rows['open'], 'collision': collision}


def class_evidence_record(evidence):
    return {'unit': MOVER_CLASS_UNIT_KEY, 'evidenceSha256': evidence.evidence_sha256,
            'classes': [{'object': definition['object'], 'package': definition['source']['package'], 'packageSha256': definition['source']['packageSha256']}
                        for definition in sorted(evidence.definitions.values(), key=lambda definition: definition['object'])]}


class MoverConversion:
    def __init__(self, tile_id, source_identity, evidence):
        self.tile_id, self.source_identity, self.evidence = tile_id, source_identity, evidence
        self.gapped = []

    def gap(self, item, status, reason):
        row = tile_step_row(self.tile_id, MOVER_STEP_NAME, status, reason, {**self.source_identity, 'object': item['object']}, self.evidence)
        self.gapped.append((item['exportIndex'], row))

    def gap_rows(self):
        return [row for _, row in sorted(self.gapped, key=lambda entry: entry[0])]


def converted_movers(read_movers, outcomes, conversion):
    converted = []
    for mover in read_movers:
        outcome = outcomes[mover.mesh_source['object']]
        if isinstance(outcome, ConvertedStaticMesh):
            converted.append((mover, outcome))
        else:
            conversion.gap(mover.item, *outcome)
    return converted


def require_every_mover_classified(tile_id, items, converted, gapped):
    classified = sorted([mover.item['exportIndex'] for mover, _ in converted] + [export_index for export_index, _ in gapped])
    if classified != sorted(item['exportIndex'] for item in items):
        raise MoverStepError(f'{len(converted)} converted and {len(gapped)} gapped movers do not classify the {len(items)} Engine.Mover exports of {tile_id} '
                             'once each')


def mover_models(converted):
    return sorted({outcome.model_record['id']: outcome.model_record for _, outcome in converted}.values(), key=model_sort_key)


def run_mover_step(project_root, client_root, tile_id):
    require_tile_id(tile_id)
    lock_record = read_tile_map_lock_record(tile_id)
    source_identity = {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}
    client = Path(client_root).resolve()
    sources = MapSources(client)
    evidence = mover_class_evidence(project_root, client)
    unit = mover_unit(project_root, tile_id, lock_record, evidence.receipt_sha256, sources)
    step_directory = unit.ledger.unit_step_directory(unit.unit_key)
    receipt_evidence = (step_directory / RECEIPT_RECORD_NAME).relative_to(unit.ledger.lane_folder).as_posix()
    if unit.ledger.is_sealed(unit.unit_key, unit.fingerprint):
        return tile_mover_row(tile_id, source_identity, json.loads(movers_product_path(unit.ledger, unit.unit_key).read_text(encoding='utf-8'))['gapRows'],
                              receipt_evidence)
    conversion = MoverConversion(tile_id, source_identity, receipt_evidence)
    package = read_locked_map_package(client, tile_id, lock_record)
    items, read_movers = read_tile_movers(package, sources, evidence.defaults, tile_id, conversion.gap)
    outcomes = static_mesh_outcomes(project_root, client, mesh_requests(read_movers))
    converted = converted_movers(read_movers, outcomes, conversion)
    require_every_mover_classified(tile_id, items, converted, conversion.gapped)
    actors_by_export = {actor['exportIndex']: actor for actor in mover_actors(unit.raw_products)}
    if any(mover.item['exportIndex'] not in actors_by_export for mover, _ in converted):
        raise MoverStepError(f'raw actors of {tile_id} miss an Engine.Mover export; rerun --step raw')
    rules, class_evidence = load_collision_rules(), read_class_evidence(client, lane_work_root(project_root, WORLD_LANE_NAME))
    collisions = [mover_collision(mover, actors_by_export[mover.item['exportIndex']], class_evidence, outcome, sources, rules) for mover, outcome in converted]
    models = mover_models(converted)
    gap_rows = conversion.gap_rows()
    products_directory = unit.ledger.begin(unit.unit_key, unit.fingerprint) / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    outputs, manifest_record = write_static_mesh_store_files(project_root, {'models': models}, outcomes), None
    if converted:
        manifest = {'kind': TILE_MOVERS_KIND, 'schemaVersion': TILE_MOVERS_SCHEMA_VERSION, 'tileId': tile_id,
                    'sourceMap': {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}, 'classEvidence': class_evidence_record(evidence),
                    'models': [tile_model_entry(model) for model in models],
                    'movers': [tile_mover_entry(mover, collision) for (mover, _), collision in zip(converted, collisions)], 'gaps': gap_rows}
        manifest_record, manifest_output = write_tile_json_resource(lane_store_root(project_root, WORLD_LANE_NAME), TILE_MOVERS_FOLDER, TILE_MOVERS_NAME, manifest)
        outputs.append(manifest_output)
    product = {'tileId': tile_id, 'exportCount': len(items), 'manifest': manifest_record,
               'movers': [product_mover_entry(mover, collision, outcome.model_record) for (mover, outcome), collision in zip(converted, collisions)],
               'gapRows': gap_rows}
    product_payload = json_bytes(product)
    product_path = products_directory / MOVERS_PRODUCT_NAME
    product_path.write_bytes(product_payload)
    outputs.append({'path': product_path.relative_to(unit.ledger.lane_folder).as_posix(), 'sha256': sha256_hex(product_payload), 'bytes': len(product_payload)})
    unit.ledger.seal(unit.unit_key, unit.fingerprint, {'config': unit.config, 'inputs': unit.inputs, 'outputs': outputs, 'gapRows': gap_rows})
    return tile_mover_row(tile_id, source_identity, gap_rows, receipt_evidence)
