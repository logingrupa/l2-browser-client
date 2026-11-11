from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from actors.actor_unit_inventory import character_units_and_rows, conversion_unit_key
from actors.item_unit_inventory import armorgrp_mtx_column_names, item_units_and_rows
from actors.skill_unit_inventory import skill_units_and_rows
from actor_census_fixture import (SYNTHETIC_ARMOR_COLUMNS, SYNTHETIC_FIRST_TEXTURE, SYNTHETIC_MESH, SYNTHETIC_SECOND_TEXTURE, SyntheticActorClient,
                                  synthetic_armorgrp, synthetic_character, synthetic_chargrp, synthetic_skillgrp, synthetic_skillsoundgrp,
                                  synthetic_weapongrp)
from native_catalog.tables import CRYPTO_SOURCE, SCHEMA_ROOT, decode_table
from native_store.gap_rows import validate_gap_row
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH

CONVERSION_CLIENT_ROOT = Path('E:/Lineage2-client')
SYNTHETIC_SKILL_ROOT = 'SyntheticSkill.synthetic_root'
SYNTHETIC_SOUND = 'SyntheticSound.cast_1'


def units_by_key(units):
    return {unit['key']: unit for unit in units}


def reasons_by_key(rows):
    return {row['key']: row['reason'] for row in rows}


class InventoryTestCase(unittest.TestCase):
    def setUp(self):
        self.package_census = SyntheticActorClient(self).package_census()

    def assert_valid_gap_rows(self, rows):
        for row in rows:
            with self.subTest(key=row['key']):
                validate_gap_row(row)


class CharacterUnitInventoryTests(InventoryTestCase):
    def test_every_chargrp_row_is_a_census_row_with_explicit_hair_and_helmet_gaps(self):
        chargrp = synthetic_chargrp([
            synthetic_character([SYNTHETIC_MESH, ''], [SYNTHETIC_FIRST_TEXTURE, '']),
            synthetic_character([SYNTHETIC_MESH, ''], [SYNTHETIC_SECOND_TEXTURE, '']),
            synthetic_character(['', ''], ['', '']),
        ])
        units, rows = character_units_and_rows(chargrp, self.package_census)
        self.assertEqual(reasons_by_key(rows), {'character:0': 'conversion-pending', 'character:1': 'conversion-pending',
                                                'character:2': 'no-mesh-in-row'})
        units = units_by_key(units)
        self.assertEqual(sorted(units), ['character:0', 'character:0:hair', 'character:0:helmet', 'character:1', 'character:1:hair',
                                         'character:1:helmet', 'character:2', 'character:2:hair', 'character:2:helmet'])
        layout_units = [unit for key, unit in units.items() if key.endswith((':hair', ':helmet'))]
        self.assertEqual(len(layout_units), 6)
        self.assertEqual({(unit['status'], unit['reason'], unit['selection']) for unit in layout_units},
                         {('gap', 'hair-layout-undecoded', None), ('gap', 'helmet-layout-undecoded', None)})
        self.assertEqual(units['character:0']['selection'], {
            'meshGroups': {'body_mesh': [SYNTHETIC_MESH, '']}, 'textureGroups': {'body_texture': [SYNTHETIC_FIRST_TEXTURE, '']}})
        self.assertEqual((units['character:2']['status'], units['character:2']['reason']), ('gap', 'no-mesh-in-row'))
        self.assert_valid_gap_rows(rows)

    def test_hair_groups_belong_to_the_hair_gap_and_never_gate_the_body(self):
        chargrp = synthetic_chargrp([synthetic_character([SYNTHETIC_MESH], [SYNTHETIC_FIRST_TEXTURE], hair_mesh='SyntheticElders.hair_m00',
                                                         hair_texture='SyntheticEldersTex.hair_t00')])
        units, rows = character_units_and_rows(chargrp, self.package_census)
        self.assertEqual(reasons_by_key(rows), {'character:0': 'conversion-pending'})
        self.assertNotIn('hair_mesh', units_by_key(units)['character:0']['selection']['meshGroups'])

    def test_unreviewed_body_texture_package_is_the_row_gap(self):
        chargrp = synthetic_chargrp([synthetic_character([SYNTHETIC_MESH], ['SyntheticEldersTex.body_t00'])])
        _, rows = character_units_and_rows(chargrp, self.package_census)
        self.assertEqual(reasons_by_key(rows), {'character:0': 'texture-licensee-unsupported:123/31'})


class ItemUnitInventoryTests(InventoryTestCase):
    def test_weapon_rows_sharing_a_mesh_selection_share_one_unit(self):
        weapongrp = synthetic_weapongrp({
            1: ([SYNTHETIC_MESH], [SYNTHETIC_FIRST_TEXTURE]),
            2: ([SYNTHETIC_MESH], [SYNTHETIC_FIRST_TEXTURE]),
            3: ([''], ['']),
            4: (['SyntheticElders.blade_m00'], [SYNTHETIC_FIRST_TEXTURE]),
        })
        units, rows = item_units_and_rows(weapongrp, synthetic_armorgrp({}), SYNTHETIC_ARMOR_COLUMNS, self.package_census)
        self.assertEqual(reasons_by_key(rows), {'item:1': 'conversion-pending', 'item:2': 'conversion-pending', 'item:3': 'no-mesh-in-row',
                                                'item:4': 'skeletal-licensee-unsupported:123/23'})
        self.assertEqual(len(units), 2)
        self.assertEqual(units[0]['key'], conversion_unit_key('weapon-mesh', {'meshes': [SYNTHETIC_MESH], 'textures': [SYNTHETIC_FIRST_TEXTURE]}))
        self.assertEqual(units[0]['sourceIdentity']['path'], 'animations/SyntheticMonsters.ukx')
        self.assert_valid_gap_rows(rows)

    def test_armor_units_are_one_per_column_with_a_mesh(self):
        armorgrp = synthetic_armorgrp({
            21: {'f_SyntheticRace': ([SYNTHETIC_MESH], [SYNTHETIC_FIRST_TEXTURE])},
            22: {},
            23: {'m_SyntheticRace': ([SYNTHETIC_MESH], [SYNTHETIC_FIRST_TEXTURE]),
                 'Synthetic_NPC': (['SyntheticTwin.armor_m00'], [''])},
        })
        units, rows = item_units_and_rows(synthetic_weapongrp({}), armorgrp, SYNTHETIC_ARMOR_COLUMNS, self.package_census)
        self.assertEqual(reasons_by_key(rows), {'item:21': 'conversion-pending', 'item:22': 'no-mesh-in-row',
                                                'item:23': 'package-name-ambiguous:SyntheticTwin'})
        self.assertEqual(sorted(unit['selection']['column'] for unit in units), ['Synthetic_NPC', 'f_SyntheticRace', 'm_SyntheticRace'])
        self.assertEqual({unit['unitKind'] for unit in units}, {'armor-mesh'})
        self.assert_valid_gap_rows(rows)

    def test_a_column_missing_from_a_decoded_row_is_refused(self):
        with self.assertRaisesRegex(ValueError, 'no decoded column Absent_Column'):
            item_units_and_rows(synthetic_weapongrp({}), synthetic_armorgrp({21: {}}), ['Absent_Column'], self.package_census)


class SkillUnitInventoryTests(InventoryTestCase):
    def test_duplicate_pairs_stay_ambiguous_and_levels_stay_decoded(self):
        skillgrp = synthetic_skillgrp([(3, 1, SYNTHETIC_SKILL_ROOT), (3, 1, SYNTHETIC_SKILL_ROOT), (3, 2, ''), (5, 101, SYNTHETIC_SKILL_ROOT),
                                       (6, 1, 'AbsentEffects.root')])
        units, rows = skill_units_and_rows(skillgrp, synthetic_skillsoundgrp([]), self.package_census)
        self.assertEqual(reasons_by_key(rows), {'skill:3:1': 'skill-row-ambiguous:2', 'skill:3:2': 'native-skill-dispatch-required',
                                                'skill:5:101': 'conversion-pending', 'skill:6:1': 'mesh-package-not-in-client:AbsentEffects'})
        units = units_by_key(units)
        self.assertEqual(sorted(units), ['skill-root:AbsentEffects.root', 'skill-root:' + SYNTHETIC_SKILL_ROOT])
        self.assertEqual(units['skill-root:' + SYNTHETIC_SKILL_ROOT]['sourceIdentity']['path'], 'animations/SyntheticSkill.usk')
        self.assert_valid_gap_rows(rows)

    def test_every_sound_row_is_its_own_unit_without_fallback(self):
        skillsoundgrp = synthetic_skillsoundgrp([
            (4, 1, {'spelleffect_sound_1': SYNTHETIC_SOUND}),
            (4, 1, {'spelleffect_sound_1': SYNTHETIC_SOUND, 'mfighter_cast': 'AbsentSounds.cast'}),
            (4, 2, {'shoteffect_sound_2': 'unqualified_sound'}),
        ])
        units, rows = skill_units_and_rows(synthetic_skillgrp([]), skillsoundgrp, self.package_census)
        self.assertEqual(rows, [])
        self.assertEqual({unit['key']: (unit['status'], unit['reason']) for unit in units}, {
            'skill-sound-row:0': ('convertible', None),
            'skill-sound-row:1': ('gap', 'sound-identity-unresolved'),
            'skill-sound-row:2': ('gap', 'sound-identity-unresolved'),
        })
        self.assertEqual(units_by_key(units)['skill-sound-row:1']['selection'], {
            'skillId': 4, 'level': 1, 'references': [SYNTHETIC_SOUND, 'AbsentSounds.cast']})


@unittest.skipUnless(CONVERSION_CLIENT_ROOT.is_dir() and REFERENCE_CLIENT_LOCK_PATH.is_file() and SCHEMA_ROOT.is_dir() and CRYPTO_SOURCE.is_file(),
                     'needs the conversion client E:/Lineage2-client, the reference client lock and the native table tools')
class DecodedArmorColumnTests(unittest.TestCase):
    def test_schema_mesh_columns_are_the_decoded_mesh_texture_compounds(self):
        armorgrp = decode_table(CONVERSION_CLIENT_ROOT, 'armorgrp')
        first_armor = armorgrp['data']['item'][0]
        compound_columns = [name for name, value in first_armor.items() if isinstance(value, dict) and 'for_mtx_size_1_' in value.get('var_0_', {})]
        self.assertEqual(armorgrp_mtx_column_names(armorgrp), compound_columns)


if __name__ == '__main__':
    unittest.main()
