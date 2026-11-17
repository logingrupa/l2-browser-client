import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'scripts' / 'data'))
from native_store.catalog_writer import validate_catalog_record
from native_store.verified_file_writes import CatalogWriteError
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import UnitLedger
import ui_font_step

RECIPE_PATH = ROOT / 'recipes' / 'data' / 'ui-fonts.json'
DIGIT_FONT = {'fontType': 10, 'authoringName': 'SpecialDigitLarge', 'route': 'digit-atlas', 'selection': 'synthetic digit selection',
              'texture': {'package': 'systextures/SyntheticUI.utx', 'object': 'SyntheticUI.Nwindow.Number', 'width': 32, 'height': 8},
              'cellWidth': 8, 'cellHeight': 8, 'slotCharacters': '0123'}
BITMAP_FONT = {'fontType': 0, 'authoringName': 'Normal', 'route': 'bitmap-glyph-table', 'selection': 'synthetic bitmap selection',
               'texture': {'package': 'systextures/SyntheticFont.utx', 'object': 'SyntheticFont.Font.Small', 'width': 64, 'height': 16},
               'glyphTable': 'system/synthetic.gly'}
GLYPH_TRAILER = b'\x07' * 20


def png_header(width, height):
    return b'\x89PNG\r\n\x1a\n' + struct.pack('>I', 13) + b'IHDR' + struct.pack('>II', width, height) + b'\x08\x06\x00\x00\x00'


def glyph_table_bytes(width=64, height=16, records=((0, 5, 0, 12), (5, 0, 0, 12), (10, 6, 0, 12))):
    payload = struct.pack('<3i', width, height, 1) + struct.pack('<2i', 65, len(records))
    payload += b''.join(struct.pack('<4i', *record) for record in records)
    return payload + GLYPH_TRAILER


class FakeClientAccess:
    def __init__(self, root, files):
        self.root = root
        self.files = files
        for relative, payload in files.items():
            (root / relative).parent.mkdir(parents=True, exist_ok=True)
            (root / relative).write_bytes(payload)

    def require_equal_file_with_sha256(self, relative):
        return self.root / relative, hashlib.sha256(self.files[relative]).hexdigest()


class FakeTextureConverter:
    def __init__(self, output, sizes):
        self.output = output
        self.sizes = sizes
        self.requests = []

    def convert(self, request):
        self.requests.append(request)
        image = png_header(*self.sizes[request['object']]) + request['object'].encode()
        provenance = json.dumps({'metadata': {'nativeTextureSource': {'status': 'preserved'}}}).encode()
        archive = b'PK' + image + provenance
        archive_sha256 = hashlib.sha256(archive).hexdigest()
        target = self.output / archive_sha256
        target.mkdir(parents=True, exist_ok=True)
        for name, payload in (('texture.png', image), ('provenance.json', provenance), ('asset.l2asset', archive)):
            (target / name).write_bytes(payload)
        (target / 'asset.json').write_bytes(json.dumps({
            'id': 'interlude:' + request['object'], 'image': {'file': 'texture.png'},
            'source': {'edition': 'interlude', 'package': request['package'], 'object': request['object'], 'sha256': '2' * 64},
            'files': [{'path': 'provenance.json', 'sha256': hashlib.sha256(provenance).hexdigest(), 'bytes': len(provenance)},
                      {'path': 'texture.png', 'sha256': hashlib.sha256(image).hexdigest(), 'bytes': len(image)}]}).encode())
        return {'file': str(target / 'asset.l2asset'), 'sha256': archive_sha256}


class GlyphTableTests(unittest.TestCase):
    def test_decodes_records_as_x_width_y_height_and_skips_records_without_area(self):
        decoded = ui_font_step.decode_glyph_table(glyph_table_bytes(), 64, 16)
        self.assertEqual(decoded['glyphs'], [{'codeUnit': 65, 'x': 0, 'y': 0, 'width': 5, 'height': 12},
                                             {'codeUnit': 67, 'x': 10, 'y': 0, 'width': 6, 'height': 12}])
        self.assertEqual((decoded['segmentCount'], decoded['trailerBytes'], decoded['trailerSha256']),
                         (1, 20, hashlib.sha256(GLYPH_TRAILER).hexdigest()))

    def test_refuses_a_header_of_another_atlas_and_a_glyph_outside_the_atlas(self):
        with self.assertRaisesRegex(ui_font_step.UiFontStepError, 'does not match the 64 x 16 atlas'):
            ui_font_step.decode_glyph_table(glyph_table_bytes(width=128), 64, 16)
        with self.assertRaisesRegex(ui_font_step.UiFontStepError, 'leaves the atlas'):
            ui_font_step.decode_glyph_table(glyph_table_bytes(records=((60, 8, 0, 12),)), 64, 16)


class UiFontRecipeTests(unittest.TestCase):
    def test_the_recipe_maps_every_stored_font_type_to_its_verified_route(self):
        recipe = ui_font_step.read_ui_font_recipe(RECIPE_PATH)
        self.assertEqual({entry['fontType']: entry['route'] for entry in recipe['fonts']}, {
            0: 'bitmap-glyph-table', 1: 'bitmap-glyph-table', 4: 'system-face', 6: 'system-face', 7: 'system-face', 10: 'digit-atlas', 11: 'digit-atlas'})
        self.assertEqual([entry['fontType'] for entry in ui_font_step.converted_font_entries(recipe)], [0, 1, 10, 11])
        self.assertEqual(recipe['source']['reportSha256'], '903ea77455aa5e1bbe730db8c260e9b47fcf515f39185cfee48fa40563d2f40c')

    def test_the_limit_counts_pending_units_and_skips_past_sealed_ones(self):
        recipe = ui_font_step.read_ui_font_recipe(RECIPE_PATH)
        sealed_font_types = {0, 10}
        converted = []

        def convert_entry(entry):
            converted.append(entry['fontType'])
            return {'status': 'skipped-sealed' if entry['fontType'] in sealed_font_types else 'converted'}
        ui_font_step.convert_font_units(ui_font_step.selected_font_entries(recipe, None), 2, convert_entry)
        self.assertEqual(converted, [0, 1, 10, 11])
        with self.assertRaisesRegex(ui_font_step.UiFontStepError, 'converts no fontType 6'):
            ui_font_step.selected_font_entries(recipe, [6])

    def test_a_font_record_needs_the_ui_font_id_and_a_fonts_manifest_path(self):
        record = {'id': 'ui-font:10', 'manifest': f'/l2/fonts/{"a" * 64}/font.json', 'manifestSha256': 'a' * 64, 'manifestBytes': 10}
        self.assertEqual(validate_catalog_record('fonts', record), record)
        for broken in ({**record, 'id': 'ui-font:x'}, {**record, 'manifest': f'/l2/windows/{"a" * 64}/font.json'}):
            with self.assertRaises(CatalogWriteError):
                validate_catalog_record('fonts', broken)


class ConvertFontUnitTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve() / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        self.output_root = lane_store_root(self.project_root, 'data-ui')
        self.client_access = FakeClientAccess(Path(temporary_directory.name).resolve() / 'client', {
            'systextures/SyntheticUI.utx': b'digit package', 'systextures/SyntheticFont.utx': b'font package', 'system/synthetic.gly': glyph_table_bytes()})
        self.converter = FakeTextureConverter(lane_work_root(self.project_root, 'data-ui') / 'ui-texture-converter', {
            'SyntheticUI.Nwindow.Number': (32, 8), 'SyntheticFont.Font.Small': (64, 16)})

    def convert(self, entry):
        ledger = UnitLedger(lane_work_root(self.project_root, 'data-ui'), ui_font_step.FONTS_STEP, ui_font_step.UI_FONT_ALGORITHM_VERSION)
        return ui_font_step.convert_font_unit(entry, self.client_access, self.converter, ledger, self.output_root,
                                              converter_identity={'implementation': 'synthetic'}, capacity=2)

    def font_manifest(self, record_id):
        [record] = [record for record in json.loads((self.output_root / 'catalog.json').read_bytes())['fonts'] if record['id'] == record_id]
        payload = (self.output_root / record['manifest'].removeprefix('/l2/')).read_bytes()
        self.assertEqual((hashlib.sha256(payload).hexdigest(), len(payload)), (record['manifestSha256'], record['manifestBytes']))
        return json.loads(payload)

    def test_converts_the_digit_atlas_once_with_its_cells_and_pinned_image_then_skips_a_rerun(self):
        result = self.convert(DIGIT_FONT)
        self.assertEqual((result['unit'], result['status'], result['id']), ('ui-font:10', 'converted', 'ui-font:10'))
        manifest = self.font_manifest('ui-font:10')
        self.assertEqual((manifest['kind'], manifest['route'], manifest['digitCells']),
                         ('native-ui-font', 'digit-atlas', {'cellWidth': 8, 'cellHeight': 8, 'slotCharacters': '0123'}))
        image = (self.output_root / manifest['atlas']['image'].removeprefix('/l2/')).read_bytes()
        self.assertEqual((hashlib.sha256(image).hexdigest(), len(image)), (manifest['atlas']['imageSha256'], manifest['atlas']['imageBytes']))
        self.assertEqual(manifest['source']['texture'], {'path': 'systextures/SyntheticUI.utx', 'sha256': hashlib.sha256(b'digit package').hexdigest(),
                                                         'object': 'SyntheticUI.Nwindow.Number'})
        self.assertEqual(self.convert(DIGIT_FONT), {'unit': 'ui-font:10', 'status': 'skipped-sealed'})
        self.assertEqual(self.converter.requests, [{'kind': 'texture', 'package': 'systextures/SyntheticUI.utx', 'object': 'SyntheticUI.Nwindow.Number'}])

    def test_converts_a_bitmap_font_with_its_glyph_table_and_records_the_unread_trailer(self):
        self.convert(BITMAP_FONT)
        manifest = self.font_manifest('ui-font:0')
        self.assertEqual([glyph['codeUnit'] for glyph in manifest['glyphs']], [65, 67])
        self.assertEqual((manifest['source']['glyphTable']['path'], manifest['source']['glyphTable']['unreadTrailerBytes']), ('system/synthetic.gly', 20))

    def test_an_unreadable_glyph_table_seals_a_gap_outcome_and_writes_no_font_record(self):
        self.client_access = FakeClientAccess(self.client_access.root, {**self.client_access.files, 'system/synthetic.gly': glyph_table_bytes(width=128)})
        result = self.convert(BITMAP_FONT)
        self.assertEqual((result['status'], result['reason']), ('gap', 'font-glyph-table-unreadable'))
        self.assertFalse((self.output_root / 'catalog.json').exists())
        self.assertEqual(self.converter.requests, [])

    def test_an_atlas_of_another_size_than_the_recipe_is_refused(self):
        self.converter.sizes['SyntheticUI.Nwindow.Number'] = (16, 8)
        with self.assertRaisesRegex(ui_font_step.UiFontStepError, 'is 16 x 8, not the recipe 32 x 8'):
            self.convert(DIGIT_FONT)


if __name__ == '__main__':
    unittest.main()
