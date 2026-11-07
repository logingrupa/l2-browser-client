"""Selected skill dependencies: hostile/stale inputs and source preservation.
Synthetic archives only; no real conversion, decoder, browser or native code.
"""
import copy
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import wave

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets import archive_bytes
from native_assets_lib.gltf import json_bytes
from native_assets_lib import skill_audio_bundle as subject


def snapshot(root):
    return {p.relative_to(root).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
            for p in root.rglob('*') if p.is_file()}


class SkillAudioTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='skill-audio-')
        self.addCleanup(temporary.cleanup); self.root = Path(temporary.name)
        self.output = self.root / 'artifacts/bundle'
        stream = io.BytesIO()
        with wave.open(stream, 'wb') as writer:
            writer.setnchannels(2); writer.setsampwidth(2); writer.setframerate(22050); writer.writeframes(b'\x01\x00\x02\x00' * 4)
        self.wav = stream.getvalue(); self.package_hash = subject.digest(b'synthetic-original-package')
        self.inventory = {'kind': 'native-staged-sound-inventory', 'sounds': []}
        self.coverage = {'kind': 'native-staged-sound-coverage', 'sounds': []}
        self.add_sound('skillsound.Group.Test', 7)
        self.row = {'skill_id': 7, 'skill_level': 1}
        self.row.update({name: '' for name in subject.REFERENCE_FIELDS})
        self.row.update({name: 0.0 for name in subject.NUMERIC_FIELDS})
        self.row.update(spelleffect_sound_1='SkillSound.Test', spelleffect_sound_vol_1=12.125, spelleffect_sound_rad_1=0.0)
        self.sound_rows = [dict(self.row, skill_id=99), copy.deepcopy(self.row), dict(self.row, skill_id=100), copy.deepcopy(self.row)]
        self.skill_rows = [{'skill_id': 99, 'skill_level': 1}, {'skill_id': 7, 'skill_level': 1, 'description': '', 'hit_time': 1.08}]
        self.recipe = {'schemaVersion': 1, 'kind': 'native-skill-audio-bundle', 'referencePolicy': copy.deepcopy(subject.POLICY),
            'selections': [{'skillId': 7, 'level': 1}], 'tables': {}, 'corpus': {'root': 'inputs/corpus'}}
        self.save()

    def write(self, name, data):
        path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
        return {'path': name, 'bytes': len(data), 'sha256': subject.digest(data)}

    def add_sound(self, object_name, export_index):
        prefix = f'cache/{export_index}'; stable = f'FIXTURE:{self.package_hash}:{export_index}'
        asset = {'schemaVersion': 1, 'kind': 'audio', 'id': 'interlude:' + object_name,
            'source': {'edition': 'interlude', 'object': object_name, 'sha256': self.package_hash}, 'audio': {'file': 'audio.wav'}, 'animationEvents': []}
        payloads = {'audio.wav': self.wav, 'provenance.json': json_bytes({'metadata': {'nativeExportIndex': export_index,
            'nativePayloadSha256': subject.digest(self.wav), 'encodedAudioUnchanged': True}})}
        asset['files'] = [{'path': name, 'bytes': len(data), 'sha256': subject.digest(data)} for name, data in payloads.items()]
        archive = self.write('inputs/corpus/' + prefix + '/asset.l2asset', archive_bytes(asset, payloads))
        audio = self.write('inputs/corpus/' + prefix + '/audio.wav', self.wav)
        native = self.write(f'inputs/corpus/source/{export_index}.bin', self.wav)
        self.inventory['sounds'].append({'stableId': stable, 'status': 'source-ready', 'id': asset['id'],
            'export': {'object': object_name, 'classObject': 'Engine.Sound', 'exportIndex': export_index},
            'sourcePackage': {'sha256': self.package_hash, 'relativePath': 'sounds/skillsound.uax'},
            'nativePayload': {**native, 'path': f'source/{export_index}.bin'},
            'nativeSound': {'exportIndex': export_index, 'embeddedPayloadSha256': subject.digest(self.wav)},
            'serializedExport': {'offsetUnwrapped': export_index * 1000}})
        self.coverage['sounds'].append({'stableId': stable, 'status': 'exported-and-verified', 'products': {
            'archive': {**archive, 'path': prefix + '/asset.l2asset'}, 'audio': {**audio, 'path': prefix + '/audio.wav'}}})

    def save(self):
        for name, collection, rows in [('skillgrp', 'skill', self.skill_rows), ('skillsoundgrp', 'skillsound', self.sound_rows)]:
            original = self.write('inputs/system/' + name + '.dat', b'synthetic original ' + name.encode())
            table = {'schemaVersion': 1, 'edition': 'interlude', 'source': 'system/' + name + '.dat', 'sourceSha256': original['sha256'],
                'decodedSha256': subject.digest(json_bytes(rows)), 'schema': {'fixture': True}, 'formatDefinitionPins': {},
                'data': {'data': len(rows), collection: rows}}
            self.recipe['tables'][name] = {'original': original, 'decoded': self.write('inputs/' + name + '.json', json_bytes(table))}
        inventory = self.write('inputs/corpus/inventory.json', json_bytes(self.inventory))
        self.coverage['inventorySha256'] = inventory['sha256']
        coverage = self.write('inputs/corpus/coverage.json', json_bytes(self.coverage))
        self.recipe['corpus'].update(inventory=inventory, coverage=coverage)
        self.write('recipes/skill.json', json_bytes(self.recipe))

    def run_bundle(self, **kwargs):
        return subject.run(self.root, self.root / 'recipes/skill.json', self.output, **kwargs)

    def manifest(self):
        self.run_bundle(); return json.loads((self.output / 'manifest.json').read_bytes())

    def fails_read_only(self, pattern, **kwargs):
        before = snapshot(self.root)
        with self.assertRaisesRegex((ValueError, KeyError, OSError), pattern): self.run_bundle(**kwargs)
        self.assertEqual(snapshot(self.root), before)

    def field(self, manifest, name, index=0):
        return next(row for row in manifest['soundRows'][index]['referenceFields'] if row['field'] == name)

    def test_plan_is_write_free_and_verifies_inputs(self):
        before = snapshot(self.root); result = self.run_bundle(plan=True)
        self.assertEqual((result['status'], result['filesWritten']), ('planned', 0)); self.assertEqual(snapshot(self.root), before)

    def test_global_interleaving_duplicate_raw_rows_casing_and_values_survive(self):
        before = snapshot(self.root / 'inputs'); manifest = self.manifest()
        self.assertEqual([row['globalRowOrdinal'] for row in manifest['soundRows']], [1, 3])
        self.assertEqual(manifest['soundRows'][0]['raw'], self.row)
        self.assertEqual(manifest['soundRows'][1]['raw'], self.row)
        source = json.loads((self.root / 'inputs/skillsoundgrp.json').read_bytes())['data']['skillsound'][1]
        self.assertEqual(manifest['soundRows'][0]['rawFieldOrder'], list(source))
        self.assertEqual(manifest['selections'][0]['soundStatus'], 'duplicate-rows-retained')
        self.assertEqual(self.field(manifest, 'spelleffect_sound_1')['rawReference'], 'SkillSound.Test')
        self.assertEqual(manifest['soundRows'][0]['raw']['spelleffect_sound_vol_1'], 12.125)
        self.assertEqual(manifest['soundRows'][0]['raw']['spelleffect_sound_rad_1'], 0)
        self.assertEqual(snapshot(self.root / 'inputs'), before)

    def test_original_candidate_wav_is_stereo_and_unchanged(self):
        manifest = self.manifest(); self.assertEqual(len(manifest['sounds']), 1)
        sound = manifest['sounds'][0]; self.assertEqual((self.output / sound['file']).read_bytes(), self.wav)
        self.assertFalse(sound['nativeLookupVerified'])
        self.assertNotIn('authoredReference', sound['provenance'])
        self.assertEqual(sound['provenance']['kind'], 'retained-uax-candidate-export-identity')

    def test_all_thirty_voice_fields_are_retained_without_policy(self):
        voices = subject.CAST_VOICES + subject.THROW_VOICES
        for row in self.sound_rows:
            for i, field in enumerate(voices): row[field] = f'Voices.Original_{i}'
        self.save(); manifest = self.manifest()
        self.assertEqual(len(voices), 30)
        self.assertEqual([self.field(manifest, field)['rawReference'] for field in voices], [f'Voices.Original_{i}' for i in range(30)])
        self.assertFalse(manifest['runtime']['nativeDispatchVerified'])

    def test_empty_null_omitted_and_literal_none_are_distinct(self):
        for row in self.sound_rows:
            row['spelleffect_sound_1'] = ''; row['spelleffect_sound_2'] = None
            del row['spelleffect_sound_3']; row['shoteffect_sound_1'] = 'None'
        self.save(); manifest = self.manifest()
        self.assertEqual([self.field(manifest, name)['status'] for name in ['spelleffect_sound_1','spelleffect_sound_2','spelleffect_sound_3','shoteffect_sound_1']], ['empty','null','omitted','unsupported-reference'])
        self.assertNotIn('rawReference', self.field(manifest, 'spelleffect_sound_3'))
        self.assertIsNone(self.field(manifest, 'spelleffect_sound_2')['rawReference'])

    def test_leaf_ambiguity_retains_both_candidates_and_selects_neither(self):
        self.add_sound('skillsound.Other.Test', 8); self.save(); manifest = self.manifest()
        field = self.field(manifest, 'spelleffect_sound_1')
        self.assertEqual(field['status'], 'ambiguous-package-leaf-candidates')
        self.assertEqual([row['object'] for row in field['candidates']], ['skillsound.Group.Test', 'skillsound.Other.Test'])
        self.assertNotIn('selectedCandidate', field); self.assertFalse(field['nativeLookupVerified'])
        self.assertEqual((manifest['coverage']['dependencies'], manifest['coverage']['wavFiles']), (2, 1))

    def test_exact_casefold_identity_does_not_lowercase_raw_string(self):
        for row in self.sound_rows: row['spelleffect_sound_1'] = 'SkillSound.gROUP.tEST'
        self.add_sound('skillsound.Other.Test', 8); self.save(); manifest = self.manifest()
        field = self.field(manifest, 'spelleffect_sound_1')
        self.assertEqual(field['status'], 'exact-identity'); self.assertEqual(len(field['candidates']), 1)
        self.assertEqual(field['rawReference'], 'SkillSound.gROUP.tEST')

    def test_no_cross_package_leaf_fallback_or_whitespace_normalization(self):
        for row in self.sound_rows:
            row['spelleffect_sound_1'] = 'OtherSound.Test'; row['spelleffect_sound_2'] = ' SkillSound.Test '
        self.save(); manifest = self.manifest()
        self.assertEqual(self.field(manifest, 'spelleffect_sound_1')['status'], 'no-package-leaf-candidate-in-inventory')
        self.assertEqual(self.field(manifest, 'spelleffect_sound_2')['status'], 'unsupported-reference')
        self.assertEqual(manifest['sounds'], [])

    def test_qualified_missing_group_does_not_fallback_to_leaf(self):
        for row in self.sound_rows: row['spelleffect_sound_1'] = 'SkillSound.Absent.Test'
        self.save(); manifest = self.manifest()
        self.assertEqual(self.field(manifest, 'spelleffect_sound_1')['status'], 'no-exact-identity-in-inventory')

    def test_missing_level_does_not_inherit_level_one(self):
        self.recipe['selections'] = [{'skillId': 7, 'level': 2}]; self.save(); manifest = self.manifest()
        self.assertEqual(manifest['soundRows'], []); self.assertEqual(manifest['skillRows'], [])
        self.assertEqual(manifest['selections'][0]['soundStatus'], 'missing-exact-row')

    def test_existing_candidate_without_product_is_explicit(self):
        self.coverage['sounds'] = []; self.save(); manifest = self.manifest()
        field = self.field(manifest, 'spelleffect_sound_1')
        self.assertEqual(field['status'], 'unique-package-leaf-candidate')
        self.assertEqual(field['candidates'][0]['productStatus'], 'no-coverage-record')
        self.assertIsNone(field['candidates'][0]['dependencyId']); self.assertEqual(manifest['sounds'], [])

    def test_unverified_product_is_not_silently_used(self):
        self.coverage['sounds'][0]['status'] = 'unsupported-source-record'; self.save(); manifest = self.manifest()
        self.assertEqual(self.field(manifest, 'spelleffect_sound_1')['candidates'][0]['productStatus'], 'not-verified-export')
        self.assertEqual(manifest['sounds'], [])

    def test_repeat_verify_and_plan_preserve_all_bytes_and_mtimes(self):
        self.run_bundle(); before = snapshot(self.root)
        self.assertEqual(self.run_bundle()['status'], 'preserved')
        self.assertEqual(self.run_bundle(verify_only=True)['status'], 'verified')
        self.assertEqual(self.run_bundle(plan=True)['status'], 'planned')
        self.assertEqual(snapshot(self.root), before)

    def test_verify_refuses_missing_output(self): self.fails_read_only('requires a complete', verify_only=True)
    def test_stale_decoded_table_pin(self):
        (self.root / 'inputs/skillsoundgrp.json').write_bytes(b'{}'); self.fails_read_only('Input hash differs')
    def test_stale_original_dat_pin(self):
        (self.root / 'inputs/system/skillgrp.dat').write_bytes(b'changed'); self.fails_read_only('Input hash differs')
    def test_stale_wav_pin(self):
        (self.root / 'inputs/corpus/cache/7/audio.wav').write_bytes(self.wav+b'x'); self.fails_read_only('Input hash differs')
    def test_stale_archive_pin(self):
        (self.root / 'inputs/corpus/cache/7/asset.l2asset').write_bytes(b'changed'); self.fails_read_only('Input hash differs')
    def test_stale_native_payload_pin(self):
        (self.root / 'inputs/corpus/source/7.bin').write_bytes(b'changed'); self.fails_read_only('Input hash differs')
    def test_duplicate_selection_refused(self):
        self.recipe['selections'] *= 2; self.save(); self.fails_read_only('Duplicate recipe selection')
    def test_corpus_coverage_join_refused(self):
        self.coverage['inventorySha256'] = '0'*64
        self.recipe['corpus']['coverage'] = self.write('inputs/corpus/coverage.json', json_bytes(self.coverage))
        self.write('recipes/skill.json', json_bytes(self.recipe)); self.fails_read_only('inventory/coverage join')
    def test_no_lookup_policy_promotion(self):
        self.recipe['referencePolicy']['nativeLookupVerified'] = True; self.save(); self.fails_read_only('candidate-only policy')
    def test_invalid_reference_type_refused(self):
        self.sound_rows[1]['spelleffect_sound_1'] = 123; self.save(); self.fails_read_only('string or explicit null')
    def test_invalid_numeric_field_refused(self):
        self.sound_rows[1]['cast_volume'] = '250'; self.save(); self.fails_read_only('numeric field')
    def test_unknown_extra_raw_fields_are_retained(self):
        self.sound_rows[1]['future_raw_field'] = {'values': [1, None, '']}; self.save()
        self.assertEqual(self.manifest()['soundRows'][0]['raw']['future_raw_field'], {'values': [1, None, '']})
    def test_public_output_refused(self):
        self.output = self.root / 'public/l2/bundle'; self.fails_read_only('artifacts/scratch')
    def test_input_traversal_refused(self):
        self.recipe['tables']['skillgrp']['original']['path'] = '../escape.dat'
        self.write('recipes/skill.json', json_bytes(self.recipe)); self.fails_read_only('Unsafe')
    def test_product_traversal_refused(self):
        self.coverage['sounds'][0]['products']['audio']['path'] = '../escape.wav'; self.save(); self.fails_read_only('Unsafe')
    def test_existing_corrupt_output_preserved(self):
        self.run_bundle(); (self.output / 'manifest.json').write_bytes(b'authored work'); self.fails_read_only('immutable output differs')
    def test_extra_output_preserved(self):
        self.run_bundle(); (self.output / 'authored.txt').write_bytes(b'authored work'); self.fails_read_only('file set differs')
    def test_expected_coverage_refuses_drift(self):
        self.recipe['expectedCoverage'] = {}; self.save(); self.fails_read_only('coverage differs')

    def test_decoded_original_link_mismatch_refused(self):
        path = self.root / 'inputs/skillsoundgrp.json'; table = json.loads(path.read_bytes()); table['sourceSha256'] = '0'*64
        self.recipe['tables']['skillsoundgrp']['decoded'] = self.write('inputs/skillsoundgrp.json', json_bytes(table))
        self.write('recipes/skill.json', json_bytes(self.recipe)); self.fails_read_only('table identity differs')

    def test_nonfinite_json_refused_without_output(self):
        path = self.root / 'inputs/skillsoundgrp.json'; table = json.loads(path.read_bytes())
        table['data']['skillsound'][1]['cast_volume'] = float('nan')
        self.recipe['tables']['skillsoundgrp']['decoded'] = self.write('inputs/skillsoundgrp.json', json.dumps(table).encode())
        self.write('recipes/skill.json', json_bytes(self.recipe)); self.fails_read_only('Nonfinite JSON')

    def test_output_cannot_overlap_retained_inputs(self):
        extra = self.write('artifacts/retained/source.txt', b'retained input')
        self.recipe['supportingEvidence'] = [extra]; self.save()
        self.output = self.root / 'artifacts/retained/new-output'; self.fails_read_only('overlaps an input')

    def test_boolean_numeric_field_is_not_promoted_to_gain(self):
        self.sound_rows[1]['cast_volume'] = True; self.save(); self.fails_read_only('numeric field')


if __name__ == '__main__': unittest.main()
