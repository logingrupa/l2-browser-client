import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parent
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json
from pathlib import PurePosixPath
import re

from native_assets_lib.asset_manifest import reference_client_build
from native_assets_lib.material_graph import REVIEWED_MATERIAL_CLASSES, material_class_unported_reason
from native_catalog.ue2 import FormatError, Reader, summary, unwrap
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import replace_file
from native_store.store_paths import refuse_reparse_points
from native_store.unit_ledger import BATCH_MINIMUM_FREE_BYTES, require_batch_preflight, run_at_below_normal_priority
from reference_client_guard import require_reference_client

REPOSITORY_ROOT = SCRIPTS_ROOT.parent
MATERIAL_CLASS_CENSUS_RELATIVE_PATH = 'docs/parts/adapter-dispatch/material-class-census.json'
MATERIAL_CLASS_CENSUS_SCHEMA_VERSION = 1
CENSUS_PACKAGE_SUFFIXES = ('.utx', '.usx', '.ukx', '.usk', '.unr')
SCRIPT_PACKAGE_DIRECTORY = 'system'
SCRIPT_PACKAGE_SUFFIX = '.u'
MATERIAL_BASE_CLASS = 'Engine.Material'
TABLE_LAYOUT_PACKAGE_VERSIONS = (118, 123)
MAXIMUM_TABLE_ENTRIES = 1_000_000
MAXIMUM_CLASS_CHAIN_LENGTH = 64
MAXIMUM_OUTER_DEPTH = 100
INTEGRATION_LANE_NAME = 'integration'
REVIEWED_STATUS = 'reviewed'
UNPORTED_STATUS = 'material-class-unported'
SCRIPT_PACKAGE_NOT_LOCKED_REASON = 'script-package-not-lock-equal'
NO_SCRIPT_CLASS_EXPORT_REASON = 'no-script-class-export'
UNRESOLVED_CLASS_REASONS = (SCRIPT_PACKAGE_NOT_LOCKED_REASON, NO_SCRIPT_CLASS_EXPORT_REASON)
CENSUS_FIELDS = ('classes', 'packageCount', 'referenceTreeLockSha256', 'schemaVersion', 'unreadablePackages', 'unresolvedClasses')
CLASS_ROW_FIELDS = ('class', 'exportCount', 'packageCount', 'status')
UNRESOLVED_CLASS_ROW_FIELDS = ('class', 'exportCount', 'packageCount', 'reason')
UNREADABLE_PACKAGE_ROW_FIELDS = ('path', 'reason')
SHA256_PATTERN = re.compile(r'[0-9a-f]{64}')


class MaterialCensusError(ValueError):
    pass


class UnresolvedClassError(MaterialCensusError):
    def __init__(self, class_object, reason):
        super().__init__(f'class {class_object} cannot be resolved: {reason}')
        self.reason = reason


class PackageObjectTables:
    def __init__(self, package_name, names, imports, exports):
        self.package_name, self.names, self.imports, self.exports = package_name, names, imports, exports

    def name(self, index):
        if not 0 <= index < len(self.names):
            raise MaterialCensusError(f'name index {index} lies outside the name table of {self.package_name}')
        return self.names[index]

    def object_name(self, index, depth=0):
        if index == 0:
            return None
        if depth > MAXIMUM_OUTER_DEPTH:
            raise MaterialCensusError(f'object outer chain of {self.package_name} is cyclic or too deep')
        table, offset = (self.exports, index - 1) if index > 0 else (self.imports, -index - 1)
        if not 0 <= offset < len(table):
            raise MaterialCensusError(f'object reference {index} lies outside the tables of {self.package_name}')
        entry = table[offset]
        parent = self.object_name(entry['outerIndex'], depth + 1) if entry['outerIndex'] else (self.package_name if index > 0 else '')
        return f'{parent}.{entry["name"]}' if parent else entry['name']


def read_table_count(package_summary, field):
    count = package_summary[field]
    if count > MAXIMUM_TABLE_ENTRIES:
        raise MaterialCensusError(f'package table {field} {count} exceeds {MAXIMUM_TABLE_ENTRIES}')
    return count


def read_package_object_tables(data, file_name):
    package_summary = summary(data[:128], file_name)
    if package_summary['version'] not in TABLE_LAYOUT_PACKAGE_VERSIONS:
        raise MaterialCensusError(f'package version {package_summary["version"]} has no reviewed table layout')
    _, decoded = unwrap(data, file_name)
    reader = Reader(decoded, package_summary['nameOffset'])
    names = []
    for _ in range(read_table_count(package_summary, 'nameCount')):
        names.append(reader.string())
        reader.number('I')
    tables = PackageObjectTables(file_name.rsplit('.', 1)[0], names, [], [])
    reader = Reader(decoded, package_summary['importOffset'])
    for _ in range(read_table_count(package_summary, 'importCount')):
        tables.imports.append({'classPackage': tables.name(reader.compact()), 'className': tables.name(reader.compact()),
                               'outerIndex': reader.number('i'), 'name': tables.name(reader.compact())})
    reader = Reader(decoded, package_summary['exportOffset'])
    for _ in range(read_table_count(package_summary, 'exportCount')):
        export = {'classIndex': reader.compact(), 'superIndex': reader.compact(), 'outerIndex': reader.number('i'),
                  'name': tables.name(reader.compact()), 'flags': reader.number('I'), 'size': reader.compact()}
        if export['size']:
            reader.compact()
        tables.exports.append(export)
    return tables


def census_sort_key(path):
    return (path.casefold(), path)


def lock_equal_paths(lock, include_path):
    paths_by_casefolded_path = {}
    for path, record in lock.records_by_path.items():
        if record['class'] != 'equal' or not include_path(PurePosixPath(path)):
            continue
        if path.casefold() in paths_by_casefolded_path:
            raise MaterialCensusError(f'reference client lock holds casefold-equal paths {paths_by_casefolded_path[path.casefold()]} and {path}')
        paths_by_casefolded_path[path.casefold()] = path
    return sorted(paths_by_casefolded_path.values(), key=census_sort_key)


def lock_equal_census_package_paths(lock):
    return lock_equal_paths(lock, lambda path: path.suffix.lower() in CENSUS_PACKAGE_SUFFIXES)


def lock_equal_script_package_paths(lock):
    paths = lock_equal_paths(lock, lambda path: len(path.parts) == 2 and path.parts[0].casefold() == SCRIPT_PACKAGE_DIRECTORY
                             and path.suffix.lower() == SCRIPT_PACKAGE_SUFFIX)
    return {PurePosixPath(path).stem.casefold(): path for path in paths}


def read_lock_equal_tables(client_access, relative_path):
    package_path = client_access.require_equal_file(relative_path)
    return read_package_object_tables(package_path.read_bytes(), PurePosixPath(relative_path).name)


class MaterialClassResolver:
    def __init__(self, client_access):
        self.client_access = client_access
        self.script_paths_by_package_name = lock_equal_script_package_paths(client_access.lock)
        self.tables_by_package_name = {}
        self.material_status_by_class = {}

    def script_package_tables(self, class_object, package_name):
        key = package_name.casefold()
        if key not in self.tables_by_package_name:
            if key not in self.script_paths_by_package_name:
                raise UnresolvedClassError(class_object, SCRIPT_PACKAGE_NOT_LOCKED_REASON)
            self.tables_by_package_name[key] = read_lock_equal_tables(self.client_access, self.script_paths_by_package_name[key])
        return self.tables_by_package_name[key]

    def super_class(self, class_object):
        package_name, _, class_name = class_object.partition('.')
        tables = self.script_package_tables(class_object, package_name)
        matches = [export for export in tables.exports
                   if export['classIndex'] == 0 and export['outerIndex'] == 0 and export['name'].casefold() == class_name.casefold()]
        if not matches:
            raise UnresolvedClassError(class_object, NO_SCRIPT_CLASS_EXPORT_REASON)
        if len(matches) > 1:
            raise MaterialCensusError(f'class {class_object} is exported more than once by its script package')
        return tables.object_name(matches[0]['superIndex'])

    def is_material_class(self, class_object):
        if class_object not in self.material_status_by_class:
            chain, current_class = [], class_object
            while current_class is not None and current_class != MATERIAL_BASE_CLASS:
                if current_class in chain or len(chain) >= MAXIMUM_CLASS_CHAIN_LENGTH:
                    raise MaterialCensusError(f'class chain of {class_object} is cyclic or too long')
                chain.append(current_class)
                current_class = self.super_class(current_class)
            self.material_status_by_class[class_object] = current_class == MATERIAL_BASE_CLASS
        return self.material_status_by_class[class_object]


def class_status(class_object):
    return REVIEWED_STATUS if class_object in REVIEWED_MATERIAL_CLASSES else UNPORTED_STATUS


def class_count_rows(counts_by_class, packages_by_class, extra_fields):
    return [{'class': class_object, 'exportCount': counts_by_class[class_object], 'packageCount': len(packages_by_class[class_object]),
             **extra_fields(class_object)} for class_object in sorted(counts_by_class, key=census_sort_key)]


def build_material_class_census(client_access):
    resolver = MaterialClassResolver(client_access)
    material_counts, material_packages, unresolved_counts, unresolved_packages, unresolved_reasons = {}, {}, {}, {}, {}
    unreadable_packages, package_paths = [], lock_equal_census_package_paths(client_access.lock)
    for relative_path in package_paths:
        try:
            tables = read_lock_equal_tables(client_access, relative_path)
        except (FormatError, MaterialCensusError, UnicodeError) as error:
            unreadable_packages.append({'path': relative_path, 'reason': f'decode-failed:{type(error).__name__}'})
            continue
        for export in tables.exports:
            if export['classIndex'] == 0:
                continue
            class_object = tables.object_name(export['classIndex'])
            try:
                is_material = resolver.is_material_class(class_object)
            except UnresolvedClassError as error:
                unresolved_counts[class_object] = unresolved_counts.get(class_object, 0) + 1
                unresolved_packages.setdefault(class_object, set()).add(relative_path)
                unresolved_reasons[class_object] = error.reason
                continue
            if is_material:
                material_counts[class_object] = material_counts.get(class_object, 0) + 1
                material_packages.setdefault(class_object, set()).add(relative_path)
    return validate_material_class_census({
        'schemaVersion': MATERIAL_CLASS_CENSUS_SCHEMA_VERSION,
        'referenceTreeLockSha256': reference_client_build(client_access.lock)['referenceTreeLockSha256'],
        'packageCount': len(package_paths) - len(unreadable_packages),
        'unreadablePackages': unreadable_packages,
        'classes': class_count_rows(material_counts, material_packages, lambda class_object: {'status': class_status(class_object)}),
        'unresolvedClasses': class_count_rows(unresolved_counts, unresolved_packages,
                                              lambda class_object: {'reason': unresolved_reasons[class_object]}),
    })


def require_count(value, description):
    if not (type(value) is int and value >= 1):
        raise MaterialCensusError(f'{description} must be a positive integer')


def validate_material_class_census(census):
    if not (isinstance(census, dict) and tuple(sorted(census)) == CENSUS_FIELDS):
        raise MaterialCensusError('material class census has unexpected fields')
    if census['schemaVersion'] != MATERIAL_CLASS_CENSUS_SCHEMA_VERSION:
        raise MaterialCensusError(f'material class census schemaVersion must be {MATERIAL_CLASS_CENSUS_SCHEMA_VERSION}')
    if not (isinstance(census['referenceTreeLockSha256'], str) and SHA256_PATTERN.fullmatch(census['referenceTreeLockSha256'])):
        raise MaterialCensusError('material class census referenceTreeLockSha256 must be a SHA-256 hex digest')
    require_count(census['packageCount'], 'material class census packageCount')
    for row in census['classes']:
        if not (isinstance(row, dict) and tuple(sorted(row)) == CLASS_ROW_FIELDS):
            raise MaterialCensusError(f'material class census row has unexpected fields: {row!r}')
        require_count(row['exportCount'], f'exportCount of {row["class"]}')
        require_count(row['packageCount'], f'packageCount of {row["class"]}')
        if row['status'] != class_status(row['class']):
            raise MaterialCensusError(f'status of {row["class"]} does not follow the reviewed material classes')
    for row in census['unresolvedClasses']:
        if not (isinstance(row, dict) and tuple(sorted(row)) == UNRESOLVED_CLASS_ROW_FIELDS and row['reason'] in UNRESOLVED_CLASS_REASONS):
            raise MaterialCensusError(f'unresolved class row is malformed: {row!r}')
    for row in census['unreadablePackages']:
        if not (isinstance(row, dict) and tuple(sorted(row)) == UNREADABLE_PACKAGE_ROW_FIELDS and row['reason'].startswith('decode-failed:')):
            raise MaterialCensusError(f'unreadable package row is malformed: {row!r}')
    for rows in (census['classes'], census['unresolvedClasses']):
        classes = [row['class'] for row in rows]
        if classes != sorted(classes, key=census_sort_key) or len(set(classes)) != len(classes):
            raise MaterialCensusError('material class census rows must be unique and sorted by class')
    return census


def material_class_gap_reasons(census):
    return [material_class_unported_reason(row['class']) for row in census['classes'] if row['status'] == UNPORTED_STATUS]


def write_material_class_census(census, output_path):
    refuse_reparse_points(output_path.parent)
    replace_file(output_path, canonical_json_bytes(census))


def main(argv=None):
    parser = argparse.ArgumentParser(description='Count the material classes of every lock-equal Interlude package from its export table.')
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=REPOSITORY_ROOT / MATERIAL_CLASS_CENSUS_RELATIVE_PATH)
    arguments = parser.parse_args(argv)
    try:
        client_access = require_reference_client(arguments.client)
        require_batch_preflight(REPOSITORY_ROOT, INTEGRATION_LANE_NAME, BATCH_MINIMUM_FREE_BYTES)
        run_at_below_normal_priority()
        census = build_material_class_census(client_access)
        write_material_class_census(census, arguments.output)
    except (OSError, ValueError) as error:
        print(f'Material class census failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps({'output': str(arguments.output), 'packages': census['packageCount'], 'classes': len(census['classes']),
                      'unported': material_class_gap_reasons(census), 'unreadablePackages': len(census['unreadablePackages']),
                      'unresolvedClasses': len(census['unresolvedClasses'])}, indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
