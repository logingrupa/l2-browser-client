from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import add_store_file, sha256_hex
from native_store.native_material_program_pins import NATIVE_MATERIALS_FOLDER
from native_store.store_file_publish import publish_store_files

NATIVE_MATERIAL_LISTING_SCHEMA_VERSION = 1
SURFACE_MATERIALS_LISTING_KIND = 'native-tile-surface-materials'
SURFACE_MATERIALS_LISTING_PREFIX = 'surface-materials'
STATIC_MESH_MATERIALS_LISTING_KIND = 'native-tile-static-mesh-materials'
STATIC_MESH_MATERIALS_LISTING_PREFIX = 'static-mesh-materials'
TERRAIN_MATERIALS_LISTING_KIND = 'native-tile-terrain-materials'
TERRAIN_MATERIALS_LISTING_PREFIX = 'terrain-materials'


class NativeMaterialListingError(ValueError):
    pass


def unique_native_material_files(tile_id, material_file_lists):
    files_by_path = {}
    for material_files in material_file_lists:
        for record in material_files:
            if not record['path'].startswith(NATIVE_MATERIALS_FOLDER + '/'):
                raise NativeMaterialListingError(f'material file {record["path"]} of tile {tile_id} lies outside {NATIVE_MATERIALS_FOLDER}')
            if files_by_path.setdefault(record['path'], record) != record:
                raise NativeMaterialListingError(f'material file {record["path"]} of tile {tile_id} has two different pins')
    return [files_by_path[path] for path in sorted(files_by_path)]


def native_material_listing_store_path(listing_prefix, listing_sha256):
    return f'{NATIVE_MATERIALS_FOLDER}/{listing_prefix}-{listing_sha256}.json'


def native_material_listing(listing_kind, listing_prefix, tile_id, listed_fields, material_files):
    listing = {'kind': listing_kind, 'schemaVersion': NATIVE_MATERIAL_LISTING_SCHEMA_VERSION, 'tileId': tile_id, **listed_fields,
               'files': {record['path'].removeprefix(NATIVE_MATERIALS_FOLDER + '/'): {'sha256': record['sha256'], 'bytes': record['bytes']}
                         for record in material_files}}
    payload = canonical_json_bytes(listing)
    return native_material_listing_store_path(listing_prefix, sha256_hex(payload)), payload


def surface_materials_listing(tile_id, material_files):
    return native_material_listing(SURFACE_MATERIALS_LISTING_KIND, SURFACE_MATERIALS_LISTING_PREFIX, tile_id, {}, material_files)


def static_mesh_materials_listing(tile_id, materials, material_files):
    return native_material_listing(STATIC_MESH_MATERIALS_LISTING_KIND, STATIC_MESH_MATERIALS_LISTING_PREFIX, tile_id, {'materials': materials},
                                   material_files)


def terrain_materials_listing(tile_id, layers, material_files):
    return native_material_listing(TERRAIN_MATERIALS_LISTING_KIND, TERRAIN_MATERIALS_LISTING_PREFIX, tile_id, {'layers': layers}, material_files)


def publish_native_material_listing(store_root, relative_path, payload, material_files):
    store_files = {}
    add_store_file(store_files, relative_path, payload)
    publish_store_files(store_root, store_files)
    listing = {'resource': '/l2/' + relative_path, 'sha256': sha256_hex(payload), 'bytes': len(payload)}
    return listing, [*material_files, {'path': relative_path, 'sha256': listing['sha256'], 'bytes': listing['bytes']}]
