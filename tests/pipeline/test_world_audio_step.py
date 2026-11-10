import hashlib
import inspect
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib.world_ambience import FIELDS
from native_store.gap_rows import is_listed_reason, load_gap_reason_patterns
from reference_client_guard import ReferenceClientLockError
import world.exact_sound_sources as exact_sound_sources
from world.ambient_sound_inventory import AmbientEmitterUnreadable, ambient_emitter_row, inventory_ambient_sounds
from world.exact_sound_sources import ConvertedSound, ResolvedSound, SoundSourceGap, convert_exact_sound, resolve_exact_sound
from world.placement_audio_inventory import inventory_placement_audio, placement_audio_properties
from world.tile_step_gap_rows import TileStepGapRows
from world.world_audio_step import (CORE_LIBRARY_PATH, PLACEMENT_AUDIO_KIND, WORLD_AUDIO_STEP_ALGORITHM_VERSION, WORLD_AUDIO_STEP_NAME,
                                    core_library_radius, placement_audio_bundle)

REFERENCE_CLIENT = Path('E:/Lineage2-client')
STAGED_AMBIENCE_MANIFEST = ROOT / 'public/l2/world-audio/e2fe18be38caf3a8476e194b0ad1641b62f04dbd9dd1925f4c09ddd5d8e74a01/manifest.json'
STAGED_AMBIENCE_MANIFEST_SHA256 = 'e2fe18be38caf3a8476e194b0ad1641b62f04dbd9dd1925f4c09ddd5d8e74a01'
TILE_ID = '00_00'
SOURCE_IDENTITY = {'path': f'maps/{TILE_ID}.unr', 'sha256': hashlib.sha256(b'synthetic audio tile').hexdigest()}
EVIDENCE = f'work/tile__{TILE_ID}/audio/receipt.json'


def wav_bytes(frames=8):
    body = b'\0\0' * frames
    fmt = struct.pack('<HHIIHH', 1, 1, 22050, 44100, 2, 16)
    return b'RIFF' + struct.pack('<I', 4 + 8 + len(fmt) + 8 + len(body)) + b'WAVE' + b'fmt ' + struct.pack('<I', len(fmt)) + fmt + \
        b'data' + struct.pack('<I', len(body)) + body


class FakeSoundPackages:
    def __init__(self, packages_by_path):
        self.packages_by_path = packages_by_path

    def candidates(self, reference):
        return [path for path in self.packages_by_path if Path(path).stem.casefold() == reference.split('.')[0].casefold()]

    def package(self, relative):
        return self.packages_by_path[relative]


def sound_package(*exports):
    return SimpleNamespace(source_hash='a' * 64, exports=[{'object': name, 'className': class_name, 'exportIndex': index + 1}
                                                          for index, (name, class_name) in enumerate(exports)])


def property_tag(name, value, array_index=None):
    return {'name': name, 'value': value, 'arrayIndex': array_index, 'status': 'decoded'}


def ambient_item(properties, reference=None):
    declaration = {'class': 'AmbientSoundObject', 'object': f'{TILE_ID}.AmbientSoundObject1', 'properties': properties}
    item = {'object': f'{TILE_ID}.AmbientSoundObject1', 'exportIndex': 7, 'declaration': declaration}
    if reference is not None:
        item['soundReference'] = reference
    return item


class ExactSoundTests(unittest.TestCase):
    def test_a_casefold_equal_full_name_in_the_one_named_package_resolves(self):
        packages = FakeSoundPackages({'sounds/AmbSound.uax': sound_package(('AmbSound.Wind.gust', 'Sound'))})
        with patch.object(exact_sound_sources, 'sound_payload', return_value=(b'payload', {'nativeFormat': 'WAV'})):
            resolved = resolve_exact_sound(packages, 'ambsound.WIND.Gust')
        self.assertEqual((resolved.package_path, resolved.export['object'], resolved.payload), ('sounds/AmbSound.uax', 'AmbSound.Wind.gust', b'payload'))

    def test_a_leaf_name_match_a_wrong_class_or_two_packages_stay_unresolved(self):
        cases = {'leaf only': (FakeSoundPackages({'sounds/AmbSound.uax': sound_package(('AmbSound.Other.gust', 'Sound'))}), 'AmbSound.Wind.gust'),
                 'wrong class': (FakeSoundPackages({'sounds/AmbSound.uax': sound_package(('AmbSound.Wind.gust', 'Texture'))}), 'AmbSound.Wind.gust'),
                 'two packages': (FakeSoundPackages({'sounds/AmbSound.uax': sound_package(), 'music/AmbSound.uax': sound_package()}), 'AmbSound.Wind.gust'),
                 'unqualified': (FakeSoundPackages({}), 'gust')}
        for label, (packages, reference) in cases.items():
            with self.subTest(label), self.assertRaises(SoundSourceGap) as caught:
                resolve_exact_sound(packages, reference)
            self.assertEqual(caught.exception.reason, 'sound-identity-unresolved')

    def converted_archive(self, directory, encoded_audio_unchanged, audio):
        resolved = ResolvedSound('AmbSound.Wind.gust', 'sounds/AmbSound.uax', 'a' * 64, {'object': 'AmbSound.Wind.gust', 'exportIndex': 3}, audio, {})
        provenance = json.dumps({'request': {'kind': 'audio', 'package': 'sounds/AmbSound.uax', 'object': 'AmbSound.Wind.gust'},
                                 'metadata': {'encodedAudioUnchanged': encoded_audio_unchanged, 'nativeExportIndex': 3,
                                              'nativePayloadSha256': hashlib.sha256(audio).hexdigest()}}).encode()
        asset = json.dumps({'kind': 'audio', 'source': {'object': 'AmbSound.Wind.gust'}, 'audio': {'file': 'audio.wav'}}).encode()
        archive_path = Path(directory) / f'{encoded_audio_unchanged}.l2asset'
        with zipfile.ZipFile(archive_path, 'w') as archive:
            archive.writestr('asset.json', asset)
            archive.writestr('provenance.json', provenance)
            archive.writestr('audio.wav', audio)
        return resolved, SimpleNamespace(convert=lambda request: {'file': str(archive_path)})

    def test_a_converted_wav_must_record_its_payload_unchanged(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(exact_sound_sources, 'verify_archive', return_value={'sha256': 'b' * 64}):
            resolved, converter = self.converted_archive(directory, True, wav_bytes())
            self.assertEqual(convert_exact_sound(converter, resolved).wav, wav_bytes())
            resolved, converter = self.converted_archive(directory, False, wav_bytes())
            with self.assertRaises(SoundSourceGap) as caught:
                convert_exact_sound(converter, resolved)
        self.assertEqual(caught.exception.reason, 'sound-payload-unverified:encodedAudioUnchanged')


class AmbientInventoryTests(unittest.TestCase):
    def test_the_inventory_takes_no_expected_counts(self):
        self.assertEqual(list(inspect.signature(inventory_ambient_sounds).parameters), ['package', 'raw_path'])

    def test_an_emitter_keeps_null_for_omitted_fields_and_its_casefold_sound_key(self):
        location = {'X': 1.0, 'Y': 2.0, 'Z': 3.0}
        row = ambient_emitter_row(ambient_item([property_tag('Location', location), property_tag('SoundVolume', 250)], 'AmbSound.Wind.Gust'),
                                  {'ambsound.wind.gust'})
        values = dict(zip(FIELDS, row))
        self.assertEqual((values['soundRadius'], values['soundVolume'], values['sound'], values['x']), (None, 250, 'ambsound.wind.gust', 1.0))
        self.assertIsNone(dict(zip(FIELDS, ambient_emitter_row(ambient_item([property_tag('Location', location)], 'AmbSound.Wind.Gust'), set())))['sound'])

    def test_an_emitter_without_a_decoded_location_is_unreadable(self):
        with self.assertRaises(AmbientEmitterUnreadable):
            ambient_emitter_row(ambient_item([property_tag('SoundRadius', 90.0)]), set())


class PlacementAudioTests(unittest.TestCase):
    def test_the_placement_recipe_names_the_step_sound_properties(self):
        self.assertEqual(placement_audio_properties(), ('StepSound_1', 'StepSound_2', 'StepSound_3'))

    def test_each_static_mesh_actor_lists_its_step_sounds_or_null_in_property_order(self):
        actors = [{'id': f'interlude:{TILE_ID}.StaticMeshActor{index}', 'object': f'{TILE_ID}.StaticMeshActor{index}', 'exportIndex': index,
                   'classObject': 'Engine.StaticMeshActor', 'properties': properties}
                  for index, properties in ((9, [property_tag('StepSound_2', {'index': -3, 'object': 'StepSound.Wood.walk_02'})]), (4, []))]
        placements = inventory_placement_audio(actors, ('StepSound_1', 'StepSound_2', 'StepSound_3'))
        self.assertEqual(placements, [{'placementId': f'interlude:{TILE_ID}.StaticMeshActor9', 'exportIndex': 9,
                                       'references': [None, 'StepSound.Wood.walk_02', None]}])

    def test_casefold_equal_references_share_one_converted_sound(self):
        wav = wav_bytes()
        resolved = ResolvedSound('StepSound.Wood.walk_02', 'sounds/StepSound.uax', 'a' * 64, {'object': 'StepSound.Wood.walk_02', 'exportIndex': 2}, wav, {})
        sounds = SimpleNamespace(converted={'stepsound.wood.walk_02': ConvertedSound(resolved, wav, {'channels': 1}, 'b' * 64)},
                                 available=lambda: {'stepsound.wood.walk_02'})
        placements = [{'placementId': 'interlude:00_00.StaticMeshActor1', 'references': ['StepSound.Wood.walk_02']},
                      {'placementId': 'interlude:00_00.StaticMeshActor2', 'references': ['STEPSOUND.wood.WALK_02']}]
        files, coverage = placement_audio_bundle(TILE_ID, {'eSha256': SOURCE_IDENTITY['sha256']}, placements, ('StepSound_1',), sounds,
                                                 TileStepGapRows(TILE_ID, WORLD_AUDIO_STEP_NAME, SOURCE_IDENTITY, EVIDENCE))
        manifest = json.loads(files['manifest.json'])
        self.assertEqual(manifest['kind'], PLACEMENT_AUDIO_KIND)
        self.assertEqual([row['sounds'] for row in manifest['placements']], [['stepsound.wood.walk_02'], ['stepsound.wood.walk_02']])
        self.assertEqual([(sound['key'], sound['occurrences']) for sound in manifest['sounds']], [('stepsound.wood.walk_02', 2)])
        self.assertEqual(coverage, {'placements': 2, 'sounds': 1})
        self.assertEqual(files[manifest['sounds'][0]['file']], wav)


class RadiusTests(unittest.TestCase):
    def test_a_core_library_that_is_not_lock_equal_is_a_named_gap(self):
        def refuse(relative_path):
            raise ReferenceClientLockError(f'{relative_path} is not equal')
        gaps = TileStepGapRows(TILE_ID, WORLD_AUDIO_STEP_NAME, SOURCE_IDENTITY, EVIDENCE)
        self.assertIsNone(core_library_radius(SimpleNamespace(require_equal_file_with_locked_sha256=refuse), gaps))
        self.assertEqual([row['reason'] for row in gaps.rows()], [f'reference-file-not-lock-equal:{CORE_LIBRARY_PATH}'])

    def test_the_radius_symbols_live_in_the_world_recipe(self):
        recipe = json.loads((ROOT / 'recipes/world/ambience-radius-symbols.json').read_text(encoding='utf-8'))
        self.assertEqual((recipe['radiusMultiplier']['export'], recipe['radiusMultiplier']['defaultRadiusExport']),
                         ('?GAudioMaxRadiusMultiplier@@3MA', '?GAudioDefaultRadius@@3MA'))


class WorldAudioRecordTests(unittest.TestCase):
    def test_the_step_name_version_and_reasons_are_registered(self):
        self.assertEqual((WORLD_AUDIO_STEP_NAME, WORLD_AUDIO_STEP_ALGORITHM_VERSION), ('audio', 1))
        patterns = load_gap_reason_patterns(ROOT)
        for reason in ('ambient-emitter-unreadable', 'reference-file-not-lock-equal:system/Core.dll', 'sound-identity-unresolved',
                       'sound-payload-unverified:wav'):
            self.assertTrue(is_listed_reason(reason, patterns), reason)


@unittest.skipUnless(REFERENCE_CLIENT.is_dir() and STAGED_AMBIENCE_MANIFEST.is_file(),
                     'the conversion client E:/Lineage2-client or the staged 20_20 ambience in public/l2 is absent')
class RealClientAudioTests(unittest.TestCase):
    def test_the_20_20_ambient_counts_equal_the_staged_ambience(self):
        from native_store.store_paths import REPOSITORY_ROOT
        from world.raw_map_step import read_tile_map_lock_record
        from world.tile_chunk_plan import raw_unit_fingerprint
        from world.world_audio_step import AMBIENCE_KIND, convert_tile_audio
        staged_bytes = STAGED_AMBIENCE_MANIFEST.read_bytes()
        self.assertEqual(hashlib.sha256(staged_bytes).hexdigest(), STAGED_AMBIENCE_MANIFEST_SHA256)
        staged = json.loads(staged_bytes)
        lock_record = read_tile_map_lock_record('20_20')
        gaps = TileStepGapRows('20_20', WORLD_AUDIO_STEP_NAME, {'path': 'maps/20_20.unr', 'sha256': lock_record['eSha256']}, EVIDENCE)
        bundles, coverage, _ = convert_tile_audio(REPOSITORY_ROOT, REFERENCE_CLIENT.resolve(), '20_20', lock_record,
                                                  raw_unit_fingerprint(REPOSITORY_ROOT, '20_20', lock_record)[1], gaps)
        self.assertEqual(gaps.rows(), [])
        self.assertEqual({key: coverage['ambience'][key] for key in staged['coverage']}, staged['coverage'])
        ambience = json.loads(dict(bundles)[AMBIENCE_KIND]['manifest.json'])
        self.assertEqual(ambience['emitters'], staged['emitters'])
        self.assertEqual([sound['sha256'] for sound in ambience['sounds']], [sound['sha256'] for sound in staged['sounds']])


if __name__ == '__main__':
    unittest.main()
