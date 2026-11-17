from native_assets_lib.gltf import json_bytes
from native_store.catalog_writer import merge_catalog_slice_records, read_store_catalog, validate_catalog_record, write_store


def catalog_without_records(catalog, slice_name, record_ids):
    if slice_name not in catalog or not record_ids:
        return catalog
    return {**catalog, slice_name: [existing for existing in catalog[slice_name] if existing.get('id') not in record_ids]}


def catalog_with_records_replaced(catalog, slice_name, records, capacity):
    if not records:
        return catalog
    last_records_by_id = {}
    for record in records:
        record_id = validate_catalog_record(slice_name, record)['id']
        last_records_by_id.pop(record_id, None)
        last_records_by_id[record_id] = record
    pruned_catalog = catalog_without_records(catalog, slice_name, last_records_by_id.keys())
    return merge_catalog_slice_records(pruned_catalog, slice_name, list(last_records_by_id.values()), capacity)


def write_catalog_without_record(store_root, slice_name, record_id):
    catalog, before = read_store_catalog(store_root)
    pruned = catalog_without_records(catalog, slice_name, {record_id})
    if pruned != catalog:
        write_store(store_root, {}, before, json_bytes(pruned))
