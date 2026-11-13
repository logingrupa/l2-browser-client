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
from native_assets_lib.combat_audio_bundle import TABLES, config_sections
from native_assets_lib.footstep_config import decode_config
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
        tables = {entry['table'] for section in ('routes', 'confirmedUnresolved', 'casterIndexedRoutes', 'unroutedFields') for entry in document[section]}
        self.assertEqual(tables, {'skillsoundgrp', 'chargrp', 'armorgrp', 'weapongrp', 'npcgrp'})
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

    def bound_list_entries(self, table, member):
        layout = interlude_table_layout(table)[1]
        rows = self.decoded_rows(table)
        field_name = field_named_by_terms(descriptor_field_ordinal_terms(layout, rows), member)
        self.assertTrue(all(row['_counts'][field_name] == len(row[field_name]) for row in rows))
        return rows, field_name, [[next(iter(entry.values())) for entry in row[field_name]] for row in rows]

    def test_every_chargrp_route_binds_one_counted_sound_list_and_attack_voice_binds_eight_groups(self):
        names_by_role = {}
        for role in ('attackItem', 'defense', 'damage', 'attackVoice'):
            for member in route_entry(self.document, 'chargrp', role)['members']:
                with self.subTest(role=role, member=member['member']):
                    rows, field_name, entries = self.bound_list_entries('chargrp', member)
                    names_by_role.setdefault(role, []).append(field_name)
                    self.assertEqual([name for row in entries for name in row if name and not PACKAGE_NAME_FORM.fullmatch(name)], [])
        self.assertEqual(len(set(names_by_role['attackVoice'])), 8)
        terms = descriptor_field_ordinal_terms(interlude_table_layout('chargrp')[1], self.decoded_rows('chargrp'))
        self.assertNotIn({'ordinalConstant': 27, 'ordinalCountTerms': 15}, terms.values())
        _, _, group_five = self.bound_list_entries('chargrp', route_entry(self.document, 'chargrp', 'attackVoice')['members'][5])
        _, _, group_zero = self.bound_list_entries('chargrp', route_entry(self.document, 'chargrp', 'attackVoice')['members'][0])
        self.assertEqual({tuple(entries) for entries, first in zip(group_five, group_zero) if first}, {('',)})
        self.assertEqual(sum(1 for first in group_zero if first), 14)

    def test_the_armorgrp_defense_list_holds_816_empty_placeholders_and_package_names_otherwise(self):
        _, _, entries = self.bound_list_entries('armorgrp', route_entry(self.document, 'armorgrp', 'defense')['members'][0])
        self.assertEqual(sum(1 for row in entries if row == ['']), 816)
        self.assertEqual([name for row in entries if row != [''] for name in row if not PACKAGE_NAME_FORM.fullmatch(name)], [])

    def test_the_weapongrp_attack_item_list_holds_54_empty_and_4_malformed_entries_in_1313_rows(self):
        rows, _, entries = self.bound_list_entries('weapongrp', route_entry(self.document, 'weapongrp', 'attackItem')['members'][0])
        names = [name for row in entries for name in row]
        self.assertEqual((len(rows), names.count(''), sum(1 for name in names if name and not PACKAGE_NAME_FORM.fullmatch(name))), (1313, 54, 4))

    def test_the_alaudio_config_holds_the_recipe_soulshot_values(self):
        entry = self.document['configRoutes'][0]
        path, sha256 = require_reference_client(CONVERSION_CLIENT_ROOT).require_equal_file_with_sha256(entry['file'])
        self.assertEqual(sha256, entry['sha256'])
        decoded, _ = decode_config(path.read_bytes())
        keys = [name for name in entry['values'] if name.startswith(entry['key'])]
        values = config_sections(decoded, {entry['section']: keys})
        self.assertEqual({name: values[f'{entry["section"]}.{name}'].get('number', values[f'{entry["section"]}.{name}']['value']) for name in keys},
                         {name: entry['values'][name] for name in keys})

    def test_the_caster_indexed_entries_hold_names_for_mesh_types_0_to_13_and_slot_14_stays_empty(self):
        layout = interlude_table_layout('skillsoundgrp')[1]
        rows = self.decoded_rows('skillsoundgrp')
        terms = descriptor_field_ordinal_terms(layout, rows)
        for entry, rows_with_names in zip(self.document['casterIndexedRoutes'], (362, 404), strict=True):
            with self.subTest(entry['role']):
                names = [field_named_by_terms(terms, {**mesh_type, 'member': mesh_type['meshType']}) for mesh_type in entry['meshTypes']]
                slot_fourteen = field_named_by_terms(terms, {'member': 14, 'ordinalConstant': entry['meshTypes'][-1]['ordinalConstant'] + 1,
                                                             'ordinalCountTerms': 0})
                self.assertEqual(sum(1 for row in rows if any(row[name] for name in names)), rows_with_names)
                self.assertEqual(sum(1 for row in rows if row[slot_fourteen]), 0)


class CasterMeshClassTests(unittest.TestCase):
    def test_every_caster_mesh_class_is_a_lineage_warrior_class_this_repository_already_knows(self):
        sources = json.loads((ROOT / 'docs' / 'parts' / 'player-characters' / 'character-class-sources.json').read_bytes())
        known_classes = {entry['class'] for entry in sources['candidates']['classDefaults']}
        for entry in committed_document()['casterIndexedRoutes']:
            with self.subTest(entry['role']):
                self.assertEqual([mesh_type['meshType'] for mesh_type in entry['meshTypes']], list(range(14)))
                self.assertLessEqual({mesh_type['meshClass'] for mesh_type in entry['meshTypes']}, known_classes)
                self.assertEqual(len({mesh_type['meshClass'] for mesh_type in entry['meshTypes']}), 14)


if __name__ == '__main__':
    unittest.main()
