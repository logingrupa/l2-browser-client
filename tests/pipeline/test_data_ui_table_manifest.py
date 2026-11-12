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
from actors.character_conversion import read_character_sources
from actors.character_requests import CHARACTER_CLASS_SOURCES_RELATIVE_PATH, CLASSINFO_TABLE_NAME, HAIRGRP_TABLE_NAME, HELMETGRP_TABLE_NAME
from catalog_store_fixture import write_store_catalog
from native_store.catalog_writer import CatalogWriteError
from native_store.data_ui_table_manifest import (DATA_UI_LANE_NAME, ELBERA_ADAPTER_ROUTE, LOCAL_DESCRIPTOR_ROUTE, DataUiTableManifestError,
                                                 data_ui_table_manifest)
from native_store.store_paths import StorePathError, lane_store_root
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, read_reference_client_lock

NPCGRP_TABLE_NAME = 'npcgrp'
NPCGRP_SOURCE_PATH = 'system/npcgrp.dat'
OUTSIDE_STORE_RESOURCE = '/l2/../outside-store.json'
UNLOCKED_SOURCE_SHA256 = '1' * 64
ELBERA_HAIRGRP_RECORDS = [[[0, 0], [1, 1], [-1, -1]], [[0, 0], [-1, 2], [-1, -1]]]
ELBERA_HELMETGRP_RECORDS = [{'key': 1, 'pairs': [[[0, 0], [1, 1]]]}]
DECODED_CHARGRP_TABLE = {'source': 'system/chargrp.dat', 'sourceSha256': 'a' * 64, 'data': {'Char': []}}


def locked_source_sha256(source_path):
    return read_reference_client_lock(REFERENCE_CLIENT_LOCK_PATH).record(source_path)['eSha256']


def locked_npcgrp_sha256():
    return locked_source_sha256(NPCGRP_SOURCE_PATH)


def decoded_table_manifest_payload(table_name, source_path, source_sha256, route, records):
    return json.dumps({'kind': 'native-table', 'schemaVersion': 1, 'table': table_name, 'sourcePath': source_path,
                       'sourceSha256': source_sha256, 'route': route, 'records': records}, sort_keys=True).encode()


def npcgrp_manifest_payload(source_sha256, table_name=NPCGRP_TABLE_NAME, route=LOCAL_DESCRIPTOR_ROUTE, records=None):
    return decoded_table_manifest_payload(table_name, NPCGRP_SOURCE_PATH, source_sha256, route, {} if records is None else records)


def write_pinned_tables_records(store_root, payloads_by_table):
    records = []
    for table_name, payload in payloads_by_table.items():
        manifest_sha256 = hashlib.sha256(payload).hexdigest()
        manifest_path = store_root / 'tables' / manifest_sha256 / f'{table_name}.json'
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_bytes(payload)
        records.append({'id': table_name, 'manifest': f'/l2/tables/{manifest_sha256}/{table_name}.json', 'manifestSha256': manifest_sha256,
                        'manifestBytes': len(payload), 'recordCount': 0, 'sourceSha256': json.loads(payload)['sourceSha256']})
    write_store_catalog(store_root, {'schemaVersion': 1, 'models': [], 'tables': records})


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

    def test_an_npc_profile_manifest_whose_byte_length_differs_from_its_pin_is_refused(self):
        payload = b'{"profiles": []}'
        manifest_sha256 = hashlib.sha256(payload).hexdigest()
        manifest_path = self.store_root / 'npc-profiles' / manifest_sha256 / 'manifest.json'
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_bytes(payload)
        record = {'id': 'native-npc-profiles', 'manifest': f'/l2/npc-profiles/{manifest_sha256}/manifest.json',
                  'manifestSha256': manifest_sha256, 'manifestBytes': len(payload) + 1}
        with self.assertRaisesRegex(CatalogWriteError, 'byte length differs'):
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

    def test_a_manifest_with_list_records_on_the_local_descriptor_route_is_refused(self):
        self.payload = npcgrp_manifest_payload(locked_npcgrp_sha256(), records=[])
        self.write_tables_record(self.pinned_resource(), len(self.payload))
        with self.assertRaisesRegex(DataUiTableManifestError, 'on the local-descriptor route with a sourcePath and dict records'):
            data_ui_table_manifest(self.project_root, NPCGRP_TABLE_NAME)

    def test_an_elbera_adapter_manifest_is_refused_where_the_caller_reads_the_local_descriptor_route(self):
        self.payload = npcgrp_manifest_payload(locked_npcgrp_sha256(), route=ELBERA_ADAPTER_ROUTE, records=[])
        self.write_tables_record(self.pinned_resource(), len(self.payload))
        with self.assertRaisesRegex(DataUiTableManifestError, 'on the local-descriptor route'):
            data_ui_table_manifest(self.project_root, NPCGRP_TABLE_NAME)

    def test_the_character_route_reads_elbera_adapter_hair_and_helmet_manifests_beside_a_local_descriptor_classinfo(self):
        payloads_by_table = {
            CLASSINFO_TABLE_NAME: decoded_table_manifest_payload(CLASSINFO_TABLE_NAME, f'system/{CLASSINFO_TABLE_NAME}.dat',
                                                                 locked_source_sha256(f'system/{CLASSINFO_TABLE_NAME}.dat'),
                                                                 LOCAL_DESCRIPTOR_ROUTE, {'class': []}),
            HAIRGRP_TABLE_NAME: decoded_table_manifest_payload(HAIRGRP_TABLE_NAME, f'system/{HAIRGRP_TABLE_NAME}.dat',
                                                               locked_source_sha256(f'system/{HAIRGRP_TABLE_NAME}.dat'),
                                                               ELBERA_ADAPTER_ROUTE, ELBERA_HAIRGRP_RECORDS),
            HELMETGRP_TABLE_NAME: decoded_table_manifest_payload(HELMETGRP_TABLE_NAME, f'system/{HELMETGRP_TABLE_NAME}.dat',
                                                                 locked_source_sha256(f'system/{HELMETGRP_TABLE_NAME}.dat'),
                                                                 ELBERA_ADAPTER_ROUTE, ELBERA_HELMETGRP_RECORDS)}
        write_pinned_tables_records(self.store_root, payloads_by_table)
        class_sources_path = self.project_root / CHARACTER_CLASS_SOURCES_RELATIVE_PATH
        class_sources_path.parent.mkdir(parents=True)
        class_sources_path.write_bytes((ROOT / CHARACTER_CLASS_SOURCES_RELATIVE_PATH).read_bytes())
        sources = read_character_sources(self.project_root, self.project_root, lambda client_root, table_name: DECODED_CHARGRP_TABLE,
                                         self.project_root / 'class-work')
        self.assertEqual((sources.classinfo['records'], sources.hairgrp['records'], sources.helmetgrp['records']),
                         ({'class': []}, ELBERA_HAIRGRP_RECORDS, ELBERA_HELMETGRP_RECORDS))

    def test_a_manifest_not_decoded_from_the_locked_client_file_is_refused_by_the_character_route(self):
        self.payload = npcgrp_manifest_payload(UNLOCKED_SOURCE_SHA256)
        self.write_tables_record(self.pinned_resource(), len(self.payload), source_sha256=UNLOCKED_SOURCE_SHA256)
        with self.assertRaises(DataUiTableManifestError):
            data_ui_table_manifest(self.project_root, NPCGRP_TABLE_NAME)


if __name__ == '__main__':
    unittest.main()
