from __future__ import annotations

from native_store.catalog_writer import CatalogWriteError, validate_catalog_record
from native_store.coverage_denominators import CoverageReportError


def validated_slice_records(catalog, slice_name):
    records = catalog.get(slice_name, [])
    if not isinstance(records, list):
        raise CoverageReportError(f'catalog slice {slice_name} is not a list')
    for record in records:
        try:
            validate_catalog_record(slice_name, record)
        except CatalogWriteError as error:
            raise CoverageReportError(f'catalog slice {slice_name} holds a refused record: {error}') from error
    return records


def table_keys(catalog):
    return {f'table:{record["id"]}' for record in validated_slice_records(catalog, 'tables')}


def catalog_index_keys(catalog):
    return tuple(sorted(table_keys(catalog)))
