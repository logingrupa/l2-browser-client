from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json
from typing import NamedTuple

from native_assets_lib.class_defaults import ReferenceClientClassScripts
from native_assets_lib.gltf import json_bytes
from native_catalog.ue2 import FormatError
from native_store.catalog_record_replacement import catalog_with_records_replaced
from native_store.catalog_writer import read_store_catalog, validate_catalog_record, write_store
from native_store.gap_rows import write_gap_rows
from native_store.interprocess_lock import LaneInUseError, lane_batch_lock
from native_store.lane_coverage_refresh import lane_coverage_refreshed_at_exit
from native_store.store_paths import REPOSITORY_ROOT, StorePathError, lane_store_root, lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records, run_at_below_normal_priority
from native_store.verified_file_writes import sha256_hex
from reference_client_guard import require_reference_client
from world.actor_field_values import UNRESOLVED_PROVENANCE
from world.bsp_chunk_geometry import load_bsp_poly_flags, poly_flags_recipe_sha256
from world.bsp_material_mapping_size import surface_material_identities
from world.bsp_model_licensee_rules import read_bsp_model_licensee_rules
from world.bsp_visibility_payload import sky_visibility_arrays
from world.error_detail import conversion_failure_reason
from world.level_model import LevelModelLayoutError, read_level_model
from world.level_zones import read_level_zones
from world.light_actors import reference_client_class_chains
from world.locked_input_receipt import receipt_with_current_version_config_and_locked_map_inputs
from world.map_actor_properties import actor_properties, decode_property
from world.native_material_listings import publish_native_material_listing, shared_sky_materials_listing, unique_native_material_files
from world.raw_map_step import PRODUCTS_FOLDER_NAME, read_map_lock_record, unit_step_row
from world.shared_sky_map import SHARED_SKY_CENSUS_KEY, SHARED_SKY_MAP_NAME, SHARED_SKY_MAP_PATH, SHARED_SKY_STEP_NAME
from world.sky_geometry import SKY_COORDINATE_RULE, SKY_UV_RULE, build_sky_glb, build_sky_zone_parts, sky_root_translation_metres, \
    sky_zone_material_identities
from world.sky_root_conversion import SkyRootConversion
from world.sky_zone_selection import SHARED_SKY_ZONE_RULE, select_shared_sky_zone, sky_actor_rotation
from world.static_placement import ClassDefaults
from world.static_placement_plan import FAILED_STATUS
from world.struct_property_tag_rules import read_struct_property_tag_rules
from world.tile_census_validation import GAP_STATUS
from world.tile_chunk_plan import read_locked_map_package_by_path
from world.tile_json_resource import BUNDLE_MANIFEST_NAME, write_tile_resource_bundle
from world.tile_step_gap_rows import UnitStepGapRows
from world.shared_sky_visibility_rules import read_shared_sky_visibility_rules
from world.sky_material_sorting import require_sorting_matches_observed_route, sky_eye_zone_gap
from world.typed_payload import TYPED_PAYLOAD_PAYLOAD_NAME, typed_payload_asset
from world.world_lane_names import WORLD_LANE_NAME

SHARED_SKY_STEP_ALGORITHM_VERSION = 3
SHARED_SKY_UNIT_KEY = f'{SHARED_SKY_STEP_NAME}:{SHARED_SKY_MAP_NAME}'
SHARED_SKY_PRODUCT_NAME = 'shared-sky.json'
SHARED_SKY_SNAPSHOT_NAME = 'sky.json'
SHARED_SKY_GLB_NAME = 'sky.glb'
SHARED_SKY_VISIBILITY_NAME = 'visibility.json'
SHARED_SKY_BUNDLE_KIND = 'native-shared-sky-bundle'
SHARED_SKY_SNAPSHOT_KIND = 'native-shared-sky-snapshot'
SKIES_CATALOG_SLICE = 'skies'
SKIES_CATALOG_CAPACITY = 1
SHARED_SKY_RECORD_ID = SHARED_SKY_MAP_NAME
PASS_STATUS = 'pass'
ZERO_ROTATION = {'Pitch': 0, 'Yaw': 0, 'Roll': 0}
SKY_ZONE_ROTATION_UNPORTED_REASON = 'sky-zone-rotation-unported'
SKY_ZONE_ROTATION_UNRESOLVED_REASON = 'sky-zone-rotation-unresolved'
SKY_LOCATION_UNRESOLVED_REASON = 'actor-default-unresolved:Location'
SOURCE_COLOR_ORDER = ('serialized FColor bytes B, G, R, A; recipes/world/struct-property-tag-rules.json binary Color from Core.dll 9462f87a '
                      'SerializeBin, research Q6 binary-member-order')
SHARED_SKY_DRAW_RULE = ('Engine.SkyLevel under !GIsEditor && GIsL2Seamless && GL2SharedSky (RM-18 0x10591691, RM-21): the game draws '
                        'skylevel.unr for every map; the tile SkyZoneInfo room is never drawn')
SHARED_SKY_EYE_RULE = ('FSkySceneNode 0x10655a20: M = T(-sky.Location) * InvR(sky.Rotation) * T(parent.ViewOrigin); projection inherited, '
                       'DrawScale unused, camera translation cancels (RM-21)')
SHARED_SKY_NODE_SELECTION = ('geometry holds every drawn polygon node touching the sky zone; visibility.json carries the native node arrays so '
                              'the runtime RenderLevel walk 0x1068c560 and selector 0x10689fd0 pick the submitted nodes from the sky eye (RM-22, RM-23)')
SHARED_SKY_LIMITATIONS = ['Frozen authored sky source state; no native visible-pixel parity is established.',
                          'RequiresSorting per material follows the verified RM-24 class rules on the package fields (Modifier Material, Shader '
                          'OutputBlending and Opacity, Texture bAlphaTexture); the field offsets are matched in live memory, not traced, and a '
                          'material reaching another class stays unresolved.',
                          'The sky draws on the main view FakeBackdrop trigger with viewport+0x160 taken as zero; that route and the non-backdrop '
                          'selector route 0x1068a4c9 are open (RM-22 c) and the runtime names them.',
                          'Texture panner rates and stored matrices are retained in the material programs.',
                          'Source ColorModifier bytes are B, G, R, A (research Q6 binary-member-order).',
                          'Original mip blocks are preserved; PNG is an ordinary BC1/BC3 decode of mip 0, without alpha/channel repair, '
                          'recoloring or generated mipmaps.']


class SharedSkyMaterialListing(NamedTuple):
    relative_path: str
    payload: bytes
    material_files: list


class SharedSkyConversion(NamedTuple):
    files: dict | None
    counts: dict | None
    material_listing: SharedSkyMaterialListing | None
    package_paths: list


class SharedSkyRootSelection(NamedTuple):
    zone_index: int
    actor: dict
    rotation: dict


def shared_sky_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), SHARED_SKY_STEP_NAME, SHARED_SKY_STEP_ALGORITHM_VERSION)


def shared_sky_config():
    return {'structPropertyRulesSha256': read_struct_property_tag_rules().sha256, 'levelModelRulesSha256': read_bsp_model_licensee_rules()['sha256'],
            'polyFlagsSha256': poly_flags_recipe_sha256(), 'sharedSkyVisibilityRulesSha256': read_shared_sky_visibility_rules()['sha256']}


def shared_sky_product_path(ledger):
    return ledger.unit_step_directory(SHARED_SKY_UNIT_KEY) / PRODUCTS_FOLDER_NAME / SHARED_SKY_PRODUCT_NAME


def shared_sky_source_identity():
    return {'path': SHARED_SKY_MAP_PATH, 'sha256': read_map_lock_record(SHARED_SKY_MAP_PATH)['eSha256']}


def shared_sky_summary_row(gap_rows, evidence):
    status, reason = (gap_rows[0]['status'], gap_rows[0]['reason']) if gap_rows else (PASS_STATUS, None)
    return unit_step_row(SHARED_SKY_CENSUS_KEY, SHARED_SKY_STEP_NAME, status, reason, shared_sky_source_identity(), evidence)


def sky_actor_location(package, sky_actor):
    tags, _, _, _ = actor_properties(package, sky_actor)
    properties = [decode_property(package, tag, SHARED_SKY_MAP_PATH) for tag in tags]
    locations = [prop for prop in properties if prop['name'] == 'Location']
    if len(locations) > 1:
        raise FormatError(f'{sky_actor["object"]} serializes Location {len(locations)} times')
    return (None if not locations else [locations[0]['value'][axis] for axis in 'XYZ']), properties


def sky_zone_rotation_gap(rotation):
    if rotation.provenance == UNRESOLVED_PROVENANCE:
        return SKY_ZONE_ROTATION_UNRESOLVED_REASON
    if rotation.value not in (None, ZERO_ROTATION):
        return SKY_ZONE_ROTATION_UNPORTED_REASON
    return None


def sky_counts(parts):
    return {'nodes': sum(len(part['nodeRanges']) for part in parts), 'vertices': sum(len(part['positions']) // 3 for part in parts),
            'triangles': sum(len(part['indices']) // 3 for part in parts), 'materialRoots': len(parts),
            'textures': len({part['texture']['sourceReference'] for part in parts})}


def shared_sky_snapshot(level, selection, location, actor_properties_record, parts, materials, map_sha256):
    sky_actor = selection.actor
    return {'schemaVersion': 1, 'kind': SHARED_SKY_SNAPSHOT_KIND, 'id': f'interlude:{level.binding["model"]["qualified"]}.{sky_actor["name"]}',
            'map': SHARED_SKY_MAP_NAME, 'drawRule': SHARED_SKY_DRAW_RULE, 'zoneRule': SHARED_SKY_ZONE_RULE, 'eyeRule': SHARED_SKY_EYE_RULE,
            'nodeSelection': SHARED_SKY_NODE_SELECTION, 'sourceSkyZone': sky_actor['object'], 'skyZoneIndex': selection.zone_index,
            'sourceSkyZonePosition': location, 'sourceSkyZoneRotation': selection.rotation,
            'rootTranslationMetres': sky_root_translation_metres(location), 'coordinateRule': SKY_COORDINATE_RULE, 'uvRule': SKY_UV_RULE,
            'parts': parts, 'materials': materials, 'skyActorProperties': actor_properties_record, 'levelModelBinding': level.binding,
            'source': {'map': SHARED_SKY_MAP_PATH, 'mapSha256': map_sha256,
                       'modelSha256': sha256_hex(level.package.data[level.export.serial_offset:level.export.serial_offset + level.export.serial_size]),
                       'modelOffset': level.export.serial_offset, 'modelBytes': level.export.serial_size,
                       'skyActorOffset': sky_actor['offset'], 'skyActorBytes': sky_actor['size'],
                       'skyActorSha256': sha256_hex(level.package.data[sky_actor['offset']:sky_actor['offset'] + sky_actor['size']]),
                       'sourceColorOrder': SOURCE_COLOR_ORDER},
            'limitations': SHARED_SKY_LIMITATIONS}


def shared_sky_material_listing(material_files_by_path):
    material_files = unique_native_material_files(SHARED_SKY_MAP_PATH, [material_files_by_path.values()])
    relative_path, payload = shared_sky_materials_listing(SHARED_SKY_MAP_NAME, material_files)
    return SharedSkyMaterialListing(relative_path, payload, material_files)


def material_listing_pin(material_listing):
    return {'manifest': '/l2/' + material_listing.relative_path, 'manifestSha256': sha256_hex(material_listing.payload),
            'manifestBytes': len(material_listing.payload)}


def sky_visibility_asset(model, parts, map_sha256):
    arrays = sky_visibility_arrays(model, parts, [part['requiresSorting'] for part in parts])
    return typed_payload_asset(arrays, {'sourceSha256': map_sha256, 'converterVersion': f'{SHARED_SKY_STEP_NAME}-{SHARED_SKY_STEP_ALGORITHM_VERSION}'})


def shared_sky_bundle_files(snapshot, texture_files, material_listing, visibility):
    files = dict(texture_files)
    files[SHARED_SKY_SNAPSHOT_NAME] = json_bytes(snapshot)
    files[SHARED_SKY_VISIBILITY_NAME] = visibility.asset_bytes
    files[TYPED_PAYLOAD_PAYLOAD_NAME] = visibility.payload_bytes
    files[SHARED_SKY_GLB_NAME] = build_sky_glb(snapshot, files)
    counts = sky_counts(snapshot['parts'])
    files[BUNDLE_MANIFEST_NAME] = json_bytes({'schemaVersion': 1, 'kind': SHARED_SKY_BUNDLE_KIND, 'id': snapshot['id'], 'map': snapshot['map'],
                                           'source': snapshot['source'], 'counts': counts, 'materials': material_listing_pin(material_listing),
                                           'files': {name: {'bytes': len(data), 'sha256': sha256_hex(data)} for name, data in sorted(files.items())},
                                           'limitations': SHARED_SKY_LIMITATIONS})
    return files, counts


def select_shared_sky_root(package, level, class_defaults, gaps):
    class_chains = reference_client_class_chains(class_defaults)
    zones = read_level_zones(package, level, class_defaults, class_chains)
    selection = select_shared_sky_zone(package, zones, class_chains)
    if selection.gap_reason is not None:
        gaps.add(GAP_STATUS, selection.gap_reason)
        return None
    if selection.zone_index is None:
        raise FormatError(f'{SHARED_SKY_MAP_PATH} holds no zone whose actor casts to SkyZoneInfo')
    rotation = sky_actor_rotation(package, selection.actor, class_defaults)
    rotation_gap = sky_zone_rotation_gap(rotation)
    if rotation_gap is not None:
        gaps.add(GAP_STATUS, rotation_gap, selection.actor['object'])
        return None
    return SharedSkyRootSelection(selection.zone_index, selection.actor, rotation.to_record())


def convert_shared_sky(project_root, client, package, level, selection, map_sha256, gaps):
    location, actor_properties_record = sky_actor_location(package, selection.actor)
    if location is None:
        gaps.add(GAP_STATUS, SKY_LOCATION_UNRESOLVED_REASON, selection.actor['object'])
        return SharedSkyConversion(None, None, None, [])
    conversion = SkyRootConversion(client, lane_store_root(project_root, WORLD_LANE_NAME), lane_work_root(project_root, WORLD_LANE_NAME), gaps)
    material_of_surface = surface_material_identities(package, level.model, conversion.class_work_root, conversion.class_scripts)
    flags = load_bsp_poly_flags()
    roots = [root for identity in sky_zone_material_identities(material_of_surface, level.model, selection.zone_index, flags)
             if (root := conversion.convert(identity)) is not None]
    package_paths = sorted(conversion.packages.packages)
    if not roots:
        return SharedSkyConversion(None, None, None, package_paths)
    parts = build_sky_zone_parts(package, material_of_surface, level.model, selection.zone_index, flags, roots)
    for part in parts:
        require_sorting_matches_observed_route(part['sourceMaterial'], part['requiresSorting'])
    eye_zone_gap = sky_eye_zone_gap(level.model, location, selection.zone_index)
    if eye_zone_gap is not None:
        gaps.add(GAP_STATUS, eye_zone_gap, selection.actor['object'])
    snapshot = shared_sky_snapshot(level, selection, location, actor_properties_record, parts, conversion.materials, map_sha256)
    material_listing = shared_sky_material_listing(conversion.material_files)
    files, counts = shared_sky_bundle_files(snapshot, conversion.texture_files, material_listing,
                                            sky_visibility_asset(level.model, parts, map_sha256))
    return SharedSkyConversion(files, counts, material_listing, package_paths)


def publish_shared_sky_files(store_root, converted):
    listing = converted.material_listing
    _, material_records = publish_native_material_listing(store_root, listing.relative_path, listing.payload, listing.material_files)
    material_outputs = [{**record, 'path': (store_root / record['path']).relative_to(store_root.parent).as_posix()} for record in material_records]
    manifest_record, bundle_outputs = write_tile_resource_bundle(store_root, SKIES_CATALOG_SLICE, converted.files)
    return manifest_record, [*material_outputs, *bundle_outputs]


def write_shared_sky_catalog_record(store_root, manifest_record):
    record = validate_catalog_record(SKIES_CATALOG_SLICE, {'id': SHARED_SKY_RECORD_ID, 'manifest': manifest_record['resource'],
                                                           'manifestSha256': manifest_record['sha256'], 'manifestBytes': manifest_record['bytes']})
    catalog, before = read_store_catalog(store_root)
    write_store(store_root, {}, before, json_bytes(catalog_with_records_replaced(catalog, SKIES_CATALOG_SLICE, [record], SKIES_CATALOG_CAPACITY)))
    return record


def run_shared_sky_step(project_root, client_root):
    project_root = Path(project_root)
    lock_record = read_map_lock_record(SHARED_SKY_MAP_PATH)
    source_identity = shared_sky_source_identity()
    ledger, config = shared_sky_ledger(project_root), shared_sky_config()
    step_directory = ledger.unit_step_directory(SHARED_SKY_UNIT_KEY)
    receipt_evidence = (step_directory / RECEIPT_RECORD_NAME).relative_to(ledger.lane_folder).as_posix()
    if receipt_with_current_version_config_and_locked_map_inputs(ledger, SHARED_SKY_UNIT_KEY, SHARED_SKY_MAP_PATH, config) is not None:
        return shared_sky_summary_row(json.loads(shared_sky_product_path(ledger).read_text(encoding='utf-8'))['gapRows'], receipt_evidence)
    client = Path(client_root).resolve()
    package = read_locked_map_package_by_path(client, SHARED_SKY_MAP_PATH, lock_record)
    step_evidence = step_directory.relative_to(ledger.lane_folder).as_posix()
    class_defaults = ClassDefaults(lane_work_root(project_root, WORLD_LANE_NAME), ReferenceClientClassScripts(client))
    gaps = UnitStepGapRows(SHARED_SKY_CENSUS_KEY, SHARED_SKY_STEP_NAME, source_identity, receipt_evidence)
    try:
        level = read_level_model(package)
        selection = select_shared_sky_root(package, level, class_defaults, gaps)
        converted = SharedSkyConversion(None, None, None, []) if selection is None else convert_shared_sky(
            project_root, client, package, level, selection, lock_record['eSha256'], gaps)
    except LevelModelLayoutError as error:
        return unit_step_row(SHARED_SKY_CENSUS_KEY, SHARED_SKY_STEP_NAME, GAP_STATUS, error.reason, source_identity, step_evidence)
    except StorePathError:
        raise
    except ValueError as error:
        return unit_step_row(SHARED_SKY_CENSUS_KEY, SHARED_SKY_STEP_NAME, FAILED_STATUS, conversion_failure_reason(error), source_identity, step_evidence)
    inputs = locked_input_records(sorted({SHARED_SKY_MAP_PATH, *converted.package_paths}))
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    gap_rows = gaps.rows()
    products_directory = ledger.begin(SHARED_SKY_UNIT_KEY, fingerprint) / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    store_root = lane_store_root(project_root, WORLD_LANE_NAME)
    manifest_record, store_outputs = (None, []) if converted.files is None else publish_shared_sky_files(store_root, converted)
    catalog_record = None if manifest_record is None else write_shared_sky_catalog_record(store_root, manifest_record)
    product = {'unitKey': SHARED_SKY_UNIT_KEY, 'skyZone': None if selection is None else selection.zone_index, 'manifest': manifest_record,
               'catalogRecord': catalog_record, 'counts': converted.counts, 'gapRows': gap_rows}
    product_payload = json_bytes(product)
    product_path = products_directory / SHARED_SKY_PRODUCT_NAME
    product_path.write_bytes(product_payload)
    outputs = [*store_outputs, {'path': product_path.relative_to(ledger.lane_folder).as_posix(), 'sha256': sha256_hex(product_payload),
                                 'bytes': len(product_payload)}]
    ledger.seal(SHARED_SKY_UNIT_KEY, fingerprint, {'config': config, 'inputs': inputs, 'outputs': outputs, 'gapRows': gap_rows})
    return shared_sky_summary_row(gap_rows, receipt_evidence)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Convert the shared SkyLevel (maps/skylevel.unr) once into skies/<sha256>/ and its catalog '
                                                 'record in the world lane store.')
    parser.add_argument('--client', type=Path, required=True)
    arguments = parser.parse_args(argv)
    run_at_below_normal_priority()
    try:
        client_access = require_reference_client(arguments.client)
        with lane_batch_lock(lane_work_root(REPOSITORY_ROOT, WORLD_LANE_NAME)), lane_coverage_refreshed_at_exit(REPOSITORY_ROOT, WORLD_LANE_NAME):
            row = run_shared_sky_step(REPOSITORY_ROOT, client_access.root)
            write_gap_rows(REPOSITORY_ROOT, WORLD_LANE_NAME, SHARED_SKY_STEP_NAME, [row])
    except (OSError, ValueError, LaneInUseError) as error:
        print(json.dumps({'unitKey': SHARED_SKY_UNIT_KEY, 'status': 'failed', 'error': f'{type(error).__name__}: {error}'}))
        return 1
    print(json.dumps(row, sort_keys=True))
    return 0 if row['status'] in (PASS_STATUS, GAP_STATUS) else 1


if __name__ == '__main__':
    raise SystemExit(main())
