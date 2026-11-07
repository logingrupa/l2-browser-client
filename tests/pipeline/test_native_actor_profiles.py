import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import native_actor_profiles as profiles
from native_catalog.ue2 import FormatError


def recipe():
    return json.loads((ROOT / 'recipes/native-npc-profiles.json').read_text())


def tables():
    names = {'data': {'npc': [{'id': 21622, 'name': 'Greater Musveren'}, {'id': 20842, 'name': 'Musveren'}]}}
    groups = {'data': {'npc': [
        {'npc_id': 21622, 'mesh_name': 'LineageMonsters.field_stalker_m00', 'class_name': 'LineageMonster.field_stalker_20_bi'},
        {'npc_id': 20842, 'mesh_name': 'LineageMonsters.field_stalker_m00', 'class_name': 'LineageMonster.field_stalker'}]}}
    return names, groups


class SelectionTests(unittest.TestCase):
    def test_exact_id_selects_subclass_instead_of_another_npc_with_same_mesh(self):
        names, groups = tables()
        selection = recipe()['profiles'][0]
        selected = profiles.select_rows(names, groups, selection)
        self.assertEqual(selected[1][1]['class_name'], 'LineageMonster.field_stalker_20_bi')
        for key, value in [('expectedName', 'Musveren'), ('expectedActorClass', 'LineageMonster.field_stalker'),
                ('expectedMesh', 'LineageMonsters.other'), ('npcId', 123456)]:
            with self.subTest(key=key), self.assertRaises(FormatError):
                profiles.select_rows(names, groups, dict(selection, **{key: value}))

    def test_duplicate_ids_in_either_table_are_rejected(self):
        for index in range(2):
            values = tables()
            values[index]['data']['npc'].append(copy.deepcopy(values[index]['data']['npc'][1]))
            with self.subTest(index=index), self.assertRaisesRegex(FormatError, 'Duplicate'):
                profiles.select_rows(*values, recipe()['profiles'][0])

    def test_unknown_recipe_fields_and_ambiguous_or_missing_bindings_fail(self):
        for mutate in [lambda r: r.update(prePivot=[0, 0, 0]),
                lambda r: r['profiles'].append(copy.deepcopy(r['profiles'][0])),
                lambda r: r['profiles'][0].pop('expectedMesh'),
                lambda r: r.update(nameTable='../npcname-e.dat'),
                lambda r: r.update(sourceUnitsPerMetre=1),
                lambda r: r['profiles'][0].update(npcId=True)]:
            value = recipe()
            mutate(value)
            with self.assertRaises(FormatError):
                profiles._recipe(value)


class NativeFieldTests(unittest.TestCase):
    def setUp(self):
        self.native = {'DrawScale': 1.2, 'DrawScale3D': {'X': 1, 'Y': 1, 'Z': 1},
            'CollisionRadius': 18, 'CollisionHeight': 36}

    def resolve(self, value):
        return profiles.resolved_profile(recipe()['profiles'][0], {'effectiveProperties': value}, 100)

    def test_actor_scale_does_not_rescale_collision_or_invent_missing_pivot(self):
        result = self.resolve(self.native)
        self.assertEqual((result['drawScale'], result['collisionRadius'], result['collisionHeight']), (1.2, 18, 36))
        self.assertEqual(result['drawScale3D'], [1, 1, 1])
        self.assertEqual(result['sourceUnitsPerMetre'], 100)
        self.assertNotIn('prePivot', result)
        self.assertEqual(result['unsupportedFields'][0]['field'], 'prePivot')

    def test_authored_nonzero_pivot_is_preserved_in_native_axis_order(self):
        result = self.resolve(dict(self.native, PrePivot={'X': -3, 'Y': 2, 'Z': 7}))
        self.assertEqual(result['prePivot'], [-3, 2, 7])
        self.assertNotIn('unsupportedFields', result)

    def test_missing_and_partial_scale_never_use_prototype_defaults(self):
        for value in [{key: val for key, val in self.native.items() if key != 'DrawScale'},
                dict(self.native, DrawScale3D={'X': 1}), dict(self.native, DrawScale=float('nan')),
                dict(self.native, CollisionHeight=-1), dict(self.native, DrawScale=True),
                dict(self.native, DrawScale3D={'X': 0, 'Y': 1, 'Z': 1}),
                dict(self.native, PrePivot={'X': 0, 'Y': 0})]:
            with self.subTest(value=value), self.assertRaises(FormatError):
                self.resolve(value)


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.client = self.root / 'client'
        self.client.mkdir()
        self.source = self.client / 'Actor.u'
        self.source.write_bytes(b'original native class')
        self.output = self.root / 'output'
        self.pins = {'implementation': 'test-fixture'}
        self.calls = 0
        self.addCleanup(patch.stopall)
        patch.object(profiles, '_tool_pins', side_effect=lambda: copy.deepcopy(self.pins)).start()
        patch.object(profiles, '_extract_bundle', side_effect=self.extract).start()

    def extract(self, client, request, output, save):
        self.calls += 1
        save('source/native.bin', self.source.read_bytes())
        return {'sourceFiles': [{'path': 'Actor.u', 'bytes': self.source.stat().st_size, 'sha256': profiles.file_hash(self.source)}],
            'profiles': [], 'coverage': {'requestedProfiles': 1}, 'support': profiles.SUPPORT, 'gaps': ['test fixture']}

    def test_cache_replay_and_clean_build_have_identical_products(self):
        first = profiles.migrate_npc_profiles(self.client, recipe(), self.output)
        replay = profiles.migrate_npc_profiles(self.client, recipe(), self.output)
        self.assertFalse(first['cacheHit'])
        self.assertTrue(replay['cacheHit'])
        self.assertEqual(self.calls, 1)
        clean = profiles.migrate_npc_profiles(self.client, recipe(), self.root / 'clean')
        self.assertFalse(clean['cacheHit'])
        self.assertEqual(first['sha256'], clean['sha256'])
        for name in ('manifest.json', 'receipt.json', 'source/native.bin'):
            self.assertEqual((self.output / name).read_bytes(), (self.root / 'clean' / name).read_bytes())

    def test_changed_source_or_tool_pin_rebuilds(self):
        first = profiles.migrate_npc_profiles(self.client, recipe(), self.output)
        self.source.write_bytes(b'changed class defaults')
        second = profiles.migrate_npc_profiles(self.client, recipe(), self.output)
        self.assertFalse(second['cacheHit'])
        self.assertNotEqual(first['sha256'], second['sha256'])
        self.pins['implementation'] = 'new-tool'
        self.assertFalse(profiles.migrate_npc_profiles(self.client, recipe(), self.output)['cacheHit'])
        self.assertEqual(self.calls, 3)

    def test_changed_source_fails_verify_only(self):
        profiles.migrate_npc_profiles(self.client, recipe(), self.output)
        self.source.write_bytes(b'changed source')
        with self.assertRaisesRegex(FormatError, 'source hash'):
            profiles.verify_npc_profiles(self.client, self.output)

    def test_corrupt_payload_is_not_silently_overwritten_on_cache_or_rebuild(self):
        profiles.migrate_npc_profiles(self.client, recipe(), self.output)
        (self.output / 'source/native.bin').write_bytes(b'manual authored edits')
        with self.assertRaisesRegex(FormatError, 'artifact hash'):
            profiles.migrate_npc_profiles(self.client, recipe(), self.output)
        self.pins['implementation'] = 'changed-tool'
        with self.assertRaisesRegex(FormatError, 'modified NPC profile artifact'):
            profiles.migrate_npc_profiles(self.client, recipe(), self.output)
        self.assertEqual((self.output / 'source/native.bin').read_bytes(), b'manual authored edits')

    def test_unowned_output_and_client_overlap_fail(self):
        self.output.mkdir()
        (self.output / 'authored.txt').write_text('preserve me')
        for path in (self.output, self.client / 'generated', self.root):
            with self.subTest(path=path), self.assertRaises(FormatError):
                profiles.migrate_npc_profiles(self.client, recipe(), path)
        self.assertEqual((self.output / 'authored.txt').read_text(), 'preserve me')

    def test_manifest_corruption_is_rejected(self):
        profiles.migrate_npc_profiles(self.client, recipe(), self.output)
        (self.output / 'manifest.json').write_text('{}')
        with self.assertRaises(FormatError):
            profiles.verify_npc_profiles(self.client, self.output)


if __name__ == '__main__':
    unittest.main()
