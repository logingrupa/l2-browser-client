import json
from pathlib import Path

from native_assets_lib.gltf import json_bytes
from native_assets_lib.world_ambience import FIELDS, KIND as AMBIENCE_KIND, pe_export_f32
from native_catalog.ue2 import FormatError
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import sha256_hex
from native_store.store_paths import REPOSITORY_ROOT, lane_store_root, lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from reference_client_guard import ReferenceClientLockError, require_reference_client
from world.ambient_sound_inventory import AMBIENT_EMITTER_UNREADABLE_REASON, AmbientEmitterUnreadable, ambient_emitter_row, inventory_ambient_sounds
from world.exact_sound_sources import ExactSoundPackages, SoundSourceGap, convert_exact_sound, lock_equal_sound_package_paths, resolve_exact_sound, \
    sound_record, world_sound_converter
from world.placement_audio_inventory import inventory_placement_audio, placement_audio_properties
from world.raw_map_step import PRODUCTS_FOLDER_NAME, read_tile_map_lock_record, require_tile_id, tile_map_path, tile_unit_key
from world.static_mesh_step import conversion_failure_reason
from world.static_placement_plan import FAILED_STATUS
from world.tile_census import WORLD_LANE_NAME
from world.tile_census_validation import GAP_STATUS
from world.tile_chunk_plan import raw_unit_fingerprint, read_locked_map_package
from world.tile_json_resource import BUNDLE_MANIFEST_NAME, write_tile_resource_bundle
from world.tile_music import MUSIC_KIND, convert_tile_music, music_derivative_spec, pinned_music_encoder
from world.tile_step_gap_rows import TileStepGapRows, tile_step_summary_row

WORLD_AUDIO_STEP_ALGORITHM_VERSION = 1
WORLD_AUDIO_STEP_NAME = 'audio'
WORLD_AUDIO_PRODUCT_NAME = 'world-audio.json'
WORLD_AUDIO_STORE_FOLDER = 'world-audio'
PLACEMENT_AUDIO_KIND = 'native-tile-placement-audio'
CORE_LIBRARY_PATH = 'system/Core.dll'
RADIUS_SYMBOLS_PATH = REPOSITORY_ROOT / 'recipes' / 'world' / 'ambience-radius-symbols.json'
REFERENCE_FILE_NOT_LOCK_EQUAL_REASON_PREFIX = 'reference-file-not-lock-equal:'
RAW_MAP_PRODUCT_PATH = 'raw/map.unwrapped.bin'
AMBIENT_SOUND_TYPE_FIELD_INDEX = FIELDS.index('ambientSoundType')
SOUND_FIELD_INDEX = FIELDS.index('sound')
NATIVE_COORDINATES = {'space': 'native Unreal world units (X, Y, Z-up)', 'browser': 'browser = (X, Z, Y) * 0.01, as section placements'}
RADIUS_EVIDENCE = ('ALAudio ambient helper compares squared distance with (SoundRadius * Core!GAudioMaxRadiusMultiplier)^2 '
                   '(backend-closure/ambient-dispatch REPORT.md)')
AMBIENCE_LIMITS = ['Authored fields only; omitted values are null and their class defaults are applied by the runtime from its sourced defaults.',
                   'Native AmbientSoundType/AmbientRandom/StartTime semantics are conditional static evidence, not observed playback.',
                   'Attenuation, listener, looping and voice priority are browser presentation choices; native audible parity is unverified.']
PLACEMENT_AUDIO_LIMITS = ['StepSound references are bound per placement as authored; automatic surface footstep playback is not established.',
                          'Selection among the StepSound properties, gain and timing are browser presentation choices; native audible parity is unverified.']


def radius_symbols():
    return json.loads(RADIUS_SYMBOLS_PATH.read_text(encoding='utf-8'))['radiusMultiplier']


def world_audio_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), WORLD_AUDIO_STEP_NAME, WORLD_AUDIO_STEP_ALGORITHM_VERSION)


def world_audio_unit_config(project_root, tile_id, lock_record, music_encoder):
    return {'rawFingerprint': raw_unit_fingerprint(project_root, tile_id, lock_record)[0],
            'placementPropertiesSha256': sha256_hex(canonical_json_bytes(list(placement_audio_properties()))),
            'radiusSymbolsSha256': sha256_hex(canonical_json_bytes(radius_symbols())),
            'musicDerivativeSha256': sha256_hex(canonical_json_bytes(music_derivative_spec())),
            'musicEncoder': music_encoder.identity}


def world_audio_product_path(ledger, unit_key):
    return ledger.unit_step_directory(unit_key) / PRODUCTS_FOLDER_NAME / WORLD_AUDIO_PRODUCT_NAME


def current_world_audio_receipt(ledger, unit_key, tile_id, config):
    receipt = ledger.sealed_receipt(unit_key)
    if receipt is None or receipt['algorithmVersion'] != WORLD_AUDIO_STEP_ALGORITHM_VERSION or receipt['config'] != config:
        return None
    paths = [record['path'] for record in receipt['inputs']]
    if tile_map_path(tile_id) not in paths or locked_input_records(paths) != receipt['inputs']:
        return None
    return receipt


def sealed_world_audio(project_root, tile_id, lock_record):
    ledger, unit_key = world_audio_ledger(project_root), tile_unit_key(tile_id)
    receipt = current_world_audio_receipt(ledger, unit_key, tile_id, world_audio_unit_config(project_root, tile_id, lock_record, pinned_music_encoder()))
    if receipt is None:
        return None, None
    return receipt['fingerprint'], json.loads(world_audio_product_path(ledger, unit_key).read_text(encoding='utf-8'))


def tile_world_audio_row(tile_id, source_identity, gap_rows, evidence):
    return tile_step_summary_row(tile_id, WORLD_AUDIO_STEP_NAME, source_identity, gap_rows, evidence)


class TileSounds:
    def __init__(self, project_root, client, gaps):
        self.project_root, self.client, self.gaps = project_root, client, gaps
        self.client_access = require_reference_client(client)
        self.packages = ExactSoundPackages(self.client_access, lock_equal_sound_package_paths(self.client_access.lock))
        self.converter, self.converted = None, {}

    def convert(self, reference):
        key = reference.casefold()
        if key in self.converted:
            return
        self.converted[key] = None
        try:
            resolved = resolve_exact_sound(self.packages, reference)
        except ValueError as error:
            self.record_sound_failure(reference, error)
            return
        self.converter = self.converter or world_sound_converter(self.project_root, self.client)
        try:
            self.converted[key] = convert_exact_sound(self.converter, resolved)
        except ValueError as error:
            self.record_sound_failure(reference, error)

    def record_sound_failure(self, reference, error):
        if isinstance(error, SoundSourceGap):
            self.gaps.add(GAP_STATUS, error.reason, reference)
        else:
            self.gaps.add(FAILED_STATUS, conversion_failure_reason(error), reference)

    def available(self):
        return {key for key, converted in self.converted.items() if converted is not None}

    def package_paths(self):
        return sorted(self.packages.packages)


def core_library_radius(client_access, gaps):
    spec = radius_symbols()
    try:
        path, locked_sha256 = client_access.require_equal_file_with_locked_sha256(CORE_LIBRARY_PATH)
    except ReferenceClientLockError:
        locked_sha256 = None
    image = None if locked_sha256 != spec['sha256'] else path.read_bytes()
    if image is None or sha256_hex(image) != spec['sha256']:
        gaps.add(GAP_STATUS, REFERENCE_FILE_NOT_LOCK_EQUAL_REASON_PREFIX + CORE_LIBRARY_PATH)
        return None
    image_record = {'path': CORE_LIBRARY_PATH, 'sha256': spec['sha256'], 'sourceHost': spec['sourceHost'], 'sourcePath': spec['sourcePath']}
    return {'unit': 'native Unreal units, the same space as Location',
            'maxRadiusMultiplier': {**pe_export_f32(image, spec['export']), 'image': image_record,
                                    'status': 'static initializer in original Core.dll .data; runtime/INI overrides unobserved'},
            'defaultRadius': {**pe_export_f32(image, spec['defaultRadiusExport']), 'status': 'static initializer; consumer unverified'},
            'evidence': RADIUS_EVIDENCE}


def bundle_files(manifest, sound_records, sounds):
    files = {record['file']: sounds.converted[record['key']].wav for record in sound_records}
    manifest['files'] = [{'path': name, 'bytes': len(data), 'sha256': sha256_hex(data), 'mime': 'audio/wav'} for name, data in sorted(files.items())]
    files[BUNDLE_MANIFEST_NAME] = json_bytes(manifest)
    return files


def source_map_record(tile_id, lock_record):
    return {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}


def ambience_bundle(tile_id, lock_record, inventory, sounds, radius, gaps):
    emitters = []
    for item in inventory.items:
        try:
            emitters.append(ambient_emitter_row(item, sounds.available()))
        except AmbientEmitterUnreadable:
            gaps.add(GAP_STATUS, AMBIENT_EMITTER_UNREADABLE_REASON, item['object'])
    used = sorted({row[SOUND_FIELD_INDEX] for row in emitters if row[SOUND_FIELD_INDEX] is not None})
    records = [sound_record(sounds.converted[key], key, len(inventory.references[key]['declarations'])) for key in used]
    types = {}
    for row in emitters:
        type_key = 'omitted' if row[AMBIENT_SOUND_TYPE_FIELD_INDEX] is None else str(row[AMBIENT_SOUND_TYPE_FIELD_INDEX])
        types[type_key] = types.get(type_key, 0) + 1
    manifest = {'schemaVersion': 1, 'kind': AMBIENCE_KIND, 'tileId': tile_id, 'source': {'map': source_map_record(tile_id, lock_record)},
                'coordinates': NATIVE_COORDINATES, 'radius': radius, 'emitterFields': FIELDS, 'emitters': emitters, 'sounds': records,
                'coverage': {'emitters': len(emitters), 'emittersWithSound': sum(row[SOUND_FIELD_INDEX] is not None for row in emitters),
                             'sounds': len(records), 'ambientSoundType': dict(sorted(types.items())), 'declarations': inventory.counts,
                             'runtimeConnected': False},
                'limits': AMBIENCE_LIMITS}
    return bundle_files(manifest, records, sounds), manifest['coverage']


def placement_audio_bundle(tile_id, lock_record, placements, properties, sounds, gaps):
    available = sounds.available()
    rows = [{'placementId': placement['placementId'],
             'sounds': [reference.casefold() if reference is not None and reference.casefold() in available else None for reference in placement['references']]}
            for placement in placements]
    occurrences = {}
    for row in rows:
        for key in row['sounds']:
            if key is not None:
                occurrences[key] = occurrences.get(key, 0) + 1
    records = [sound_record(sounds.converted[key], key, occurrences[key]) for key in sorted(occurrences)]
    references = {reference for placement in placements for reference in placement['references'] if reference is not None}
    manifest = {'kind': PLACEMENT_AUDIO_KIND, 'schemaVersion': 1, 'tileId': tile_id, 'source': {'map': source_map_record(tile_id, lock_record)},
                'properties': list(properties), 'placements': rows, 'sounds': records, 'gaps': gaps.rows_for_objects(references),
                'limits': PLACEMENT_AUDIO_LIMITS}
    return bundle_files(manifest, records, sounds), {'placements': len(rows), 'sounds': len(records)}


def convert_tile_audio(project_root, client, tile_id, lock_record, raw_products, music_encoder, gaps):
    package = read_locked_map_package(client, tile_id, lock_record)
    sounds = TileSounds(project_root, client, gaps)
    inventory = inventory_ambient_sounds(package, RAW_MAP_PRODUCT_PATH)
    properties = placement_audio_properties()
    placements = inventory_placement_audio(json.loads((raw_products / 'actors.json').read_text(encoding='utf-8')), properties)
    for reference in sorted({*(sorted(use['references'])[0] for use in inventory.references.values()),
                             *(reference for placement in placements for reference in placement['references'] if reference is not None)},
                            key=lambda reference: (reference.casefold(), reference)):
        sounds.convert(reference)
    bundles, coverage, extra_inputs = [], {}, []
    if inventory.items:
        radius = core_library_radius(sounds.client_access, gaps)
        if radius is not None:
            extra_inputs.append(CORE_LIBRARY_PATH)
            files, coverage['ambience'] = ambience_bundle(tile_id, lock_record, inventory, sounds, radius, gaps)
            bundles.append((AMBIENCE_KIND, files))
    if placements:
        files, coverage['placementAudio'] = placement_audio_bundle(tile_id, lock_record, placements, properties, sounds, gaps)
        bundles.append((PLACEMENT_AUDIO_KIND, files))
    map_data = sounds.client_access.require_equal_file(tile_map_path(tile_id)).read_bytes()
    music = convert_tile_music(client, sounds.client_access, tile_id, lock_record, map_data, music_encoder, gaps)
    coverage['music'] = music.coverage
    if music.files is not None:
        bundles.append((MUSIC_KIND, music.files))
    return bundles, coverage, [*sounds.package_paths(), *extra_inputs, *music.input_paths]


def run_world_audio_step(project_root, client_root, tile_id):
    require_tile_id(tile_id)
    lock_record = read_tile_map_lock_record(tile_id)
    source_identity = {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}
    music_encoder = pinned_music_encoder()
    ledger, unit_key = world_audio_ledger(project_root), tile_unit_key(tile_id)
    config = world_audio_unit_config(project_root, tile_id, lock_record, music_encoder)
    receipt_evidence = (ledger.unit_step_directory(unit_key) / RECEIPT_RECORD_NAME).relative_to(ledger.lane_folder).as_posix()
    if current_world_audio_receipt(ledger, unit_key, tile_id, config) is not None:
        product = json.loads(world_audio_product_path(ledger, unit_key).read_text(encoding='utf-8'))
        return tile_world_audio_row(tile_id, source_identity, product['gapRows'], receipt_evidence)
    client = Path(client_root).resolve()
    gaps = TileStepGapRows(tile_id, WORLD_AUDIO_STEP_NAME, source_identity, receipt_evidence)
    try:
        bundles, coverage, input_paths = convert_tile_audio(project_root, client, tile_id, lock_record, raw_unit_fingerprint(project_root, tile_id, lock_record)[1],
                                                            music_encoder, gaps)
    except FormatError as error:
        gaps.add(FAILED_STATUS, conversion_failure_reason(error))
        bundles, coverage, input_paths = [], {}, []
    inputs = locked_input_records(sorted({tile_map_path(tile_id), *input_paths}))
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    gap_rows = gaps.rows()
    products_directory = ledger.begin(unit_key, fingerprint) / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    store_root, manifests, outputs = lane_store_root(project_root, WORLD_LANE_NAME), [], []
    for kind, files in bundles:
        record, bundle_outputs = write_tile_resource_bundle(store_root, WORLD_AUDIO_STORE_FOLDER, files)
        manifests.append({'kind': kind, **record})
        outputs.extend(bundle_outputs)
    product_payload = json_bytes({'tileId': tile_id, 'manifests': manifests, 'coverage': coverage, 'gapRows': gap_rows})
    product_path = products_directory / WORLD_AUDIO_PRODUCT_NAME
    product_path.write_bytes(product_payload)
    outputs_by_path = {record['path']: record for record in outputs}
    ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': inputs, 'gapRows': gap_rows,
                                        'outputs': [*(outputs_by_path[path] for path in sorted(outputs_by_path)),
                                                    {'path': product_path.relative_to(ledger.lane_folder).as_posix(), 'sha256': sha256_hex(product_payload),
                                                     'bytes': len(product_payload)}]})
    return tile_world_audio_row(tile_id, source_identity, gap_rows, receipt_evidence)
