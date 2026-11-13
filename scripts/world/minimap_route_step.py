from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json
from typing import NamedTuple

from native_assets import implementation_hash
from native_assets_lib.gltf import json_bytes
from native_store.catalog_writer import sha256_hex
from native_store.store_paths import REPOSITORY_ROOT, lane_store_root, lane_work_root
from native_store.unit_ledger import UnitLedger, locked_input_records, run_at_below_normal_priority
from reference_client_guard import require_reference_client
from world.format5_texture_pixels import Format5PixelMismatch, require_png_equals_format5_mip0, texture_format_id
from world.minimap_radar_route_recipe import JOIN_UNRESOLVED_REASON_PREFIX, read_minimap_radar_route_recipe
from world.minimap_sources import decoded_table_rows
from world.minimap_textures import (TEXTURE_SOURCE_READABLE_STATUS, convert_minimap_texture, export_named, minimap_texture_converter,
                                    read_texture_package, store_converted_texture, texture_package_index)
from world.raw_map_step import PRODUCTS_FOLDER_NAME
from world.tile_census import WORLD_LANE_NAME
from world.tile_json_resource import write_tile_json_resource
from world.zone_name_keys import zone_key_table

MINIMAP_ROUTE_STEP_NAME = 'minimap-route'
MINIMAP_ROUTE_STEP_ALGORITHM_VERSION = 1
MINIMAP_ROUTE_UNIT_KEY = 'minimap-route:interlude'
MINIMAP_ROUTE_PRODUCT_NAME = 'minimap-route.json'
NATIVE_MINIMAP_ROUTE_KIND = 'native-minimap-route'
NATIVE_MINIMAP_ROUTE_SCHEMA_VERSION = 1
MINIMAP_ROUTE_STORE_FOLDER = 'maps'
MINIMAP_ROUTE_MANIFEST_NAME = f'{NATIVE_MINIMAP_ROUTE_KIND}/manifest.json'
RADAR_PACKAGE_PATH = 'systextures/L2_RadarMap.utx'
WORLD_MAP_PACKAGE_PATH = 'systextures/L2Font-e.utx'
ZONENAME_TABLE_PATH = 'system/zonename-e.dat'
ZONENAME_TABLE_ROLE = 'zonename'
MINIMAP_ROUTE_INPUT_PATHS = (RADAR_PACKAGE_PATH, WORLD_MAP_PACKAGE_PATH, ZONENAME_TABLE_PATH)
RADAR_CASE_RULE = 'radar-case'
RADAR_DEFAULT_RULE = 'radar-default'
WORLD_MAP_PIECE_RULE = 'world-map-piece'
TEXTURE_LAYOUT_DIFFERS = 'texture-layout-differs'
TEXTURE_ABSENT = 'route-texture-absent'
ZONE_TITLE_SOURCE_OPEN_ID = 'zone-title-source'
RADAR_ANCHOR_OPEN_ID = 'radar-anchor'
EVERY_TILE_OPEN_IDS = (ZONE_TITLE_SOURCE_OPEN_ID, RADAR_ANCHOR_OPEN_ID)


class MinimapRouteStepError(ValueError):
    pass


class MinimapRoute(NamedTuple):
    fingerprint: str
    product: dict | None


def minimap_route_ledger(project_root):
    return UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), MINIMAP_ROUTE_STEP_NAME, MINIMAP_ROUTE_STEP_ALGORITHM_VERSION)


def minimap_route_config():
    return {'recipeSha256': read_minimap_radar_route_recipe()['sha256'], 'converterSha256': implementation_hash()}


def minimap_route_inputs():
    return locked_input_records(MINIMAP_ROUTE_INPUT_PATHS)


def minimap_route_product_path(ledger):
    return ledger.unit_step_directory(MINIMAP_ROUTE_UNIT_KEY) / PRODUCTS_FOLDER_NAME / MINIMAP_ROUTE_PRODUCT_NAME


def current_minimap_route(project_root):
    ledger = minimap_route_ledger(project_root)
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in minimap_route_inputs()], minimap_route_config())
    if not ledger.is_sealed(MINIMAP_ROUTE_UNIT_KEY, fingerprint):
        return MinimapRoute(fingerprint, None)
    return MinimapRoute(fingerprint, json.loads(minimap_route_product_path(ledger).read_text(encoding='utf-8')))


def join_unresolved(what):
    return JOIN_UNRESOLVED_REASON_PREFIX + what


def route_textures(radar, world_map):
    group = radar['textureGroup']
    display = world_map['initializeMapDisplay']
    textures = [(f'{group}.{case["texture"]}', RADAR_CASE_RULE) for case in radar['cases']]
    textures.append((f'{group}.{radar["default"]["texture"]}', RADAR_DEFAULT_RULE))
    textures.extend((f'{display["english"]}{suffix}', WORLD_MAP_PIECE_RULE) for suffix in display['suffixes'])
    return textures


class RouteTextureConverter:
    def __init__(self, project_root, client, converter, recipe):
        self.project_root, self.client, self.converter, self.recipe = project_root, client, converter, recipe
        self.store_root = lane_store_root(project_root, WORLD_LANE_NAME)
        self.packages, self.records, self.outputs, self.gaps = {}, {}, [], []

    def package(self, relative_path):
        if relative_path not in self.packages:
            package = read_texture_package(self.client, relative_path)
            self.packages[relative_path] = (package, texture_package_index(package, relative_path))
        return self.packages[relative_path]

    def add_gap(self, reason, evidence):
        self.gaps.append({'reason': reason, 'evidence': evidence})
        return None

    def texture_format(self, package, export, index_entry):
        source = index_entry['textureSource']
        if source['status'] == TEXTURE_SOURCE_READABLE_STATUS:
            return source['format'], None
        format_rule = self.recipe['textureFormat5']
        if texture_format_id(package, export) == format_rule['formatId']:
            return format_rule['formatName'], format_rule
        return None, source['reason']

    def convert(self, relative_path, object_name, rule):
        package, index = self.package(relative_path)
        index_entry = export_named(index, object_name)
        if index_entry is None:
            return self.add_gap(join_unresolved(TEXTURE_ABSENT), object_name)
        export = package.exports[index_entry['exportIndex'] - 1]
        texture_format, format_rule_or_reason = self.texture_format(package, export, index_entry)
        if texture_format is None:
            return self.add_gap(format_rule_or_reason, index_entry['object'])
        converter = self.converter or minimap_texture_converter(self.project_root, self.client)
        conversion, failure_reason = convert_minimap_texture(converter, package.package_name, index_entry['object'])
        if conversion is None:
            return self.add_gap(failure_reason, index_entry['object'])
        pixel_check = None
        if isinstance(format_rule_or_reason, dict):
            try:
                pixel_check = require_png_equals_format5_mip0(package, export, conversion.image, format_rule_or_reason)
            except Format5PixelMismatch as mismatch:
                return self.add_gap(join_unresolved(TEXTURE_LAYOUT_DIFFERS), f'{index_entry["object"]}: {mismatch}')
        stored, _, output = store_converted_texture(self.store_root, conversion, {'object': index_entry['object'], 'rule': rule})
        self.outputs.append(output)
        record = {'object': index_entry['object'], 'rule': rule, 'archive': stored['archive'], 'archiveSha256': stored['archiveSha256'],
                  'archiveBytes': stored['archiveBytes'], 'format': texture_format}
        if pixel_check is not None:
            record['pixelCheck'] = pixel_check
        return record


def world_map_pieces(world_map, textures):
    draw = world_map['drawWorldMap']
    pieces = []
    for index, suffix in enumerate(world_map['initializeMapDisplay']['suffixes']):
        column, row = index % draw['columns'], index // draw['columns']
        pieces.append({'suffix': suffix, 'index': index, 'column': column, 'row': row, 'originX': column * draw['pieceWidth'],
                       'originY': row * draw['pieceHeight'], 'width': draw['pieceWidth'], 'height': draw['pieceHeight'], 'texture': textures[index]})
    return pieces


def world_map_projection(world_map):
    position = world_map['getMinimapPosition']
    return {key: position[key] for key in ('function', 'address', 'branch', 'offsetX', 'offsetY', 'scaleNumerator', 'scaleDenominator', 'scale',
                                           'formula', 'truncationAddress', 'truncation')}


def route_open_gaps(open_items):
    gaps_by_id = {item['id']: item for item in open_items}
    return [{'reason': gaps_by_id[open_id]['tileGap'], 'evidence': gaps_by_id[open_id]['what']} for open_id in EVERY_TILE_OPEN_IDS]


def minimap_route_manifest(recipe_record, inputs, recipe, textures, zone_keys, texture_gaps):
    radar, world_map = recipe['radar'], recipe['worldMap']
    case_count = len(radar['cases'])
    return {'kind': NATIVE_MINIMAP_ROUTE_KIND, 'schemaVersion': NATIVE_MINIMAP_ROUTE_SCHEMA_VERSION,
            'recipe': {'path': recipe_record['path'], 'sha256': recipe_record['sha256']},
            'sourceInputs': [{'path': record['path'], 'sha256': record['sha256']} for record in inputs],
            'radar': {'zoneTitleEvent': radar['zoneTitleEvent'], 'getLocInfo': radar['getLocInfo'], 'match': radar['match'],
                      'cases': [{**case, 'texture': textures[index]} for index, case in enumerate(radar['cases'])],
                      'default': {**radar['default'], 'texture': textures[case_count]}, 'anchor': radar['anchor']},
            'worldMap': {'pieces': world_map_pieces(world_map, textures[case_count + 1:]), 'projection': world_map_projection(world_map),
                         'fallback': world_map['initializeMapDisplay']['fallback']},
            'zoneSampler': recipe['zoneSampler'], 'zoneKeys': zone_keys, 'open': recipe['open'],
            'gaps': [*route_open_gaps(recipe['open']), *texture_gaps]}


def run_minimap_route_step(project_root, client_root, converter=None):
    project_root = Path(project_root)
    ledger = minimap_route_ledger(project_root)
    route = current_minimap_route(project_root)
    if route.product is not None:
        return {'unitKey': MINIMAP_ROUTE_UNIT_KEY, 'status': 'sealed', 'fingerprint': route.fingerprint, 'converted': 0,
                'manifest': route.product['manifest'], 'gaps': route.product['gaps']}
    client = require_reference_client(Path(client_root).resolve()).root
    recipe_record = read_minimap_radar_route_recipe()
    recipe = recipe_record['document']
    inputs = minimap_route_inputs()
    texture_converter = RouteTextureConverter(project_root, client, converter, recipe)
    package_paths = {RADAR_CASE_RULE: recipe['radar']['texturePackage'], RADAR_DEFAULT_RULE: recipe['radar']['texturePackage'],
                     WORLD_MAP_PIECE_RULE: WORLD_MAP_PACKAGE_PATH}
    textures = [texture_converter.convert(package_paths[rule], object_name, rule) for object_name, rule in route_textures(recipe['radar'], recipe['worldMap'])]
    zone_keys = zone_key_table(decoded_table_rows(client, ZONENAME_TABLE_ROLE)['rows'])
    manifest = minimap_route_manifest(recipe_record, inputs, recipe, textures, zone_keys, texture_converter.gaps)
    products_directory = ledger.begin(MINIMAP_ROUTE_UNIT_KEY, route.fingerprint) / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    manifest_record, manifest_output = write_tile_json_resource(texture_converter.store_root, MINIMAP_ROUTE_STORE_FOLDER, MINIMAP_ROUTE_MANIFEST_NAME, manifest)
    product = {'manifest': manifest_record, 'gaps': manifest['gaps']}
    product_payload = json_bytes(product)
    product_path = products_directory / MINIMAP_ROUTE_PRODUCT_NAME
    product_path.write_bytes(product_payload)
    outputs = [*sorted({output['path']: output for output in [manifest_output, *texture_converter.outputs]}.values(), key=lambda output: output['path']),
               {'path': product_path.relative_to(ledger.lane_folder).as_posix(), 'sha256': sha256_hex(product_payload), 'bytes': len(product_payload)}]
    ledger.seal(MINIMAP_ROUTE_UNIT_KEY, route.fingerprint, {'config': minimap_route_config(), 'inputs': inputs, 'outputs': outputs, 'gapRows': []})
    return {'unitKey': MINIMAP_ROUTE_UNIT_KEY, 'status': 'converted', 'fingerprint': route.fingerprint,
            'converted': sum(1 for texture in textures if texture is not None), 'manifest': manifest_record, 'gaps': manifest['gaps']}


def main(argv=None):
    parser = argparse.ArgumentParser(description='Convert the minimap radar route textures once and seal the route manifest in the world lane.')
    parser.add_argument('--client', type=Path, required=True)
    arguments = parser.parse_args(argv)
    run_at_below_normal_priority()
    try:
        result = run_minimap_route_step(REPOSITORY_ROOT, arguments.client)
    except (OSError, ValueError) as error:
        print(json.dumps({'unitKey': MINIMAP_ROUTE_UNIT_KEY, 'status': 'failed', 'error': f'{type(error).__name__}: {error}'}))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
