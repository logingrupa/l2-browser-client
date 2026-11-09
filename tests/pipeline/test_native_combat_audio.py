import copy
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
import wave
import zlib

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets import archive_bytes
from native_assets_lib.gltf import json_bytes
from native_assets_lib import combat_audio_bundle as subject
from native_assets_lib.sha256_identity import sha256_hex_digest
from native_catalog.table_layout_pins import MTX_DEFINITION_EVIDENCE
from native_store.catalog_writer import pinned_store_files, read_store_catalog, write_store
from native_store.store_paths import lane_store_root
from native_store.write_lane_catalog import write_lane_catalog
import stage_native_combat_audio as stager


def snapshot(root):
    return {p.relative_to(root).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
            for p in root.rglob('*') if p.is_file()}


def ver111(text):
    body = 'Lineage2Ver111'.encode('utf-16le') + bytes(value ^ 0xac for value in text.encode('ascii'))
    return body + struct.pack('<5I', 0, 8, 71, zlib.crc32(body), 0)


ALAUDIO = ('[Public]\r\nObject=(Name=X)\r\n\r\n[ItemSound]\r\nRandom=100\r\nVol=250.0\r\nRadius=40.0\r\n\r\n'
           '[CharSound]\r\nRandom=50\r\nVol=250.0\r\nRadius=30.0\r\n\r\n[EtcSound]\r\nCriticalSound=SkillSound.Critical_Hit_02\r\n'
           'CriticalSound_Vol=250.0\r\nCriticalSound_Radius=50.0\r\n\r\n[MusicVolume]\r\nMaxTime=30.f\r\n')
READER_SCHEMA = {'descriptor': '06_interlude.xml', 'layout': 'Interlude', 'descriptorSha256': 'a' * 64, 'file': 'dats/npcgrp.xml',
                 'sha256': 'b' * 64, 'sourcePattern': 'npcgrp.dat', 'compoundDefinitionEvidence': dict(MTX_DEFINITION_EVIDENCE)}


class CombatAudioFixture(unittest.TestCase):
    decoded_table_schema = {'fixture': True}

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='combat-audio-')
        self.addCleanup(temporary.cleanup); self.root = Path(temporary.name)
        self.output = self.root / 'artifacts/bundle'
        self.package_hash = sha256_hex_digest(b'synthetic-original-package')
        self.inventory = {'kind': 'native-staged-sound-inventory', 'sounds': []}
        self.coverage = {'kind': 'native-staged-sound-coverage', 'sounds': []}
        self.wavs = {}
        for index, name in enumerate(['itemsound.Weapon_Fist.fist_1', 'itemsound.Weapon_Fist.fist_2', 'monsound.Public_Hit_Wet.Hit_Wet_2',
                                      'monsound.field_stalker.field_stalker_dmg_1', 'chrsound.MHFighter_Basic_Action.MHFighter_Dmg_1'], start=10):
            self.add_sound(name, index)
        self.char_rows = [
            {'body_mesh': {'body_mesh1': 'Fighter.MFighter_m001_u'}, 'attack_sound': [{'param_attack_sound': 'ItemSound.fist_2'}, {'param_attack_sound': 'ItemSound.fist_1'}],
             'damage_sound': [{'param_damage_sound': 'ChrSound.MHFighter_Dmg_1'}], 'defense_sound': [{'param_defense_sound': 'MonSound.Hit_Wet_2'}]},
            {'body_mesh': {'body_mesh1': 'Fighter.FFighter_m001_u'}, 'attack_sound': [], 'damage_sound': [], 'defense_sound': []}]
        self.npc_rows = [{'npc_id': 1, 'mesh_name': 'Other.mesh'},
                         {'npc_id': 21622, 'mesh_name': 'LineageMonsters.field_stalker_m00', 'attack_sound1': [{'param_attack_sound1': ''}],
                          'defense_sound1': [{'param_defense_sound1': 'MonSound.Hit_Wet_2'}],
                          'damage_sound': [{'param_damage_sound': 'MonSound.field_stalker_dmg_1'}], 'sound_vol': 50.0, 'sound_radius': 250.0,
                          'sound_random': 70.0}]
        self.recipe = {'schemaVersion': 1, 'kind': subject.RECIPE_KIND, 'referencePolicy': copy.deepcopy(subject.POLICY),
            'corpus': {'root': 'inputs/corpus'}, 'tables': {}, 'selections': [
                {'id': 'male', 'kind': 'actor', 'catalogId': 'human-male-fighter:0', 'sourceObject': 'Fighter.MFighter_m001_u', 'table': 'chargrp',
                 'match': [{'pointer': '/body_mesh/body_mesh1', 'value': 'Fighter.MFighter_m001_u'}],
                 'roles': {'attackItem': 'attack_sound', 'defense': 'defense_sound', 'damage': 'damage_sound'}},
                {'id': 'musveren', 'kind': 'actor', 'catalogId': 'musveren:0', 'sourceObject': 'LineageMonsters.field_stalker_m00', 'table': 'npcgrp',
                 'match': [{'pointer': '/npc_id', 'value': 21622}], 'join': [{'pointer': '/mesh_name', 'value': 'LineageMonsters.field_stalker_m00'}],
                 'roles': {'attackItem': 'attack_sound1', 'defense': 'defense_sound1', 'damage': 'damage_sound'}, 'numericFields': ['sound_vol', 'sound_radius']}]}
        self.save()

    def write(self, name, data):
        path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
        return {'path': name, 'bytes': len(data), 'sha256': sha256_hex_digest(data)}

    def add_sound(self, object_name, export_index):
        stream = io.BytesIO()
        with wave.open(stream, 'wb') as writer:
            writer.setnchannels(1); writer.setsampwidth(2); writer.setframerate(22050); writer.writeframes(bytes([export_index, 0]) * 8)
        wav = stream.getvalue(); self.wavs[object_name] = wav
        prefix = f'cache/{export_index}'; stable = f'FIXTURE:{self.package_hash}:{export_index}'
        asset = {'schemaVersion': 1, 'kind': 'audio', 'id': 'interlude:' + object_name,
            'source': {'edition': 'interlude', 'object': object_name, 'sha256': self.package_hash}, 'audio': {'file': 'audio.wav'}, 'animationEvents': []}
        payloads = {'audio.wav': wav, 'provenance.json': json_bytes({'metadata': {'nativeExportIndex': export_index,
            'nativePayloadSha256': sha256_hex_digest(wav), 'encodedAudioUnchanged': True}})}
        asset['files'] = [{'path': name, 'bytes': len(data), 'sha256': sha256_hex_digest(data)} for name, data in payloads.items()]
        archive = self.write('inputs/corpus/' + prefix + '/asset.l2asset', archive_bytes(asset, payloads))
        audio = self.write('inputs/corpus/' + prefix + '/audio.wav', wav)
        native = self.write(f'inputs/corpus/source/{export_index}.bin', wav)
        self.inventory['sounds'].append({'stableId': stable, 'status': 'source-ready', 'id': asset['id'],
            'export': {'object': object_name, 'classObject': 'Engine.Sound', 'exportIndex': export_index},
            'sourcePackage': {'sha256': self.package_hash, 'relativePath': 'sounds/fixture.uax'},
            'nativePayload': {**native, 'path': f'source/{export_index}.bin'},
            'nativeSound': {'exportIndex': export_index, 'embeddedPayloadSha256': sha256_hex_digest(wav)},
            'serializedExport': {'offsetUnwrapped': export_index * 1000}})
        self.coverage['sounds'].append({'stableId': stable, 'status': 'exported-and-verified', 'products': {
            'archive': {**archive, 'path': prefix + '/asset.l2asset'}, 'audio': {**audio, 'path': prefix + '/audio.wav'}}})

    def save(self):
        for name, collection, rows in [('chargrp', 'Char', self.char_rows), ('npcgrp', 'npc', self.npc_rows)]:
            original = self.write('inputs/system/' + name + '.dat', b'synthetic original ' + name.encode())
            table = {'schemaVersion': 1, 'edition': 'interlude', 'source': 'system/' + name + '.dat', 'sourceSha256': original['sha256'],
                'decodedSha256': sha256_hex_digest(json_bytes(rows)), 'schema': copy.deepcopy(self.decoded_table_schema),
                'data': {collection: rows}}
            if name == 'npcgrp': table['data']['data'] = len(rows)
            self.recipe['tables'][name] = {'original': original, 'decoded': self.write('inputs/' + name + '.json', json_bytes(table))}
        inventory = self.write('inputs/corpus/inventory.json', json_bytes(self.inventory))
        self.coverage['inventorySha256'] = inventory['sha256']
        coverage = self.write('inputs/corpus/coverage.json', json_bytes(self.coverage))
        self.recipe['corpus'].update(inventory=inventory, coverage=coverage)
        self.write('recipes/combat.json', json_bytes(self.recipe))

    def run_bundle(self, **kwargs):
        return subject.run(self.root, self.root / 'recipes/combat.json', self.output, **kwargs)

    def manifest(self):
        self.run_bundle(); return json.loads((self.output / 'manifest.json').read_bytes())

    def fails_read_only(self, pattern, **kwargs):
        before = snapshot(self.root)
        with self.assertRaisesRegex((ValueError, KeyError, OSError), pattern): self.run_bundle(**kwargs)
        self.assertEqual(snapshot(self.root), before)

    def selection(self, manifest, identity):
        return next(row for row in manifest['selections'] if row['id'] == identity)


class CombatAudioBundleTests(CombatAudioFixture):
    def test_plan_is_write_free_and_verifies_inputs(self):
        before = snapshot(self.root); result = self.run_bundle(plan=True)
        self.assertEqual((result['status'], result['filesWritten']), ('planned', 0)); self.assertEqual(snapshot(self.root), before)

    def test_slot_order_raw_rows_and_empty_values_survive(self):
        manifest = self.manifest(); male = self.selection(manifest, 'male'); npc = self.selection(manifest, 'musveren')
        self.assertEqual(male['rowOrdinal'], 0); self.assertEqual(male['raw'], self.char_rows[0])
        self.assertEqual([slot['reference'] for slot in male['roles']['attackItem']['slots']], ['ItemSound.fist_2', 'ItemSound.fist_1'])
        self.assertEqual(male['roles']['attackItem']['slots'][0]['sourcePointer'], '/data/Char/0/attack_sound/0/param_attack_sound')
        self.assertEqual(npc['rowOrdinal'], 1); self.assertEqual(npc['numeric'], {'sound_vol': 50.0, 'sound_radius': 250.0})
        empty = npc['roles']['attackItem']['slots'][0]
        self.assertEqual((empty['status'], empty['reference'], empty['dependencyId']), ('empty', '', None))
        self.assertEqual(manifest['coverage']['slotStatuses'], {'empty': 1, 'unique-package-leaf-candidate': 6})
        self.assertEqual((manifest['coverage']['slots'], manifest['coverage']['admittedSlots']), (7, 6))

    def test_unique_leaf_candidates_copy_original_wav_bytes(self):
        manifest = self.manifest(); self.assertEqual(manifest['coverage']['dependencies'], 5)
        for sound in manifest['sounds']:
            self.assertEqual((self.output / sound['file']).read_bytes(), self.wavs[sound['source']['object']])
            self.assertFalse(sound['nativeLookupVerified'])
        slot = self.selection(manifest, 'male')['roles']['damage']['slots'][0]
        self.assertEqual(slot['candidates'][0]['object'], 'chrsound.MHFighter_Basic_Action.MHFighter_Dmg_1')
        self.assertEqual(slot['dependencyId'], slot['candidates'][0]['stableId'])
        self.assertFalse(manifest['runtime']['nativeSlotSelectionVerified'])

    def test_ambiguous_leaf_candidates_are_retained_but_not_admitted(self):
        self.add_sound('itemsound.Other_Group.fist_1', 40); self.save(); manifest = self.manifest()
        slot = self.selection(manifest, 'male')['roles']['attackItem']['slots'][1]
        self.assertEqual(slot['status'], 'ambiguous-package-leaf-candidates'); self.assertEqual(len(slot['candidates']), 2)
        self.assertIsNone(slot['dependencyId'])

    def test_repeat_is_zero_write_and_verify_only_needs_output(self):
        self.fails_read_only('Verify-only requires', verify_only=True)
        first = self.run_bundle(); self.assertEqual(first['status'], 'produced'); before = snapshot(self.root)
        repeat = self.run_bundle(); self.assertEqual((repeat['status'], repeat['filesWritten']), ('preserved', 0))
        verified = self.run_bundle(verify_only=True); self.assertEqual(verified['status'], 'verified')
        self.assertEqual(snapshot(self.root), before); self.assertEqual(first['manifestSha256'], repeat['manifestSha256'])

    def test_refuses_to_overwrite_a_different_existing_output(self):
        self.run_bundle(); (self.output / 'manifest.json').write_bytes(b'{}')
        self.fails_read_only('Existing immutable output differs')

    def test_ambiguous_or_unjoined_rows_are_refused(self):
        self.npc_rows.append(copy.deepcopy(self.npc_rows[1])); self.save()
        self.fails_read_only('missing or ambiguous')
        self.npc_rows.pop(); self.npc_rows[1]['mesh_name'] = 'LineageMonsters.other_m00'; self.save()
        self.fails_read_only('does not join')

    def test_decoded_table_must_match_its_original_dat(self):
        self.write('inputs/system/chargrp.dat', b'changed'); self.recipe['tables']['chargrp']['original'] = self.write('inputs/system/chargrp.dat', b'changed')
        self.write('recipes/combat.json', json_bytes(self.recipe))
        self.fails_read_only('Decoded/original table identity differs')

    def test_stale_pins_and_coverage_are_refused(self):
        self.write('inputs/corpus/source/10.bin', b'tampered')
        self.fails_read_only('Input hash differs|Candidate native payload differs')
        self.write('inputs/corpus/source/10.bin', self.wavs['itemsound.Weapon_Fist.fist_1'])
        self.recipe['expectedCoverage'] = {'selections': 99}; self.write('recipes/combat.json', json_bytes(self.recipe))
        self.fails_read_only('Selected coverage differs')

    def test_native_numeric_renames_the_swapped_npc_labels(self):
        self.recipe['selections'][1].pop('numericFields')
        self.recipe['selections'][1]['nativeNumeric'] = {'soundRadius': 'sound_vol', 'soundVolume': 'sound_radius', 'soundRandom': 'sound_random'}
        self.save(); npc = self.selection(self.manifest(), 'musveren')
        self.assertEqual(npc['numeric'], {'soundRadius': 50.0, 'soundVolume': 250.0, 'soundRandom': 70.0})
        self.assertEqual(npc['numericSource']['soundRadius'], {'decodedField': 'sound_vol', 'sourcePointer': '/data/npc/1/sound_vol'})
        self.assertEqual(npc['raw']['sound_vol'], 50.0)
        self.recipe['selections'][1]['nativeNumeric'] = {'soundRadius': 'missing_field'}; self.save()
        self.output = self.root / 'artifacts/other'
        self.fails_read_only('Native numeric field is missing')

    def add_config(self, text=ALAUDIO, sections=None):
        if 'skillsound.critical_hit.critical_hit_02' not in self.wavs:
            self.add_sound('skillsound.critical_hit.critical_hit_02', 30); self.save()
        self.recipe['selections'] = [row for row in self.recipe['selections'] if row['id'] != 'config']
        self.recipe['config'] = {'alaudio': {'original': self.write('inputs/system/ALAudio.int', ver111(text)),
            'sections': sections or {'CharSound': ['Random', 'Vol', 'Radius'], 'ItemSound': ['Vol', 'Radius'],
                                     'EtcSound': ['CriticalSound', 'CriticalSound_Vol', 'CriticalSound_Radius']}}}
        self.recipe['selections'].append({'id': 'config', 'kind': 'config', 'table': 'alaudio',
            'match': [{'pointer': '/source', 'value': 'ALAudio.int'}], 'roles': {'critical': 'EtcSound.CriticalSound'},
            'numericFields': ['CharSound.Random', 'CharSound.Vol', 'CharSound.Radius', 'ItemSound.Vol', 'EtcSound.CriticalSound_Radius']})
        self.write('recipes/combat.json', json_bytes(self.recipe))

    def test_alaudio_sections_become_config_values_and_sounds(self):
        self.add_config(); manifest = self.manifest(); config = self.selection(manifest, 'config')
        self.assertEqual(config['numeric'], {'CharSound.Random': 50, 'CharSound.Vol': 250.0, 'CharSound.Radius': 30.0,
                                             'ItemSound.Vol': 250.0, 'EtcSound.CriticalSound_Radius': 50.0})
        self.assertEqual(config['sourcePointer'], '/config/alaudio')
        slot = config['roles']['critical']['slots'][0]
        self.assertEqual((slot['reference'], slot['status'], slot['sourcePointer']),
                         ('SkillSound.Critical_Hit_02', 'unique-package-leaf-candidate', '/config/alaudio/EtcSound.CriticalSound'))
        self.assertEqual(slot['candidates'][0]['object'], 'skillsound.critical_hit.critical_hit_02')
        records = {row['section'] + '.' + row['key']: row for row in manifest['config']['alaudio']['records']}
        self.assertEqual(records['CharSound.Random']['rawLine'], 'Random=50')
        self.assertEqual(records['CharSound.Random']['value'], '50')
        offset = records['CharSound.Random']['payloadByteOffset']
        self.assertEqual(ALAUDIO.encode('ascii')[offset:offset + 9], b'Random=50')
        self.assertNotIn('alaudio', manifest['tables'])
        self.assertEqual(manifest['config']['alaudio']['decoder']['adapter'], 'native_animation_families.decode_localization111')

    def test_config_refuses_missing_duplicate_or_tampered_values(self):
        self.add_config(sections={'CharSound': ['Random'], 'LobbySound': ['Missing']})
        self.fails_read_only('Config section missing')
        self.add_config(text=ALAUDIO.replace('Vol=250.0\r\nRadius=30.0', 'Vol=250.0\r\nvol=1\r\nRadius=30.0'))
        self.fails_read_only('Duplicate config key')
        self.add_config(); self.write('inputs/system/ALAudio.int', ver111(ALAUDIO.replace('Random=50', 'Random=99')))
        self.fails_read_only('Input hash differs')

    def test_unsupported_policy_or_roles_are_refused(self):
        self.recipe['referencePolicy'] = dict(subject.POLICY, nativeLookupVerified=True); self.write('recipes/combat.json', json_bytes(self.recipe))
        self.fails_read_only('reference policy')
        self.recipe['referencePolicy'] = copy.deepcopy(subject.POLICY); self.recipe['selections'][0]['roles'] = {'cast': 'attack_sound'}
        self.write('recipes/combat.json', json_bytes(self.recipe))
        self.fails_read_only('Invalid role mapping')


class CombatAudioStageTests(CombatAudioFixture):
    def setUp(self):
        super().setUp()
        self.result = self.run_bundle()
        self.catalog = {'schemaVersion': 1, 'models': [
            {'id': 'human-male-fighter:0', 'source': {'object': 'Fighter.MFighter_m001_u'}},
            {'id': 'musveren:0', 'source': {'object': 'LineageMonsters.field_stalker_m00'}}], 'animationAudio': [{'id': 'kept'}]}
        self.catalog_record = self.write('public/l2/catalog.json', json_bytes(self.catalog))

    def stage(self, catalog_sha=None, **kwargs):
        return stager.stage(self.output, self.result['manifestSha256'], catalog_sha or self.catalog_record['sha256'], root=self.root, **kwargs)

    def test_additive_stage_then_zero_write_repeat_and_verify(self):
        planned = self.stage(plan=True); self.assertEqual(planned['filesWritten'], 0)
        self.assertFalse((self.root / 'public/l2/combat-audio').exists())
        staged = self.stage(); self.assertEqual(staged['filesWritten'], 7)
        catalog = json.loads((self.root / 'public/l2/catalog.json').read_bytes())
        self.assertEqual(catalog['animationAudio'], [{'id': 'kept'}]); self.assertEqual(catalog['combatAudio'], [staged['entry']])
        prefix = self.root / 'public/l2/combat-audio' / self.result['manifestSha256']
        self.assertEqual((prefix / 'manifest.json').read_bytes(), (self.output / 'manifest.json').read_bytes())
        before = snapshot(self.root)
        repeat = self.stage(staged['resultingCatalogSha256']); self.assertEqual(repeat['filesWritten'], 0)
        self.stage(staged['resultingCatalogSha256'], verify_only=True)
        self.assertEqual(snapshot(self.root), before)

    def test_stale_catalog_guard_refuses_without_writes(self):
        before = snapshot(self.root)
        with self.assertRaisesRegex(ValueError, 'Catalog changed'): self.stage('0' * 64)
        with self.assertRaisesRegex(ValueError, 'not completely staged'): self.stage(verify_only=True)
        self.assertEqual(snapshot(self.root), before)

    def test_actor_source_must_match_catalog(self):
        self.catalog['models'][1]['source']['object'] = 'LineageMonsters.other_m00'
        record = self.write('public/l2/catalog.json', json_bytes(self.catalog)); before = snapshot(self.root)
        with self.assertRaisesRegex(ValueError, 'source differs'): self.stage(record['sha256'])
        self.assertEqual(snapshot(self.root), before)

    def second_bundle(self):
        self.recipe['selections'][0]['label'] = 'Changed label'; self.save()
        self.output = self.root / 'artifacts/bundle-2'
        return self.run_bundle()

    def test_replacement_needs_the_exact_superseded_manifest_and_prunes_only_verified_files(self):
        first = self.stage(); old = self.result['manifestSha256']
        second = self.second_bundle(); new = second['manifestSha256']
        stage = lambda **kwargs: stager.stage(self.output, new, first['resultingCatalogSha256'], root=self.root, **kwargs)
        before = snapshot(self.root)
        with self.assertRaisesRegex(ValueError, 'identity differs; preserved'): stage()
        with self.assertRaisesRegex(ValueError, 'identity differs; preserved'): stage(replace_manifest_sha256='1' * 64)
        self.assertEqual(snapshot(self.root), before)
        planned = stage(replace_manifest_sha256=old, plan=True)
        self.assertEqual((planned['filesWritten'], planned['filesRemoved'], len(planned['retiredResources'])), (0, 0, 6))
        self.assertEqual(snapshot(self.root), before)
        staged = stage(replace_manifest_sha256=old)
        catalog = json.loads((self.root / 'public/l2/catalog.json').read_bytes())
        self.assertEqual(catalog['combatAudio'], [staged['entry']]); self.assertEqual(catalog['animationAudio'], [{'id': 'kept'}])
        self.assertEqual((staged['replacedManifestSha256'], staged['filesRemoved']), (old, 6))
        self.assertFalse((self.root / 'public/l2/combat-audio' / old).exists())
        self.assertTrue((self.root / 'public/l2/combat-audio' / new / 'manifest.json').exists())
        after = snapshot(self.root)
        repeat = stager.stage(self.output, new, staged['resultingCatalogSha256'], root=self.root, verify_only=True)
        self.assertEqual(repeat['filesWritten'], 0); self.assertEqual(snapshot(self.root), after)

    def test_replacement_preserves_a_superseded_folder_with_unlisted_files(self):
        first = self.stage(); old = self.result['manifestSha256']
        (self.root / 'public/l2/combat-audio' / old / 'extra.wav').write_bytes(b'not listed')
        second = self.second_bundle(); before = snapshot(self.root)
        with self.assertRaisesRegex(ValueError, 'unlisted/changed files; preserved'):
            stager.stage(self.output, second['manifestSha256'], first['resultingCatalogSha256'], root=self.root, replace_manifest_sha256=old)
        self.assertEqual(snapshot(self.root), before)

    def test_existing_corrupt_resource_is_preserved(self):
        manifest = json.loads((self.output / 'manifest.json').read_bytes())
        target = self.root / 'public/l2/combat-audio' / self.result['manifestSha256'] / manifest['sounds'][0]['file']
        target.parent.mkdir(parents=True); target.write_bytes(b'corrupt'); before = snapshot(self.root)
        with self.assertRaisesRegex(ValueError, 'differs; preserved'): self.stage()
        self.assertEqual(snapshot(self.root), before)


class LaneStoreCombatAudioPinTests(CombatAudioFixture):
    decoded_table_schema = READER_SCHEMA

    def setUp(self):
        super().setUp()
        self.store_root = lane_store_root(self.root, 'actors')
        _, payloads, _ = subject.prepare(self.root, self.root / 'recipes/combat.json')
        manifest_sha256 = sha256_hex_digest(payloads['manifest.json'])
        self.bundle_folder = self.store_root / 'combat-audio' / manifest_sha256
        subject.run(self.root, self.root / 'recipes/combat.json', self.bundle_folder)
        record = {'id': 'actor-sounds:npc:21622', 'manifest': f'/l2/combat-audio/{manifest_sha256}/manifest.json',
                  'manifestBytes': len(payloads['manifest.json']), 'manifestSha256': manifest_sha256}
        _, before = read_store_catalog(self.store_root)
        write_store(self.store_root, {}, before, json_bytes({'schemaVersion': 1, 'models': [], 'combatAudio': [record]}))

    def test_the_reader_provenance_names_its_schema_files_by_path(self):
        manifest = json.loads((self.bundle_folder / 'manifest.json').read_bytes())
        expected_schema = {key: value for key, value in READER_SCHEMA.items() if key != 'file'}
        expected_schema['path'] = READER_SCHEMA['file']
        expected_schema['compoundDefinitionEvidence'] = {key: value for key, value in MTX_DEFINITION_EVIDENCE.items() if key != 'file'}
        expected_schema['compoundDefinitionEvidence']['path'] = MTX_DEFINITION_EVIDENCE['file']
        for table in ('chargrp', 'npcgrp'):
            with self.subTest(table):
                self.assertEqual(manifest['tables'][table]['reader']['schema'], expected_schema)

    def test_the_bundle_pins_only_the_files_it_holds_and_the_lane_catalog_writer_pins_it(self):
        catalog, _ = read_store_catalog(self.store_root)
        pinned = {relative for relative, _ in pinned_store_files(self.store_root, catalog).values()}
        held = {path.relative_to(self.store_root).as_posix() for path in self.bundle_folder.rglob('*') if path.is_file()}
        self.assertEqual(pinned, held)
        self.write('public/l2/catalog.json', json_bytes({'schemaVersion': 1, 'models': []}))
        summary = write_lane_catalog(self.root, 'actors')
        self.assertEqual(summary['recordsBySlice'], {'models': 0, 'combatAudio': 1})


if __name__ == '__main__':
    unittest.main()
