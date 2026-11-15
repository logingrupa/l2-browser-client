from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_catalog.table_source_resolver import (TableSourceResolutionError, descriptor_layout_for_file_name, descriptor_layout_links,
                                                  resolve_table_source_file_name)
from native_catalog.ue2 import FormatError

SYNTHETIC_DESCRIPTOR = rb'''<?xml version="1.0" encoding="UTF-8"?>
<list name="CT0 Interlude">
	<link pattern="creditgrp-[\w]+\.dat" file="credit" version="ScionsOfDestiny" />
	<link pattern="SkillName-[\w]+\.dat" file="skillname" version="ScionsOfDestiny" />
	<link pattern="skillgrp.dat" file="skillgrp" version="ScionsOfDestiny" />
	<!-- <link pattern="hairgrp.dat" file="hairgrp" version="Interlude" /> -->
</list>
'''
OVERLAPPING_DESCRIPTOR = rb'''<list name="CT0 Interlude">
	<link pattern="itemname-[\w]+\.dat" file="itemname" version="Interlude" />
	<link pattern="ItemName-e\.dat" file="itemname_copy" version="Interlude" />
</list>
'''
SYSTEM_FILE_NAMES = ('creditgrp-e.dat', 'skillgrp.dat', 'skillname-e.dat', 'hairgrp.dat')


class DescriptorLinkTests(unittest.TestCase):
    def setUp(self):
        self.links = descriptor_layout_links(SYNTHETIC_DESCRIPTOR)

    def test_links_keep_pattern_layout_and_version_and_drop_commented_links(self):
        self.assertEqual([(link.pattern, link.layout, link.version) for link in self.links], [
            (r'creditgrp-[\w]+\.dat', 'credit', 'ScionsOfDestiny'), (r'SkillName-[\w]+\.dat', 'skillname', 'ScionsOfDestiny'),
            ('skillgrp.dat', 'skillgrp', 'ScionsOfDestiny')])

    def test_another_descriptor_name_is_refused(self):
        with self.assertRaisesRegex(TableSourceResolutionError, 'descriptor is not CT0 Interlude'):
            descriptor_layout_links(b'<list name="CT2 Gracia"><link pattern="a.dat" file="a" version="x" /></list>')

    def test_credit_link_names_the_creditgrp_file(self):
        self.assertEqual(descriptor_layout_for_file_name('creditgrp-e.dat', self.links), 'credit')
        self.assertEqual(resolve_table_source_file_name(SYSTEM_FILE_NAMES, self.links[0].pattern), 'creditgrp-e.dat')

    def test_file_without_a_link_has_no_layout(self):
        self.assertIsNone(descriptor_layout_for_file_name('hairgrp.dat', self.links))

    def test_file_matched_by_two_links_raises_naming_both_layouts(self):
        with self.assertRaisesRegex(TableSourceResolutionError, 'more than one layout for itemname-e.dat: itemname, itemname_copy'):
            descriptor_layout_for_file_name('itemname-e.dat', descriptor_layout_links(OVERLAPPING_DESCRIPTOR))


class SourceFileResolutionTests(unittest.TestCase):
    def test_link_pattern_matches_the_directory_entry_case_insensitively(self):
        self.assertEqual(resolve_table_source_file_name(SYSTEM_FILE_NAMES, r'SkillName-[\w]+\.dat'), 'skillname-e.dat')

    def test_zero_matches_raise(self):
        with self.assertRaisesRegex(TableSourceResolutionError, r'matches 0 source files, expected 1: none'):
            resolve_table_source_file_name(SYSTEM_FILE_NAMES, r'npcname-[\w]+\.dat')

    def test_two_matches_raise_naming_both_files_instead_of_picking_one(self):
        with self.assertRaisesRegex(TableSourceResolutionError, 'matches 2 source files, expected 1: skillname-e.dat, skillname-ru.dat'):
            resolve_table_source_file_name((*SYSTEM_FILE_NAMES, 'skillname-ru.dat'), r'SkillName-[\w]+\.dat')

    def test_explicit_file_name_selects_one_of_several_matches(self):
        self.assertEqual(resolve_table_source_file_name((*SYSTEM_FILE_NAMES, 'skillname-ru.dat'), r'SkillName-[\w]+\.dat',
                                                        'skillname-ru.dat'), 'skillname-ru.dat')

    def test_explicit_file_name_outside_the_pattern_raises(self):
        with self.assertRaisesRegex(TableSourceResolutionError, 'is not a directory entry matching'):
            resolve_table_source_file_name(SYSTEM_FILE_NAMES, r'SkillName-[\w]+\.dat', 'skillgrp.dat')

    def test_explicit_file_name_must_be_the_exact_directory_entry_spelling(self):
        with self.assertRaisesRegex(TableSourceResolutionError, 'is not a directory entry matching'):
            resolve_table_source_file_name(SYSTEM_FILE_NAMES, r'SkillName-[\w]+\.dat', 'SkillName-e.dat')

    def test_explicit_file_name_with_a_folder_raises(self):
        for file_name in ('../skillname-e.dat', 'sub/skillname-e.dat', 'sub\\skillname-e.dat', ''):
            with self.subTest(file_name=file_name), self.assertRaisesRegex(TableSourceResolutionError, 'bare file name'):
                resolve_table_source_file_name(SYSTEM_FILE_NAMES, r'SkillName-[\w]+\.dat', file_name)

    def test_resolution_errors_are_format_errors(self):
        self.assertTrue(issubclass(TableSourceResolutionError, FormatError))


if __name__ == '__main__':
    unittest.main()
