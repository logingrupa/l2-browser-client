import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json

from actors.path_free_messages import path_free_reason
from actors.pinned_answer_files import pinned_bytes, require_lock_equal, sha256_hex
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import replace_file
from native_store.data_ui_table_manifest import ELBERA_ADAPTER_ROUTE, data_ui_table_manifest
from reference_client_guard import ReferenceClientLockError, require_reference_client

REPOSITORY_ROOT = SCRIPTS_ROOT.parent
CHARACTER_HAIR_PARTS_RELATIVE_PATH = 'recipes/actors/character-hair-parts.json'
CHARACTER_HAIR_PARTS_KIND = 'character-hair-parts'
CHARACTER_HAIR_PARTS_SCHEMA_VERSION = 1
VERIFIED_PLAYER_HAIR_FACE_FILE_NAME = 'verified-player-hair-face.md'
VERIFIED_PLAYER_HAIR_FACE_SHA256 = '3ffd8acaa8026662d12d3a696cee1a7e5183de537b72ecbfc7d449a59bffe89e'
PLAYER_HAIR_FACE_ANSWER_FILE_NAME = 'player-hair-face.json'
PLAYER_HAIR_FACE_ANSWER_SHA256 = 'fcd0b944176c38535ac70632f70688bd1a49a47ea05ea718f7a07e6d5d0c3ed8'
PLAYER_HAIR_FACE_MANIFEST_RELATIVE_PATH = 'player-hair-face-rm11/manifest.json'
PLAYER_HAIR_FACE_MANIFEST_SHA256 = '535d4f6b7bb03fc1a6c578f55623dc52cba7e5b05a2ef54004aa66c74718aef3'
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
STYLE_COUNT = 15
NONE_STYLE = -1
NONE_STATUS, RESOLVED_STATUS, UNRESOLVED_STATUS = 'none', 'resolved', 'unresolved'
KEEP_CELL, HIDE_CELL, REPLACE_CELL = 'keep', 'hide', 'replace'
HELMETGRP_MAP_SITE, HAIRACCESSARYGRP_MAP_SITE = 'FL2GameData+0x182c', 'FL2GameData+0x1830'
HAIRACCESSARYGRP_LOADER, HAIRACCESSARYGRP_KEY_FIELD = '0x104675f0', 'HairAccessary_index'
EQUIPMENT_MAPPINGS_APPLIED_BY = 'equipment-03-30'
EXCLUDED_ROW_REASON = 'no chargrp mesh type {}'
MESH_CLASS_NAME = 'SkeletalMesh'
CONVERTER_WORK_FOLDER = 'converter'
CHARACTER_LANE_NAME = 'actors'
CHARACTER_HAIR_PARTS_LIMITATIONS = (
    'HairStyle 0, HairColor 0 and Face 0 are the default appearance; the client reads them from the user record (+0x240, +0x244, +0x248, '
    'RM-11), and a server packet selects another one in Phase 4.',
    'Requested names are group-less (MFighter.X) while the exports sit in groups (MFighter.Hair.X); they resolve through the converter rule '
    '(exact object, else one unique leaf name in the package) until RM-13 answers the StaticLoadObject rule and the mesh family selector.',
    'Hair halves attach rigidly with the head bone inverse bind matrix; the native client copies the head bone to part+0xdc, and that '
    'attachment math is not replayed.',
)
CHARACTER_HAIR_RECIPE_DESCRIPTION = (
    'Generate recipes/actors/character-hair-parts.json from the verified RM-11 player hair and face answer, the sealed data-ui manifests '
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


def mesh_type_family(row, literals, type_names):
    family = row['faceMesh'].split('.', 1)[0]
    require(family in literals and family not in type_names,
            f'mesh type {row["typeName"]} face package {family} is not an Engine.dll family literal of the answer')
    return {'family': family, 'familyAddress': engine_literal_address(literals, family), 'familySource': 'chargrp face_mesh[0] package'}


def style_mappings(hairgrp, mesh_type):
    return [{'style': style, 'front': front, 'back': back, 'frontIndex': mesh_type * STYLE_COUNT + style,
             'backIndex': (mesh_type + STYLE_COUNT) * STYLE_COUNT + style}
            for style, (front, back) in enumerate(hairgrp['records'][mesh_type])]


def hair_mesh_name(name_format, family, type_name, mapped_style):
    return name_format % (family, type_name, mapped_style)


def hair_material_name(name_format, type_name, mapped_style, hair_color):
    return name_format % (type_name, type_name, mapped_style, hair_color)


def resolved_half(half, slot, mapped_style, requested_mesh, requested_material, resolve_export):
    base = {'half': half, 'pawnSlot': slot, 'mappedStyle': mapped_style}
    if mapped_style == NONE_STYLE:
        return {**base, 'status': NONE_STATUS}
    requested = {'requestedMesh': requested_mesh, 'requestedMaterial': requested_material}
    try:
        mesh, material = resolve_export(requested_mesh, MESH_CLASS_NAME), resolve_export(requested_material, None)
    except ReferenceClientLockError:
        raise
    except (ValueError, OSError) as error:
        return {**base, **requested, 'status': UNRESOLVED_STATUS, 'reason': str(error)}
    return {**base, **requested, 'status': RESOLVED_STATUS, 'mesh': mesh, 'material': material}


def default_halves(row, family, mappings, formats, slots, resolve_export):
    mapping = mappings[DEFAULT_APPEARANCE['hairStyle']]
    halves = []
    for half, _ in HALF_SUFFIXES:
        mapped = mapping[half]
        halves.append(resolved_half(half, slots[half], mapped, hair_mesh_name(formats['mesh'][half]['format'], family, row['typeName'], mapped),
                                    hair_material_name(formats['material'][half]['format'], row['typeName'], mapped, DEFAULT_APPEARANCE['hairColor']),
                                    resolve_export))
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


def require_verified_mentions(verified_text, mentions):
    missing = [mention for mention in mentions if mention not in verified_text]
    require(not missing, f'{VERIFIED_PLAYER_HAIR_FACE_FILE_NAME} does not state {", ".join(missing)}')


def table_identity(manifest):
    require(manifest is not None, 'a hair table manifest is missing from the data-ui lane')
    require(manifest['sourceSha256'] == TABLE_SOURCE_SHA256_BY_NAME[manifest['table']], f'{manifest["table"]} is not decoded from its pinned source')
    return {'sourcePath': manifest['sourcePath'], 'sourceSha256': manifest['sourceSha256'], 'descriptorSha256': manifest['descriptorSha256'],
            'route': manifest['route'], 'recordCount': len(manifest['records'])}


def character_hair_parts_document(verified_payload, answer_payload, manifest_payload, tables, chargrp, lock, resolve_export):
    answer, verified_text = json.loads(answer_payload), verified_payload.decode('utf-8')
    require(answer['verification']['status'] == 'passed', 'the RM-11 answer verification did not pass')
    require(chargrp['sourceSha256'] == CHARGRP_SHA256, 'the decoded chargrp is not the pinned source')
    require_verified_mentions(verified_text, (HELMETGRP_MAP_SITE, HAIRACCESSARYGRP_MAP_SITE, HAIRACCESSARYGRP_LOADER, HAIRACCESSARYGRP_KEY_FIELD))
    hairgrp, helmetgrp, accessories = tables[HAIRGRP_TABLE_NAME], tables[HELMETGRP_TABLE_NAME], tables[HAIRACCESSARYGRP_TABLE_NAME]
    source_tables = {name: table_identity(manifest) for name, manifest in sorted(tables.items())}
    require_hairgrp_equals_answer(hairgrp, answer)
    require_helmetgrp_equals_answer(helmetgrp, answer)
    literals, classes = engine_literals(answer), {entry['meshType']: entry['class'] for entry in answer['inputs']['meshTypeClasses']}
    rows, formats, slots = chargrp_rows_by_mesh_type(chargrp, answer), name_formats(answer, literals), pawn_slots(answer)
    require(sorted(rows) == sorted(classes) == list(range(len(classes))) and all(rows[t]['typeName'] == classes[t] for t in classes),
            'the RM-11 mesh type classes differ from its chargrp rows')
    mesh_types = []
    for mesh_type in sorted(rows):
        row = rows[mesh_type]
        family = mesh_type_family(row, literals, set(classes.values()))
        mappings = style_mappings(hairgrp, mesh_type)
        mesh_types.append({'meshType': mesh_type, 'chargrpRow': row['chargrpRow'], 'typeName': row['typeName'],
                           'typeNameAddress': engine_literal_address(literals, row['typeName']), **family, 'mappings': mappings,
                           'defaultHalves': default_halves(row, family['family'], mappings, formats, slots, resolve_export)})
    require_fixture_halves(answer, mesh_types)
    require_assets_agree(answer, mesh_types)
    return {'schemaVersion': CHARACTER_HAIR_PARTS_SCHEMA_VERSION, 'kind': CHARACTER_HAIR_PARTS_KIND,
            'source': {'verification': {'file': VERIFIED_PLAYER_HAIR_FACE_FILE_NAME, 'sha256': sha256_hex(verified_payload)},
                       'answer': {'file': PLAYER_HAIR_FACE_ANSWER_FILE_NAME, 'sha256': sha256_hex(answer_payload)},
                       'answerManifest': {'path': PLAYER_HAIR_FACE_MANIFEST_RELATIVE_PATH, 'sha256': sha256_hex(manifest_payload),
                                          'files': len(json.loads(manifest_payload)['files'])},
                       'engine': require_lock_equal(lock, ENGINE_RELATIVE_PATH, ENGINE_SHA256, CHARACTER_HAIR_PARTS_RELATIVE_PATH),
                       'chargrp': require_lock_equal(lock, CHARGRP_RELATIVE_PATH, CHARGRP_SHA256, CHARACTER_HAIR_PARTS_RELATIVE_PATH),
                       'tables': source_tables},
            'defaultAppearance': {**DEFAULT_APPEARANCE, 'userRecordOffsets': user_record_offsets(answer),
                                  'limitation': CHARACTER_HAIR_PARTS_LIMITATIONS[0]},
            'formats': {**formats, 'pawnSlots': slots},
            'meshTypes': mesh_types,
            'equipmentHairMappings': {
                'appliedBy': EQUIPMENT_MAPPINGS_APPLIED_BY,
                'cellRule': 'keep when the mapped style equals the style, hide at -1, replace with any other mapped style',
                HELMETGRP_TABLE_NAME: equipment_table_mappings(helmetgrp, len(mesh_types), (KEEP_CELL, HIDE_CELL), HELMETGRP_MAP_SITE, EXCLUDED_ROW_REASON),
                HAIRACCESSARYGRP_TABLE_NAME: {**equipment_table_mappings(accessories, len(mesh_types), (KEEP_CELL, HIDE_CELL, REPLACE_CELL),
                                                                         HAIRACCESSARYGRP_MAP_SITE, EXCLUDED_ROW_REASON),
                                              'loader': HAIRACCESSARYGRP_LOADER, 'keyField': HAIRACCESSARYGRP_KEY_FIELD}},
            'limitations': list(CHARACTER_HAIR_PARTS_LIMITATIONS)}


def character_hair_table_manifests(project_root):
    return {name: data_ui_table_manifest(project_root, name, ELBERA_ADAPTER_ROUTE) for name in TABLE_SOURCE_SHA256_BY_NAME}


def character_lane_converter(project_root, client_root):
    from native_assets import UMODEL, Converter
    from native_store.store_paths import lane_store_root
    return Converter(client_root, lane_store_root(project_root, CHARACTER_LANE_NAME).parent / CONVERTER_WORK_FOLDER, UMODEL)


def converter_export_resolver(converter, client_root):
    def resolve_export(requested, class_name):
        package_name, object_name = requested.split('.', 1)
        try:
            _, package = converter.package(package_name)
            export = converter.select(package, object_name, class_name)
        except ReferenceClientLockError:
            raise
        except (ValueError, OSError) as error:
            raise CharacterHairRecipeError(path_free_reason(str(error), client_root, converter.output)) from error
        return {'object': export['object'], 'exportIndex': export['exportIndex'], 'class': export['classObject']}
    return resolve_export


def character_hair_parts_payload(project_root, verification_folder, answer_folder, client_access):
    from native_catalog.tables import decode_table
    verification, answers = Path(verification_folder), Path(answer_folder)
    converter = character_lane_converter(project_root, client_access.root)
    return canonical_json_bytes(character_hair_parts_document(
        pinned_bytes(verification / VERIFIED_PLAYER_HAIR_FACE_FILE_NAME, VERIFIED_PLAYER_HAIR_FACE_SHA256, 'verified facts'),
        pinned_bytes(answers / PLAYER_HAIR_FACE_ANSWER_FILE_NAME, PLAYER_HAIR_FACE_ANSWER_SHA256, 'answer'),
        pinned_bytes(answers / PLAYER_HAIR_FACE_MANIFEST_RELATIVE_PATH, PLAYER_HAIR_FACE_MANIFEST_SHA256, 'answer manifest'),
        character_hair_table_manifests(project_root), decode_table(client_access.root, 'chargrp'), client_access.lock,
        converter_export_resolver(converter, client_access.root)))


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
            'is not a character-hair-parts v1 recipe')
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
                      'halves': {status: sum(half['status'] == status for half in halves) for status in (NONE_STATUS, RESOLVED_STATUS, UNRESOLVED_STATUS)}},
                     sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
