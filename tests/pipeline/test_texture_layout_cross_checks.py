import copy
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from data.pinned_elbera_module import ELBERA_ROOT
from native_assets_lib.texture_mips import REVIEWED_VERSIONS
from native_store.texture_layout_cross_checks import (RECOMPUTED_FIELDS, REFUSED_STATUS, TextureLayoutCrossCheckError, read_cross_check_rows,
                                                      texture_layout_cross_check_row, validate_cross_check_rows)
from reference_client_guard import require_reference_client
from world.elbera_reader_cross_check import ELBERA_UE2PACKAGE_PATH

REFERENCE_CLIENT_ROOT = Path('E:/Lineage2-client')


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


class RecomputedCrossCheckRowTests(unittest.TestCase):
    def setUp(self):
        self.access, reason = reference_client_access_or_skip_reason()
        if self.access is None:
            self.skipTest(reason)

    def test_every_committed_row_recomputes_from_the_locked_client_and_pinned_elbera(self):
        for row in read_cross_check_rows(ROOT):
            with self.subTest(package=row['package'], object=row['object']):
                recomputed = texture_layout_cross_check_row(self.access, row['package'], row['object'])
                self.assertEqual({field: recomputed[field] for field in RECOMPUTED_FIELDS}, {field: row[field] for field in RECOMPUTED_FIELDS})


if __name__ == '__main__':
    unittest.main()
