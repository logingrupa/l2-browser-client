import copy
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from actors.combat_role_routes import descriptor_record_field_names
from actors.combat_sound_route_recipe import (COMBAT_SOUND_ROUTE_RECIPE_RELATIVE_PATH, CombatSoundRouteRecipeError, read_combat_sound_route_recipe,
                                              recipe_strings, validate_combat_sound_route_document)
from actors.dat_field_ordinals import descriptor_field_ordinal_terms, descriptor_record_collection
from native_assets_lib.combat_audio_bundle import TABLES
from native_catalog.tables import decode_table, interlude_table_layout
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, require_reference_client

CONVERSION_CLIENT_ROOT = Path('E:/Lineage2-client')
ENGINE_SHA256 = '4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08'
PACKAGE_NAME_FORM = re.compile(r'[^.\s]+\.[^.\s]+')
SKILL_SOUND_READERS = ['UINT', 'UINT'] + (['UNICODE'] * 3 + ['FLOAT'] * 6) * 3 + ['UNICODE'] * 30 + ['FLOAT', 'FLOAT']
SKILL_SOUND_NON_EMPTY_COUNTS = {('cast', 0): 1335, ('cast', 1): 20, ('cast', 2): 1, ('shot', 0): 1105, ('shot', 1): 93, ('shot', 2): 4}


def committed_document():
    return json.loads((ROOT / COMBAT_SOUND_ROUTE_RECIPE_RELATIVE_PATH).read_bytes())


def route_entry(document, table, role):
    return next(entry for entry in document['routes'] if (entry['table'], entry['role']) == (table, role))


def field_named_by_terms(ordinal_terms, member):
    wanted = {'ordinalConstant': member['ordinalConstant'], 'ordinalCountTerms': member['ordinalCountTerms']}
    names = [name for name, terms in ordinal_terms.items() if terms == wanted]
    if len(names) != 1:
        raise AssertionError(f'member {member} matches {len(names)} fields')
    return names[0]


class CombatSoundRouteRecipeStructureTests(unittest.TestCase):
    def test_the_recipe_pins_the_lock_equal_engine_and_the_verified_facts(self):
        recipe = read_combat_sound_route_recipe(ROOT)
        document = recipe['document']
        self.assertEqual(recipe['path'], 'recipes/actors/combat-sound-routes.json')
        self.assertEqual(document['engine'], {'path': 'system/Engine.dll', 'sha256': ENGINE_SHA256, 'imageBase': '0x10300000'})
        lock = json.loads(REFERENCE_CLIENT_LOCK_PATH.read_bytes())
        self.assertEqual(lock['files']['system/engine.dll'][4], ENGINE_SHA256)
        self.assertEqual((document['verification']['date'], document['verification']['decisionRow']), ('2026-11-13', 'P1147'))

    def test_the_skillsoundgrp_members_are_the_verified_row_members_and_dat_ordinals(self):
        document = committed_document()
        for role, members in (('cast', [('+0x08', 2), ('+0x0c', 11), ('+0x10', 20)]), ('shot', [('+0x14', 3), ('+0x18', 12), ('+0x1c', 21)])):
            with self.subTest(role):
                entry = route_entry(document, 'skillsoundgrp', role)
                self.assertEqual([(member['rowMember'], member['ordinalConstant'], member['ordinalCountTerms'], member['datFieldOrdinal'])
                                  for member in entry['members']], [(row_member, ordinal, 0, str(ordinal)) for row_member, ordinal in members])

    def test_no_recipe_key_or_string_equals_a_descriptor_field_name_of_its_tables(self):
        document = committed_document()
        tables = {entry['table'] for entry in document['routes']}
        field_names = {name for table in tables for name in descriptor_record_field_names(interlude_table_layout(table)[1])}
        self.assertEqual(field_names.intersection(recipe_strings(document)), set())


class CombatSoundRouteRecipeRefusalTests(unittest.TestCase):
    def assert_refused(self, document, message):
        with self.assertRaisesRegex(CombatSoundRouteRecipeError, message):
            validate_combat_sound_route_document(document)

    def test_an_engine_pin_that_differs_from_the_lock_entry_is_refused(self):
        document = committed_document()
        document['engine']['sha256'] = '0' * 64
        self.assert_refused(document, 'differs from the system/engine.dll entry')

    def test_a_member_without_its_constant_or_count_terms_is_refused(self):
        for field in ('ordinalConstant', 'ordinalCountTerms'):
            with self.subTest(field):
                document = committed_document()
                del document['routes'][0]['members'][1][field]
                self.assert_refused(document, 'member 1 must hold')

    def test_a_table_or_role_outside_the_selection_kinds_is_refused(self):
        for changes, message in (({'table': 'skillgrp'}, 'names no supported table'), ({'role': 'attackItem'}, 'names no role of its selection kind')):
            with self.subTest(changes):
                document = committed_document()
                document['routes'][0].update(changes)
                self.assert_refused(document, message)

    def test_a_string_equal_to_a_descriptor_field_name_is_refused_and_a_word_inside_text_is_not(self):
        document = committed_document()
        document['routes'][0]['selector'] = 'skill_level'
        self.assert_refused(document, "names the descriptor fields \\['skill_level'\\]")
        document = committed_document()
        document['routes'][0]['selector'] += ' The skill_level stage stays.'
        validate_combat_sound_route_document(document)

    def test_duplicate_keys_and_non_finite_numbers_are_refused(self):
        payloads = {'repeats a JSON key': b'{"schemaVersion": 1, "schemaVersion": 1}', 'non-finite number': b'{"schemaVersion": NaN}'}
        for message, payload in payloads.items():
            with self.subTest(message), tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / COMBAT_SOUND_ROUTE_RECIPE_RELATIVE_PATH
                path.parent.mkdir(parents=True)
                path.write_bytes(payload)
                with self.assertRaisesRegex(CombatSoundRouteRecipeError, message):
                    read_combat_sound_route_recipe(temporary)

    def test_a_table_and_role_listed_twice_is_refused(self):
        document = committed_document()
        document['routes'].append(copy.deepcopy(document['routes'][0]))
        self.assert_refused(document, 'more than once')


@unittest.skipUnless(CONVERSION_CLIENT_ROOT.is_dir() and REFERENCE_CLIENT_LOCK_PATH.is_file(),
                     'needs the conversion client E:/Lineage2-client and the committed recipes/reference-client-tree.lock.json')
class CombatSoundRouteRederivationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.document = committed_document()
        cls.decoded = {}

    def decoded_rows(self, table):
        if table not in self.decoded:
            require_reference_client(CONVERSION_CLIENT_ROOT).require_equal_file_with_sha256(f'system/{table}.dat')
            self.decoded[table] = decode_table(CONVERSION_CLIENT_ROOT, table)['data'][TABLES[table]]
        return self.decoded[table]

    def test_every_skillsoundgrp_row_walks_to_61_scalar_fields_in_the_verified_reader_sequence(self):
        layout = interlude_table_layout('skillsoundgrp')[1]
        rows = self.decoded_rows('skillsoundgrp')
        self.assertEqual(len(rows), 1398)
        self.assertEqual([node.get('reader') for node in descriptor_record_collection(layout)], SKILL_SOUND_READERS)
        terms = descriptor_field_ordinal_terms(layout, rows)
        self.assertEqual(sorted((value['ordinalConstant'], value['ordinalCountTerms']) for value in terms.values()),
                         [(ordinal, 0) for ordinal in range(61)])

    def test_every_skillsoundgrp_member_sits_at_its_ordinal_with_the_verified_data_counts(self):
        layout = interlude_table_layout('skillsoundgrp')[1]
        rows = self.decoded_rows('skillsoundgrp')
        terms = descriptor_field_ordinal_terms(layout, rows)
        readers = [node.get('reader') for node in descriptor_record_collection(layout)]
        for role in ('cast', 'shot'):
            for member in route_entry(self.document, 'skillsoundgrp', role)['members']:
                with self.subTest(role=role, member=member['member']):
                    field_name = field_named_by_terms(terms, member)
                    self.assertEqual(readers[member['ordinalConstant']], 'UNICODE')
                    values = [row[field_name] for row in rows if row[field_name]]
                    self.assertEqual(len(values), SKILL_SOUND_NON_EMPTY_COUNTS[(role, member['member'])])
                    self.assertEqual([value for value in values if not PACKAGE_NAME_FORM.fullmatch(value)], [])


if __name__ == '__main__':
    unittest.main()
