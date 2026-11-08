import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
GOLDEN = ROOT / 'tests' / 'fixtures' / 'golden'
sys.path.insert(0, str(ROOT / 'scripts'))
from generate_golden_fixtures import write_golden_fixtures, fixture_pin_bytes
from native_assets import SOURCE_TO_GLTF
from native_assets_lib.asset_manifest import (SUPPORTED_ASSET_MANIFEST_VERSIONS, asset_coordinates, asset_coordinates_record,
    build_asset_manifest, reference_client_build, require_supported_asset_manifest, source_path_record)
from native_assets_lib.gltf import json_bytes


def golden_manifest(name):
    with zipfile.ZipFile(GOLDEN / name) as archive:
        return json.loads(archive.read('asset.json'))


class CoordinatesRecordTests(unittest.TestCase):
    def test_source_to_gltf_flips_handedness_into_a_right_handed_y_up_frame(self):
        self.assertEqual(asset_coordinates_record(SOURCE_TO_GLTF, 100),
            {'unit': 'metre', 'sourceUnitsPerMetre': 100, 'handedness': 'right', 'upAxis': 'Y', 'sourceToGltf': SOURCE_TO_GLTF})

    def test_rejects_a_matrix_with_positive_determinant(self):
        identity_scaled = [.01, 0, 0, 0, 0, .01, 0, 0, 0, 0, .01, 0, 0, 0, 0, 1]
        with self.assertRaisesRegex(ValueError, 'flip handedness'):
            asset_coordinates_record(identity_scaled, 100)

    def test_rejects_non_finite_matrix_and_non_positive_units(self):
        with self.assertRaisesRegex(ValueError, '16 finite numbers'):
            asset_coordinates_record(SOURCE_TO_GLTF[:15], 100)
        with self.assertRaisesRegex(ValueError, 'positive'):
            asset_coordinates_record(SOURCE_TO_GLTF, 0)


class ClientBuildTests(unittest.TestCase):
    def test_reads_the_canonical_lock_hash_and_engine_library_hash_from_the_lock(self):
        lock = json.loads((GOLDEN / 'reference-client-tree.lock.json').read_bytes())
        engine = dict(zip(lock['fileFields'], lock['files']['system/Engine.dll']))
        self.assertEqual(reference_client_build(GOLDEN / 'reference-client-tree.lock.json'),
            {'referenceTreeLockSha256': hashlib.sha256(json_bytes(lock)).hexdigest(), 'engineDllSha256': engine['importaSha256']})

    def test_refuses_when_the_lock_is_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'reference client lock missing: asset.json v2 needs clientBuild'):
                reference_client_build(Path(directory) / 'absent.lock.json')

    def test_refuses_when_engine_library_is_not_equal(self):
        lock = json.loads((GOLDEN / 'reference-client-tree.lock.json').read_bytes())
        lock['files']['system/Engine.dll'][0] = 'differs'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'lock.json'
            path.write_bytes(json_bytes(lock))
            with self.assertRaisesRegex(ValueError, 'as equal'):
                reference_client_build(path)


class SourcePathTests(unittest.TestCase):
    def test_records_host_and_posix_absolute_path(self):
        self.assertEqual(source_path_record('DATABASE-PC', 'E:\\Lineage2-client\\animations\\Fighter.ukx'),
            {'host': 'DATABASE-PC', 'absolutePath': 'E:/Lineage2-client/animations/Fighter.ukx'})

    def test_rejects_relative_paths(self):
        with self.assertRaisesRegex(ValueError, 'absolute'):
            source_path_record('DATABASE-PC', 'animations/Fighter.ukx')


class ManifestVersionTests(unittest.TestCase):
    def test_supports_versions_one_and_two_only(self):
        self.assertEqual(SUPPORTED_ASSET_MANIFEST_VERSIONS, (1, 2))
        for name in ('model-v1.l2asset', 'model-v2.l2asset', 'audio-v2.l2asset'):
            require_supported_asset_manifest(golden_manifest(name))
        for version in (0, 3, '2', True):
            manifest = golden_manifest('model-v2.l2asset')
            manifest['schemaVersion'] = version
            with self.assertRaisesRegex(ValueError, 'schemaVersion'):
                require_supported_asset_manifest(manifest)

    def test_rejects_version_two_without_derived_fields_or_with_wrong_frame(self):
        def without_coordinates(manifest):
            del manifest['coordinates']

        def left_handed(manifest):
            manifest['coordinates']['handedness'] = 'left'

        def without_client_build(manifest):
            del manifest['clientBuild']

        def short_converter_version(manifest):
            manifest['converterVersion'] = 'abc'

        def without_source_path(manifest):
            del manifest['source']['path']
        for edit in (without_coordinates, left_handed, without_client_build, short_converter_version, without_source_path):
            manifest = golden_manifest('model-v2.l2asset')
            edit(manifest)
            with self.assertRaises(ValueError, msg=edit.__name__):
                require_supported_asset_manifest(manifest)

    def test_builder_refuses_coordinates_on_audio_and_missing_coordinates_on_models(self):
        common = {'identity': 'SyntheticFixture.Object', 'source': {'edition': 'interlude'}, 'source_path': source_path_record('HOST', 'C:/a.ukx'),
            'client_build': {'referenceTreeLockSha256': '0' * 64, 'engineDllSha256': '1' * 64}, 'converter_version': '2' * 64,
            'limitations': [], 'animation_events': [], 'primary_file': 'audio.wav', 'files': []}
        with self.assertRaisesRegex(ValueError, 'carry coordinates'):
            build_asset_manifest(kind='audio', coordinates=asset_coordinates_record(SOURCE_TO_GLTF, 100), **common)
        with self.assertRaisesRegex(ValueError, 'carry coordinates'):
            build_asset_manifest(kind='model', **common)

    def test_asset_coordinates_reads_both_versions(self):
        self.assertEqual(asset_coordinates(golden_manifest('model-v2.l2asset'))['handedness'], 'right')
        version_one = asset_coordinates(golden_manifest('model-v1.l2asset'))
        self.assertEqual((version_one['unit'], version_one['sourceUnitsPerMetre'], version_one['sourceToGltf'], version_one['handedness']),
            ('metre', 100, SOURCE_TO_GLTF, None))


class GoldenFixtureTests(unittest.TestCase):
    def test_regeneration_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as directory:
            written = write_golden_fixtures(Path(directory))
            committed = sorted(path.relative_to(GOLDEN).as_posix() for path in GOLDEN.rglob('*') if path.is_file())
            self.assertEqual(written, committed)
            for relative_path in written:
                generated = (Path(directory) / relative_path).read_bytes()
                committed_bytes = (GOLDEN / relative_path).read_bytes()
                self.assertEqual(fixture_pin_bytes(relative_path, generated), fixture_pin_bytes(relative_path, committed_bytes), relative_path)

    def test_fixture_lock_matches_committed_files_in_sorted_order(self):
        lock = json.loads((GOLDEN / 'fixtures.lock.json').read_bytes())
        paths = [row['path'] for row in lock['files']]
        self.assertEqual(paths, sorted(paths))
        for row in lock['files']:
            pinned = fixture_pin_bytes(row['path'], (GOLDEN / row['path']).read_bytes())
            self.assertEqual((hashlib.sha256(pinned).hexdigest(), len(pinned)), (row['sha256'], row['bytes']), row['path'])

    def test_fixtures_carry_no_lineage_names(self):
        for name in ('model-v1.l2asset', 'model-v2.l2asset', 'audio-v2.l2asset'):
            with zipfile.ZipFile(io.BytesIO((GOLDEN / name).read_bytes())) as archive:
                manifest = json.loads(archive.read('asset.json'))
            self.assertTrue(manifest['source']['object'].startswith('SyntheticFixture.'))


if __name__ == '__main__':
    unittest.main()
