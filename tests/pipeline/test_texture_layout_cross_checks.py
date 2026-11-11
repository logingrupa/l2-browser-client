import copy
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from data.pinned_elbera_module import ELBERA_ROOT
from native_assets_lib.lineage_material_prefix import (NO_MATERIAL_PREFIX, RESERVED_INT32_MATERIAL_PREFIX, SHADER_BLOCK_MATERIAL_PREFIX,
                                                       lineage_material_prefix)
from native_assets_lib.texture_mips import REVIEWED_VERSIONS, read_texture_source_for_layout
from native_assets_lib.texture_package_118 import read_unreal_package
from native_assets_lib.texture_source_reader import UnsupportedTextureSource
from native_store.texture_layout_cross_checks import (RECOMPUTED_FIELDS, REFUSED_STATUS, TEXTURE_LAYOUT_FIXTURE_FOLDER, TextureLayoutCrossCheckError,
                                                      read_cross_check_rows, read_texture_layout_fixtures, texture_layout_cross_check_row,
                                                      texture_layout_fixture_path, validate_cross_check_rows)
from reference_client_guard import require_reference_client
from texture_layout_fixture import decoded_texture_layout_projection, synthetic_texture_layout_package_bytes
from world.elbera_reader_cross_check import ELBERA_UE2PACKAGE_PATH

REFERENCE_CLIENT_ROOT = Path('E:/Lineage2-client')
UI_TEXTURE_CENSUS_PATH = ROOT / 'docs' / 'parts' / 'ui' / 'texture-package-census.json'
ACTOR_UNIT_CENSUS_PATH = ROOT / 'docs' / 'parts' / 'npcs' / 'actor-unit-census.json'
TEXTURE_GATE_NOT_APPLICABLE = 'not-applicable'
SYNTHETIC_PACKAGE_FILENAME = 'Synthetic_T.utx'


def decode_texture_layout_fixture(fixture):
    package = read_unreal_package(synthetic_texture_layout_package_bytes(fixture), SYNTHETIC_PACKAGE_FILENAME)
    return read_texture_source_for_layout(package, package.exports[0])


def census_texture_layouts():
    ui_rows = json.loads(UI_TEXTURE_CENSUS_PATH.read_bytes())['packages']
    actor_rows = json.loads(ACTOR_UNIT_CENSUS_PATH.read_bytes())['packages']
    return ({(row['packageVersion'], row['licensee']) for row in ui_rows if row['packageVersion'] is not None}
            | {(row['packageVersion'], row['licensee']) for row in actor_rows if row['textureReaderGate'] != TEXTURE_GATE_NOT_APPLICABLE})


def reference_client_access_or_skip_reason():
    if not (Path(ELBERA_ROOT) / ELBERA_UE2PACKAGE_PATH).is_file():
        return None, f'pinned Elbera checkout {ELBERA_ROOT} is unavailable'
    try:
        return require_reference_client(REFERENCE_CLIENT_ROOT), None
    except (OSError, ValueError) as error:
        return None, f'locked reference client {REFERENCE_CLIENT_ROOT} is unavailable: {error}'


class CommittedCrossCheckRowTests(unittest.TestCase):
    def setUp(self):
        self.rows = read_cross_check_rows(ROOT)

    def test_every_reviewed_texture_layout_has_an_exact_elbera_row_and_an_equal_converter_conversion(self):
        validate_cross_check_rows(self.rows, REVIEWED_VERSIONS)

    def test_the_118_layout_is_reviewed_by_one_ui_and_one_radar_texture(self):
        packages = {row['package'] for row in self.rows if (row['packageVersion'], row['licensee']) == (118, 0)}
        self.assertEqual(packages, {'systextures/L2UI_CH3.utx', 'systextures/L2_RadarMap.utx'})

    def test_removing_the_row_of_a_reviewed_layout_fails(self):
        for layout in sorted(REVIEWED_VERSIONS):
            remaining = [row for row in self.rows if (row['packageVersion'], row['licensee']) != layout]
            with self.subTest(layout=layout), self.assertRaisesRegex(TextureLayoutCrossCheckError, 'without an exact Elbera cross-check row'):
                validate_cross_check_rows(remaining, REVIEWED_VERSIONS)

    def test_a_reviewed_row_whose_mips_differ_from_elbera_fails(self):
        rows = copy.deepcopy(self.rows)
        rows[0]['elberaMipSha256'] = ['0' * 64]
        with self.assertRaisesRegex(TextureLayoutCrossCheckError, 'not an exact Elbera match'):
            validate_cross_check_rows(rows, REVIEWED_VERSIONS)

    def test_a_reviewed_layout_without_an_equal_converter_conversion_fails(self):
        rows = copy.deepcopy(self.rows)
        rows[0]['converterNativeMipsEqual'] = None
        with self.assertRaisesRegex(TextureLayoutCrossCheckError, 'lacks an equal Converter conversion'):
            validate_cross_check_rows(rows, REVIEWED_VERSIONS)

    def test_a_refused_row_keeps_its_layout_out_of_the_reviewed_layouts(self):
        rows = copy.deepcopy(self.rows)
        rows[0].update(status=REFUSED_STATUS, failingCheck='mip payload SHA-256 values differ from Elbera')
        with self.assertRaisesRegex(TextureLayoutCrossCheckError, 'keep .* out of the reviewed texture layouts'):
            validate_cross_check_rows(rows, {(rows[0]['packageVersion'], rows[0]['licensee'])})


    def test_every_texture_layout_a_committed_census_lists_is_reviewed_or_refused_with_its_failing_check(self):
        checked_layouts = {(row['packageVersion'], row['licensee']) for row in self.rows}
        self.assertEqual(sorted(census_texture_layouts() - checked_layouts), [])


class LineageMaterialPrefixTests(unittest.TestCase):
    def test_the_cited_rule_gives_one_prefix_per_package_version_and_licensee(self):
        self.assertEqual([lineage_material_prefix(*layout) for layout in ((123, 27), (123, 28), (123, 30), (118, 0), (123, 0))],
                         [RESERVED_INT32_MATERIAL_PREFIX, RESERVED_INT32_MATERIAL_PREFIX, SHADER_BLOCK_MATERIAL_PREFIX, NO_MATERIAL_PREFIX,
                          NO_MATERIAL_PREFIX])

    def test_a_shader_block_licensee_other_than_30_is_refused_as_a_licensee_gap(self):
        fixture = {**read_texture_layout_fixtures(ROOT, {(123, 30)})[(123, 30)], 'licensee': 31}
        with self.assertRaises(UnsupportedTextureSource) as caught:
            decode_texture_layout_fixture(fixture)
        self.assertEqual(caught.exception.reason, 'texture-licensee-unsupported:123/31')


class TextureLayoutFixtureTests(unittest.TestCase):
    def setUp(self):
        self.fixtures = read_texture_layout_fixtures(ROOT, REVIEWED_VERSIONS)

    def test_every_reviewed_layout_fixture_decodes_to_its_recorded_offsets_and_hashes(self):
        for layout, fixture in self.fixtures.items():
            with self.subTest(layout=layout):
                metadata, _ = decode_texture_layout_fixture(fixture)
                self.assertEqual(decoded_texture_layout_projection(metadata), fixture['expected'])

    def test_a_licensee_27_fixture_decodes_exactly_as_the_licensee_28_fixture_with_the_same_body(self):
        licensee_27, licensee_28 = self.fixtures[(123, 27)], self.fixtures[(123, 28)]
        self.assertEqual(licensee_27['syntheticBody'], licensee_28['syntheticBody'])
        self.assertEqual(decoded_texture_layout_projection(decode_texture_layout_fixture(licensee_27)[0]),
                         decoded_texture_layout_projection(decode_texture_layout_fixture(licensee_28)[0]))

    def test_removing_the_fixture_of_a_reviewed_layout_fails(self):
        with tempfile.TemporaryDirectory() as temporary:
            copied_root = Path(temporary)
            shutil.copytree(ROOT / TEXTURE_LAYOUT_FIXTURE_FOLDER, copied_root / TEXTURE_LAYOUT_FIXTURE_FOLDER)
            texture_layout_fixture_path(copied_root, (123, 27)).unlink()
            with self.assertRaisesRegex(TextureLayoutCrossCheckError, '123/27 has no synthetic fixture'):
                read_texture_layout_fixtures(copied_root, REVIEWED_VERSIONS)


class RecomputedCrossCheckRowTests(unittest.TestCase):
    def setUp(self):
        self.access, reason = reference_client_access_or_skip_reason()
        if self.access is None:
            self.skipTest(reason)

    def test_every_committed_row_recomputes_from_the_locked_client_and_pinned_elbera(self):
        for row in read_cross_check_rows(ROOT):
            with self.subTest(package=row['package'], object=row['object']):
                recomputed = texture_layout_cross_check_row(self.access, row['package'])
                self.assertEqual({field: recomputed[field] for field in RECOMPUTED_FIELDS}, {field: row[field] for field in RECOMPUTED_FIELDS})


if __name__ == '__main__':
    unittest.main()
