from __future__ import annotations

from contextlib import contextmanager

from native_store.build_coverage_report import COVERAGE_OUTPUT_NAME, refresh_lane_coverage_report
from native_store.catalog_writer import STORE_CATALOG_NAME, sha256_of_file
from native_store.store_paths import lane_store_root


class LaneCoverageNotRefreshedError(ValueError):
    pass


def lane_coverage_report_command(project_root, lane_name):
    store_root = lane_store_root(project_root, lane_name)
    return f'pnpm report:coverage --store-root {store_root.as_posix()} --lane {lane_name}'


def lane_catalog_text(store_root):
    catalog_path = store_root / STORE_CATALOG_NAME
    return f'catalog {sha256_of_file(catalog_path)}' if catalog_path.is_file() else 'missing catalog'


def refresh_lane_coverage(project_root, lane_name):
    try:
        refresh_lane_coverage_report(project_root, lane_name)
    except (OSError, ValueError) as error:
        store_root = lane_store_root(project_root, lane_name)
        raise LaneCoverageNotRefreshedError(
            f'lane {lane_name} coverage report {store_root / COVERAGE_OUTPUT_NAME} was not refreshed for its {lane_catalog_text(store_root)}: '
            f'{error}; once the reason is fixed, run {lane_coverage_report_command(project_root, lane_name)}') from error


@contextmanager
def lane_coverage_refreshed_at_exit(project_root, lane_name):
    try:
        yield
    except (OSError, ValueError) as run_error:
        try:
            refresh_lane_coverage(project_root, lane_name)
        except LaneCoverageNotRefreshedError as refresh_error:
            raise LaneCoverageNotRefreshedError(f'{run_error}; {refresh_error}') from run_error
        raise
    refresh_lane_coverage(project_root, lane_name)
