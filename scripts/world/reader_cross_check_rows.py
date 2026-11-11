from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import hashlib
import json
import tempfile

from native_catalog.ue2 import FormatError
from world.raw_map_extraction import build_map
from native_store.store_paths import REPOSITORY_ROOT
from native_store.unit_ledger import BATCH_MINIMUM_FREE_BYTES, require_batch_preflight, run_at_below_normal_priority
from reference_client_guard import require_reference_client
from world.elbera_reader_cross_check import (elbera_actor_properties, elbera_terrain_sector_properties, elbera_texture_mip_bytes,
                                             elbera_tool_record)
from world.map_actor_properties import HAS_STACK, actor_properties, property_value
from world.map_sources import MapSources, safe_path
from world.native_terrain_sectors import native_terrain
from world.raw_map_step import raw_map_recipe, read_tile_map_lock_record, tile_map_path
from world.reader_licensee_layouts import (G16_HEIGHTMAP_READER, MAP_ACTOR_READER, READER_LICENSEE_LAYOUTS, REVIEWED_PACKAGE_VERSION,
                                           TERRAIN_INFO_READER, require_reviewed_reader_layout)
from world.terrain_height_texture import read_g16
from world.tile_census import WORLD_LANE_NAME

CROSS_CHECKS_RELATIVE_PATH = 'tests/fixtures/world-readers/cross-checks.json'
AMBIENT_SOUND_CLASS_OBJECT = 'Engine.AmbientSoundObject'
TERRAIN_INFO_CLASS_OBJECT = 'Engine.TerrainInfo'
BOOLEAN_PROPERTY_TYPE = 3


class ReaderCrossCheckError(ValueError):
    pass


def canonical_json_sha256(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')).hexdigest()


def property_digest_mapping(property_records):
    return {record['name']: record['value'] if record['type'] == BOOLEAN_PROPERTY_TYPE else record['payloadDigest']
            for record in property_records}


def raw_property_digests(properties):
    return [{'name': prop['name'], 'type': prop['type'], 'value': prop.get('value'),
             'payloadDigest': hashlib.sha256(bytes.fromhex(prop['payloadHex'])).hexdigest()} for prop in properties]


def read_by_build_map(item):
    return bool(item['flags'] & HAS_STACK) or item['classObject'] == AMBIENT_SOUND_CLASS_OBJECT


def our_actor_property_projection(map_package):
    projections = []
    for item in map_package.exports:
        if not read_by_build_map(item):
            continue
        properties, tail, _, _ = actor_properties(map_package, item)
        projections.append({'exportIndex': item['exportIndex'], 'propertyEnd': tail.position,
                            'properties': property_digest_mapping(raw_property_digests(properties))})
    return projections


def our_terrain_sector_projection(map_package):
    native = native_terrain(map_package)
    sectors = []
    for sector in sorted(native['sectors'], key=lambda record: record['exportIndex']):
        properties, tail = map_package.properties(map_package.exports[sector['exportIndex'] - 1])
        sectors.append({'exportIndex': sector['exportIndex'], 'propertyEnd': tail.position,
                        'properties': property_digest_mapping(raw_property_digests(properties))})
    return {'terrainInfoExportIndex': native['exportIndex'], 'propertyEnd': native['nativePayload']['offset'], 'sectors': sectors}


def build_map_property_records(decoded_properties):
    return [{'name': prop['name'], 'type': prop['type'], 'value': prop.get('value'), 'payloadDigest': prop['payload']['sha256']}
            for prop in decoded_properties]


def build_map_property_projection(actors, ambient_objects):
    projections = [{'exportIndex': record['exportIndex'], 'propertyEnd': record['nativeTail']['offset'],
                    'properties': property_digest_mapping(build_map_property_records(record['properties']))}
                   for record in (*actors, *ambient_objects)]
    return sorted(projections, key=lambda record: record['exportIndex'])


def build_map_into_temporary_directory(client, tile_id):
    recipe = raw_map_recipe(tile_id, read_tile_map_lock_record(tile_id))
    with tempfile.TemporaryDirectory(prefix='world-reader-cross-check-') as temporary:
        output = Path(temporary)

        def write_product(relative_path, payload):
            product_path = safe_path(output, relative_path)
            product_path.parent.mkdir(parents=True, exist_ok=True)
            product_path.write_bytes(payload)

        manifest, _ = build_map(Path(client).resolve(), recipe, write_product)
        actors = json.loads((output / manifest['files']['actors']).read_text(encoding='utf-8'))
        ambient_objects = json.loads((output / manifest['files']['ambientSounds']).read_text(encoding='utf-8'))['objects']
    return manifest, build_map_property_projection(actors, ambient_objects)


def declared_terrain_map_reference(map_package):
    terrain_infos = [item for item in map_package.exports if item['classObject'] == TERRAIN_INFO_CLASS_OBJECT]
    if len(terrain_infos) != 1:
        raise FormatError(f'{map_package.filename} holds {len(terrain_infos)} TerrainInfo exports, not one')
    properties, _, _, _ = actor_properties(map_package, terrain_infos[0])
    reference = property_value(properties, 'TerrainMap')
    if not reference or not reference['object']:
        raise FormatError(f'{map_package.filename} TerrainInfo declares no TerrainMap texture')
    return reference['object']


def require_package_licensee(package, licensee, tile_id):
    if (package.summary['version'], package.summary['licenseeVersion']) != (REVIEWED_PACKAGE_VERSION, licensee):
        raise ReaderCrossCheckError(f'tile {tile_id} package {package.filename} is '
                                    f'{package.summary["version"]}/{package.summary["licenseeVersion"]}, not {REVIEWED_PACKAGE_VERSION}/{licensee}')


def heightmap_decodes(access, sources, tile_id, licensee):
    reference = declared_terrain_map_reference(sources.get(tile_map_path(tile_id)))
    relative_path, height_package, height_item = sources.resolve(reference, 'Texture')
    require_package_licensee(height_package, licensee, tile_id)
    ours = hashlib.sha256(read_g16(height_package, height_item)['mips'][0]['raw']).hexdigest()
    theirs = hashlib.sha256(elbera_texture_mip_bytes(access, relative_path, reference)).hexdigest()
    return relative_path, ours, theirs


def map_decodes(client, access, sources, tile_id, licensee, reader):
    relative_path = tile_map_path(tile_id)
    map_package = sources.get(relative_path)
    require_package_licensee(map_package, licensee, tile_id)
    if reader == MAP_ACTOR_READER:
        return relative_path, canonical_json_sha256(our_actor_property_projection(map_package)), canonical_json_sha256(
            elbera_actor_properties(access, relative_path))
    if reader == TERRAIN_INFO_READER:
        return relative_path, canonical_json_sha256(our_terrain_sector_projection(map_package)), canonical_json_sha256(
            elbera_terrain_sector_properties(access, relative_path))
    _, projection = build_map_into_temporary_directory(client, tile_id)
    return relative_path, canonical_json_sha256(projection), canonical_json_sha256(elbera_actor_properties(access, relative_path))


def reader_cross_check_row(client, reader, licensee, tile_id):
    if reader not in READER_LICENSEE_LAYOUTS:
        raise ReaderCrossCheckError(f'unknown world reader {reader!r}')
    access = require_reference_client(client)
    sources = MapSources(Path(client).resolve())
    if reader == G16_HEIGHTMAP_READER:
        relative_path, ours, theirs = heightmap_decodes(access, sources, tile_id, licensee)
    else:
        relative_path, ours, theirs = map_decodes(client, access, sources, tile_id, licensee, reader)
    _, package_sha256 = access.require_equal_file_with_sha256(relative_path)
    return {'reader': reader, 'version': REVIEWED_PACKAGE_VERSION, 'licensee': licensee, 'tile': tile_id, 'package': relative_path,
            'lockSha256': package_sha256, 'ourDecodeSha256': ours, 'crossCheckDecodeSha256': theirs, 'tool': elbera_tool_record(),
            'equal': ours == theirs}


def read_cross_check_rows(project_root):
    path = Path(project_root) / CROSS_CHECKS_RELATIVE_PATH
    return json.loads(path.read_text(encoding='utf-8')) if path.is_file() else []


def cross_check_row_identity(row):
    return (row['reader'], row['version'], row['licensee'])


def write_cross_check_row(project_root, row):
    rows = [existing for existing in read_cross_check_rows(project_root) if cross_check_row_identity(existing) != cross_check_row_identity(row)]
    path = Path(project_root) / CROSS_CHECKS_RELATIVE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(sorted([*rows, row], key=cross_check_row_identity), indent=1) + '\n', encoding='utf-8')


def main(argv=None):
    parser = argparse.ArgumentParser(description='Decode the cross-check tile of one reviewed world reader licensee with our reader '
                                                 'and the pinned Elbera l2lib, and record the exact comparison row.')
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--reader', choices=sorted(READER_LICENSEE_LAYOUTS), required=True)
    parser.add_argument('--licensee', type=int, required=True)
    arguments = parser.parse_args(argv)
    try:
        require_reference_client(arguments.client)
        require_batch_preflight(REPOSITORY_ROOT, WORLD_LANE_NAME, BATCH_MINIMUM_FREE_BYTES)
        run_at_below_normal_priority()
        record = require_reviewed_reader_layout(arguments.reader, {'version': REVIEWED_PACKAGE_VERSION, 'licenseeVersion': arguments.licensee})
        row = reader_cross_check_row(arguments.client, arguments.reader, arguments.licensee, record['crossCheck']['tile'])
        write_cross_check_row(REPOSITORY_ROOT, row)
    except (OSError, ValueError) as error:
        print(f'World reader cross-check failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps(row, indent=1))
    return 0 if row['equal'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
