import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from reference_client_guard import ReferenceClientLockError
from world import export_texture_sampler_fixtures
from world.export_day_night_fixtures import DayNightFixtureError
from world.export_texture_sampler_fixtures import (TEXTURE_SAMPLERS_MANIFEST_SHA256, TEXTURE_SAMPLERS_REPORT_SHA256, live_texture, live_texture_package_path,
                                                   pinned_texture_samplers_report)

FIXTURES_FILE = ROOT / 'tests' / 'fixtures' / 'rm25' / 'texture-samplers-native.json'
REFERENCE_CLIENT_TREE_LOCK = ROOT / 'recipes' / 'reference-client-tree.lock.json'


def locked_package_sha256(relative_path):
    lock = json.loads(REFERENCE_CLIENT_TREE_LOCK.read_bytes())
    return lock['files'][relative_path][lock['fileFields'].index('eSha256')]


def committed_document():
    return json.loads(FIXTURES_FILE.read_bytes())


class CommittedTextureSamplerFixturesTests(unittest.TestCase):
    def test_the_committed_file_names_the_pinned_report_and_manifest(self):
        source = committed_document()['source']
        self.assertEqual((source['reportSha256'], source['manifestSha256']), (TEXTURE_SAMPLERS_REPORT_SHA256, TEXTURE_SAMPLERS_MANIFEST_SHA256))

    def test_the_committed_file_holds_every_report_fixture(self):
        fixtures = committed_document()['fixtures']
        self.assertEqual((len(fixtures['mips']), len(fixtures['mipMappings']), len(fixtures['samplers'])), (16, 6, 10))

    def test_the_committed_live_stages_hold_the_seven_bound_textures(self):
        stages = [stage for sample in committed_document()['liveSummary'] for stage in sample['boundStages']]
        self.assertEqual(len(stages), 7)
        self.assertEqual({stage['lodBias'] for stage in stages}, {-0.5})

    def test_the_committed_live_textures_were_read_from_lock_equal_packages(self):
        textures = committed_document()['liveTextures']
        self.assertEqual(len(textures), 6)
        for texture in textures:
            self.assertEqual(texture['packageSha256'], locked_package_sha256(texture['package']))
            self.assertEqual(len(texture['storedMipDimensions']), texture['storedMipCount'])

    def test_the_committed_configuration_names_the_runtime_globals(self):
        configuration = committed_document()['configuration']
        self.assertEqual(configuration['runtimeGlobals'], {'GL2UseTrilinear': 1, 'GL2TextureDetail': 0, 'GL2KeepMinFrameRate': 0})
        self.assertEqual(configuration['l2Ini']['DefaultTexMipBias'], '-0.5')
        self.assertEqual(configuration['optionIni']['TextureDetail'], '0')


class LiveTexturePackagePathTests(unittest.TestCase):
    def test_the_package_is_the_lowercased_first_name_under_textures(self):
        self.assertEqual(live_texture_package_path('L2_Skies.Textures.WhiteChip'), 'textures/l2_skies.utx')
        self.assertEqual(live_texture_package_path('cruma_tr_t.Cm_o_wall008'), 'textures/cruma_tr_t.utx')

    def test_a_client_root_without_the_lock_equal_engine_library_is_refused_before_a_package_is_read(self):
        with tempfile.TemporaryDirectory() as client_root:
            with self.assertRaisesRegex(ReferenceClientLockError, 'has no system/Engine.dll'):
                live_texture(client_root, {}, 'L2_Skies.Textures.WhiteChip', {})


class PinnedReportTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.root = Path(temporary_directory.name).resolve()
        (self.root / 'texture-samplers-rm25').mkdir()
        self.report = self.root / 'texture-samplers.json'
        self.report.write_bytes(b'{"fixtures": {}}')
        self.report_sha256 = hashlib.sha256(self.report.read_bytes()).hexdigest()

    def write_manifest(self, listed_sha256):
        manifest = self.root / 'texture-samplers-rm25' / 'manifest.json'
        manifest.write_bytes(json.dumps({'files': [{'file': 'texture-samplers.json', 'sha256': listed_sha256}]}).encode('utf-8'))
        return hashlib.sha256(manifest.read_bytes()).hexdigest()

    def read(self, report_sha256, manifest_sha256):
        with patch.object(export_texture_sampler_fixtures, 'TEXTURE_SAMPLERS_REPORT_SHA256', report_sha256), \
                patch.object(export_texture_sampler_fixtures, 'TEXTURE_SAMPLERS_MANIFEST_SHA256', manifest_sha256):
            return pinned_texture_samplers_report(self.root)

    def test_a_report_listed_by_the_pinned_manifest_is_read(self):
        manifest_sha256 = self.write_manifest(self.report_sha256)
        self.assertEqual(self.read(self.report_sha256, manifest_sha256), {'fixtures': {}})

    def test_a_report_with_another_sha256_is_refused(self):
        manifest_sha256 = self.write_manifest('0' * 64)
        with self.assertRaisesRegex(DayNightFixtureError, 'differs from the pinned'):
            self.read('0' * 64, manifest_sha256)

    def test_a_manifest_that_lists_another_report_is_refused(self):
        manifest_sha256 = self.write_manifest('1' * 64)
        with self.assertRaisesRegex(DayNightFixtureError, 'manifest lists'):
            self.read(self.report_sha256, manifest_sha256)


if __name__ == '__main__':
    unittest.main()
