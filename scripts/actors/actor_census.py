import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import hashlib
import json
from pathlib import PurePosixPath

from actors.actor_unit_inventory import ACTOR_UNIT_CENSUS_RELATIVE_PATH, character_units_and_rows, decoded_table_rows, npc_units_and_rows
from actors.item_unit_inventory import armorgrp_mtx_column_names, item_units_and_rows
from actors.skill_dispatch_candidates import read_skill_dispatch_candidates
from actors.skill_unit_inventory import skill_units_and_rows
from native_assets_lib.asset_manifest import reference_client_build
from native_assets_lib.texture_mips import REVIEWED_VERSIONS
from native_catalog.cli import NATIVE, inspect_header
from native_catalog.skeletal import SkeletalReader
from native_catalog.tables import decode_table
from native_catalog.ue2 import FormatError
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import replace_file
from native_store.gap_rows import write_gap_rows
from native_store.lane_coverage_refresh import lane_coverage_refreshed_at_exit
from native_store.store_paths import refuse_reparse_points
from native_store.unit_ledger import run_at_below_normal_priority
from reference_client_guard import require_reference_client

REPOSITORY_ROOT = SCRIPTS_ROOT.parent
ACTOR_UNIT_CENSUS_PATH = REPOSITORY_ROOT / ACTOR_UNIT_CENSUS_RELATIVE_PATH
ACTOR_UNIT_CENSUS_SCHEMA_VERSION = 1
ACTOR_CENSUS_TABLES = ('armorgrp', 'chargrp', 'mobskillanimgrp', 'npcgrp', 'npcname', 'skillgrp', 'skillsoundgrp', 'weapongrp')
ACTORS_LANE_NAME = 'actors'
CENSUS_GAP_ROW_STEP = 'census'
SKELETAL_PACKAGE_DIRECTORY = 'animations'
SKELETAL_PACKAGE_SUFFIXES = ('.ukx', '.usk')
MESH_PACKAGE_SUFFIXES = ('.ukx',)
TEXTURE_PACKAGE_SUFFIXES = ('.ukx', '.utx')
SOUND_PACKAGE_SUFFIXES = ('.uax',)
EFFECT_PACKAGE_SUFFIXES = tuple(sorted(NATIVE))
ACCEPTED_GATE = 'accepted'
REFUSED_GATE = 'refused'
NOT_APPLICABLE_GATE = 'not-applicable'
UNSUPPORTED_HEADER_REASON = 'decode-failed:unsupported-native'
CENSUS_ENVELOPE_LIST_IDENTITIES = {'packages': 'path', 'tables': 'table', 'units': 'key'}


class PackageHeaderView:
    def __init__(self, package_summary):
        self.summary = package_summary

    def properties(self, item):
        return {}, None


def skeletal_reader_gate(package_summary):
    try:
        SkeletalReader(PackageHeaderView(package_summary), {'className': 'SkeletalMesh'})
    except FormatError:
        return REFUSED_GATE
    return ACCEPTED_GATE


def texture_reader_gate(package_summary):
    return ACCEPTED_GATE if (package_summary['version'], package_summary['licenseeVersion']) in REVIEWED_VERSIONS else REFUSED_GATE


def lock_skeletal_package_paths(lock):
    return sorted(path for path in lock.records_by_path
                  if PurePosixPath(path).parts[0] == SKELETAL_PACKAGE_DIRECTORY and PurePosixPath(path).suffix.lower() in SKELETAL_PACKAGE_SUFFIXES)


def lock_equal_paths_by_casefolded_stem(lock):
    paths_by_stem = {}
    for path, record in lock.records_by_path.items():
        if record['class'] == 'equal':
            paths_by_stem.setdefault(PurePosixPath(path).stem.casefold(), []).append(path)
    return paths_by_stem


def package_name_of(object_name):
    return object_name.split('.', 1)[0]


def licensee_gap_reason(prefix, package_summary):
    if package_summary is None:
        return UNSUPPORTED_HEADER_REASON
    return f'{prefix}:{package_summary["version"]}/{package_summary["licenseeVersion"]}'


class ActorPackageCensus:
    def __init__(self, client_access, skeletal_package_paths):
        self.client_access = client_access
        self.lock_equal_paths_by_stem = lock_equal_paths_by_casefolded_stem(client_access.lock)
        self.header_summaries_by_path = {}
        self.texture_package_paths = set()
        for path in skeletal_package_paths:
            self.package_summary(path)

    def package_summary(self, path):
        if path not in self.header_summaries_by_path:
            observation = inspect_header(self.client_access.require_equal_file(path))
            self.header_summaries_by_path[path] = observation['summary'] if observation['status'] == 'header-readable' else None
        return self.header_summaries_by_path[path]

    def resolve_package_paths(self, object_name, suffixes):
        return [path for path in self.lock_equal_paths_by_stem.get(package_name_of(object_name).casefold(), ())
                if PurePosixPath(path).suffix.lower() in suffixes]

    def resolution_gap_reason(self, object_name, suffixes, missing_reason_prefix):
        paths = self.resolve_package_paths(object_name, suffixes)
        if not paths:
            return f'{missing_reason_prefix}:{package_name_of(object_name)}'
        if len(paths) > 1:
            return f'package-name-ambiguous:{package_name_of(object_name)}'
        return None

    def mesh_gap_reason(self, mesh):
        resolution_reason = self.resolution_gap_reason(mesh, MESH_PACKAGE_SUFFIXES, 'mesh-package-not-in-client')
        if resolution_reason is not None:
            return resolution_reason
        package_summary = self.package_summary(self.resolve_package_paths(mesh, MESH_PACKAGE_SUFFIXES)[0])
        if package_summary is not None and skeletal_reader_gate(package_summary) == ACCEPTED_GATE:
            return None
        return licensee_gap_reason('skeletal-licensee-unsupported', package_summary)

    def texture_gap_reason(self, texture):
        resolution_reason = self.resolution_gap_reason(texture, TEXTURE_PACKAGE_SUFFIXES, 'texture-package-not-in-client')
        if resolution_reason is not None:
            return resolution_reason
        path = self.resolve_package_paths(texture, TEXTURE_PACKAGE_SUFFIXES)[0]
        self.texture_package_paths.add(path)
        package_summary = self.package_summary(path)
        if package_summary is not None and texture_reader_gate(package_summary) == ACCEPTED_GATE:
            return None
        return licensee_gap_reason('texture-licensee-unsupported', package_summary)

    def effect_gap_reason(self, effect_object):
        return self.resolution_gap_reason(effect_object, EFFECT_PACKAGE_SUFFIXES, 'mesh-package-not-in-client')

    def sound_package_resolves(self, sound_reference):
        return len(self.resolve_package_paths(sound_reference, SOUND_PACKAGE_SUFFIXES)) == 1

    def resolved_source_identity(self, object_name, suffixes):
        paths = self.resolve_package_paths(object_name, suffixes)
        if len(paths) != 1:
            return None
        return {'path': paths[0], 'sha256': self.client_access.lock.record(paths[0])['eSha256'], 'object': object_name}

    def mesh_source_identity(self, mesh):
        return self.resolved_source_identity(mesh, MESH_PACKAGE_SUFFIXES)

    def effect_source_identity(self, effect_object):
        return self.resolved_source_identity(effect_object, EFFECT_PACKAGE_SUFFIXES)

    def package_row(self, path):
        package_summary = self.header_summaries_by_path[path]
        skeletal_applicable = PurePosixPath(path).suffix.lower() in SKELETAL_PACKAGE_SUFFIXES
        texture_applicable = path in self.texture_package_paths
        if package_summary is None:
            return {'path': path, 'packageVersion': None, 'licensee': None, 'wrapper': None,
                    'skeletalReaderGate': REFUSED_GATE if skeletal_applicable else NOT_APPLICABLE_GATE,
                    'textureReaderGate': REFUSED_GATE if texture_applicable else NOT_APPLICABLE_GATE}
        return {'path': path, 'packageVersion': package_summary['version'], 'licensee': package_summary['licenseeVersion'],
                'wrapper': package_summary['wrapper'],
                'skeletalReaderGate': skeletal_reader_gate(package_summary) if skeletal_applicable else NOT_APPLICABLE_GATE,
                'textureReaderGate': texture_reader_gate(package_summary) if texture_applicable else NOT_APPLICABLE_GATE}

    def package_rows(self):
        return [self.package_row(path) for path in sorted(self.header_summaries_by_path)]


def decoded_table_census_row(table_name, decoded_table):
    return {'table': table_name, 'path': decoded_table['source'], 'sha256': decoded_table['sourceSha256'],
            'rowCount': len(decoded_table_rows(decoded_table))}


def actor_units_and_rows(tables, armor_mesh_columns, package_census, dispatch_candidates):
    units, rows = [], []
    for kind_units, kind_rows in (
            npc_units_and_rows(tables['npcgrp'], package_census),
            character_units_and_rows(tables['chargrp'], package_census),
            item_units_and_rows(tables['weapongrp'], tables['armorgrp'], armor_mesh_columns, package_census),
            skill_units_and_rows(tables['skillgrp'], tables['skillsoundgrp'], package_census, dispatch_candidates)):
        units.extend(kind_units)
        rows.extend(kind_rows)
    return sorted(units, key=lambda unit: unit['key']), rows


def build_actor_census(client_access, tables, armor_mesh_columns, dispatch_candidates):
    package_census = ActorPackageCensus(client_access, lock_skeletal_package_paths(client_access.lock))
    units, rows = actor_units_and_rows(tables, armor_mesh_columns, package_census, dispatch_candidates)
    census = {
        'schemaVersion': ACTOR_UNIT_CENSUS_SCHEMA_VERSION,
        'referenceTreeLockSha256': reference_client_build(client_access.lock)['referenceTreeLockSha256'],
        'tables': [decoded_table_census_row(table_name, tables[table_name]) for table_name in sorted(tables)],
        'packages': package_census.package_rows(),
        'units': units,
    }
    return census, rows


def decode_actor_tables(client_root):
    return {table_name: decode_table(client_root, table_name) for table_name in ACTOR_CENSUS_TABLES}


def write_actor_census(census, path):
    refuse_reparse_points(path.parent)
    replace_file(path, canonical_json_bytes(census))


def first_differing_census_key(committed, recomputed):
    if not isinstance(committed, dict):
        return 'census'
    for field in sorted(set(committed) | set(recomputed)):
        committed_value, recomputed_value = committed.get(field), recomputed.get(field)
        if committed_value == recomputed_value:
            continue
        identity_field = CENSUS_ENVELOPE_LIST_IDENTITIES.get(field)
        if identity_field is None or not isinstance(committed_value, list):
            return field
        committed_by_identity = {record.get(identity_field): record for record in committed_value if isinstance(record, dict)}
        recomputed_by_identity = {record[identity_field]: record for record in recomputed_value}
        for identity in sorted(set(committed_by_identity) | set(recomputed_by_identity), key=str):
            if committed_by_identity.get(identity) != recomputed_by_identity.get(identity):
                return f'{field}:{identity}'
        return field
    return None


def read_committed_census(path):
    try:
        return json.loads(path.read_bytes().decode('utf-8'))
    except (FileNotFoundError, ValueError):
        return None


def check_committed_census(census, path):
    return first_differing_census_key(read_committed_census(path), census)


def census_summary(census, rows):
    return {'output': ACTOR_UNIT_CENSUS_RELATIVE_PATH, 'packages': len(census['packages']), 'units': len(census['units']),
            'rows': len(rows), 'censusSha256': hashlib.sha256(canonical_json_bytes(census)).hexdigest()}


def main(argv=None):
    parser = argparse.ArgumentParser(description='Census the actor packages and conversion units of the locked reference client tree.')
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    arguments = parser.parse_args(argv)
    try:
        client_access = require_reference_client(arguments.client)
        run_at_below_normal_priority()
        tables = decode_actor_tables(client_access.root)
        census, rows = build_actor_census(client_access, tables, armorgrp_mtx_column_names(tables['armorgrp']),
                                          read_skill_dispatch_candidates(REPOSITORY_ROOT)['document'])
        if arguments.check:
            differing_key = check_committed_census(census, ACTOR_UNIT_CENSUS_PATH)
            if differing_key is not None:
                print(f'Actor census differs from {ACTOR_UNIT_CENSUS_RELATIVE_PATH} at {differing_key}', file=sys.stderr)
                return 1
        else:
            with lane_coverage_refreshed_at_exit(REPOSITORY_ROOT, ACTORS_LANE_NAME):
                write_actor_census(census, ACTOR_UNIT_CENSUS_PATH)
                write_gap_rows(REPOSITORY_ROOT, ACTORS_LANE_NAME, CENSUS_GAP_ROW_STEP, rows)
    except (OSError, ValueError) as error:
        print(f'Actor census failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps(census_summary(census, rows), indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
