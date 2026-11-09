import copy
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import native_actor_profiles as profiles
from native_catalog.ue2 import FormatError
from reference_client_lock_fixture import lock_client_as_reference_root


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
        selected = profiles.select_exact_npc_rows_without_mesh_substitution(names, groups, selection)
        self.assertEqual(selected[1][1]['class_name'], 'LineageMonster.field_stalker_20_bi')
        for key, value in [('expectedName', 'Musveren'), ('expectedActorClass', 'LineageMonster.field_stalker'),
                ('expectedMesh', 'LineageMonsters.other'), ('npcId', 123456)]:
            with self.subTest(key=key), self.assertRaises(FormatError):
                profiles.select_exact_npc_rows_without_mesh_substitution(names, groups, dict(selection, **{key: value}))

    def test_duplicate_ids_in_either_table_are_rejected(self):
        for index in range(2):
            values = tables()
            values[index]['data']['npc'].append(copy.deepcopy(values[index]['data']['npc'][1]))
            with self.subTest(index=index), self.assertRaisesRegex(FormatError, 'Duplicate'):
                profiles.select_exact_npc_rows_without_mesh_substitution(*values, recipe()['profiles'][0])

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


class ProfileBoundTests(unittest.TestCase):
    def recipe_with_profiles(self, count):
        value = recipe()
        selection = value['profiles'][0]
        value['profiles'] = [dict(selection, npcId=npc_id) for npc_id in range(1, count + 1)]
        return value

    def test_bounds_are_256_profiles_per_bundle_and_64_bundles(self):
        self.assertEqual((profiles.MAXIMUM_PROFILES_PER_BUNDLE, profiles.MAXIMUM_NPC_PROFILE_BUNDLES), (256, 64))

    def test_recipe_accepts_the_largest_bundle_and_refuses_one_more_or_none(self):
        self.assertEqual(len(profiles._recipe(self.recipe_with_profiles(profiles.MAXIMUM_PROFILES_PER_BUNDLE))['profiles']), 256)
        for count in (profiles.MAXIMUM_PROFILES_PER_BUNDLE + 1, 0):
            with self.subTest(count=count), self.assertRaisesRegex(FormatError, 'requires 1 to 256 explicit profiles'):
                profiles._recipe(self.recipe_with_profiles(count))


class NativeFieldTests(unittest.TestCase):
    def setUp(self):
        self.native = {'DrawScale': 1.2, 'DrawScale3D': {'X': 1, 'Y': 1, 'Z': 1},
            'CollisionRadius': 18, 'CollisionHeight': 36}

    def resolve(self, value):
        return profiles.resolved_profile(recipe()['profiles'][0], {'effectiveProperties': value}, 100, recipe()['profiles'][0]['expectedMesh'])

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
        lock_client_as_reference_root(self, self.client)
        self.source = self.client / 'Actor.u'
        self.source.write_bytes(b'original native class')
        self.output = self.root / 'output'
        self.pins = {'implementation': 'test-fixture'}
        self.calls = 0
        self.addCleanup(patch.stopall)
        patch.object(profiles, 'npc_profile_tool_pins', side_effect=lambda: copy.deepcopy(self.pins)).start()
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


SYNTHETIC_MESH_PACKAGE_PATH = 'animations/LineageMonsters.ukx'
RESOLVED_ACTOR_PROPERTIES = {'DrawScale': 1.0, 'DrawScale3D': {'X': 1.0, 'Y': 1.0, 'Z': 1.0}, 'CollisionRadius': 10.0, 'CollisionHeight': 15.0}


class SyntheticDefaultReader:
    def __init__(self, client, packages, work, save):
        self.definitions = {}
        for qualified_name, parent, properties in (
                ('Core.Object', None, {}), ('Engine.Actor', 'Core.Object', {}),
                ('LineageMonster.resolved', 'Engine.Actor', RESOLVED_ACTOR_PROPERTIES),
                ('LineageMonster.no_height', 'Engine.Actor', {key: value for key, value in RESOLVED_ACTOR_PROPERTIES.items() if key != 'CollisionHeight'})):
            self.definitions[qualified_name.casefold()] = {'object': qualified_name, 'nativeSuperClass': parent, 'effectiveProperties': properties,
                                                           'source': {'package': 'system/LineageMonster.u', 'packageSha256': 'e' * 64}}

    def get(self, reference):
        return self.definitions[reference.casefold()]


def synthetic_source_packages(export_objects):
    exports_by_package = {}
    for export_object in export_objects:
        exports_by_package.setdefault(export_object.split('.')[0].casefold(), []).append({'object': export_object})

    class SyntheticSourcePackages:
        def __init__(self, client):
            pass

        def get(self, package_name):
            return None, SimpleNamespace(exports=exports_by_package.get(package_name.casefold(), []))

        def resolve(self, reference, expected_class):
            _, package = self.get(reference.split('.')[0])
            export = next(item for item in package.exports if item['object'].casefold() == reference.casefold())
            return {'reference': reference, 'object': export['object'], 'resolution': 'exact-qualified-object',
                    'package': SYNTHETIC_MESH_PACKAGE_PATH, 'packageSha256': 'd' * 64}, package, export

    return SyntheticSourcePackages


class SyntheticSourceFile:
    def __init__(self, relative_path, sha256):
        self.relative_path, self.sha256 = relative_path, sha256

    def stat(self):
        return SimpleNamespace(st_size=1)


RESOLVED_PROFILE = {'npcId': 41, 'expectedName': 'Resolved', 'expectedMesh': 'LineageMonsters.resolved_m00',
                    'expectedActorClass': 'LineageMonster.resolved', 'modelCatalogId': 'npc-model:' + 'a' * 64}
NO_HEIGHT_PROFILE = {'npcId': 42, 'expectedName': 'No height', 'expectedMesh': 'LineageMonsters.no_height_m00',
                     'expectedActorClass': 'LineageMonster.no_height', 'modelCatalogId': 'npc-model:' + 'b' * 64}
SYNTHETIC_EXPORT_OBJECTS = ('LineageMonster.resolved', 'LineageMonster.no_height', 'LineageMonsters.resolved_m00', 'LineageMonsters.no_height_m00')


class ExtractBundleTests(unittest.TestCase):
    def extract_bundle(self, recipe_profiles, export_objects=SYNTHETIC_EXPORT_OBJECTS):
        source_sha256s = {'system/npcgrp.dat': 'a' * 64, 'system/npcname-e.dat': 'b' * 64, SYNTHETIC_MESH_PACKAGE_PATH: 'd' * 64,
                          'system/LineageMonster.u': 'e' * 64}
        tables = {'npcgrp': {'source': 'system/npcgrp.dat', 'sourceSha256': 'a' * 64, 'data': {'npc': []}},
                  'npcname': {'source': 'system/npcname-e.dat', 'sourceSha256': 'b' * 64, 'data': {'npc': []}}}
        guard = SimpleNamespace(require_equal_file=lambda relative_path: SyntheticSourceFile(relative_path, source_sha256s[relative_path]))
        recipe = {'schemaVersion': 1, 'id': 'interlude:npc-profiles:pack-0123456789abcdef', 'nameTable': 'npcname-e.dat',
                  'sourceUnitsPerMetre': 100, 'profiles': list(recipe_profiles)}
        saved = {}

        def save(name, data):
            saved[name] = data
            return name

        with patch.object(profiles, 'decode_table', side_effect=lambda client, name, **options: tables[name]), \
                patch.object(profiles, 'SourcePackages', synthetic_source_packages(export_objects)), \
                patch.object(profiles, 'DefaultReader', SyntheticDefaultReader), \
                patch.object(profiles, 'select_exact_npc_rows_without_mesh_substitution', return_value=[(0, {}), (0, {})]), \
                patch.object(profiles, 'audit_selected_row_offsets_and_typed_values', return_value={}), \
                patch.object(profiles, 'require_reference_client', return_value=guard), \
                patch.object(profiles, 'file_hash', side_effect=lambda source_file: source_file.sha256):
            bundle = profiles._extract_bundle(Path('client'), recipe, Path('output'), save)
        return bundle, json.loads(saved['source/npc-selections.json'])['selections']

    def test_a_profile_with_an_unresolved_actor_default_is_left_out_and_listed_in_excluded_profiles(self):
        bundle, _ = self.extract_bundle([RESOLVED_PROFILE, NO_HEIGHT_PROFILE])
        self.assertEqual([profile['npcId'] for profile in bundle['profiles']], [41])
        self.assertEqual(bundle['excludedProfiles'], [{'npcId': 42, 'field': 'CollisionHeight'}])
        self.assertEqual(bundle['unsupported'], [])
        self.assertEqual((bundle['coverage']['requestedProfiles'], bundle['coverage']['resolvedProfiles']), (2, 1))

    def test_a_class_matching_one_export_ignoring_case_records_the_requested_and_the_export_spelling(self):
        requested = dict(RESOLVED_PROFILE, expectedActorClass='LineageMonster.Resolved')
        bundle, selections = self.extract_bundle([requested])
        self.assertEqual(bundle['profiles'][0]['actorClass'], 'LineageMonster.Resolved')
        self.assertEqual(selections[0]['classChain'], ['LineageMonster.resolved', 'Engine.Actor', 'Core.Object'])
        self.assertEqual(selections[0]['qualifiedNameMatches'], {
            'actorClass': {'requested': 'LineageMonster.Resolved', 'export': 'LineageMonster.resolved', 'spelling': 'case-insensitive-spelling'},
            'mesh': {'requested': 'LineageMonsters.resolved_m00', 'export': 'LineageMonsters.resolved_m00', 'spelling': 'exact-spelling'}})

    def test_a_mesh_matching_one_export_ignoring_case_records_both_spellings_in_the_mesh_source(self):
        requested = dict(RESOLVED_PROFILE, expectedMesh='LineageMonsters.Resolved_M00')
        _, selections = self.extract_bundle([requested])
        self.assertEqual((selections[0]['meshSource']['reference'], selections[0]['meshSource']['object']),
                         ('LineageMonsters.Resolved_M00', 'LineageMonsters.resolved_m00'))
        self.assertEqual(selections[0]['qualifiedNameMatches']['mesh']['spelling'], 'case-insensitive-spelling')

    def test_a_mesh_matching_one_export_ignoring_case_gives_the_profile_the_export_spelling_its_model_carries(self):
        bundle, selections = self.extract_bundle([dict(RESOLVED_PROFILE, expectedMesh='LineageMonsters.Resolved_M00')])
        self.assertEqual(bundle['profiles'][0]['mesh'], 'LineageMonsters.resolved_m00')
        self.assertEqual(bundle['profiles'][0]['mesh'], selections[0]['meshSource']['object'])

    def test_a_class_matching_two_exports_ignoring_case_refuses_the_bundle(self):
        with self.assertRaisesRegex(FormatError, 'Qualified name matches two or more exports ignoring case: LineageMonster.resolved matches '
                                                 'LineageMonster.RESOLVED and LineageMonster.resolved'):
            self.extract_bundle([RESOLVED_PROFILE], (*SYNTHETIC_EXPORT_OBJECTS, 'LineageMonster.RESOLVED'))

    def test_a_mesh_matching_no_export_refuses_the_bundle(self):
        with self.assertRaisesRegex(FormatError, profiles.UNMATCHED_NPC_MESH_MESSAGE):
            self.extract_bundle([RESOLVED_PROFILE], ('LineageMonster.resolved',))


if __name__ == '__main__':
    unittest.main()
