from pathlib import Path
import sys
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from actors.dat_field_ordinals import descriptor_field_ordinal_terms, descriptor_record_collection

COUNTED_LAYOUT = ET.fromstring(
    '<file><node name="data" reader="UINT"/><for name="rows" size="#data" hidden="false">'
    '<node name="identity" reader="UINT"/><node name="first_list" reader="UINT"/><node name="second_list" reader="UINT"/>'
    '<for name="first_list" size="#first_list"><node name="first_entry" reader="UNICODE"/></for>'
    '<wrapper name="pair"><node name="pair_left" reader="UNICODE"/><node name="pair_right" reader="FLOAT"/></wrapper>'
    '<for name="second_list" size="#second_list"><node name="second_entry" reader="UNICODE"/></for>'
    '<node name="voice_count" reader="UINT"/><for name="voice_list" size="#voice_count"><node name="voice_entry" reader="UNICODE"/></for>'
    '<node name="last_scalar" reader="UNICODE"/></for></file>')
CONDITIONAL_LAYOUT = ET.fromstring(
    '<file><for name="rows" size="2" hidden="false"><node name="handness" reader="UINT"/><node name="before" reader="UNICODE"/>'
    '<if name="check" param="#handness" val="2"><node name="extra" reader="UNICODE"/></if>'
    '<node name="after" reader="UNICODE"/></for></file>')
UNREAD_LAYOUT = ET.fromstring(
    '<file><for name="rows" size="2" hidden="false"><node name="first" reader="UINT"/><node name="odd" reader="MAP_INT"/>'
    '<node name="after" reader="UNICODE"/></for></file>')


def counted_row(first, second, voices):
    return {'_counts': {'first_list': len(first), 'second_list': len(second)}, 'identity': 1, 'first_list': [{'first_entry': name} for name in first],
            'second_list': [{'second_entry': name} for name in second], 'pair': {'pair_left': 'Pkg.left', 'pair_right': 1.0},
            'voice_count': len(voices), 'voice_list': [{'voice_entry': name} for name in voices], 'last_scalar': 'Pkg.last'}


class DescriptorFieldOrdinalTermTests(unittest.TestCase):
    def test_scalar_fields_take_their_position_and_counted_lists_add_one_count_term_each(self):
        rows = [counted_row(['A.a'], ['B.b', 'B.c'], []), counted_row([], ['B.d'], ['V.a', 'V.b', 'V.c'])]
        self.assertEqual(descriptor_field_ordinal_terms(COUNTED_LAYOUT, rows), {
            'identity': {'ordinalConstant': 0, 'ordinalCountTerms': 0},
            'first_list': {'ordinalConstant': 3, 'ordinalCountTerms': 0},
            'second_list': {'ordinalConstant': 5, 'ordinalCountTerms': 1},
            'pair': {'ordinalConstant': 3, 'ordinalCountTerms': 1},
            'voice_count': {'ordinalConstant': 5, 'ordinalCountTerms': 2},
            'voice_list': {'ordinalConstant': 6, 'ordinalCountTerms': 2},
            'last_scalar': {'ordinalConstant': 6, 'ordinalCountTerms': 3}})

    def test_a_conditional_block_held_by_some_rows_leaves_the_following_fields_without_terms(self):
        rows = [{'handness': 1, 'before': 'A.a', 'after': 'A.b'}, {'handness': 2, 'before': 'A.c', 'extra': 'A.d', 'after': 'A.e'}]
        self.assertEqual(descriptor_field_ordinal_terms(CONDITIONAL_LAYOUT, rows),
                         {'handness': {'ordinalConstant': 0, 'ordinalCountTerms': 0}, 'before': {'ordinalConstant': 1, 'ordinalCountTerms': 0}})
        held_by_every_row = [{**row, 'handness': 2, 'extra': 'A.x'} for row in rows]
        self.assertEqual(descriptor_field_ordinal_terms(CONDITIONAL_LAYOUT, held_by_every_row)['after'],
                         {'ordinalConstant': 3, 'ordinalCountTerms': 0})

    def test_a_field_after_a_construct_the_walk_does_not_read_has_no_terms(self):
        terms = descriptor_field_ordinal_terms(UNREAD_LAYOUT, [{'first': 1, 'odd': {'x': 1}, 'after': 'A.a'}])
        self.assertEqual(terms, {'first': {'ordinalConstant': 0, 'ordinalCountTerms': 0}})

    def test_the_record_collection_is_the_one_visible_list(self):
        self.assertEqual(descriptor_record_collection(COUNTED_LAYOUT).get('name'), 'rows')
        with self.assertRaisesRegex(ValueError, 'holds 0 record collections'):
            descriptor_record_collection(ET.fromstring('<file><node name="data" reader="UINT"/></file>'))


if __name__ == '__main__':
    unittest.main()
