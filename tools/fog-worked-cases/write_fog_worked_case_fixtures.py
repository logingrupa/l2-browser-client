import argparse
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / 'scripts'))
sys.path.insert(0, str(REPOSITORY_ROOT / 'tests' / 'pipeline'))
from native_assets_lib.class_defaults import ReferenceClientClassScripts
from native_environment import build_products
from reference_client_guard import require_reference_client
from synthetic_class_scripts import link_world_class_default_cache
from world.level_model import read_level_model
from world.level_zones import read_level_zones
from world.light_actors import reference_client_class_chains
from world.raw_map_step import read_tile_map_lock_record
from world.static_placement import ClassDefaults
from world.tile_chunk_plan import read_locked_map_package

FIXTURE_PATH = REPOSITORY_ROOT / 'tests' / 'fixtures' / 'fog' / 'fog-worked-cases.json'
SCRATCH_ROOT = REPOSITORY_ROOT / 'artifacts' / 'scratch'
RECORDS_ARRAY_NAME = 'RECS.canonicalJson'
LIGHTING_RESOURCE_KIND = 'lighting'
FOG_INFO_TILE_ID = '20_21'
TERRAIN_ZONE_TILE_ID = '15_22'
ENVIRONMENT_SETUP_FILE = 'Env.int'


def sha256_of(data):
    return hashlib.sha256(data).hexdigest()


def store_file(store_root, served_path, expected_sha256):
    data = (store_root / served_path.removeprefix('/l2/')).read_bytes()
    if sha256_of(data) != expected_sha256:
        raise SystemExit(f'{served_path} does not hash to its pin {expected_sha256}')
    return data


def converted_lighting_records(store_root, tile_id):
    catalog = json.loads((store_root / 'catalog.json').read_text(encoding='utf-8'))
    tile = next(entry for entry in catalog['tiles'] if entry['id'] == tile_id)
    tile_manifest = json.loads(store_file(store_root, tile['manifest'], tile['manifestSha256']))
    lighting = next(resource for resource in tile_manifest['resources'] if resource['kind'] == LIGHTING_RESOURCE_KIND)
    asset = json.loads(store_file(store_root, lighting['manifest'], lighting['manifestSha256']))
    payload = (store_root / lighting['manifest'].removeprefix('/l2/')).with_name('payload.bin').read_bytes()
    array = next(entry for entry in asset['arrays'] if entry['name'] == RECORDS_ARRAY_NAME)
    records = json.loads(payload[array['byteOffset']:array['byteOffset'] + array['byteLength']])
    source = {'tileManifestSha256': tile['manifestSha256'], 'lightingManifestSha256': lighting['manifestSha256'],
              'lightingPayloadSha256': sha256_of(payload), 'converterVersion': asset['converterVersion']}
    return records, source


def converter_zone_records(client_root, tile_id):
    SCRATCH_ROOT.mkdir(parents=True, exist_ok=True)
    work_root = Path(tempfile.mkdtemp(prefix='fog-worked-case-class-defaults-', dir=SCRATCH_ROOT))
    try:
        class_defaults = ClassDefaults(link_world_class_default_cache(work_root), ReferenceClientClassScripts(client_root))
        lock_record = read_tile_map_lock_record(tile_id)
        package = read_locked_map_package(client_root, tile_id, lock_record)
        zones = read_level_zones(package, read_level_model(package), class_defaults, reference_client_class_chains(class_defaults))
        return [zone.to_record() for zone in zones], {'mapSha256': lock_record['eSha256'], 'reader': 'scripts/world/level_zones.py read_level_zones'}
    finally:
        shutil.rmtree(work_root, ignore_errors=True)


def converted_environment_fog_setup(client_root):
    path, env_int_sha256 = require_reference_client(client_root).require_equal_file_with_sha256(f'system/{ENVIRONMENT_SETUP_FILE}')
    time_tables = json.loads(build_products({ENVIRONMENT_SETUP_FILE: path.read_bytes()})['time-tables.json'])
    return time_tables['setup']['fog'], {'envIntSha256': env_int_sha256, 'reader': 'scripts/native_environment.py build_products time-tables.json setup.fog'}


def main():
    parser = argparse.ArgumentParser(description='Writes the fog worked-case fixture from converted lighting records and the converter zone reader.')
    parser.add_argument('--store-root', type=Path, required=True)
    parser.add_argument('--client-root', type=Path, required=True)
    arguments = parser.parse_args()
    fog_info_records, fog_info_source = converted_lighting_records(arguments.store_root, FOG_INFO_TILE_ID)
    fog_info_zones, fog_info_zone_source = converter_zone_records(arguments.client_root, FOG_INFO_TILE_ID)
    terrain_records, terrain_source = converted_lighting_records(arguments.store_root, TERRAIN_ZONE_TILE_ID)
    terrain_zones, terrain_zone_source = converter_zone_records(arguments.client_root, TERRAIN_ZONE_TILE_ID)
    environment_fog, environment_fog_source = converted_environment_fog_setup(arguments.client_root)
    fixture = {'schemaVersion': 1, 'kind': 'fog-worked-cases', 'environmentFog': {'setup': environment_fog, 'source': environment_fog_source}, 'tiles': {
        FOG_INFO_TILE_ID: {'fogInfos': fog_info_records['fogInfos'], 'zones': fog_info_zones,
                           'source': {'fogInfos': fog_info_source, 'zones': fog_info_zone_source}},
        TERRAIN_ZONE_TILE_ID: {'fogInfos': terrain_records['fogInfos'], 'zones': terrain_zones,
                               'source': {'fogInfos': terrain_source, 'zones': terrain_zone_source}}}}
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(json.dumps(fixture, indent=1, sort_keys=True) + '\n', encoding='utf-8', newline='\n')
    print(f'{FIXTURE_PATH}: {len(fixture["tiles"][FOG_INFO_TILE_ID]["fogInfos"])} {FOG_INFO_TILE_ID} fog infos, '
          f'{len(fixture["tiles"][TERRAIN_ZONE_TILE_ID]["fogInfos"])} {TERRAIN_ZONE_TILE_ID} fog infos')


if __name__ == '__main__':
    main()
