from __future__ import annotations

import json
import struct

from hash_reference_client_tree import canonical_json_bytes
from lane_unit_outcomes import lane_relative_path
from native_store.catalog_writer import add_store_file, add_store_file_entry, read_store_catalog, validate_catalog_record, write_store
from native_store.verified_file_writes import sha256_hex
from reference_client_guard import ReferenceClientLockError
from native_store.catalog_record_replacement import catalog_with_records_replaced
from ui_texture_step import TRANSIENT_TEXTURE_CONVERSION_FAILURES, FAILED_STATUS, convert_reference

UI_FONT_ALGORITHM_VERSION = 2
UI_FONT_RECIPE_SCHEMA_VERSION = 1
FONTS_STEP = 'fonts'
FONTS_CATALOG_SLICE = 'fonts'
UI_FONT_ID_PREFIX = 'ui-font:'
UI_FONT_MANIFEST_KIND = 'native-ui-font'
UI_FONT_MANIFEST_FILE_NAME = 'font.json'
FONT_OUTCOME_RECORD_NAME = 'font-outcome.json'
BITMAP_GLYPH_TABLE_ROUTE = 'bitmap-glyph-table'
DIGIT_ATLAS_ROUTE = 'digit-atlas'
SYSTEM_FACE_ROUTE = 'system-face'
CONVERTED_ROUTES = (BITMAP_GLYPH_TABLE_ROUTE, DIGIT_ATLAS_ROUTE)
FONT_ROUTES = (*CONVERTED_ROUTES, SYSTEM_FACE_ROUTE)
GLYPH_TABLE_HEADER = struct.Struct('<3i')
GLYPH_SEGMENT_HEADER = struct.Struct('<2i')
GLYPH_RECORD = struct.Struct('<4i')
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
PNG_HEADER_CHUNK = b'IHDR'
PNG_DIMENSIONS = struct.Struct('>II')
GLYPH_TABLE_UNREADABLE_REASON = 'font-glyph-table-unreadable'


class UiFontStepError(ValueError):
    pass


def require_positive_integer(value, label):
    if not (type(value) is int and value > 0):
        raise UiFontStepError(f'{label} must be a positive integer: {value!r}')
    return value


def validate_font_recipe_entry(entry):
    label = f'ui font recipe entry {entry.get("fontType")!r}' if isinstance(entry, dict) else 'ui font recipe entry'
    if not (isinstance(entry, dict) and type(entry.get('fontType')) is int and entry['fontType'] >= 0 and entry.get('route') in FONT_ROUTES
            and isinstance(entry.get('authoringName'), str) and isinstance(entry.get('selection'), str)):
        raise UiFontStepError(f'{label} needs a fontType, an authoringName, a selection and a route of {", ".join(FONT_ROUTES)}')
    if entry['route'] == SYSTEM_FACE_ROUTE:
        return entry
    texture = entry.get('texture')
    if not (isinstance(texture, dict) and isinstance(texture.get('package'), str) and isinstance(texture.get('object'), str)):
        raise UiFontStepError(f'{label} needs a texture package and object')
    require_positive_integer(texture.get('width'), f'{label} texture width')
    require_positive_integer(texture.get('height'), f'{label} texture height')
    if entry['route'] == BITMAP_GLYPH_TABLE_ROUTE and not isinstance(entry.get('glyphTable'), str):
        raise UiFontStepError(f'{label} needs a glyphTable path')
    if entry['route'] == DIGIT_ATLAS_ROUTE:
        require_positive_integer(entry.get('cellWidth'), f'{label} cellWidth')
        require_positive_integer(entry.get('cellHeight'), f'{label} cellHeight')
        if not (isinstance(entry.get('slotCharacters'), str) and entry['slotCharacters'] and len(set(entry['slotCharacters'])) == len(entry['slotCharacters'])):
            raise UiFontStepError(f'{label} needs distinct slotCharacters')
    return entry


def read_ui_font_recipe(path):
    document = json.loads(path.read_bytes())
    if not (isinstance(document, dict) and document.get('schemaVersion') == UI_FONT_RECIPE_SCHEMA_VERSION and isinstance(document.get('source'), dict)
            and isinstance(document.get('fonts'), list) and document['fonts']):
        raise UiFontStepError(f'ui font recipe must be {{schemaVersion {UI_FONT_RECIPE_SCHEMA_VERSION}, source, fonts}}: {path}')
    fonts = [validate_font_recipe_entry(entry) for entry in document['fonts']]
    font_types = [entry['fontType'] for entry in fonts]
    if len(set(font_types)) != len(font_types):
        raise UiFontStepError(f'ui font recipe lists a fontType twice: {path}')
    return document


def converted_font_entries(recipe):
    return [entry for entry in recipe['fonts'] if entry['route'] in CONVERTED_ROUTES]


def decode_glyph_table(payload, atlas_width, atlas_height):
    if len(payload) < GLYPH_TABLE_HEADER.size:
        raise UiFontStepError(f'glyph table of {len(payload)} bytes has no header')
    width, height, segment_count = GLYPH_TABLE_HEADER.unpack_from(payload, 0)
    if (width, height) != (atlas_width, atlas_height) or segment_count < 1:
        raise UiFontStepError(f'glyph table header {width} x {height} with {segment_count} segments does not match the {atlas_width} x {atlas_height} atlas')
    offset = GLYPH_TABLE_HEADER.size
    glyphs = []
    for _ in range(segment_count):
        if offset + GLYPH_SEGMENT_HEADER.size > len(payload):
            raise UiFontStepError(f'glyph table segment header at {offset} runs past {len(payload)} bytes')
        first_code_unit, count = GLYPH_SEGMENT_HEADER.unpack_from(payload, offset)
        offset += GLYPH_SEGMENT_HEADER.size
        if first_code_unit < 0 or count < 1 or offset + count * GLYPH_RECORD.size > len(payload):
            raise UiFontStepError(f'glyph table segment at {offset} with first {first_code_unit} and {count} records does not fit')
        for index in range(count):
            x, width, y, height = GLYPH_RECORD.unpack_from(payload, offset + index * GLYPH_RECORD.size)
            if width <= 0 or height <= 0:
                continue
            if x < 0 or y < 0 or x + width > atlas_width or y + height > atlas_height:
                raise UiFontStepError(f'glyph {first_code_unit + index} at {x},{y} size {width} x {height} leaves the atlas')
            glyphs.append({'codeUnit': first_code_unit + index, 'x': x, 'y': y, 'width': width, 'height': height})
        offset += count * GLYPH_RECORD.size
    code_units = [glyph['codeUnit'] for glyph in glyphs]
    if len(set(code_units)) != len(code_units):
        raise UiFontStepError('glyph table segments overlap')
    trailer = payload[offset:]
    return {'segmentCount': segment_count, 'glyphs': glyphs, 'trailerBytes': len(trailer), 'trailerSha256': sha256_hex(trailer)}


def png_dimensions(payload):
    if not (payload.startswith(PNG_SIGNATURE) and payload[12:16] == PNG_HEADER_CHUNK and len(payload) >= 24):
        raise UiFontStepError('converted font atlas is not a PNG')
    return PNG_DIMENSIONS.unpack_from(payload, 16)


def font_record_id(font_type):
    return f'{UI_FONT_ID_PREFIX}{font_type}'


def font_manifest(entry, texture_record, texture_source, glyph_table):
    manifest = {'kind': UI_FONT_MANIFEST_KIND, 'schemaVersion': 1, 'fontType': entry['fontType'], 'authoringName': entry['authoringName'],
                'route': entry['route'], 'selection': entry['selection'],
                'atlas': {'width': entry['texture']['width'], 'height': entry['texture']['height'], 'image': texture_record['image'],
                          'imageSha256': texture_record['imageSha256'], 'imageBytes': texture_record['imageBytes'],
                          'archive': texture_record['archive'], 'archiveSha256': texture_record['archiveSha256']},
                'source': {'texture': texture_source}}
    if entry['route'] == DIGIT_ATLAS_ROUTE:
        manifest['digitCells'] = {'cellWidth': entry['cellWidth'], 'cellHeight': entry['cellHeight'], 'slotCharacters': entry['slotCharacters']}
    else:
        manifest['glyphs'] = glyph_table['decoded']['glyphs']
        manifest['source']['glyphTable'] = {'path': glyph_table['path'], 'sha256': glyph_table['sha256'], 'segmentCount': glyph_table['decoded']['segmentCount'],
                                            'unreadTrailerBytes': glyph_table['decoded']['trailerBytes'],
                                            'unreadTrailerSha256': glyph_table['decoded']['trailerSha256']}
    return manifest


def write_font_record(output_root, font_type, manifest_bytes, texture_files, capacity):
    manifest_sha256 = sha256_hex(manifest_bytes)
    manifest_relative = f'{FONTS_CATALOG_SLICE}/{manifest_sha256}/{UI_FONT_MANIFEST_FILE_NAME}'
    record = validate_catalog_record(FONTS_CATALOG_SLICE, {'id': font_record_id(font_type), 'manifest': f'/l2/{manifest_relative}',
                                                           'manifestSha256': manifest_sha256, 'manifestBytes': len(manifest_bytes)})
    catalog, before = read_store_catalog(output_root)
    catalog = catalog_with_records_replaced(catalog, FONTS_CATALOG_SLICE, [record], capacity)
    catalog[FONTS_CATALOG_SLICE] = sorted(catalog[FONTS_CATALOG_SLICE], key=lambda existing: existing['id'])
    store_files = {}
    for entry in texture_files.values():
        add_store_file_entry(store_files, entry)
    add_store_file(store_files, manifest_relative, manifest_bytes)
    write_store(output_root, store_files, before, canonical_json_bytes(catalog))
    return record, [{'path': f'l2/{relative}', 'sha256': expected_sha256, 'bytes': len(payload)}
                    for relative, payload, expected_sha256 in sorted(store_files.values())]


def read_glyph_table(client_access, entry):
    path, sha256 = client_access.require_equal_file_with_sha256(entry['glyphTable'])
    return {'path': entry['glyphTable'], 'sha256': sha256, 'payload': path.read_bytes()}


class FontUnitPlan:
    def __init__(self, entry, client_access, ledger, converter_identity):
        self.entry = entry
        self.texture_path, texture_sha256 = client_access.require_equal_file_with_sha256(entry['texture']['package'])
        self.texture_source = {'path': entry['texture']['package'], 'sha256': texture_sha256, 'object': entry['texture']['object']}
        self.glyph_table = read_glyph_table(client_access, entry) if entry['route'] == BITMAP_GLYPH_TABLE_ROUTE else None
        self.inputs = [{'path': self.texture_source['path'], 'sha256': texture_sha256}]
        if self.glyph_table is not None:
            self.inputs.append({'path': self.glyph_table['path'], 'sha256': self.glyph_table['sha256']})
        self.config = {'uiFontAlgorithmVersion': UI_FONT_ALGORITHM_VERSION, 'converterIdentity': converter_identity, 'font': entry}
        self.fingerprint = ledger.unit_fingerprint([record['sha256'] for record in self.inputs], self.config)


def texture_request(entry):
    return {'reference': entry['texture']['object'], 'packageName': entry['texture']['package'], 'reason': None}


def convert_font_texture(unit_plan, converter):
    outcome, conversion = convert_reference(texture_request(unit_plan.entry), converter)
    if conversion is None:
        return outcome, None
    record, files = conversion
    width, height = png_dimensions(files[record['image'][len('/l2/'):]].payload)
    texture = unit_plan.entry['texture']
    if (width, height) != (texture['width'], texture['height']):
        raise UiFontStepError(f'converted {texture["object"]} is {width} x {height}, not the recipe {texture["width"]} x {texture["height"]}')
    return outcome, (record, files)


def decoded_glyph_table_or_gap(unit_plan):
    if unit_plan.glyph_table is None:
        return None, None
    texture = unit_plan.entry['texture']
    try:
        decoded = decode_glyph_table(unit_plan.glyph_table['payload'], texture['width'], texture['height'])
    except UiFontStepError as error:
        return None, {'status': 'gap', 'reason': GLYPH_TABLE_UNREADABLE_REASON, 'message': str(error)}
    return {**{key: value for key, value in unit_plan.glyph_table.items() if key != 'payload'}, 'decoded': decoded}, None


def seal_font_outcome(ledger, unit_key, unit_plan, step_directory, outcome, store_outputs):
    outcome_bytes = canonical_json_bytes({'unit': unit_key, **outcome})
    outcome_path = step_directory / FONT_OUTCOME_RECORD_NAME
    outcome_path.write_bytes(outcome_bytes)
    ledger.seal(unit_key, unit_plan.fingerprint, {'config': unit_plan.config, 'inputs': unit_plan.inputs, 'gapRows': [], 'outputs': [
        {'path': lane_relative_path(ledger, outcome_path), 'sha256': sha256_hex(outcome_bytes), 'bytes': len(outcome_bytes)}, *store_outputs]})
    return {'unit': unit_key, **{key: value for key, value in outcome.items() if key != 'message'}}


def convert_font_unit(entry, client_access, converter, ledger, output_root, *, converter_identity, capacity):
    unit_key = font_record_id(entry['fontType'])
    unit_plan = FontUnitPlan(entry, client_access, ledger, converter_identity)
    if ledger.is_sealed(unit_key, unit_plan.fingerprint):
        return {'unit': unit_key, 'status': 'skipped-sealed'}
    step_directory = ledger.begin(unit_key, unit_plan.fingerprint)
    glyph_table, glyph_gap = decoded_glyph_table_or_gap(unit_plan)
    if glyph_gap is not None:
        return seal_font_outcome(ledger, unit_key, unit_plan, step_directory, glyph_gap, [])
    try:
        texture_outcome, conversion = convert_font_texture(unit_plan, converter)
    except ReferenceClientLockError:
        raise
    except TRANSIENT_TEXTURE_CONVERSION_FAILURES as error:
        return {'unit': unit_key, 'status': FAILED_STATUS, 'reason': f'{type(error).__name__}: {error}'}
    if conversion is None:
        return seal_font_outcome(ledger, unit_key, unit_plan, step_directory, {key: value for key, value in texture_outcome.items() if key != 'reference'}, [])
    texture_record, texture_files = conversion
    manifest_bytes = canonical_json_bytes(font_manifest(entry, texture_record, unit_plan.texture_source, glyph_table))
    record, store_outputs = write_font_record(output_root, entry['fontType'], manifest_bytes, texture_files, capacity)
    return seal_font_outcome(ledger, unit_key, unit_plan, step_directory,
                             {'status': 'converted', 'id': record['id'], 'manifest': record['manifest'],
                              'nativeSourceGapReason': texture_outcome['nativeSourceGapReason']}, store_outputs)


def selected_font_entries(recipe, requested_font_types):
    entries = converted_font_entries(recipe)
    if requested_font_types is None:
        return entries
    entries_by_font_type = {entry['fontType']: entry for entry in entries}
    missing = [font_type for font_type in requested_font_types if font_type not in entries_by_font_type]
    if missing:
        raise UiFontStepError(f'ui font recipe converts no fontType {", ".join(map(str, missing))}')
    return [entries_by_font_type[font_type] for font_type in requested_font_types]


def convert_font_units(entries, limit, convert_entry):
    results = []
    for entry in entries:
        if sum(1 for result in results if result['status'] != 'skipped-sealed') >= limit:
            break
        results.append(convert_entry(entry))
    return results
