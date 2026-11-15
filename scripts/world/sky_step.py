import json
from pathlib import Path
from typing import NamedTuple

from native_assets_lib.class_defaults import ReferenceClientClassScripts
from native_assets_lib.gltf import json_bytes
from native_assets_lib.material_resources import write_material_program_record
from native_assets_lib.texture_package_118 import read_unreal_package
from native_catalog.ue2 import FormatError
from native_store.catalog_writer import sha256_hex
from native_store.store_paths import StorePathError, lane_store_root, lane_work_root
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from world.level_model import LevelModelLayoutError, read_level_model
from world.level_zones import read_level_zones, sky_zone_indices, zone_actor_export
from world.locked_input_receipt import receipt_with_current_version_config_and_locked_inputs
from world.map_actor_properties import actor_properties, decode_property
from world.map_sources import MapSources, require_lock_equal_client_path
from world.raw_map_step import PRODUCTS_FOLDER_NAME, read_tile_map_lock_record, require_tile_id, tile_map_path, tile_step_row, tile_unit_key
from world.sky_geometry import SKY_COORDINATE_RULE, SKY_UV_RULE, SkyRootSurface, build_sky_glb, build_sky_zone_parts, sky_root_translation_metres, \
    sky_zone_material_identities
from world.material_texture_images import write_material_texture_images
from world.sky_materials import SkyTextureUnsupported, read_sky_material_graph, single_graph_texture_export, sky_material_program, \
    sky_texture_pngs_by_node, sky_texture_products_by_node
from world.static_mesh_step import conversion_failure_reason
from world.static_placement import ClassDefaults
from world.static_placement_plan import FAILED_STATUS
from world.tile_census import WORLD_LANE_NAME
from world.tile_census_validation import GAP_STATUS
from world.tile_chunk_plan import raw_unit_fingerprint, read_locked_map_package
from world.tile_json_resource import BUNDLE_MANIFEST_NAME, write_tile_resource_bundle
from world.tile_step_gap_rows import TileStepGapRows, tile_step_summary_row

SKY_STEP_ALGORITHM_VERSION = 2
SKY_STEP_NAME = 'sky'
SKY_PRODUCT_NAME = 'sky.json'
SKY_BUNDLE_KIND = 'native-sky-source-bundle'
SKY_SNAPSHOT_KIND = 'native-sky-source-snapshot'
SKY_STORE_FOLDER = 'skies'
SKY_ZONE_AMBIGUOUS_REASON_PREFIX = 'sky-zone-ambiguous:'
SKY_LOCATION_UNRESOLVED_REASON = 'actor-default-unresolved:Location'
MATERIAL_FEATURE_UNPORTED_REASON_PREFIX = 'material-feature-unported:'
RAW_MAP_PRODUCT_PATH = 'raw/map.unwrapped.bin'
UNPORTED_NODE_STATUS = 'unported'
AUTHORED_PROVENANCE = 'authored'
SKY_ROOT_PRESENTATION_FIELDS = ('Color', 'AlphaBlend', 'RenderTwoSided')
SKY_LIMITATIONS = ['Frozen authored sky source state; no native visible-pixel parity is established.',
                   'Native runtime sky camera projection, parallax, far-plane/depth composition and live zone binding are unobserved.',
                   'Texture panner rates and stored matrices are retained in the material programs; no invented clock, phase or animation is applied.',
                   'Source ColorModifier bytes are UE2 RGBA. Native time-of-day tint updates, sun, moon and lens-flare behavior are not reproduced.',
                   'GLB source preview maps stored color/alpha declarations to unlit factors; native Shader/ColorModifier blending and BSP two-sided '
                   'precedence remain unverified.',
                   'Original mip blocks are preserved; PNG is an ordinary BC1/BC3 decode of mip 0, without alpha/channel repair, recoloring or generated '
                   'mipmaps.',
                   'Sky source snapshot adds no original-audio parity evidence.']


class SkyStepError(ValueError):
    pass


class SkyMaterialPackages:
    def __init__(self, client):
        self.client, self.map_sources, self.packages = client, MapSources(client), {}

    def resolve(self, identity):
        candidates = self.map_sources.paths.get(identity.split('.')[0].casefold(), [])
        if len(candidates) != 1:
            raise FormatError(f'sky material package of {identity} is missing or ambiguous: {candidates}')
        relative = candidates[0]
        if relative not in self.packages:
            path = require_lock_equal_client_path(self.client, relative)
            self.packages[relative] = read_unreal_package(path.read_bytes(), path.name)
        package = self.packages[relative]
        matches = [item for item in package.exports if item['object'].casefold() == identity.casefold()]
        if len(matches) != 1:
            raise FormatError(f'sky material export {identity} is missing or ambiguous in {relative}')
        return package, matches[0]


class TileSkyConversion(NamedTuple):
    files: dict | None
    counts: dict | None
    material_files: list
    package_paths: list


def sky_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), SKY_STEP_NAME, SKY_STEP_ALGORITHM_VERSION)


def sky_unit_config(project_root, tile_id, lock_record):
    return {'rawFingerprint': raw_unit_fingerprint(project_root, tile_id, lock_record)[0]}


def sky_product_path(ledger, unit_key):
    return ledger.unit_step_directory(unit_key) / PRODUCTS_FOLDER_NAME / SKY_PRODUCT_NAME


def sealed_sky(project_root, tile_id, lock_record):
    ledger, unit_key = sky_ledger(project_root), tile_unit_key(tile_id)
    receipt = receipt_with_current_version_config_and_locked_inputs(ledger, unit_key, tile_id, sky_unit_config(project_root, tile_id, lock_record))
    if receipt is None:
        return None, None
    return receipt['fingerprint'], json.loads(sky_product_path(ledger, unit_key).read_text(encoding='utf-8'))


def tile_sky_row(tile_id, source_identity, gap_rows, evidence):
    return tile_step_summary_row(tile_id, SKY_STEP_NAME, source_identity, gap_rows, evidence)


def sky_actor_location(package, sky_actor):
    tags, _, _, _ = actor_properties(package, sky_actor)
    properties = [decode_property(package, tag, RAW_MAP_PRODUCT_PATH) for tag in tags]
    locations = [prop for prop in properties if prop['name'] == 'Location']
    if len(locations) > 1:
        raise FormatError(f'{sky_actor["object"]} serializes Location {len(locations)} times')
    return (None if not locations else [locations[0]['value'][axis] for axis in 'XYZ']), properties


def root_presentation_fields(program):
    root = next(node for node in program['nodes'] if node['id'] == program['root'])
    return {field['field']: field for field in root['fields'] if field['field'] in SKY_ROOT_PRESENTATION_FIELDS}


def presentation_field_gap(fields):
    color = fields.get('Color', {}).get('value')
    if not (isinstance(color, dict) and isinstance(color.get('rawHex'), str) and len(color['rawHex']) == 8):
        return MATERIAL_FEATURE_UNPORTED_REASON_PREFIX + 'Color'
    for name in ('AlphaBlend', 'RenderTwoSided'):
        if type(fields.get(name, {}).get('value')) is not bool:
            return MATERIAL_FEATURE_UNPORTED_REASON_PREFIX + name
    return None


def alpha_source(field):
    return 'serialized' if field['provenance'] == AUTHORED_PROVENANCE else f'{field.get("valueDeclaringClass")} class default'


class SkyRootConversion:
    def __init__(self, client, store_root, class_work_root, gaps):
        self.packages, self.store_root, self.gaps = SkyMaterialPackages(client), store_root, gaps
        self.class_work_root, self.class_scripts = class_work_root, ReferenceClientClassScripts(client)
        self.texture_files, self.material_files, self.materials = {}, {}, []

    def add_texture_files(self, files):
        for name, payload in files.items():
            if self.texture_files.get(name, payload) != payload:
                raise FormatError(f'two sky textures write different bytes to {name}')
            self.texture_files[name] = payload

    def convert(self, identity):
        try:
            package, root_export = self.packages.resolve(identity)
            [material] = read_sky_material_graph(package, [root_export])
            products, texture_gap_reasons = sky_texture_products_by_node(package, material.graph)
            pngs_by_node = sky_texture_pngs_by_node(products)
            program = sky_material_program(material.graph, self.class_work_root, self.class_scripts, pngs_by_node)
            program_record, program_files = write_material_program_record(self.store_root, material.graph, program)
            image_files = write_material_texture_images(self.store_root, pngs_by_node)
        except StorePathError:
            raise
        except (FormatError, ValueError) as error:
            self.gaps.add(FAILED_STATUS, conversion_failure_reason(error), identity)
            return None
        self.material_files.update((record['path'], record) for record in [*program_files, *image_files])
        self.materials.append({'mapReference': identity, 'root': root_export['object'], 'program': program_record, 'gapReasons': material.gap_reasons})
        for reason in [*material.gap_reasons, *texture_gap_reasons]:
            self.gaps.add(GAP_STATUS, reason, root_export['object'])
        root_node = next(node for node in material.graph['nodes'] if node['exportIndex'] == root_export['exportIndex'])
        fields = root_presentation_fields(program)
        field_gap = presentation_field_gap(fields)
        if root_node['status'] == UNPORTED_NODE_STATUS or field_gap is not None:
            if field_gap is not None:
                self.gaps.add(GAP_STATUS, field_gap, root_export['object'])
            return None
        try:
            drawn_texture = single_graph_texture_export(package, material.graph)
        except SkyTextureUnsupported as error:
            self.gaps.add(GAP_STATUS, error.reason, root_export['object'])
            return None
        if drawn_texture['object'] not in products:
            return None
        receipt, files = products[drawn_texture['object']]
        self.add_texture_files(files)
        return SkyRootSurface(root_export['object'], identity, list(bytes.fromhex(fields['Color']['value']['rawHex'])), fields['AlphaBlend']['value'],
                              alpha_source(fields['AlphaBlend']), fields['RenderTwoSided']['value'], receipt)


def sky_counts(parts):
    return {'nodes': sum(len(part['nodeRanges']) for part in parts), 'vertices': sum(len(part['positions']) // 3 for part in parts),
            'triangles': sum(len(part['indices']) // 3 for part in parts), 'materialRoots': len(parts),
            'textures': len({part['texture']['sourceReference'] for part in parts})}


def sky_snapshot(tile_id, level, zone_index, sky_actor, location, actor_properties_record, parts, materials, lock_record):
    return {'schemaVersion': 1, 'kind': SKY_SNAPSHOT_KIND, 'id': f'interlude:{level.binding["model"]["qualified"]}.{sky_actor["name"]}',
            'tileId': tile_id, 'sourceSkyZone': sky_actor['object'], 'skyZoneIndex': zone_index, 'sourceSkyZonePosition': location,
            'rootTranslationMetres': sky_root_translation_metres(location), 'coordinateRule': SKY_COORDINATE_RULE, 'uvRule': SKY_UV_RULE,
            'parts': parts, 'materials': materials, 'skyActorProperties': actor_properties_record, 'levelModelBinding': level.binding,
            'source': {'map': tile_map_path(tile_id), 'mapSha256': lock_record['eSha256'],
                       'modelSha256': sha256_hex(level.package.data[level.export.serial_offset:level.export.serial_offset + level.export.serial_size]),
                       'modelOffset': level.export.serial_offset, 'modelBytes': level.export.serial_size,
                       'skyActorOffset': sky_actor['offset'], 'skyActorBytes': sky_actor['size'],
                       'skyActorSha256': sha256_hex(level.package.data[sky_actor['offset']:sky_actor['offset'] + sky_actor['size']]),
                       'sourceColorOrder': 'UE1/2 archive RGBA; UEViewer a0bfb468 UnCore.h2474-2490'},
            'unresolvedDynamics': {'texturePanners': 'retained in the material programs; not applied', 'timeOfDay': 'unverified; no authored-color replacement',
                                   'sunMoonLensFlare': 'unimplemented; source actor references retained'},
            'limitations': SKY_LIMITATIONS}


def sky_bundle_files(snapshot, texture_files):
    files = dict(texture_files)
    files['sky.json'] = json_bytes(snapshot)
    files['sky.glb'] = build_sky_glb(snapshot, files)
    counts = sky_counts(snapshot['parts'])
    files[BUNDLE_MANIFEST_NAME] = json_bytes({'schemaVersion': 1, 'kind': SKY_BUNDLE_KIND, 'id': snapshot['id'], 'tileId': snapshot['tileId'],
                                           'source': snapshot['source'], 'counts': counts,
                                           'files': {name: {'bytes': len(data), 'sha256': sha256_hex(data)} for name, data in sorted(files.items())},
                                           'limitations': SKY_LIMITATIONS})
    return files, counts


def convert_tile_sky(project_root, client, tile_id, lock_record, package, level, zone_index, gaps):
    sky_actor = zone_actor_export(package, level.model.zones[zone_index][0])
    if sky_actor is None:
        raise SkyStepError(f'sky zone {zone_index} of {tile_id} names no exported actor')
    location, actor_properties_record = sky_actor_location(package, sky_actor)
    if location is None:
        gaps.add(GAP_STATUS, SKY_LOCATION_UNRESOLVED_REASON, sky_actor['object'])
        return TileSkyConversion(None, None, [], [])
    conversion = SkyRootConversion(client, lane_store_root(project_root, WORLD_LANE_NAME), lane_work_root(project_root, WORLD_LANE_NAME), gaps)
    roots = [root for identity in sky_zone_material_identities(package, level.model, zone_index) if (root := conversion.convert(identity)) is not None]
    package_paths = sorted(conversion.packages.packages)
    material_files = [conversion.material_files[path] for path in sorted(conversion.material_files)]
    if not roots:
        return TileSkyConversion(None, None, material_files, package_paths)
    parts = build_sky_zone_parts(package, level.model, zone_index, roots)
    snapshot = sky_snapshot(tile_id, level, zone_index, sky_actor, location, actor_properties_record, parts, conversion.materials, lock_record)
    files, counts = sky_bundle_files(snapshot, conversion.texture_files)
    return TileSkyConversion(files, counts, material_files, package_paths)


def run_sky_step(project_root, client_root, tile_id):
    require_tile_id(tile_id)
    lock_record = read_tile_map_lock_record(tile_id)
    source_identity = {'path': tile_map_path(tile_id), 'sha256': lock_record['eSha256']}
    ledger, unit_key, config = sky_ledger(project_root), tile_unit_key(tile_id), sky_unit_config(project_root, tile_id, lock_record)
    step_directory = ledger.unit_step_directory(unit_key)
    receipt_evidence = (step_directory / RECEIPT_RECORD_NAME).relative_to(ledger.lane_folder).as_posix()
    if receipt_with_current_version_config_and_locked_inputs(ledger, unit_key, tile_id, config) is not None:
        return tile_sky_row(tile_id, source_identity, json.loads(sky_product_path(ledger, unit_key).read_text(encoding='utf-8'))['gapRows'], receipt_evidence)
    client = Path(client_root).resolve()
    package = read_locked_map_package(client, tile_id, lock_record)
    step_evidence = step_directory.relative_to(ledger.lane_folder).as_posix()
    try:
        level = read_level_model(package)
        zones = read_level_zones(package, level.model, ClassDefaults(lane_work_root(project_root, WORLD_LANE_NAME), ReferenceClientClassScripts(client)))
    except LevelModelLayoutError as error:
        return tile_step_row(tile_id, SKY_STEP_NAME, GAP_STATUS, error.reason, source_identity, step_evidence)
    except ValueError as error:
        return tile_step_row(tile_id, SKY_STEP_NAME, FAILED_STATUS, conversion_failure_reason(error), source_identity, step_evidence)
    sky_zones, gaps = sorted(sky_zone_indices(zones)), TileStepGapRows(tile_id, SKY_STEP_NAME, source_identity, receipt_evidence)
    converted = TileSkyConversion(None, None, [], [])
    if len(sky_zones) > 1:
        gaps.add(GAP_STATUS, f'{SKY_ZONE_AMBIGUOUS_REASON_PREFIX}{len(sky_zones)}')
    elif sky_zones:
        converted = convert_tile_sky(project_root, client, tile_id, lock_record, package, level, sky_zones[0], gaps)
    inputs = locked_input_records(sorted({tile_map_path(tile_id), *converted.package_paths}))
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    gap_rows = gaps.rows()
    products_directory = ledger.begin(unit_key, fingerprint) / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    store_root = lane_store_root(project_root, WORLD_LANE_NAME)
    manifest_record, bundle_outputs = (None, []) if converted.files is None else write_tile_resource_bundle(store_root, SKY_STORE_FOLDER, converted.files)
    material_outputs = [{**record, 'path': (store_root / record['path']).relative_to(store_root.parent).as_posix()} for record in converted.material_files]
    product = {'tileId': tile_id, 'skyZones': sky_zones, 'manifest': manifest_record, 'counts': converted.counts,
               'materialFiles': converted.material_files, 'gapRows': gap_rows}
    product_payload = json_bytes(product)
    product_path = products_directory / SKY_PRODUCT_NAME
    product_path.write_bytes(product_payload)
    outputs_by_path = {record['path']: record for record in [*bundle_outputs, *material_outputs]}
    outputs = [*(outputs_by_path[output_path] for output_path in sorted(outputs_by_path)),
               {'path': product_path.relative_to(ledger.lane_folder).as_posix(), 'sha256': sha256_hex(product_payload), 'bytes': len(product_payload)}]
    ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': inputs, 'outputs': outputs, 'gapRows': gap_rows})
    return tile_sky_row(tile_id, source_identity, gap_rows, receipt_evidence)
