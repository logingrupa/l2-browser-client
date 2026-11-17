import io
import json
import re
import zipfile

from native_assets import implementation_hash
from native_assets_lib.class_defaults import ReferenceClientClassScripts
from native_assets_lib.gltf import json_bytes
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_index_keys import model_record_unit_key, read_profile_manifest_profiles, store_root_candidates
from native_store.catalog_writer import (MATERIAL_PROGRAM_RECORD_ID_PREFIX, UE2_OBJECT_PATH_PATTERN_TEXT, add_store_file,
                                         read_store_catalog, write_store)
from native_store.verified_file_writes import sha256_hex
from native_store.native_material_program_pins import NATIVE_MATERIALS_FOLDER
from native_store.store_file_publish import publish_store_files
from native_store.store_paths import confined_child_path, lane_store_root, lane_work_root
from native_store.unit_ledger import UnitLedger, locked_input_records
from native_store.catalog_record_replacement import catalog_with_records_replaced
from world.map_sources import MapSources
from world.surface_material_programs import WorldMaterialSources, material_package_paths, material_program_outcome, program_root_is_ported

ACTORS_LANE_NAME = 'actors'
MATERIAL_PROGRAMS_STEP = 'material-programs'
MATERIAL_PROGRAMS_ALGORITHM_VERSION = 1
MATERIAL_PROGRAMS_BATCH_NAME = 'material-programs'
MATERIAL_PROGRAMS_SLICE = 'materialPrograms'
MAXIMUM_MATERIAL_PROGRAM_RECORDS = 16_384
ACTOR_MATERIAL_PROGRAM_LISTING_KIND = 'native-actor-material-program'
ACTOR_MATERIAL_PROGRAM_LISTING_SCHEMA_VERSION = 1
ACTOR_MATERIAL_PROGRAM_LISTING_PREFIX = 'material-program'
MATERIAL_PROGRAM_PRODUCT_NAME = 'material-program.json'
PRODUCTS_FOLDER_NAME = 'products'
PROVENANCE_FILE_NAME = 'provenance.json'
NATIVE_RESOURCE_PREFIX = '/l2/'
PASS_STATUS = 'pass'
GAP_STATUS = 'gap'
NPC_KEY_PREFIX = 'npc:'
UE2_OBJECT_PATH_PATTERN = re.compile('^' + UE2_OBJECT_PATH_PATTERN_TEXT + '$')


class ActorMaterialProgramError(ValueError):
    pass


def material_program_unit_key(source_object):
    return MATERIAL_PROGRAM_RECORD_ID_PREFIX + source_object


def provenance_material_slots(metadata, label):
    if 'materialSlots' in metadata:
        return metadata['materialSlots']
    parts = metadata.get('parts')
    if not isinstance(parts, list):
        raise ActorMaterialProgramError(f'{label} provenance names neither materialSlots nor assembly parts')
    return [slot for part in parts for slot in part.get('materialSlots', [])]


def model_slot_source_objects(store_root, model_record):
    label = f'actor model {model_record["id"]}'
    archive_bytes = confined_child_path(store_root, model_record['archive'].removeprefix(NATIVE_RESOURCE_PREFIX)).read_bytes()
    if sha256_hex(archive_bytes) != model_record['archiveSha256']:
        raise ActorMaterialProgramError(f'{label} archive differs from its SHA-256 {model_record["archiveSha256"]}')
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        metadata = json.loads(archive.read(PROVENANCE_FILE_NAME))['metadata']
    source_objects = []
    for slot in provenance_material_slots(metadata, label):
        material_object = resolved_slot_material_object(slot)
        if material_object is not None and not (isinstance(material_object, str) and UE2_OBJECT_PATH_PATTERN.fullmatch(material_object)):
            raise ActorMaterialProgramError(f'{label} names a slot material that is no qualified object name: {material_object!r}')
        source_objects.append(material_object)
    return source_objects


def resolved_slot_material_object(slot):
    if slot.get('unsupportedMaterialAdapter'):
        return slot['unsupportedMaterialAdapter'].get('object')
    if slot.get('nativeMaterialGraph'):
        return slot['nativeMaterialGraph'][0].get('object')
    return slot.get('texture')


def actor_material_object_inventory(store_root, model_records):
    identities = {}
    for model_record in model_records:
        for material_object in model_slot_source_objects(store_root, model_record):
            if material_object is not None:
                identities.setdefault(material_object.casefold(), material_object)
    return sorted(identities.values(), key=lambda identity: (identity.casefold(), identity))


def npc_model_ids(store_root, catalog, npc_id):
    return {profile['modelCatalogId'] for record in catalog.get('npcProfiles', [])
            for profile in read_profile_manifest_profiles('npcProfiles', record, store_root_candidates(store_root, None))
            if profile.get('npcId') == npc_id and 'modelCatalogId' in profile}


def model_records_of_catalog_key(store_root, catalog, catalog_key):
    if catalog_key.startswith(NPC_KEY_PREFIX):
        model_ids = npc_model_ids(store_root, catalog, int(catalog_key.removeprefix(NPC_KEY_PREFIX)))
        models = [record for record in catalog['models'] if record['id'] in model_ids]
    else:
        models = [record for record in catalog['models'] if model_record_unit_key(record['id']) == catalog_key]
    if not models:
        raise ActorMaterialProgramError(f'{catalog_key} names no model in the {ACTORS_LANE_NAME} lane catalog')
    return models


def actor_material_sources(client_root, project_root, converter):
    return WorldMaterialSources(MapSources(client_root), converter, lane_work_root(project_root, ACTORS_LANE_NAME),
                                ReferenceClientClassScripts(client_root), lane_store_root(project_root, ACTORS_LANE_NAME))


def material_program_listing(source_object, outcome):
    root_ported = outcome.program is not None and program_root_is_ported(outcome.program)
    if not root_ported and not outcome.gap_reasons:
        raise ActorMaterialProgramError(f'material program of {source_object} has an unported root and no gap reason')
    files = {}
    for record in outcome.store_outputs:
        if not record['path'].startswith(NATIVE_MATERIALS_FOLDER + '/'):
            raise ActorMaterialProgramError(f'material file {record["path"]} of {source_object} lies outside {NATIVE_MATERIALS_FOLDER}')
        pin = {'sha256': record['sha256'], 'bytes': record['bytes']}
        if files.setdefault(record['path'].removeprefix(NATIVE_MATERIALS_FOLDER + '/'), pin) != pin:
            raise ActorMaterialProgramError(f'material file {record["path"]} of {source_object} has two different pins')
    return {'kind': ACTOR_MATERIAL_PROGRAM_LISTING_KIND, 'schemaVersion': ACTOR_MATERIAL_PROGRAM_LISTING_SCHEMA_VERSION,
            'sourceObject': source_object, 'program': outcome.program_record, 'rootPorted': root_ported, 'gapReasons': outcome.gap_reasons,
            'files': dict(sorted(files.items()))}


def material_program_catalog_record(source_object, listing_relative_path, listing_payload):
    return {'id': material_program_unit_key(source_object), 'manifest': NATIVE_RESOURCE_PREFIX + listing_relative_path,
            'manifestSha256': sha256_hex(listing_payload), 'manifestBytes': len(listing_payload)}


class ActorMaterialProgramUnits:
    def __init__(self, project_root, sources):
        self.sources = sources
        self.ledger = UnitLedger(lane_work_root(project_root, ACTORS_LANE_NAME), MATERIAL_PROGRAMS_STEP, MATERIAL_PROGRAMS_ALGORITHM_VERSION)
        self.converter_sha256 = implementation_hash()

    def unit_work(self, source_object):
        config = {'sourceObject': source_object, 'converterSha256': self.converter_sha256}
        inputs = locked_input_records(material_package_paths(self.sources.map_sources, [source_object]))
        return material_program_unit_key(source_object), inputs, config, self.ledger.unit_fingerprint([record['sha256'] for record in inputs], config)

    def product_path(self, unit_key):
        return self.ledger.unit_step_directory(unit_key) / PRODUCTS_FOLDER_NAME / MATERIAL_PROGRAM_PRODUCT_NAME

    def sealed_product(self, source_object):
        unit_key, _, _, fingerprint = self.unit_work(source_object)
        if not self.ledger.is_sealed(unit_key, fingerprint):
            return None
        return json.loads(self.product_path(unit_key).read_bytes())

    def convert(self, source_object):
        unit_key, inputs, config, fingerprint = self.unit_work(source_object)
        if self.ledger.is_sealed(unit_key, fingerprint):
            product = json.loads(self.product_path(unit_key).read_bytes())
            return {'key': unit_key, 'step': MATERIAL_PROGRAMS_STEP, 'status': product['status'], 'reason': product['reason'], 'cacheHit': True}
        products_directory = self.ledger.begin(unit_key, fingerprint) / PRODUCTS_FOLDER_NAME
        products_directory.mkdir()
        outcome = material_program_outcome(source_object, *self.sources)
        listing = material_program_listing(source_object, outcome)
        listing_payload = canonical_json_bytes(listing)
        listing_relative_path = f'{NATIVE_MATERIALS_FOLDER}/{ACTOR_MATERIAL_PROGRAM_LISTING_PREFIX}-{sha256_hex(listing_payload)}.json'
        store_files = {}
        add_store_file(store_files, listing_relative_path, listing_payload)
        publish_store_files(self.sources.store_root, store_files)
        status = PASS_STATUS if listing['rootPorted'] else GAP_STATUS
        product = {'sourceObject': source_object, 'status': status, 'reason': None if listing['rootPorted'] else listing['gapReasons'][0],
                   'record': material_program_catalog_record(source_object, listing_relative_path, listing_payload)}
        product_payload = json_bytes(product)
        self.product_path(unit_key).write_bytes(product_payload)
        store_records = [*outcome.store_outputs, {'path': listing_relative_path, 'sha256': product['record']['manifestSha256'],
                                                  'bytes': len(listing_payload)}]
        outputs = [{**record, 'path': (self.sources.store_root / record['path']).relative_to(self.ledger.lane_folder).as_posix()}
                   for record in store_records]
        outputs.append({'path': self.product_path(unit_key).relative_to(self.ledger.lane_folder).as_posix(), 'sha256': sha256_hex(product_payload),
                        'bytes': len(product_payload)})
        self.ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': inputs, 'outputs': outputs, 'gapRows': []})
        return {'key': unit_key, 'step': MATERIAL_PROGRAMS_STEP, 'status': status, 'reason': product['reason'], 'cacheHit': False}


def publish_material_program_records(store_root, records):
    catalog, before = read_store_catalog(store_root)
    catalog = catalog_with_records_replaced(catalog, MATERIAL_PROGRAMS_SLICE, records, MAXIMUM_MATERIAL_PROGRAM_RECORDS)
    if MATERIAL_PROGRAMS_SLICE in catalog:
        catalog[MATERIAL_PROGRAMS_SLICE] = sorted(catalog[MATERIAL_PROGRAMS_SLICE], key=lambda record: record['id'])
    return write_store(store_root, {}, before, json_bytes(catalog))


def convert_actor_material_programs(project_root, client_root, converter, store_root, preflight, limit=None, catalog_key=None):
    catalog, _ = read_store_catalog(store_root)
    model_records = catalog['models'] if catalog_key is None else model_records_of_catalog_key(store_root, catalog, catalog_key)
    source_objects = actor_material_object_inventory(store_root, model_records)
    units = ActorMaterialProgramUnits(project_root, actor_material_sources(client_root, project_root, converter))
    pending = [source_object for source_object in source_objects if units.sealed_product(source_object) is None]
    outcomes = []
    try:
        for source_object in pending if limit is None else pending[:limit]:
            preflight()
            outcomes.append(units.convert(source_object))
    finally:
        products = [product for source_object in source_objects if (product := units.sealed_product(source_object)) is not None]
        store = publish_material_program_records(store_root, [product['record'] for product in products])
    summary = {'inventory': len(source_objects), 'pendingBefore': len(pending), 'convertedUnits': len(outcomes),
               'sealedUnits': len(products), 'statusCounts': {status: sum(1 for product in products if product['status'] == status)
                                                               for status in sorted({product['status'] for product in products})},
               'store': store}
    return outcomes, summary


def run_actor_material_program_conversion(project_root, client_root, converter, store_root, preflight, limit, catalog_key):
    outcomes, summary = convert_actor_material_programs(project_root, client_root, converter, store_root, preflight, limit, catalog_key)
    for outcome in outcomes:
        print(json.dumps(outcome, sort_keys=True), flush=True)
    print(json.dumps(summary, sort_keys=True), flush=True)
    return outcomes
