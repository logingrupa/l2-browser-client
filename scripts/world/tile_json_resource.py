from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import add_store_file, sha256_hex
from native_store.store_file_publish import publish_store_files

BUNDLE_MANIFEST_NAME = 'manifest.json'


def write_tile_json_resource(store_root, folder, name, document):
    payload = canonical_json_bytes(document)
    relative = f'{folder}/{sha256_hex(payload)}/{name}'
    destination = {}
    add_store_file(destination, relative, payload)
    publish_store_files(store_root, destination)
    return {'resource': f'/l2/{relative}', 'sha256': sha256_hex(payload), 'bytes': len(payload)}, \
        {'path': (store_root / relative).relative_to(store_root.parent).as_posix(), 'sha256': sha256_hex(payload), 'bytes': len(payload)}


def write_tile_resource_bundle(store_root, folder, files):
    manifest = files[BUNDLE_MANIFEST_NAME]
    bundle_folder = f'{folder}/{sha256_hex(manifest)}'
    destination = {}
    for name, payload in files.items():
        add_store_file(destination, f'{bundle_folder}/{name}', payload)
    publish_store_files(store_root, destination)
    outputs = [{'path': (store_root / relative).relative_to(store_root.parent).as_posix(), 'sha256': sha256_hex(payload), 'bytes': len(payload)}
               for relative, payload in sorted(destination.values())]
    return {'resource': f'/l2/{bundle_folder}/{BUNDLE_MANIFEST_NAME}', 'sha256': sha256_hex(manifest), 'bytes': len(manifest)}, outputs
