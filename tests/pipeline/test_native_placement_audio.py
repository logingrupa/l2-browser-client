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
from native_assets_lib import placement_audio as subject
from native_assets_lib.sha256_identity import sha256_hex_digest


def snapshot(root):
    return {p.relative_to(root).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
            for p in root.rglob('*') if p.is_file()}


class PlacementAudioTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='placement-audio-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.output = self.root / 'artifacts/bundle'
        self.source_hash = sha256_hex_digest(b'original package fixture')
        self.reference = 'StepSound.Wood.Walk_01'
        self.stable = 'FIXTURE:' + self.source_hash + ':7'
        stream = io.BytesIO()
        with wave.open(stream, 'wb') as writer:
            writer.setnchannels(1); writer.setsampwidth(2); writer.setframerate(22050)
            writer.writeframes(b'\x01\x00\x02\x00')
        self.wav = stream.getvalue()
        self.asset = {'schemaVersion': 1, 'kind': 'audio', 'id': 'interlude:stepsound.Wood.Walk_01',
                      'source': {'edition': 'interlude', 'object': 'stepsound.Wood.Walk_01', 'sha256': self.source_hash},
                      'audio': {'file': 'audio.wav'}, 'animationEvents': []}
        archive = self.archive('inputs/corpus/cache/asset.l2asset', self.asset,
            {'audio.wav': self.wav, 'provenance.json': json_bytes({'metadata': {
                'nativeExportIndex': 7, 'encodedAudioUnchanged': True, 'nativePayloadSha256': sha256_hex_digest(self.wav)}})})
        self.write('inputs/corpus/cache/audio.wav', self.wav)
        self.write('inputs/corpus/source/native-payload.bin', self.wav)
        self.inventory = {'kind': 'native-staged-sound-inventory', 'sounds': [{
            'stableId': self.stable, 'id': self.asset['id'], 'status': 'source-ready',
            'export': {'exportIndex': 7, 'classObject': 'Engine.Sound', 'object': 'stepsound.Wood.Walk_01'},
            'sourcePackage': {'relativePath': 'sounds/stepsound.uax', 'sha256': self.source_hash, 'bytes': 8192},
            'nativePayload': {'path': 'source/native-payload.bin', 'sha256': sha256_hex_digest(self.wav), 'bytes': len(self.wav)},
            'serializedExport': {'path': 'source/serialized.bin', 'offsetUnwrapped': 100, 'bytes': len(self.wav)+9,
                                 'sha256': sha256_hex_digest(b'serialized source')},
            'nativeSound': {'exportIndex': 7, 'embeddedPayloadSha256': sha256_hex_digest(self.wav)}}]}
        self.coverage = {'kind': 'native-staged-sound-coverage', 'sounds': [{
            'stableId': self.stable, 'status': 'exported-and-verified',
            'products': {'archive': {**archive, 'path': 'cache/asset.l2asset'},
                         'audio': {'path': 'cache/audio.wav', 'sha256': sha256_hex_digest(self.wav), 'bytes': len(self.wav)}}}]}
        self.raw = bytearray(b'\0' * 64)
        self.actors = [self.actor('House', 1, []), self.actor('Steps', 2, [])]
        tags = [self.tag(name, 8 + i * 4) for i, name in enumerate(subject.PROPERTIES)]
        self.actors[1]['properties'] = [tags[2], {'name': 'Unrelated', 'value': 17}, tags[0], tags[1]]
        self.section = {'schemaVersion': 1, 'kind': 'native-map-section-runtime', 'errors': [],
                        'models': [{'id': 'model', 'model': {'file': 'model.glb', 'bytes': 20, 'sha256': sha256_hex_digest(b'model')}}],
                        'placements': [{'id': a['id'], 'sourceMesh': a['staticMesh']['object'], 'modelId': 'model',
                                        'matrix': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]}
                                       for a in reversed(self.actors)]}
        self.recipe = {'schemaVersion': 1, 'kind': 'native-placement-audio-bundle', 'properties': list(subject.PROPERTIES),
                       'section': {'id': 'fixture-section'}, 'source': {
                           'map': {'path': 'maps/fixture.unr', 'sha256': self.source_hash, 'bytes': 92}},
                       'corpus': {'root': 'inputs/corpus'}, 'absenceControls': ['interlude:fixture.House']}
        self.save()

    def actor(self, name, export, properties):
        return {'id': 'interlude:fixture.' + name, 'object': 'fixture.' + name, 'classObject': 'Engine.StaticMeshActor',
                'exportIndex': export, 'staticMesh': {'object': 'Models.' + name}, 'properties': properties,
                'stateFrameBytes': {'offset': 0, 'bytes': 8, 'path': 'raw/map.unwrapped.bin', 'sha256': sha256_hex_digest(b'\0'*8)}}

    def tag(self, name, offset):
        self.raw[offset:offset+3] = b'\x11\x05\x81'
        return {'name': name, 'offset': offset, 'arrayIndex': None, 'structName': None, 'type': 5, 'status': 'decoded',
                'value': {'index': -1, 'object': self.reference}, 'payload': {'path': 'raw/map.unwrapped.bin',
                    'offset': offset+2, 'bytes': 1, 'sha256': sha256_hex_digest(b'\x81')}}

    def write(self, name, data):
        path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
        return {'path': name, 'bytes': len(data), 'sha256': sha256_hex_digest(data)}

    def archive(self, name, asset, payloads):
        asset['files'] = [{'path': n, 'bytes': len(b), 'sha256': sha256_hex_digest(b)} for n, b in payloads.items()]
        return self.write(name, archive_bytes(asset, payloads))

    def save(self, requalify=True):
        src = self.recipe['source']
        src['actors'] = self.write('inputs/map/actors.json', json_bytes(self.actors))
        src['rawMap'] = self.write('inputs/map/raw/map.unwrapped.bin', bytes(self.raw))
        source_map = src['map']
        src['receipt'] = self.write('inputs/map/receipt.json', json_bytes({'schemaVersion': 1, 'kind': 'native-map-raw',
            'dependencies': {source_map['path']: {k: source_map[k] for k in ('bytes', 'sha256')}},
            'outputs': {name: {k: src[key][k] for k in ('bytes', 'sha256')}
                        for key, name in [('actors', 'actors.json'), ('rawMap', 'raw/map.unwrapped.bin')]}}))
        self.recipe['section']['manifest'] = self.write('inputs/section.json', json_bytes(self.section))
        self.recipe['corpus']['inventory'] = self.write('inputs/corpus/inventory.json', json_bytes(self.inventory))
        self.coverage['inventorySha256'] = self.recipe['corpus']['inventory']['sha256']
        self.recipe['corpus']['coverage'] = self.write('inputs/corpus/coverage.json', json_bytes(self.coverage))
        if requalify:
            self.proof = {'schemaVersion': 1, 'nativeAutomaticSelectionQualified': False, 'originalMap': {
                k: source_map[k] for k in ('bytes', 'sha256')}, 'sourceActorTable': src['actors'], 'sourceRawMap': src['rawMap'],
                'sectionManifest': self.recipe['section']['manifest'], 'placements': [], 'omittedPlacements': [],
                'soundProducts': [{'sourceActorReference': self.reference, 'inventory': copy.deepcopy(self.inventory['sounds'][0]),
                                   'existingCoverage': copy.deepcopy(self.coverage['sounds'][0])}]}
            declared = nulls = slots = 0
            for i, placement in enumerate(self.section['placements']):
                actor = next(a for a in self.actors if a['id'] == placement['id'])
                tags = [t for t in actor['properties'] if t['name'] in subject.PROPERTIES]
                if not tags:
                    self.proof['omittedPlacements'].append({'placementId': actor['id'], 'object': actor['object'],
                        'exportIndex': actor['exportIndex'], 'status': 'not-serialized-in-retained-actor', 'defaultOrRuntimeValue': None})
                    continue
                declared += 1; slots += len(tags); nulls += sum(t['value']['index'] == 0 for t in tags)
                evidence = {'placementId': actor['id'], 'manifestPointer': f'/placements/{i}', 'object': actor['object'],
                    'class': actor['classObject'], 'exportIndex': actor['exportIndex'], 'stateFrameBytes': actor['stateFrameBytes'],
                    'sourceMesh': placement['sourceMesh'], 'modelId': placement['modelId'],
                    'modelResource': self.section['models'][0]['model'], 'sourcePlacementMatrix': placement['matrix'], 'stepSounds': []}
                for tag in tags:
                    raw = bytes(self.raw[tag['offset']:tag['payload']['offset']+tag['payload']['bytes']])
                    evidence['stepSounds'].append({'sourceTag': copy.deepcopy(tag), 'rawTagAndPayload': {
                        'offset': tag['offset'], 'bytes': len(raw), 'hex': raw.hex(), 'sha256': sha256_hex_digest(raw)}})
                self.proof['placements'].append(evidence)
            self.proof['explicitMissingControls'] = [r for r in self.proof['omittedPlacements'] if r['placementId'] in self.recipe['absenceControls']]
            count = len(self.section['placements'])
            self.recipe['expectedCoverage'] = {'placements': count, 'declaredPlacements': declared, 'omittedPlacements': count-declared,
                'declaredSlots': slots, 'omittedSlots': count*3-slots, 'nullSlots': nulls, 'soundReferenceSlots': slots-nulls,
                'dependencies': 1, 'wavFiles': 1}
        src['qualification'] = self.write('inputs/qualification.json', json_bytes(self.proof))
        self.write('recipes/bundle.json', json_bytes(self.recipe))

    def run_bundle(self, **kwargs):
        return subject.run(self.root, self.root / 'recipes/bundle.json', self.output, **kwargs)

    def fails_read_only(self, pattern, **kwargs):
        before = snapshot(self.root)
        with self.assertRaisesRegex((ValueError, KeyError, OSError), pattern): self.run_bundle(**kwargs)
        self.assertEqual(snapshot(self.root), before)

    def test_plan_changes_no_files(self):
        before = snapshot(self.root); result = self.run_bundle(plan=True)
        self.assertEqual(result['status'], 'planned'); self.assertEqual(result['filesWritten'], 0)
        self.assertEqual(snapshot(self.root), before); self.assertFalse(self.output.exists())

    def test_preserves_manifest_source_actor_property_and_slot_orders(self):
        before = snapshot(self.root / 'inputs'); self.run_bundle()
        m = json.loads((self.output / 'manifest.json').read_bytes())
        self.assertEqual([r['sourceActor']['object'] for r in m['placements']], ['fixture.Steps', 'fixture.House'])
        self.assertEqual([r['sourceActor']['tableOrdinal'] for r in m['placements']], [1, 0])
        self.assertEqual([r['sourceActor']['exportIndex'] for r in m['placements']], [2, 1])
        slots = m['placements'][0]['slots']
        self.assertEqual([s['property'] for s in slots], list(subject.PROPERTIES))
        self.assertEqual([s['sourcePropertyOrdinal'] for s in slots], [2, 3, 0])
        self.assertEqual([s['sourceTag']['offset'] for s in slots], [8, 12, 16])
        self.assertEqual([s['reference'] for s in slots], [self.reference]*3)
        self.assertTrue(all(s['rawTagAndPayload']['hex'] == '110581' for s in slots))
        self.assertEqual(m['coverage']['dependencies'], 1)
        self.assertEqual((self.output / m['sounds'][0]['file']).read_bytes(), self.wav)
        self.assertEqual(before, snapshot(self.root / 'inputs'))

    def test_omission_has_no_inferred_fallback_or_runtime_policy(self):
        self.run_bundle(); m = json.loads((self.output / 'manifest.json').read_bytes())
        for slot in m['placements'][1]['slots']:
            self.assertEqual(slot['status'], 'omitted'); self.assertIsNone(slot['nativeDefaultOrFallback'])
        self.assertFalse(m['runtime']['connected']); self.assertFalse(m['runtime']['nativeDispatchVerified'])

    def test_explicit_null_and_partially_omitted_slots_remain_distinct(self):
        tags = self.actors[1]['properties']; tag = tags[2]
        tag['value'] = {'index': 0, 'object': None}; self.raw[tag['payload']['offset']] = 0
        tag['payload']['sha256'] = sha256_hex_digest(b'\0'); tags.pop(3); self.save()
        self.run_bundle(); slots = json.loads((self.output / 'manifest.json').read_bytes())['placements'][0]['slots']
        self.assertEqual([s['status'] for s in slots], ['explicit-null', 'omitted', 'source-declared'])

    def test_repeat_verify_and_clean_run_are_deterministic(self):
        first = self.run_bundle(); before = snapshot(self.root)
        self.assertEqual(self.run_bundle()['status'], 'preserved')
        self.assertEqual(self.run_bundle(verify_only=True)['status'], 'verified')
        self.assertEqual(snapshot(self.root), before)
        self.output = self.root / 'artifacts/clean'
        second = self.run_bundle(); self.assertEqual(first['files'], second['files'])

    def test_verify_requires_complete_output(self): self.fails_read_only('requires a complete', verify_only=True)

    def test_extra_output_is_preserved(self):
        self.run_bundle(); (self.output / 'authored.txt').write_bytes(b'keep')
        self.fails_read_only('file set differs')

    def test_changed_output_is_preserved(self):
        self.run_bundle(); (self.output / 'manifest.json').write_bytes(b'changed')
        self.fails_read_only('immutable output differs')

    def test_stale_raw_source_hash_is_rejected(self):
        (self.root / 'inputs/map/raw/map.unwrapped.bin').write_bytes(b'changed')
        self.fails_read_only('Input hash differs')

    def test_pinned_raw_payload_disagreement_is_rejected(self):
        tag = self.actors[1]['properties'][0]; self.raw[tag['payload']['offset']] = 0x82
        self.save(); self.fails_read_only('Source property bytes differ')

    def test_decoded_object_index_disagreement_is_rejected(self):
        self.actors[1]['properties'][0]['value']['index'] = -2; self.save()
        self.fails_read_only('Serialized object index differs')

    def test_group_less_leaf_alias_is_rejected(self):
        self.actors[1]['properties'][0]['value']['object'] = 'StepSound.Walk_01'; self.save()
        self.fails_read_only('Missing exact qualified Sound')

    def test_duplicate_source_slot_is_rejected(self):
        self.actors[1]['properties'].append(copy.deepcopy(self.actors[1]['properties'][0])); self.save()
        self.fails_read_only('Invalid source slot list|Duplicate/invalid source slot')

    def test_duplicate_casefold_placement_identity_is_rejected(self):
        other = copy.deepcopy(self.section['placements'][0]); other['id'] = other['id'].lower()
        self.section['placements'].append(other); self.save(requalify=False)
        self.fails_read_only('Duplicate/invalid placement')

    def test_missing_placement_qualification_is_rejected(self):
        self.proof['omittedPlacements'] = []; self.save(requalify=False)
        self.fails_read_only('cover selected placements exactly')

    def test_qualification_tag_mismatch_is_rejected(self):
        self.proof['placements'][0]['stepSounds'][0]['sourceTag']['offset'] += 1; self.save(requalify=False)
        self.fails_read_only('Source tag qualification differs')

    def test_source_mesh_mismatch_is_rejected(self):
        self.actors[1]['staticMesh']['object'] = 'Models.Wrong'; self.save()
        self.fails_read_only('Placement/source actor identity differs')

    def test_source_map_receipt_mismatch_is_rejected(self):
        self.recipe['source']['map']['sha256'] = sha256_hex_digest(b'different')
        self.write('recipes/bundle.json', json_bytes(self.recipe)); self.fails_read_only('Original map identity differs')

    def test_sound_export_provenance_mismatch_is_rejected(self):
        self.inventory['sounds'][0]['export']['exportIndex'] = 8; self.save()
        self.fails_read_only('Sound is not the unchanged qualified source payload|stable source identity differs')

    def test_sound_archive_payload_hash_is_checked(self):
        (self.root / 'inputs/corpus/cache/asset.l2asset').write_bytes(b'changed')
        self.fails_read_only('Input hash differs')

    def test_native_sound_payload_hash_is_checked(self):
        (self.root / 'inputs/corpus/source/native-payload.bin').write_bytes(b'changed')
        self.fails_read_only('Input hash differs')

    def test_missing_existing_sound_product_is_not_reexported(self):
        self.coverage['sounds'][0]['status'] = 'missing'; self.save()
        self.fails_read_only('Sound corpus provenance differs')

    def test_leaf_sound_collision_is_not_joined_by_alias(self):
        other = copy.deepcopy(self.proof['soundProducts'][0]); other['sourceActorReference'] = self.reference.lower()
        self.proof['soundProducts'].append(other); self.save(requalify=False)
        self.fails_read_only('Duplicate/invalid qualified sound')

    def test_public_output_and_input_overlap_are_rejected(self):
        self.output = self.root / 'public/audio'; self.fails_read_only('artifacts/scratch')
        self.output = self.root / 'artifacts'; self.fails_read_only('named artifacts/scratch')
        self.recipe['supportingEvidence'] = [self.write('artifacts/retained/pin.txt', b'source')]
        self.save(requalify=False); self.output = self.root / 'artifacts/retained/output'
        self.fails_read_only('overlaps an input')

    def test_input_path_escape_is_rejected(self):
        self.recipe['source']['actors']['path'] = '../actors.json'
        self.write('recipes/bundle.json', json_bytes(self.recipe)); self.fails_read_only('Unsafe')

    def test_duplicate_json_key_is_rejected(self):
        path = self.root / 'recipes/bundle.json'
        path.write_bytes(b'{"schemaVersion":1,"schemaVersion":1}')
        self.fails_read_only('Duplicate JSON key')

    def test_symlink_output_is_rejected(self):
        target = self.root / 'target'; target.mkdir(); self.output.parent.mkdir()
        try: self.output.symlink_to(target, target_is_directory=True)
        except OSError as error: self.skipTest('Windows symlink privilege unavailable: ' + str(error))
        self.fails_read_only('Symlink|reparse')


if __name__ == '__main__': unittest.main()
