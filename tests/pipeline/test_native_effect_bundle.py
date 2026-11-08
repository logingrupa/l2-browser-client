import copy
import json
import hashlib
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import native_effect_bundle as bundle
from native_catalog.ue2 import FormatError
from reference_client_lock_fixture import lock_client_as_reference_root


def recipe():
    return {'schemaVersion': 1, 'id': 'interlude:skill:3:raw-candidate', 'skillId': 3, 'level': 1,
        'effectClasses': [{'object': 'Effects.Power', 'packageSha256': 'a' * 64}]}


def one_section_pe_with_offset_virtual_addresses_and_skill_three_selected_by_third_byte():
    image = bytearray(0x800)
    image[:2] = b'MZ'
    struct.pack_into('<I', image, 0x3c, 0x80)
    image[0x80:0x84] = b'PE\0\0'
    struct.pack_into('<HH', image, 0x84, 0x14c, 1)
    struct.pack_into('<H', image, 0x94, 0xe0)
    struct.pack_into('<H', image, 0x98, 0x10b)
    struct.pack_into('<I', image, 0xb4, 0x10000000)
    struct.pack_into('<IIII', image, 0x180, 0x600, 0x1000, 0x600, 0x200)
    image[0x210:0x21e] = bytes.fromhex('0fb68000110010ff248520110010')
    image[0x300:0x303] = bytes([7, 8, 2])
    image[0x328:0x32c] = bytes.fromhex('00120010')
    image[0x404:0x409] = bytes.fromhex('6800130010')
    literal = 'Effects.Power\0'.encode('utf-16-le')
    image[0x500:0x500 + len(literal)] = literal
    return image


class BindingTests(unittest.TestCase):
    def test_empty_description_is_preserved_without_inventing_skill_join(self):
        skill = {'skill_id': 3, 'skill_level': 1, 'description': '', 'animation': 'S', 'hit_time': 1.08}
        sound = {'skill_id': 3, 'skill_level': 1, 'sound': 'Skills.Power'}
        selected = bundle.select_exact_skill_and_sound_rows({'data': {'skill': [skill]}}, {'data': {'skillsound': [sound]}}, 3, 1)
        self.assertEqual(selected, (skill, sound))
        class Packages:
            def resolve(self, reference, expected):
                return {'object': reference, 'packageSha256': 'a' * 64}, None, None
        root, stages, _, _, associations = bundle.select_effect_roots(Packages(), recipe(), selected[0])
        self.assertIsNone(root)
        self.assertEqual(stages, [])
        self.assertEqual(associations[0]['status'], 'candidate-unverified')
        self.assertEqual(selected[0]['animation'], 'S')

    def test_candidate_package_pin_is_enforced(self):
        class Packages:
            def resolve(self, reference, expected):
                return {'object': reference, 'packageSha256': 'b' * 64}, None, None
        with self.assertRaisesRegex(FormatError, 'differs from recipe pin'):
            bundle.select_effect_roots(Packages(), recipe(), {'description': ''})

    def test_verified_association_requires_native_description_action_chain(self):
        class Packages:
            def resolve(self, reference, expected):
                return {'object': reference, 'packageSha256': 'a' * 64}, 'package', 'item'
        stages = [{'object': 'Effects.Action', 'properties': {'EffectClass': {'class': 'Class', 'object': 'Effects.Power'}}}]
        with patch.object(bundle, 'skill_actions', return_value=(stages, [])):
            root, actions, _, _, associations = bundle.select_effect_roots(Packages(), recipe(), {'description': 'Effects.Skill3'})
        self.assertEqual(root['object'], 'Effects.Skill3')
        self.assertEqual(actions[0]['effectObject'], 'Effects.Power')
        self.assertEqual(associations[0]['status'], 'verified-native-description-action')

    def test_missing_level_and_ambiguous_skill_rows_never_fall_back(self):
        skill = {'skill_id': 3, 'skill_level': 1, 'description': ''}
        for rows, level in (([skill], 2), ([skill, skill], 1)):
            with self.subTest(rows=len(rows), level=level), self.assertRaises(FormatError):
                bundle.select_exact_skill_and_sound_rows({'data': {'skill': rows}}, {'data': {'skillsound': [skill]}}, 3, level)

    def test_recipe_cannot_assert_a_verified_binding_or_hide_duplicate_candidates(self):
        malformed = recipe()
        malformed['effectClasses'][0]['verified'] = True
        with self.assertRaises(FormatError):
            bundle._recipe(malformed)
        malformed = recipe()
        malformed['effectClasses'].append(dict(malformed['effectClasses'][0], object='effects.power'))
        with self.assertRaises(FormatError):
            bundle._recipe(malformed)


class SourceDispatchTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.client = Path(self.directory.name)
        self.binary = self.client / 'system/Engine.dll'
        self.binary.parent.mkdir()
        image = one_section_pe_with_offset_virtual_addresses_and_skill_three_selected_by_third_byte()
        self.binary.write_bytes(image)
        lock_client_as_reference_root(self, self.client)
        self.effect = {'object': 'Effects.Power', 'nativeSuperClass': 'Engine.Emitter',
            'properties': {'DrawScale': 0.05, 'AutoReplay': True, 'bUseDynamicLights': False},
            'children': [{'name': 'MeshEmitter2', 'class': 'Engine.MeshEmitter', 'properties': {'MaxParticles': 1}}]}
        self.recipe = recipe()
        self.recipe['sourceDispatch'] = {'binary': {'path': 'system/Engine.dll', 'bytes': len(image),
            'sha256': hashlib.sha256(image).hexdigest()}, 'bindings': [{
                'stage': 'init', 'effectObject': 'Effects.Power', 'switchVA': '0x10001010',
                'selectorBase': '0x10001100', 'targetTable': '0x10001120', 'caseIndex': 2,
                'caseVA': '0x10001200', 'classPushVA': '0x10001204', 'classLiteralVA': '0x10001300',
                'nativeSuperClass': 'Engine.Emitter', 'authoredPropertiesSha256': bundle.digest(self.effect['properties']),
                'emittersSha256': bundle.digest(self.effect['children'])}],
            'reviewedObservations': {'attachment': 'Reviewed separately; runtime unverified'},
            'evidence': ['Standalone reviewed fixture'], 'limitations': ['No execution or visual validation']}

    def test_checked_binary_binding_preserves_empty_table_and_only_certifies_source(self):
        validated = bundle.validate_source_dispatch(self.client, bundle._recipe(self.recipe))
        bundle.validate_dispatch_defaults(validated, [self.effect])
        self.assertEqual(len(validated['checks']), 5)
        self.assertEqual(validated['reviewedObservations'], self.recipe['sourceDispatch']['reviewedObservations'])
        class Packages:
            def resolve(self, reference, expected):
                return {'object': reference, 'packageSha256': 'a' * 64}, None, None
        skill = {'description': '', 'animation': 'S'}
        root, actions, _, records, associations = bundle.select_effect_roots(Packages(), self.recipe, skill, validated)
        self.assertIsNone(root)
        self.assertEqual(actions, [])
        self.assertEqual(skill, {'description': '', 'animation': 'S'})
        self.assertEqual(records[0]['object'], 'Effects.Power')
        self.assertEqual(associations[0]['status'], 'verified-reviewed-native-dispatch')
        self.assertEqual(associations[0]['dispatchStages'], ['init'])
        associations_from_recipe_assertions_alone = bundle.select_effect_roots(Packages(), self.recipe, skill)[4]
        self.assertEqual(associations_from_recipe_assertions_alone[0]['status'], 'candidate-unverified')

    def test_changed_or_missing_source_binary_is_rejected(self):
        self.binary.write_bytes(self.binary.read_bytes() + b'changed')
        with self.assertRaisesRegex(FormatError, 'source hash/size mismatch'):
            bundle.validate_source_dispatch(self.client, self.recipe)
        self.binary.unlink()
        with self.assertRaisesRegex(FormatError, 'source hash/size mismatch'):
            bundle.validate_source_dispatch(self.client, self.recipe)

    def test_mismatched_switch_selector_target_push_and_literal_are_rejected(self):
        original = self.binary.read_bytes()
        for offset, label in ((0x210, 'switch'), (0x302, 'skill-selector'), (0x328, 'case-target'),
                (0x404, 'class-push'), (0x500, 'class-literal')):
            with self.subTest(check=label):
                changed = bytearray(original)
                changed[offset] ^= 1
                self.binary.write_bytes(changed)
                request = copy.deepcopy(self.recipe)
                request['sourceDispatch']['binary']['sha256'] = hashlib.sha256(changed).hexdigest()
                with self.assertRaisesRegex(FormatError, '/' + label):
                    bundle.validate_source_dispatch(self.client, request)

    def test_wrong_skill_id_cannot_reuse_another_skill_selector(self):
        request = copy.deepcopy(self.recipe)
        request['skillId'] = 2
        with self.assertRaisesRegex(FormatError, 'skill-selector'):
            bundle.validate_source_dispatch(self.client, request)

    def test_changed_actor_defaults_emitters_or_superclass_cannot_substitute_a_candidate(self):
        variants = [copy.deepcopy(self.effect) for _ in range(3)]
        variants[0]['properties']['AutoReplay'] = False
        variants[1]['children'][0]['properties']['MaxParticles'] = 2
        variants[2]['nativeSuperClass'] = 'Effects.OldCandidate'
        for effect in variants:
            with self.subTest(effect=effect), self.assertRaisesRegex(FormatError, 'authored defaults differ'):
                bundle.validate_dispatch_defaults(self.recipe['sourceDispatch'], [effect])
        unchanged = copy.deepcopy(self.effect)
        bundle.validate_dispatch_defaults(self.recipe['sourceDispatch'], [self.effect])
        self.assertEqual(self.effect, unchanged)

    def test_dispatch_schema_rejects_undeclared_classes_duplicate_stages_and_path_escape(self):
        wrong_class, duplicate, escape, asserted = [copy.deepcopy(self.recipe) for _ in range(4)]
        wrong_class['sourceDispatch']['bindings'][0]['effectObject'] = 'Effects.Other'
        duplicate['sourceDispatch']['bindings'] *= 2
        escape['sourceDispatch']['binary']['path'] = '../Engine.dll'
        asserted['sourceDispatch']['verified'] = True
        for request in (wrong_class, duplicate, escape, asserted):
            with self.subTest(request=request), self.assertRaises((FormatError, ValueError)):
                bundle._recipe(request)

    def test_pe_reader_rejects_truncated_non_pe_and_unbacked_addresses(self):
        for data in (b'MZ', b'not a PE image' * 40):
            with self.subTest(data=data[:20]), self.assertRaises(FormatError):
                bundle._pe32_file_section_reader(data)
        read = bundle._pe32_file_section_reader(self.binary.read_bytes())
        with self.assertRaisesRegex(FormatError, 'not uniquely file-backed'):
            read(0x10001600, 1)

    def test_power_strike_recipe_retains_both_exact_dispatch_classes(self):
        request = bundle._recipe(json.loads((ROOT / 'recipes/native-power-strike.json').read_text()))
        self.assertEqual([item['object'] for item in request['effectClasses']],
            ['LineageEffect.s_u002_a', 'LineageEffect.p_u004_a'])
        self.assertEqual([(item['stage'], item['effectObject'], item['nativeSuperClass'])
            for item in request['sourceDispatch']['bindings']], [
                ('init', 'LineageEffect.s_u002_a', 'Engine.Emitter'),
                ('shot', 'LineageEffect.p_u004_a', 'Engine.Emitter')])
        observations = request['sourceDispatch']['reviewedObservations']
        self.assertEqual(observations['shot']['conditions'],
            ['PendingNotify == 2', 'target exists, or nonempty associated-actor branch'])
        self.assertNotIn('runtimeSkillHitTime', observations)


class InheritanceTests(unittest.TestCase):
    def test_raw_struct_overlay_does_not_claim_inherited_decoded_components(self):
        inherited = {'Material': {'MipZero': {'R': 64, 'G': 128, 'B': 64, 'A': 0},
            'DetailScale': 1.0}, 'Vector': {'X': 1, 'Y': 2}}
        raw = {'unparsedHex': '808080ff', 'type': 10, 'struct': 'Color'}
        authored = {'Material': {'MipZero': raw}, 'Vector': {'X': 9}}
        originals = copy.deepcopy((inherited, authored))
        merged = bundle.merge_typed_defaults_replacing_raw_values_whole(inherited, authored)
        self.assertEqual(merged, {'Material': {'MipZero': raw, 'DetailScale': 1.0},
            'Vector': {'X': 9, 'Y': 2}})
        self.assertEqual((inherited, authored), originals)
        merged['Material']['MipZero']['unparsedHex'] = 'changed'
        self.assertEqual(authored['Material']['MipZero']['unparsedHex'], '808080ff')

    def test_typed_overlay_replaces_opaque_base_without_retaining_its_bytes(self):
        inherited = {'Color': {'unparsedHex': '808080ff', 'type': 10, 'struct': 'Color'}}
        self.assertEqual(bundle.merge_typed_defaults_replacing_raw_values_whole(inherited, {'Color': {'R': 128}}),
            {'Color': {'R': 128}})

    def test_fixed_property_array_preserves_implicit_zero_and_explicit_later_index(self):
        tags = [dict(name='Sequence', type=2, arrayIndex=None, value=7, status='decoded'),
            dict(name='Sequence', type=2, arrayIndex=2, value=9, status='decoded'),
            dict(name='DrawStyle', type=2, arrayIndex=None, value=6, status='decoded')]
        original = copy.deepcopy(tags)
        self.assertEqual(bundle.object_values(None, tags), {'Sequence': [7, None, 9], 'DrawStyle': 6})
        self.assertEqual(tags, original)

    def test_ambiguous_duplicate_property_is_not_silently_overwritten(self):
        tag = dict(name='DrawStyle', type=2, arrayIndex=None, value=6, status='decoded')
        with self.assertRaisesRegex(FormatError, 'Duplicate native property path'):
            bundle.object_values(None, [tag, dict(tag, value=2)])

    def test_superclass_comes_from_export_table_and_merges_struct_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            class Package:
                data = b'native'
                def object_name(self, index):
                    return 'Custom.Parent' if index else None
            class Packages:
                def resolve(self, reference, expected):
                    return {'object': reference}, Package(), {'superIndex': int(reference != 'Custom.Parent'), 'offset': 0, 'size': 6}
            def read_defaults(client, reference, work, **kwargs):
                work.mkdir(parents=True)
                (work / 'class.uc').write_text('native decompiler source', encoding='utf-8')
                parent = reference == 'Custom.Parent'
                return {'object': reference, 'superClass': None if parent else 'Parent',
                    'properties': {'Vector': {'X': 1, 'Y': 2}, 'DrawStyle': 6} if parent else {'Vector': {'X': 9}},
                    'sourceScript': 'class.uc'}
            with patch.object(bundle, 'read_class_defaults', side_effect=read_defaults):
                reader = bundle.DefaultReader(root, Packages(), root / 'work', lambda name, data: name)
                result = reader.get('Custom.Child')
            self.assertEqual(result['nativeSuperClass'], 'Custom.Parent')
            self.assertEqual(result['effectiveProperties'], {'Vector': {'X': 9, 'Y': 2}, 'DrawStyle': 6})
            self.assertEqual(result['properties'], {'Vector': {'X': 9}})

    def test_inheritance_cycle_is_rejected_before_unbounded_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            class Package:
                data = b'x'
                def object_name(self, index):
                    return 'Custom.A'
            class Packages:
                def resolve(self, reference, expected):
                    return {'object': reference}, Package(), {'superIndex': 1, 'offset': 0, 'size': 1}
            definition = {'object': 'Custom.A', 'superClass': 'A', 'properties': {}, 'sourceScript': 'unused.uc'}
            with patch.object(bundle, 'read_class_defaults', return_value=definition):
                with self.assertRaisesRegex(FormatError, 'Cyclic'):
                    bundle.DefaultReader(root, Packages(), root / 'work', lambda name, data: name).get('Custom.A')


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.client = self.root / 'client'
        self.client.mkdir()
        lock_client_as_reference_root(self, self.client)
        self.source = self.client / 'native.u'
        self.source.write_bytes(b'original native data')
        self.output = self.root / 'output'
        self.pins = {'effectBundleSha256': 'test-implementation', 'tool': 'pinned-fixture'}
        self.calls = 0
        self.addCleanup(patch.stopall)
        patch.object(bundle, '_tool_pins', side_effect=lambda: copy.deepcopy(self.pins)).start()
        patch.object(bundle, '_extract_bundle', side_effect=self.extract).start()

    def extract(self, client, request, output, save):
        self.calls += 1
        save('source/raw.bin', self.source.read_bytes())
        save('effect-source.json', bundle.json_bytes({'nativeRecipe': request, 'unsupportedRuntime': True}))
        return {'sourceFiles': [{'path': 'native.u', 'bytes': self.source.stat().st_size,
            'sha256': bundle.file_hash(self.source)}], 'support': {'runtimeImplemented': False},
            'gaps': [{'feature': 'native-dispatch'}], 'assets': []}

    def test_unchanged_bundle_skips_extraction_and_source_changes_rebuild(self):
        first = bundle.migrate_effect_bundle(self.client, recipe(), self.output)
        self.assertFalse(first['cacheHit'])
        self.assertTrue(bundle.migrate_effect_bundle(self.client, recipe(), self.output)['cacheHit'])
        self.assertEqual(self.calls, 1)
        self.source.write_bytes(b'changed native data')
        changed = bundle.migrate_effect_bundle(self.client, recipe(), self.output)
        self.assertFalse(changed['cacheHit'])
        self.assertNotEqual(first['sha256'], changed['sha256'])
        self.assertEqual(self.calls, 2)
        self.assertEqual(self.source.read_bytes(), b'changed native data')

    def test_corrupt_payload_is_rejected_instead_of_silently_reusing_or_overwriting(self):
        bundle.migrate_effect_bundle(self.client, recipe(), self.output)
        (self.output / 'source/raw.bin').write_bytes(b'damaged')
        with self.assertRaisesRegex(FormatError, 'artifact hash/size mismatch'):
            bundle.verify_effect_bundle(self.client, self.output)
        with self.assertRaisesRegex(FormatError, 'artifact hash/size mismatch'):
            bundle.migrate_effect_bundle(self.client, recipe(), self.output)
        self.assertEqual(self.calls, 1)

    def test_clean_builds_are_byte_identical_across_output_paths(self):
        bundle.migrate_effect_bundle(self.client, recipe(), self.output)
        alternate = self.root / 'clean-other-path'
        bundle.migrate_effect_bundle(self.client, recipe(), alternate)
        for name in ('manifest.json', 'receipt.json', 'effect-source.json', 'source/raw.bin'):
            self.assertEqual((self.output / name).read_bytes(), (alternate / name).read_bytes())
        manifest = (self.output / 'manifest.json').read_text(encoding='utf-8')
        self.assertNotIn(str(self.root).replace('\\', '\\\\'), manifest)
        self.assertNotIn('cacheHit', manifest)

    def test_recipe_and_tool_changes_invalidate_cache(self):
        bundle.migrate_effect_bundle(self.client, recipe(), self.output)
        revised = dict(recipe(), notes=['explicit candidate, still unverified'])
        self.assertFalse(bundle.migrate_effect_bundle(self.client, revised, self.output)['cacheHit'])
        self.pins['tool'] = 'another pinned fixture'
        self.assertFalse(bundle.migrate_effect_bundle(self.client, revised, self.output)['cacheHit'])
        self.assertEqual(self.calls, 3)

    def test_manifest_corruption_and_path_escape_are_rejected(self):
        bundle.migrate_effect_bundle(self.client, recipe(), self.output)
        manifest_path = self.output / 'manifest.json'
        manifest = json.loads(manifest_path.read_text())
        manifest['files'][0]['file'] = '../outside'
        manifest_path.write_bytes(bundle.json_bytes(manifest))
        with self.assertRaisesRegex(FormatError, 'manifest hash mismatch'):
            bundle.verify_effect_bundle(self.client, self.output)
        receipt_path = self.output / 'receipt.json'
        receipt = json.loads(receipt_path.read_text())
        receipt['manifestSha256'] = bundle.file_hash(manifest_path)
        receipt['files'] = manifest['files']
        receipt_path.write_bytes(bundle.json_bytes(receipt))
        with self.assertRaisesRegex(ValueError, 'Unsafe asset path'):
            bundle.verify_effect_bundle(self.client, self.output)

    def test_output_inside_read_only_source_is_rejected(self):
        with self.assertRaisesRegex(FormatError, 'outside'):
            bundle.migrate_effect_bundle(self.client, recipe(), self.client / 'forbidden')
        self.assertFalse((self.client / 'forbidden').exists())

    def test_source_parent_and_nonempty_unowned_output_are_rejected(self):
        with self.assertRaisesRegex(FormatError, 'outside'):
            bundle.migrate_effect_bundle(self.client, recipe(), self.root)
        self.output.mkdir()
        (self.output / 'authored.txt').write_bytes(b'preserve')
        with self.assertRaisesRegex(FormatError, 'nonempty unowned'):
            bundle.migrate_effect_bundle(self.client, recipe(), self.output)
        self.assertEqual((self.output / 'authored.txt').read_bytes(), b'preserve')
        self.assertFalse((self.output / 'receipt.json').exists())

    def test_rebuild_refuses_to_overwrite_manual_changes_to_generated_artifact(self):
        bundle.migrate_effect_bundle(self.client, recipe(), self.output)
        authored = self.output / 'source/raw.bin'
        authored.write_bytes(b'authored-change')
        self.source.write_bytes(b'source-changed')
        with self.assertRaisesRegex(FormatError, 'unowned or modified'):
            bundle.migrate_effect_bundle(self.client, recipe(), self.output)
        self.assertEqual(authored.read_bytes(), b'authored-change')


if __name__ == '__main__':
    unittest.main()
