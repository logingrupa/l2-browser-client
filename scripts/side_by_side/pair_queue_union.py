from __future__ import annotations

from functools import cached_property
import json
from pathlib import Path

from native_store.build_coverage_report import COVERAGE_OUTPUT_NAME, COVERAGE_ROW_FIELDS
from native_store.catalog_index_keys import catalog_index_keys, read_measured_catalog
from native_store.catalog_writer import CatalogWriteError, refuse_duplicate_json_keys, refuse_non_finite_json_number
from native_store.gap_rows import INTEGRATION_LANE_NAME
from native_store.load_check_records import read_load_check_records
from native_store.side_by_side_key_digest import key_content_sha256_by_key

STRICT_JSON_MAXIMUM_BYTES = 64 * 1024 * 1024
COVERAGE_REGENERATE_COMMAND = ('python -B scripts/native_store/build_coverage_report.py --store-root artifacts/lane-store/integration/l2 '
                               '--census-lanes world actors data-ui integration')
CENSUS_GAP_STATUSES = ('gap', 'failed')


class PairQueueError(ValueError):
    pass


def decode_strict_json(payload, label):
    try:
        return json.loads(payload, object_pairs_hook=refuse_duplicate_json_keys, parse_constant=refuse_non_finite_json_number)
    except (CatalogWriteError, ValueError) as error:
        raise PairQueueError(f'{label} is not strict JSON: {error}') from error


def read_strict_json_file(path, label):
    if not Path(path).is_file():
        raise PairQueueError(f'{label} is missing: {path}')
    with open(path, 'rb') as stream:
        payload = stream.read(STRICT_JSON_MAXIMUM_BYTES + 1)
    if len(payload) > STRICT_JSON_MAXIMUM_BYTES:
        raise PairQueueError(f'{label} exceeds {STRICT_JSON_MAXIMUM_BYTES} bytes: {path}')
    return decode_strict_json(payload, f'{label} {path}')


class PairQueueUnion:
    def __init__(self, project_root, store_root):
        self.project_root = Path(project_root)
        self.store_root = Path(store_root)
        self.catalog, self.catalog_sha256 = read_measured_catalog(self.store_root)

    @cached_property
    def converted_keys(self):
        return frozenset(catalog_index_keys(self.store_root, self.catalog))

    @cached_property
    def key_content_sha256_by_key(self):
        return key_content_sha256_by_key(self.store_root, self.catalog)

    @cached_property
    def load_status_by_key(self):
        records = read_load_check_records(self.project_root, INTEGRATION_LANE_NAME, self.catalog_sha256)
        return {key: record['status'] for key, record in records.items()}

    @cached_property
    def coverage_rows(self):
        coverage_path = self.store_root / COVERAGE_OUTPUT_NAME
        report = read_strict_json_file(coverage_path, 'union coverage report')
        if not (isinstance(report, dict) and isinstance(report.get('rows'), list)
                and all(isinstance(row, dict) and set(row) == COVERAGE_ROW_FIELDS for row in report['rows'])):
            raise PairQueueError(f'union coverage report must hold a rows list of {", ".join(sorted(COVERAGE_ROW_FIELDS))}: {coverage_path}')
        if report.get('catalogSha256') != self.catalog_sha256:
            raise PairQueueError(f'union coverage report {coverage_path} is for catalog {report["catalogSha256"]}, not the union catalog '
                                 f'{self.catalog_sha256}; regenerate it with {COVERAGE_REGENERATE_COMMAND}')
        return report['rows']

    @cached_property
    def census_status_by_part_and_key(self):
        return {(row['part'], row['key']): row['status'] for row in self.coverage_rows}

    def is_census_gap(self, part, key):
        return self.census_status_by_part_and_key.get((part, key)) in CENSUS_GAP_STATUSES

    def census_ordered_keys(self, part, kind):
        return [row['key'] for row in self.coverage_rows if row['part'] == part and row['key'].split(':', 1)[0] == kind]
