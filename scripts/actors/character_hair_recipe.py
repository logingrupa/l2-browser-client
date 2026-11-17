import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json
from collections import namedtuple

from actors.character_hair_answer_checks import package_families, require_linker_query_fixtures, require_mapping_fixtures, require_mode_fixtures
from actors.hair_export_lookup import cached_class_chain_reader, unique_export_of_class
from actors.path_free_messages import path_free_reason
from actors.pinned_answer_files import pinned_bytes, require_lock_equal, sha256_hex
from native_store.canonical_json import canonical_json_bytes
from native_store.verified_file_writes import replace_file
from native_store.data_ui_table_manifest import ELBERA_ADAPTER_ROUTE, data_ui_table_manifest
from reference_client_guard import ReferenceClientLockError, require_reference_client

REPOSITORY_ROOT = SCRIPTS_ROOT.parent
CHARACTER_HAIR_PARTS_RELATIVE_PATH = 'recipes/actors/character-hair-parts.json'
CHARACTER_HAIR_PARTS_KIND = 'character-hair-parts'
CHARACTER_HAIR_PARTS_SCHEMA_VERSION = 2
PinnedAnswerSource = namedtuple('PinnedAnswerSource', 'name verified_file verified_sha256 answer_file answer_sha256 manifest_path manifest_sha256 mentions')
PinnedAnswerPayloads = namedtuple('PinnedAnswerPayloads', 'verified answer manifest')
HairExports = namedtuple('HairExports', 'resolve_export read_mesh_mode')
PLAYER_HAIR_FACE_SOURCE = PinnedAnswerSource(
    'RM-11', 'verified-player-hair-face.md', '3ffd8acaa8026662d12d3a696cee1a7e5183de537b72ecbfc7d449a59bffe89e',
    'player-hair-face.json', 'fcd0b944176c38535ac70632f70688bd1a49a47ea05ea718f7a07e6d5d0c3ed8',
    'player-hair-face-rm11/manifest.json', '535d4f6b7bb03fc1a6c578f55623dc52cba7e5b05a2ef54004aa66c74718aef3',
    ('FL2GameData+0x182c', 'FL2GameData+0x1830', '0x104675f0', 'HairAccessary_index'))
HAIR_NAME_RESOLUTION_SOURCE = PinnedAnswerSource(
    'RM-13', 'verified-hair-name-resolution.md', 'b437af038c29d1c9458f47494c7eeb4e5aa2ad141551fbfd401c0c04bb565032',
    'hair-name-resolution.json', '36216cb7a709de71daf2de13cec7e1fecf40e610b9a66210f16ee6c24891c176',
    'hair-resolution-rm13/manifest.json', '4ab202b2830a200806d52b8c9e49fbecd14cace037eeb4a08838444081d6a7e3',
    ('EBP-0x690', '0x106def1a'))
RIGID_HAIR_AND_PHYSICS_SOURCE = PinnedAnswerSource(
    'RM-14', 'verified-rigid-hair-and-physics.md', '0e17c737addcb0b6aa1319406fb6803127f025c78550c73e358109feeb08ea5c',
    'rigid-hair-and-physics.json', '2ad59fbb1a383f6a8ed251c1cabc0a81e0520c0ba14478d9f71e1d6b4022abf7',
    'rigid-hair-rm14/manifest.json', '81b46c37bba4b90baba9589b92ccdb5c9ffa093c23a36fd76021d80315b1ad45',
    ('MatchRefBone', 'alias table'))
PINNED_ANSWER_SOURCES = (PLAYER_HAIR_FACE_SOURCE, HAIR_NAME_RESOLUTION_SOURCE, RIGID_HAIR_AND_PHYSICS_SOURCE)
ENGINE_RELATIVE_PATH, ENGINE_SHA256 = 'system/engine.dll', '4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08'
CHARGRP_RELATIVE_PATH, CHARGRP_SHA256 = 'system/chargrp.dat', '2bb52de25ef3558f51e458c0095efcd9c509dfd5b5695a269f268b5f235fbc0f'
HAIRGRP_TABLE_NAME, HELMETGRP_TABLE_NAME, HAIRACCESSARYGRP_TABLE_NAME = 'hairgrp', 'helmetgrp', 'hairaccessarygrp'
TABLE_SOURCE_SHA256_BY_NAME = {HAIRGRP_TABLE_NAME: '03df44930cd3752e0f67c99ad2f402028a4406d53a5e30978adc92b589c8fa59',
                               HELMETGRP_TABLE_NAME: 'ace5b171bf7bd6203de614257a4a523fe07e6fb14abc19af351f7b51c1809237',
                               HAIRACCESSARYGRP_TABLE_NAME: '85964918a193c6aa39829f22e1a14c6a27b9076c5cd04a2996fa041f52e500a3'}
CHARGRP_ROW_COLLECTION, FACE_MESH_GROUP, FACE_MESH_FIELD = 'Char', 'face_mesh', 'param_face_mesh'
DEFAULT_APPEARANCE = {'hairStyle': 0, 'hairColor': 0, 'face': 0}
USER_RECORD_FIELD_BY_APPEARANCE = {'hairStyle': 'HairStyle', 'hairColor': 'HairColor', 'face': 'Face'}
HALF_SUFFIXES = (('back', '_bh'), ('front', '_ah'))
ORDINARY_ROUTE, DYNAMIC_ROUTE = 'ordinary', 'dynamic'
ORDINARY_MESH_MODE = 4
HALF_ROUTE_RULE = {'dispatch': '0x106def1a', 'ordinary': 'mesh mode below 1 or equal to 4', 'dynamic': 'any other mesh mode',
                   'source': HAIR_NAME_RESOLUTION_SOURCE.name}
RIGID_HEAD_BONE_RULE = {'bone': 'root Mesh MatchRefBone(HeadBone): the mesh alias table first, then a case-insensitive name search',
                        'inverseBind': 'the root mesh inverse reference at that index', 'unresolved': 'index -1 or at or above the root bone count',
                        'source': RIGID_HAIR_AND_PHYSICS_SOURCE.name}
STYLE_COUNT = 15
NONE_STYLE = -1
NONE_STATUS, RESOLVED_STATUS, UNRESOLVED_STATUS = 'none', 'resolved', 'unresolved'
KEEP_CELL, HIDE_CELL, REPLACE_CELL = 'keep', 'hide', 'replace'
HELMETGRP_MAP_SITE, HAIRACCESSARYGRP_MAP_SITE = 'FL2GameData+0x182c', 'FL2GameData+0x1830'
HAIRACCESSARYGRP_LOADER, HAIRACCESSARYGRP_KEY_FIELD = '0x104675f0', 'HairAccessary_index'
FIXTURE_TABLE_NAMES = {'helmet': HELMETGRP_TABLE_NAME, 'hairaccessary': HAIRACCESSARYGRP_TABLE_NAME}
EQUIPMENT_MAPPINGS_APPLIED_BY = 'equipment-03-30'
EXCLUDED_ROW_REASON = 'no chargrp mesh type {}'
MESH_CLASS_NAME, MATERIAL_CLASS_NAME = 'SkeletalMesh', 'Material'
CONVERTER_WORK_FOLDER = 'converter'
CHARACTER_LANE_NAME = 'actors'
CHARACTER_HAIR_PARTS_LIMITATIONS = (
    'HairStyle 0, HairColor 0 and Face 0 are the default appearance; the client reads them from the user record (+0x240, +0x244, +0x248, '
    'RM-11), and a server packet selects another one in Phase 4.',
    'Group-less names resolve by leaf and class chain with no group constraint (RM-13). The native lookup returns the first compatible '
    'match in live hash order; a leaf with more than one compatible export is refused because that order is not reproduced.',
    'Dynamic hair halves (RM-14 NCBoneSimul modes 2 and 7) are not simulated; they stay a named gap and nothing static is drawn for them.',
)
CHARACTER_HAIR_RECIPE_DESCRIPTION = (
    'Generate recipes/actors/character-hair-parts.json from the verified RM-11, RM-13 and RM-14 answers, the sealed data-ui manifests '
    'of hairgrp, helmetgrp and hairaccessarygrp, and the lock-equal Engine.dll and chargrp. --check compares and writes nothing.')


class CharacterHairRecipeError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise CharacterHairRecipeError(f'{CHARACTER_HAIR_PARTS_RELATIVE_PATH}: {message}')


def engine_literals(answer):
    literals = {}
    for entry in answer['nativeNameLiterals']:
        if entry['fileSha256'] == ENGINE_SHA256:
            literals.setdefault(entry['decodedValues']['utf16'], []).append(entry['va'])
    return literals


def engine_literal_address(literals, text):
    addresses = literals.get(text, [])
    require(len(addresses) == 1, f'the answer names {len(addresses)} Engine.dll literals {text}')
    return addresses[0]


def user_record_offsets(answer):
    offsets = {entry['name']: entry['offset'] for entry in answer['inputs']['offsets']}
    return {appearance: offsets[field] for appearance, field in USER_RECORD_FIELD_BY_APPEARANCE.items()}


def pawn_slots(answer):
    slots = {part.get('meshSuffix'): part['index'] for part in answer['selectionAndDrawing']['parts']}
    return {half: slots[suffix] for half, suffix in HALF_SUFFIXES}


def name_formats(answer, literals):
    drawing = answer['selectionAndDrawing']
    formats = {}
    for kind, source in (('mesh', drawing['meshFormat']), ('material', drawing['textureFormat'])):
        halves = {half: {'format': source[half], 'address': engine_literal_address(literals, source[half])} for half, _ in HALF_SUFFIXES}
        require(all(source[half].endswith(suffix) for half, suffix in HALF_SUFFIXES), f'the {kind} formats do not end with the half suffixes')
        formats[kind] = {**halves, 'arguments': source['arguments']}
    return formats


def answer_hair_rows(answer):
    rows = {row['meshType'] if row['meshType'] is not None else position: row
            for position, row in enumerate(answer['hairMappings']['rows'])}
    return [[(value['first'], value['second']) for value in rows[position]['values']] for position in range(len(rows))]


def require_hairgrp_equals_answer(hairgrp, answer):
    decoded = [[tuple(pair) for pair in row] for row in hairgrp['records']]
    require(decoded == answer_hair_rows(answer), 'the hairgrp manifest differs from the RM-11 hairgrp rows')


def require_helmetgrp_equals_answer(helmetgrp, answer):
    answered = [(row['key'], {(pair['meshType'], pair['style']): (pair['front'], pair['back']) for pair in row['pairs']})
                for row in answer['helmetMappings']['rows']]
    decoded = [(record['key'], {(mesh_type, style): tuple(pair) for mesh_type, pairs in enumerate(record['pairs']) for style, pair in enumerate(pairs)})
               for record in helmetgrp['records']]
    require(decoded == answered, 'the helmetgrp manifest differs from the RM-11 helmetgrp rows')


def chargrp_rows_by_mesh_type(chargrp, answer):
    decoded_rows = chargrp['data'][CHARGRP_ROW_COLLECTION]
    rows = {}
    for answered in answer['chargrpRows']:
        if answered['meshType'] is None:
            continue
        decoded = decoded_rows[answered['rowIndex']]
        faces = [entry[FACE_MESH_FIELD] for entry in decoded[FACE_MESH_GROUP]]
        require(faces == answered['values'][FACE_MESH_GROUP], f'chargrp row {answered["rowIndex"]} face_mesh differs from the RM-11 row')
        rows[answered['meshType']] = {'chargrpRow': answered['rowIndex'], 'typeName': answered['meshTypeName'], 'faceMesh': faces[0]}
    return rows


def mesh_type_family(families, mesh_type, type_name):
    family = families.get(mesh_type)
    require(family is not None and family['meshTypeName'] == type_name, f'mesh type {mesh_type} {type_name} has no RM-13 package family')
    return {field: family[field] for field in ('family', 'familyAddress', 'familySource')}


def half_route(mesh_mode):
    return ORDINARY_ROUTE if mesh_mode < 1 or mesh_mode == ORDINARY_MESH_MODE else DYNAMIC_ROUTE


def style_mappings(hairgrp, mesh_type):
    return [{'style': style, 'front': front, 'back': back, 'frontIndex': mesh_type * STYLE_COUNT + style,
             'backIndex': (mesh_type + STYLE_COUNT) * STYLE_COUNT + style}
            for style, (front, back) in enumerate(hairgrp['records'][mesh_type])]


def hair_mesh_name(name_format, family, type_name, mapped_style):
    return name_format % (family, type_name, mapped_style)


def hair_material_name(name_format, type_name, mapped_style, hair_color):
    return name_format % (type_name, type_name, mapped_style, hair_color)


def resolved_half(half, slot, mapped_style, requested_mesh, requested_material, hair_exports):
    base = {'half': half, 'pawnSlot': slot, 'mappedStyle': mapped_style}
    if mapped_style == NONE_STYLE:
        return {**base, 'status': NONE_STATUS}
    requested = {'requestedMesh': requested_mesh, 'requestedMaterial': requested_material}
    try:
        mesh = hair_exports.resolve_export(requested_mesh, MESH_CLASS_NAME)
        material = hair_exports.resolve_export(requested_material, MATERIAL_CLASS_NAME)
        mesh_mode = hair_exports.read_mesh_mode(mesh)
    except ReferenceClientLockError:
        raise
    except (ValueError, OSError) as error:
        return {**base, **requested, 'status': UNRESOLVED_STATUS, 'reason': str(error)}
    return {**base, **requested, 'status': RESOLVED_STATUS, 'mesh': mesh, 'material': material, 'meshMode': mesh_mode,
            'route': half_route(mesh_mode)}


def default_halves(row, family, mappings, formats, slots, hair_exports):
    mapping = mappings[DEFAULT_APPEARANCE['hairStyle']]
    halves = []
    for half, _ in HALF_SUFFIXES:
        mapped = mapping[half]
        halves.append(resolved_half(half, slots[half], mapped, hair_mesh_name(formats['mesh'][half]['format'], family, row['typeName'], mapped),
                                    hair_material_name(formats['material'][half]['format'], row['typeName'], mapped, DEFAULT_APPEARANCE['hairColor']),
                                    hair_exports))
    return halves


def require_fixture_halves(answer, mesh_types):
    for fixture in answer['fixtures']:
        require({key: fixture[USER_RECORD_FIELD_BY_APPEARANCE[key]] for key in DEFAULT_APPEARANCE} == DEFAULT_APPEARANCE,
                'the RM-11 fixture is not the default appearance')
        halves = {half['pawnSlot']: half for half in mesh_types[fixture['meshType']]['defaultHalves']}
        for part in fixture['parts']:
            half = halves.get(part['partIndex'])
            if half is None:
                continue
            require(half['status'] == RESOLVED_STATUS and half['requestedMesh'] == part['meshNameRequested']
                    and half['requestedMaterial'] == part['materialNameRequested'] and half['mesh']['exportIndex'] == part['meshExportIndex']
                    and half['material']['exportIndex'] == part['materialExportIndex'] and half['material']['object'] == part['materialExportPath']
                    and half['material']['class'] == part['materialClass'], f'pawn slot {part["partIndex"]} differs from the RM-11 fixture')


def require_assets_agree(answer, mesh_types):
    assets = {asset['object']: asset for asset in answer['assets']}
    for mesh_type in mesh_types:
        for half in mesh_type['defaultHalves']:
            for export in (half.get('mesh'), half.get('material')):
                asset = assets.get(export['object']) if export else None
                require(asset is None or (asset['exportIndex'], asset['class']) == (export['exportIndex'], export['class']),
                        f'{export and export["object"]} differs from the RM-11 asset row')


def mapping_cell(style, mapped):
    if mapped == style:
        return KEEP_CELL
    return HIDE_CELL if mapped == NONE_STYLE else REPLACE_CELL


def equipment_table_mappings(manifest, mesh_type_count, allowed_cells, site, excluded_reason):
    keys = []
    for record in manifest['records']:
        counts = {KEEP_CELL: 0, HIDE_CELL: 0, REPLACE_CELL: 0}
        mesh_types = []
        for mesh_type, pairs in enumerate(record['pairs'][:mesh_type_count]):
            cells = []
            for style, (front, back) in enumerate(pairs):
                cell = {'style': style, 'front': mapping_cell(style, front), 'frontStyle': front, 'back': mapping_cell(style, back), 'backStyle': back}
                counts[cell['front']] += 1
                counts[cell['back']] += 1
                cells.append(cell)
            mesh_types.append({'meshType': mesh_type, 'cells': cells})
        require(not set(cell for cell, count in counts.items() if count) - set(allowed_cells),
                f'{manifest["table"]} key {record["key"]} holds a cell outside {", ".join(allowed_cells)}')
        keys.append({'key': record['key'], 'counts': counts, 'meshTypes': mesh_types})
    excluded = [{'row': row, 'reason': excluded_reason.format(row)} for row in range(mesh_type_count, len(manifest['records'][0]['pairs']))]
    return {'table': manifest['table'], 'sourceSha256': manifest['sourceSha256'], 'map': site, 'allowedCells': list(allowed_cells),
            'keys': keys, 'excludedRows': excluded}


def table_identity(manifest):
    require(manifest is not None, 'a hair table manifest is missing from the data-ui lane')
    require(manifest['sourceSha256'] == TABLE_SOURCE_SHA256_BY_NAME[manifest['table']], f'{manifest["table"]} is not decoded from its pinned source')
    return {'sourcePath': manifest['sourcePath'], 'sourceSha256': manifest['sourceSha256'], 'descriptorSha256': manifest['descriptorSha256'],
            'route': manifest['route'], 'recordCount': len(manifest['records'])}


def verified_answers(answer_payloads):
    answers = {}
    for source in PINNED_ANSWER_SOURCES:
        payloads = answer_payloads[source.name]
        answer = json.loads(payloads.answer)
        require(answer['verification']['status'] == 'passed', f'the {source.name} answer verification did not pass')
        missing = [mention for mention in source.mentions if mention not in payloads.verified.decode('utf-8')]
        require(not missing, f'{source.verified_file} does not state {", ".join(missing)}')
        answers[source.name] = answer
    return answers


def answer_source_record(source, payloads):
    return {'verification': {'file': source.verified_file, 'sha256': sha256_hex(payloads.verified)},
            'answer': {'file': source.answer_file, 'sha256': sha256_hex(payloads.answer)},
            'answerManifest': {'path': source.manifest_path, 'sha256': sha256_hex(payloads.manifest),
                               'files': len(json.loads(payloads.manifest)['files'])}}


def equipment_hair_mappings(helmetgrp, accessories, mesh_type_count):
    return {HELMETGRP_TABLE_NAME: equipment_table_mappings(helmetgrp, mesh_type_count, (KEEP_CELL, HIDE_CELL), HELMETGRP_MAP_SITE, EXCLUDED_ROW_REASON),
            HAIRACCESSARYGRP_TABLE_NAME: {**equipment_table_mappings(accessories, mesh_type_count, (KEEP_CELL, HIDE_CELL, REPLACE_CELL),
                                                                     HAIRACCESSARYGRP_MAP_SITE, EXCLUDED_ROW_REASON),
                                          'loader': HAIRACCESSARYGRP_LOADER, 'keyField': HAIRACCESSARYGRP_KEY_FIELD}}


def character_hair_parts_document(answer_payloads, tables, chargrp, lock, hair_exports):
    answers = verified_answers(answer_payloads)
    answer, name_resolution = answers[PLAYER_HAIR_FACE_SOURCE.name], answers[HAIR_NAME_RESOLUTION_SOURCE.name]
    require(chargrp['sourceSha256'] == CHARGRP_SHA256, 'the decoded chargrp is not the pinned source')
    hairgrp, helmetgrp, accessories = tables[HAIRGRP_TABLE_NAME], tables[HELMETGRP_TABLE_NAME], tables[HAIRACCESSARYGRP_TABLE_NAME]
    source_tables = {name: table_identity(manifest) for name, manifest in sorted(tables.items())}
    require_hairgrp_equals_answer(hairgrp, answer)
    require_helmetgrp_equals_answer(helmetgrp, answer)
    literals, classes = engine_literals(answer), {entry['meshType']: entry['class'] for entry in answer['inputs']['meshTypeClasses']}
    rows, formats, slots = chargrp_rows_by_mesh_type(chargrp, answer), name_formats(answer, literals), pawn_slots(answer)
    require(sorted(rows) == sorted(classes) == list(range(len(classes))) and all(rows[t]['typeName'] == classes[t] for t in classes),
            'the RM-11 mesh type classes differ from its chargrp rows')
    families = package_families(name_resolution, HAIR_NAME_RESOLUTION_SOURCE.name)
    mesh_types = []
    for mesh_type in sorted(rows):
        row = rows[mesh_type]
        family = mesh_type_family(families, mesh_type, row['typeName'])
        mappings = style_mappings(hairgrp, mesh_type)
        mesh_types.append({'meshType': mesh_type, 'chargrpRow': row['chargrpRow'], 'typeName': row['typeName'],
                           'typeNameAddress': engine_literal_address(literals, row['typeName']), **family, 'mappings': mappings,
                           'defaultHalves': default_halves(row, family['family'], mappings, formats, slots, hair_exports)})
    require_fixture_halves(answer, mesh_types)
    require_assets_agree(answer, mesh_types)
    equipment_mappings = equipment_hair_mappings(helmetgrp, accessories, len(mesh_types))
    require_mapping_fixtures(name_resolution, mesh_types, {table: equipment_mappings[name] for table, name in FIXTURE_TABLE_NAMES.items()},
                             lambda half, mesh_type, mapped: hair_mesh_name(formats['mesh'][half]['format'], mesh_type['family'],
                                                                            mesh_type['typeName'], mapped))
    require_linker_query_fixtures(name_resolution, hair_exports.resolve_export)
    require_mode_fixtures(answers[RIGID_HAIR_AND_PHYSICS_SOURCE.name], mesh_types)
    return {'schemaVersion': CHARACTER_HAIR_PARTS_SCHEMA_VERSION, 'kind': CHARACTER_HAIR_PARTS_KIND,
            'source': {'answers': {source.name: answer_source_record(source, answer_payloads[source.name]) for source in PINNED_ANSWER_SOURCES},
                       'engine': require_lock_equal(lock, ENGINE_RELATIVE_PATH, ENGINE_SHA256, CHARACTER_HAIR_PARTS_RELATIVE_PATH),
                       'chargrp': require_lock_equal(lock, CHARGRP_RELATIVE_PATH, CHARGRP_SHA256, CHARACTER_HAIR_PARTS_RELATIVE_PATH),
                       'tables': source_tables},
            'defaultAppearance': {**DEFAULT_APPEARANCE, 'userRecordOffsets': user_record_offsets(answer),
                                  'limitation': CHARACTER_HAIR_PARTS_LIMITATIONS[0]},
            'formats': {**formats, 'pawnSlots': slots},
            'halfRouteRule': HALF_ROUTE_RULE,
            'rigidHeadBoneRule': RIGID_HEAD_BONE_RULE,
            'meshTypes': mesh_types,
            'equipmentHairMappings': {
                'appliedBy': EQUIPMENT_MAPPINGS_APPLIED_BY,
                'cellRule': 'keep when the mapped style equals the style, hide at -1, replace with any other mapped style',
                **equipment_mappings},
            'limitations': list(CHARACTER_HAIR_PARTS_LIMITATIONS)}


def character_hair_table_manifests(project_root):
    return {name: data_ui_table_manifest(project_root, name, ELBERA_ADAPTER_ROUTE) for name in TABLE_SOURCE_SHA256_BY_NAME}


def character_lane_converter(project_root, client_root):
    from native_assets import UMODEL, Converter
    from native_store.store_paths import lane_store_root
    return Converter(client_root, lane_store_root(project_root, CHARACTER_LANE_NAME).parent / CONVERTER_WORK_FOLDER, UMODEL)


def converter_hair_exports(converter, client_root):
    from native_catalog.skeletal import decode_skeletal_source

    def read_package(package_name):
        return converter.package(package_name)[1]
    class_names_of = cached_class_chain_reader(read_package)

    def path_free(read):
        try:
            return read()
        except ReferenceClientLockError:
            raise
        except (ValueError, OSError) as error:
            raise CharacterHairRecipeError(path_free_reason(str(error), client_root, converter.output)) from error

    def resolve_export(requested, class_name):
        def resolved():
            export = unique_export_of_class(read_package(requested.split('.', 1)[0]), requested, class_name, class_names_of)
            return {'object': export['object'], 'exportIndex': export['exportIndex'], 'class': export['classObject']}
        return path_free(resolved)

    def read_mesh_mode(mesh):
        def decoded_mode():
            package = read_package(mesh['object'].split('.', 1)[0])
            items = [item for item in package.exports if item['exportIndex'] == mesh['exportIndex']]
            require(len(items) == 1, f'{mesh["object"]} export {mesh["exportIndex"]} is missing')
            return decode_skeletal_source(package, items[0])['meshMode']
        return path_free(decoded_mode)
    return HairExports(resolve_export, read_mesh_mode)


def pinned_answer_payloads(verification_folder, answer_folder):
    verification, answers = Path(verification_folder), Path(answer_folder)
    return {source.name: PinnedAnswerPayloads(
        pinned_bytes(verification / source.verified_file, source.verified_sha256, f'{source.name} verified facts'),
        pinned_bytes(answers / source.answer_file, source.answer_sha256, f'{source.name} answer'),
        pinned_bytes(answers / source.manifest_path, source.manifest_sha256, f'{source.name} answer manifest'))
        for source in PINNED_ANSWER_SOURCES}


def character_hair_parts_payload(project_root, verification_folder, answer_folder, client_access):
    from native_catalog.tables import decode_table
    converter = character_lane_converter(project_root, client_access.root)
    return canonical_json_bytes(character_hair_parts_document(
        pinned_answer_payloads(verification_folder, answer_folder), character_hair_table_manifests(project_root),
        decode_table(client_access.root, 'chargrp'), client_access.lock, converter_hair_exports(converter, client_access.root)))


def write_character_hair_parts(project_root, payload, check):
    recipe_path = Path(project_root) / CHARACTER_HAIR_PARTS_RELATIVE_PATH
    if check:
        require(recipe_path.is_file() and recipe_path.read_bytes() == payload, 'differs from its generated bytes; rerun without --check')
        return payload
    replace_file(recipe_path, payload)
    return payload


def read_character_hair_parts(project_root):
    path = Path(project_root) / CHARACTER_HAIR_PARTS_RELATIVE_PATH
    require(path.is_file(), 'is missing; run scripts/actors/character_hair_recipe.py')
    payload = path.read_bytes()
    document = json.loads(payload)
    require(document.get('schemaVersion') == CHARACTER_HAIR_PARTS_SCHEMA_VERSION and document.get('kind') == CHARACTER_HAIR_PARTS_KIND,
            f'is not a character-hair-parts v{CHARACTER_HAIR_PARTS_SCHEMA_VERSION} recipe')
    return {'path': CHARACTER_HAIR_PARTS_RELATIVE_PATH, 'sha256': sha256_hex(payload), 'defaultAppearance': document['defaultAppearance'],
            'byChargrpRow': {mesh_type['chargrpRow']: mesh_type for mesh_type in document['meshTypes']}, 'limitations': document['limitations']}


def main(argv=None):
    parser = argparse.ArgumentParser(description=CHARACTER_HAIR_RECIPE_DESCRIPTION)
    parser.add_argument('--verification-folder', type=Path, required=True)
    parser.add_argument('--answer-folder', type=Path, required=True)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    arguments = parser.parse_args(argv)
    try:
        payload = character_hair_parts_payload(REPOSITORY_ROOT, arguments.verification_folder, arguments.answer_folder,
                                               require_reference_client(arguments.client))
        write_character_hair_parts(REPOSITORY_ROOT, payload, arguments.check)
    except (OSError, ValueError, KeyError) as error:
        print(f'Character hair recipe failed: {error}', file=sys.stderr)
        return 1
    document = json.loads(payload)
    halves = [half for mesh_type in document['meshTypes'] for half in mesh_type['defaultHalves']]
    print(json.dumps({'bytes': len(payload), 'sha256': sha256_hex(payload), 'meshTypes': len(document['meshTypes']),
                      'halves': {status: sum(half['status'] == status for half in halves) for status in (NONE_STATUS, RESOLVED_STATUS, UNRESOLVED_STATUS)},
                      'routes': {route: sum(half.get('route') == route for half in halves) for route in (ORDINARY_ROUTE, DYNAMIC_ROUTE)}},
                     sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
