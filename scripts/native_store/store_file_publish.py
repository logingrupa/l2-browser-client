from native_store.catalog_writer import verify_store_destinations, write_store_files
from native_store.interprocess_lock import lane_store_publish_lock
from native_store.store_paths import refuse_reparse_points


def publish_store_files(store_root, files):
    root = refuse_reparse_points(store_root)
    with lane_store_publish_lock(root):
        verify_store_destinations(root, files)
        write_store_files(root, files)
