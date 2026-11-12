import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import hashlib
import json

from actors.character_requests import (BODY_MESH_GROUP, CHARACTER_CLASS_SOURCES_RELATIVE_PATH, CHARGRP_ROW_COLLECTION, CHARGRP_TABLE_NAME,
                                       FACE_MESH_FIELD, FACE_MESH_GROUP, HEAD_BONE_FIELD, SUB_MESHES_FIELD, is_padding_row)
from data.hair_table_adapter import HAIR_TABLE_PARSERS
from native_assets_lib.class_defaults import ReferenceClientClassScripts, class_default_parser_sha256, read_class_defaults_with_provenance
from native_catalog.effects import UELIB_SHA256
from native_catalog.ue2 import FormatError
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import is_table_name_index_id, read_store_catalog, replace_file
from native_store.data_ui_table_manifest import DATA_UI_LANE_NAME, ELBERA_ADAPTER_ROUTE, LOCAL_DESCRIPTOR_ROUTE, data_ui_table_manifest
from native_store.store_paths import REPOSITORY_ROOT, lane_store_root, lane_work_root

CHARACTER_CLASS_SOURCES_SCHEMA_VERSION = 1
ADOPTED_VERDICT, NOT_DECIDED_VERDICT = 'adopted', 'not-decided'
MESH_FIELD = 'Mesh'
CLASS_DEFAULT_FIELDS = (HEAD_BONE_FIELD, MESH_FIELD, SUB_MESHES_FIELD)
CHARGRP_INDEX_FIELD_FRAGMENT = 'chargrp'
SCRIPT_PACKAGE_FOLDER, SCRIPT_PACKAGE_SUFFIX = 'system', '.u'
PAWN_CLASS = 'Engine.Pawn'
CLASS_EXPORT_NAME = 'Class'
JOIN_RULE = [
    'A chargrp row joins an actor class only when every source names exactly one class for the row and that class names no other row.',
    'A class names a row when its Mesh or SubMeshes default, own or inherited, is a body_mesh or face_mesh reference of the row.',
    'A decoded table record names a row through such a reference or a chargrp index field, and a class through a string equal to an '
    'Engine.Pawn subclass export.',
    'Candidates are never ranked by name likeness and one of several is never picked.',
]
SCRIPT_SEARCH_BOUND = [
    'Class defaults are read for the Engine.Pawn subclasses of every script package whose name table holds a chargrp mesh object name.',
    'Then for every Engine.Pawn subclass whose export-table ancestry reaches a class that names a row.',
    'A class default can name a mesh only through a name in its own package or through an ancestor class.',
]


class CharacterClassSourcesError(ValueError):
    pass


def chargrp_row_meshes_by_row(chargrp_rows):
    return {row_index: sorted({mesh for mesh in row[BODY_MESH_GROUP].values() if mesh}
                              | {entry[FACE_MESH_FIELD] for entry in row.get(FACE_MESH_GROUP, []) if entry[FACE_MESH_FIELD]})
            for row_index, row in enumerate(chargrp_rows) if not is_padding_row(row)}


def rows_by_row_mesh(row_meshes_by_row):
    rows = {}
    for row_index, meshes in row_meshes_by_row.items():
        for mesh in meshes:
            rows.setdefault(mesh.casefold(), set()).add(row_index)
    return rows


def record_leaf_values(value, field_name=None):
    if isinstance(value, dict):
        for child_name, child in value.items():
            yield from record_leaf_values(child, child_name)
    elif isinstance(value, list):
        for child in value:
            yield from record_leaf_values(child, field_name)
    else:
        yield field_name, value


def table_records(manifest):
    records = manifest['records']
    if isinstance(records, list):
        return [([ordinal], record) for ordinal, record in enumerate(records)]
    return [([collection, ordinal], record) for collection, items in sorted(records.items()) if isinstance(items, list)
            for ordinal, record in enumerate(items)]


def table_record_candidates(table_name, manifest, row_meshes_by_row, pawn_class_names):
    mesh_rows = rows_by_row_mesh(row_meshes_by_row)
    classes_by_folded_name = {name.casefold(): name for name in pawn_class_names}
    candidates = []
    for record_path, record in table_records(manifest):
        rows, classes = set(), set()
        for field_name, value in record_leaf_values(record):
            if isinstance(value, str):
                rows |= mesh_rows.get(value.casefold(), set())
                if value.casefold() in classes_by_folded_name:
                    classes.add(classes_by_folded_name[value.casefold()])
            elif (type(value) is int and isinstance(field_name, str) and CHARGRP_INDEX_FIELD_FRAGMENT in field_name.casefold()
                  and value in row_meshes_by_row):
                rows.add(value)
        if rows:
            candidates.append({'table': table_name, 'sourceSha256': manifest['sourceSha256'], 'recordPath': record_path,
                               'rowIndexes': sorted(rows), 'actorClasses': sorted(classes)})
    return candidates


def class_default_candidate(class_record, row_meshes_by_row):
    mesh_rows = rows_by_row_mesh(row_meshes_by_row)
    named_meshes = sorted(mesh for mesh in class_record['meshes'] if mesh.casefold() in mesh_rows)
    rows = sorted({row for mesh in named_meshes for row in mesh_rows[mesh.casefold()]})
    if not (rows or class_record['headBone']):
        return None
    return {'class': class_record['class'], 'package': class_record['package'], 'packageSha256': class_record['packageSha256'],
            'holdsHeadBone': bool(class_record['headBone']), 'headBoneDeclaringClass': class_record['headBoneDeclaringClass'],
            'rowIndexes': rows, 'namedRowMeshes': named_meshes}


def class_join_verdict(row_indexes, table_candidates, class_candidates):
    classes_by_row = {row: set() for row in row_indexes}
    rows_by_class, packages_by_class, classless_records = {}, {}, {row: 0 for row in row_indexes}
    for candidate in class_candidates:
        packages_by_class[candidate['class']] = candidate['packageSha256']
        for row in candidate['rowIndexes']:
            classes_by_row[row].add(candidate['class'])
            rows_by_class.setdefault(candidate['class'], set()).add(row)
    for candidate in table_candidates:
        for row in candidate['rowIndexes']:
            classless_records[row] += 0 if candidate['actorClasses'] else 1
            for actor_class in candidate['actorClasses']:
                classes_by_row[row].add(actor_class)
                rows_by_class.setdefault(actor_class, set()).add(row)
    rows = {}
    for row in row_indexes:
        classes = sorted(classes_by_row[row])
        decided = len(classes) == 1 and rows_by_class[classes[0]] == {row}
        rows[str(row)] = {'candidateClasses': classes, 'candidateCount': len(classes), 'tableRecordsWithoutClass': classless_records[row],
                          'actorClass': classes[0] if decided else None,
                          'classPackageSha256': packages_by_class.get(classes[0]) if decided else None}
    verdict = ADOPTED_VERDICT if rows and all(entry['actorClass'] for entry in rows.values()) else NOT_DECIDED_VERDICT
    return verdict, rows


def decoded_table_manifests(project_root):
    catalog, _ = read_store_catalog(lane_store_root(project_root, DATA_UI_LANE_NAME))
    names = sorted(record['id'] for record in catalog.get('tables', [])
                   if record['id'] != CHARGRP_TABLE_NAME and not is_table_name_index_id(record['id']))
    return [(name, data_ui_table_manifest(project_root, name, ELBERA_ADAPTER_ROUTE if name in HAIR_TABLE_PARSERS else LOCAL_DESCRIPTOR_ROUTE))
            for name in names]


def script_package_exports(client_root, class_scripts):
    packages = []
    for path in sorted((Path(client_root) / SCRIPT_PACKAGE_FOLDER).iterdir(), key=lambda entry: entry.name.casefold()):
        if not (path.is_file() and path.suffix.casefold() == SCRIPT_PACKAGE_SUFFIX):
            continue
        relative_path = path.relative_to(client_root).as_posix()
        try:
            _, package = class_scripts.packages.get(path.stem)
        except FormatError as error:
            packages.append({'package': relative_path, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'refused': str(error),
                             'names': set(), 'classes': {}})
            continue
        classes = {item['object']: package.object_name(item['superIndex']) for item in package.exports if item['className'] == CLASS_EXPORT_NAME}
        packages.append({'package': relative_path, 'sha256': package.source_hash, 'refused': None,
                         'names': {name.casefold() for name in package.names}, 'classes': classes})
    return packages


def pawn_class_ancestries(packages):
    super_classes = {name.casefold(): (name, parent) for package in packages for name, parent in package['classes'].items()}
    ancestries = {}
    for folded_name, (name, _) in super_classes.items():
        chain, current = [], folded_name
        while current and current not in chain:
            chain.append(current)
            current = (super_classes[current][1] or '').casefold() if current in super_classes else ''
        if PAWN_CLASS.casefold() in chain[1:]:
            ancestries[name] = chain[1:]
    return ancestries


def class_default_record(class_name, package, work_root, class_scripts):
    values = {value.field: value for value in read_class_defaults_with_provenance(class_name, list(CLASS_DEFAULT_FIELDS), work_root, class_scripts)}
    sub_meshes = values[SUB_MESHES_FIELD].value or []
    meshes = [entry['object'] for entry in [values[MESH_FIELD].value] + list(sub_meshes) if isinstance(entry, dict) and entry.get('object')]
    return {'class': class_name, 'package': package['package'], 'packageSha256': package['sha256'], 'headBone': values[HEAD_BONE_FIELD].value,
            'headBoneDeclaringClass': values[HEAD_BONE_FIELD].declaring_class, 'meshes': meshes}


def script_class_candidates(client_root, row_meshes_by_row, work_root):
    class_scripts = ReferenceClientClassScripts(client_root)
    packages = script_package_exports(client_root, class_scripts)
    ancestries = pawn_class_ancestries(packages)
    package_of_class = {name: package for package in packages for name in package['classes']}
    mesh_names = {mesh.split('.', 1)[1].casefold() for meshes in row_meshes_by_row.values() for mesh in meshes}
    first_pass = sorted(name for name in ancestries if mesh_names & package_of_class[name]['names'])
    records = {name: class_default_record(name, package_of_class[name], work_root, class_scripts) for name in first_pass}
    candidates = {name: candidate for name, record in records.items() if (candidate := class_default_candidate(record, row_meshes_by_row))}
    naming_classes = {name.casefold() for name, candidate in candidates.items() if candidate['rowIndexes']}
    for name in sorted(name for name, ancestry in ancestries.items() if name not in records and naming_classes & set(ancestry)):
        records[name] = class_default_record(name, package_of_class[name], work_root, class_scripts)
        candidate = class_default_candidate(records[name], row_meshes_by_row)
        if candidate:
            candidates[name] = candidate
    searched = [{'package': package['package'], 'sha256': package['sha256'], 'refused': package['refused'],
                 'classExports': len(package['classes']), 'pawnClasses': sum(1 for name in package['classes'] if name in ancestries),
                 'namesHeadBone': HEAD_BONE_FIELD.casefold() in package['names'],
                 'namedChargrpRowMeshes': len(mesh_names & package['names']),
                 'classesRead': sorted(name for name in records if package_of_class[name] is package)} for package in packages]
    return searched, [candidates[name] for name in sorted(candidates)], set(ancestries)


def character_class_sources_document(project_root, client_root, chargrp_table, work_root):
    row_meshes_by_row = chargrp_row_meshes_by_row(chargrp_table['data'][CHARGRP_ROW_COLLECTION])
    searched_packages, class_candidates, pawn_class_names = script_class_candidates(client_root, row_meshes_by_row, work_root)
    searched_tables, table_candidates = [], []
    for name, manifest in decoded_table_manifests(project_root):
        searched_tables.append({'table': name, 'sourceSha256': manifest['sourceSha256'], 'recordCount': manifest['recordCount']})
        table_candidates += table_record_candidates(name, manifest, row_meshes_by_row, pawn_class_names)
    verdict, rows = class_join_verdict(sorted(row_meshes_by_row), table_candidates, class_candidates)
    return {'schemaVersion': CHARACTER_CLASS_SOURCES_SCHEMA_VERSION, 'verdict': verdict, 'joinRule': JOIN_RULE,
            'scriptSearchBound': SCRIPT_SEARCH_BOUND, 'chargrpSourceSha256': chargrp_table['sourceSha256'],
            'classDefaultFields': list(CLASS_DEFAULT_FIELDS), 'uelibSha256': UELIB_SHA256, 'classDefaultParserSha256': class_default_parser_sha256(),
            'sourcesSearched': {'tables': searched_tables, 'scriptPackages': searched_packages},
            'candidates': {'tableRecords': table_candidates, 'classDefaults': class_candidates}, 'rows': rows}


def read_character_class_sources(project_root):
    path = Path(project_root) / CHARACTER_CLASS_SOURCES_RELATIVE_PATH
    if not path.is_file():
        raise CharacterClassSourcesError(f'{CHARACTER_CLASS_SOURCES_RELATIVE_PATH} is missing; run scripts/actors/character_class_sources.py')
    payload = path.read_bytes()
    document = json.loads(payload)
    rows = document.get('rows') if isinstance(document, dict) else None
    if not (document.get('schemaVersion') == CHARACTER_CLASS_SOURCES_SCHEMA_VERSION and document.get('verdict') in (ADOPTED_VERDICT, NOT_DECIDED_VERDICT)
            and isinstance(rows, dict) and all(isinstance(entry, dict) and isinstance(entry.get('candidateCount'), int) for entry in rows.values())):
        raise CharacterClassSourcesError(f'{CHARACTER_CLASS_SOURCES_RELATIVE_PATH} is not a version {CHARACTER_CLASS_SOURCES_SCHEMA_VERSION} search result')
    return {'path': CHARACTER_CLASS_SOURCES_RELATIVE_PATH, 'sha256': hashlib.sha256(payload).hexdigest(), 'document': document}


def main(argv=None):
    parser = argparse.ArgumentParser(description='Search the decoded tables of the data-ui lane and the locked client script packages for the '
                                                 'chargrp row to actor class join and write the result with its verdict.')
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=REPOSITORY_ROOT / CHARACTER_CLASS_SOURCES_RELATIVE_PATH)
    arguments = parser.parse_args(argv)
    from native_catalog.tables import decode_table
    client_root = arguments.client.resolve(strict=True)
    document = character_class_sources_document(REPOSITORY_ROOT, client_root, decode_table(client_root, CHARGRP_TABLE_NAME),
                                                lane_work_root(REPOSITORY_ROOT, 'actors'))
    replace_file(arguments.output, canonical_json_bytes(document))
    print(json.dumps({'verdict': document['verdict'], 'rows': {row: entry['actorClass'] for row, entry in document['rows'].items()}}, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
