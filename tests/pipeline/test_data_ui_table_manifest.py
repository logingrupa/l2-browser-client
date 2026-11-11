import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests' / 'pipeline'))

from actors.actor_sound_batch import npc_profile_rows
from actors.actor_sound_conversion import ActorSoundConversionError, ActorSoundConversionRun
from catalog_store_fixture import write_store_catalog
from native_store.data_ui_table_manifest import DATA_UI_LANE_NAME, DataUiTableManifestError, data_ui_table_manifest
from native_store.store_paths import StorePathError, lane_store_root
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, read_reference_client_lock

NPCGRP_TABLE_NAME = 'npcgrp'
NPCGRP_SOURCE_PATH = 'system/npcgrp.dat'
OUTSIDE_STORE_RESOURCE = '/l2/../outside-store.json'
UNLOCKED_SOURCE_SHA256 = '1' * 64


def locked_npcgrp_sha256():
    return read_reference_client_lock(REFERENCE_CLIENT_LOCK_PATH).record(NPCGRP_SOURCE_PATH)['eSha256']


def npcgrp_manifest_payload(source_sha256, table_name=NPCGRP_TABLE_NAME):
    return json.dumps({'kind': 'native-table', 'schemaVersion': 1, 'table': table_name, 'sourcePath': NPCGRP_SOURCE_PATH,
                       'sourceSha256': source_sha256, 'records': {}}, sort_keys=True).encode()


class ClientTableSoundRun(ActorSoundConversionRun):
    def __init__(self, project_root, client_table_sha256):
        self.project_root = Path(project_root)
        self.tables = {NPCGRP_TABLE_NAME: {'identity': {'path': NPCGRP_SOURCE_PATH, 'sha256': client_table_sha256}}}


class DataUiTableManifestTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name).resolve() / 'project'
        (self.project_root / 'artifacts').mkdir(parents=True)
        self.store_root = lane_store_root(self.project_root, DATA_UI_LANE_NAME)
        self.payload = npcgrp_manifest_payload(locked_npcgrp_sha256())

    def write_tables_record(self, resource, manifest_bytes, manifest_sha256=None, source_sha256=None):
        manifest_path = self.store_root / resource[len('/l2/'):]
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_bytes(self.payload)
        write_store_catalog(self.store_root, {'schemaVersion': 1, 'models': [], 'tables': [
            {'id': NPCGRP_TABLE_NAME, 'manifest': resource, 'manifestSha256': manifest_sha256 or hashlib.sha256(self.payload).hexdigest(),
             'manifestBytes': manifest_bytes, 'recordCount': 0, 'sourceSha256': source_sha256 or locked_npcgrp_sha256()}]})

    def pinned_resource(self):
        return f'/l2/tables/{hashlib.sha256(self.payload).hexdigest()}/{NPCGRP_TABLE_NAME}.json'

    def test_the_sound_route_reads_a_pinned_manifest_decoded_from_the_locked_client_table(self):
        self.write_tables_record(self.pinned_resource(), len(self.payload))
        run = ClientTableSoundRun(self.project_root, locked_npcgrp_sha256())
        self.assertEqual(run.required_data_ui_table_manifest(NPCGRP_TABLE_NAME), json.loads(self.payload))

    def test_a_manifest_path_escaping_the_data_ui_store_is_refused_by_the_sound_route(self):
        self.write_tables_record(OUTSIDE_STORE_RESOURCE, len(self.payload))
        with self.assertRaises(DataUiTableManifestError):
            ClientTableSoundRun(self.project_root, locked_npcgrp_sha256()).required_data_ui_table_manifest(NPCGRP_TABLE_NAME)

    def test_a_manifest_whose_byte_length_differs_from_its_record_is_refused_by_the_sound_route(self):
        self.write_tables_record(self.pinned_resource(), len(self.payload) + 1)
        with self.assertRaises(DataUiTableManifestError):
            ClientTableSoundRun(self.project_root, locked_npcgrp_sha256()).required_data_ui_table_manifest(NPCGRP_TABLE_NAME)

    def test_a_manifest_not_decoded_from_the_current_client_table_is_refused_by_the_sound_route(self):
        self.write_tables_record(self.pinned_resource(), len(self.payload))
        with self.assertRaises(ActorSoundConversionError):
            ClientTableSoundRun(self.project_root, 'f' * 64).required_data_ui_table_manifest(NPCGRP_TABLE_NAME)

    def test_a_missing_tables_record_is_absent_for_the_character_route_and_refused_by_the_sound_route(self):
        self.assertIsNone(data_ui_table_manifest(self.project_root, NPCGRP_TABLE_NAME))
        with self.assertRaises(ActorSoundConversionError):
            ClientTableSoundRun(self.project_root, locked_npcgrp_sha256()).required_data_ui_table_manifest(NPCGRP_TABLE_NAME)

    def test_an_npc_profile_manifest_escaping_the_store_is_refused(self):
        (self.store_root.parent / 'outside-store.json').parent.mkdir(parents=True, exist_ok=True)
        (self.store_root.parent / 'outside-store.json').write_bytes(b'{"profiles": []}')
        record = {'id': 'native-npc-profiles', 'manifest': OUTSIDE_STORE_RESOURCE,
                  'manifestSha256': hashlib.sha256(b'{"profiles": []}').hexdigest()}
        with self.assertRaises(StorePathError):
            npc_profile_rows(self.store_root, {'npcProfiles': [record]})


    def test_a_manifest_whose_sha256_differs_from_its_record_is_refused_by_the_character_route(self):
        self.write_tables_record(self.pinned_resource(), len(self.payload), manifest_sha256='0' * 64)
        with self.assertRaises(DataUiTableManifestError):
            data_ui_table_manifest(self.project_root, NPCGRP_TABLE_NAME)

    def test_a_manifest_of_another_table_is_refused_by_the_character_route(self):
        self.payload = npcgrp_manifest_payload(locked_npcgrp_sha256(), table_name='classinfo')
        self.write_tables_record(self.pinned_resource(), len(self.payload))
        with self.assertRaisesRegex(DataUiTableManifestError, 'must be a native-table v1 manifest of npcgrp'):
            data_ui_table_manifest(self.project_root, NPCGRP_TABLE_NAME)

    def test_a_manifest_not_decoded_from_the_locked_client_file_is_refused_by_the_character_route(self):
        self.payload = npcgrp_manifest_payload(UNLOCKED_SOURCE_SHA256)
        self.write_tables_record(self.pinned_resource(), len(self.payload), source_sha256=UNLOCKED_SOURCE_SHA256)
        with self.assertRaises(DataUiTableManifestError):
            data_ui_table_manifest(self.project_root, NPCGRP_TABLE_NAME)


if __name__ == '__main__':
    unittest.main()
