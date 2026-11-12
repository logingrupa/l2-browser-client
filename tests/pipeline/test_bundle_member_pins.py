import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_assets_lib.gltf import json_bytes
from native_store.catalog_writer import CatalogWriteError, pinned_store_files
from native_store.merge_lane_store import LaneStoreMergeRefusedError, merge_lane_store
from native_store import pinned_store_verification
from native_store.pinned_store_verification import verify_pinned_store_files
from native_store.store_paths import StorePathError, lane_store_root
from native_store.write_lane_catalog import write_lane_catalog

GOLDEN_ROOT = ROOT / 'tests' / 'fixtures' / 'golden'
GOLDEN_CATALOG_BYTES = (GOLDEN_ROOT / 'l2' / 'catalog.json').read_bytes()
NATIVE_RESOURCE_PREFIX = '/l2/'
PROFILE_RECORD_ID = 'interlude:npc-profiles:synthetic-fixture'
SYNTHETIC_NPC_MODEL_CATALOG_ID = 'npc-model:' + '6' * 64
RAW_CLASS_EXPORT = 'source/classes/SyntheticFixture.Actor.bin'
CLASS_DEFINITION = 'source/classes/SyntheticFixture.Actor.json'
SOURCE_SELECTIONS = 'source/npc-selections.json'
POOLED_WALK_WORKER_COUNT = 2
POOLED_WALK_PROGRAM = '\n'.join([
    'import json, sys',
    'from pathlib import Path',
    'sys.path.insert(0, sys.argv[1])',
    'from native_store import pinned_store_verification',
    'pinned_store_verification.POOLED_LEVEL_MINIMUM_REFERENCE_COUNT = 1',
    'pool_worker_counts = []',
    'class RecordingProcessPoolExecutor(pinned_store_verification.ProcessPoolExecutor):',
    '    def __init__(self, max_workers):',
    '        pool_worker_counts.append(max_workers)',
    '        super().__init__(max_workers=max_workers)',
    'pinned_store_verification.ProcessPoolExecutor = RecordingProcessPoolExecutor',
    'catalog = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))',
    'try:',
    '    verified = pinned_store_verification.verify_pinned_store_files(Path(sys.argv[2]), catalog, int(sys.argv[4]))',
    '    outcome = {"verifiedSha256ByStoreFileKey": verified}',
    'except Exception as refusal:',
    '    outcome = {"refusalType": type(refusal).__module__ + "." + type(refusal).__qualname__, "refusalMessage": str(refusal)}',
    'print(json.dumps({**outcome, "poolWorkerCounts": pool_worker_counts}))',
])

try:
    import _winapi
    JUNCTION_FACTORY = _winapi.CreateJunction
    JUNCTION_UNAVAILABLE_REASON = None
except (ImportError, AttributeError) as error:
    JUNCTION_FACTORY = None
    JUNCTION_UNAVAILABLE_REASON = f'NTFS junctions unavailable: {error}'


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


def write_file(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def snapshot_tree(root):
    return {path.relative_to(root).as_posix(): (path.read_bytes(), path.stat().st_mtime_ns)
            for path in sorted(root.rglob('*')) if path.is_file()}


def bundle_member_pin(member, payload):
    return {'file': member, 'bytes': len(payload), 'sha256': sha256_hex(payload)}


def synthetic_profile_bundle_members():
    selections = json_bytes({'tables': {'npcgrp': {'schema': {'file': 'npcgrp.xml', 'sha256': '4' * 64, 'layout': 'synthetic'}}},
                             'selections': [{'id': 20001}]})
    definition = json_bytes({'object': 'SyntheticFixture.Actor', 'rawExport': RAW_CLASS_EXPORT})
    return {RAW_CLASS_EXPORT: b'synthetic raw class export bytes', CLASS_DEFINITION: definition, SOURCE_SELECTIONS: selections}


def synthetic_profile_manifest(member_pins):
    return {'schemaVersion': 1, 'id': 'synthetic-fixture-npc-profiles', 'kind': 'native-npc-profiles',
            'profiles': [{'npcId': 20001, 'mesh': 'SyntheticFixture.Mesh', 'modelCatalogId': SYNTHETIC_NPC_MODEL_CATALOG_ID}],
            'sourceFiles': [{'path': 'system/SyntheticFixture.u', 'bytes': 10, 'sha256': '5' * 64}],
            'sourceSelections': SOURCE_SELECTIONS, 'classDefinitions': ['SyntheticFixture.Actor'], 'files': member_pins}


class ProfileBundle:
    def __init__(self, members, member_pins=None, manifest_folder='npc-profiles'):
        self.members = members
        self.manifest_bytes = json_bytes(synthetic_profile_manifest(member_pins or [bundle_member_pin(name, payload)
                                                                                     for name, payload in sorted(members.items())]))
        self.manifest_sha256 = sha256_hex(self.manifest_bytes)
        self.folder = f'{manifest_folder}/{self.manifest_sha256}' if manifest_folder else ''
        self.manifest_relative = f'{self.folder}/manifest.json' if self.folder else 'manifest.json'
        self.record = {'id': PROFILE_RECORD_ID, 'manifest': NATIVE_RESOURCE_PREFIX + self.manifest_relative,
                       'manifestSha256': self.manifest_sha256, 'manifestBytes': len(self.manifest_bytes)}

    def member_relative(self, member):
        return f'{self.folder}/{member}' if self.folder else member

    def write(self, store_root, source_catalog_sha256=None):
        catalog = {'schemaVersion': 1, 'models': [], 'npcProfiles': [self.record]}
        if source_catalog_sha256 is not None:
            catalog['sourceCatalogSha256'] = source_catalog_sha256
        write_file(store_root / 'catalog.json', json_bytes(catalog))
        write_file(store_root / self.manifest_relative, self.manifest_bytes)
        write_file(store_root / self.member_relative('receipt.json'), b'{"schemaVersion":1}')
        for member, payload in self.members.items():
            write_file(store_root / self.member_relative(member), payload)
        return catalog

    def pinned_relative_paths(self):
        return sorted([self.manifest_relative, *(self.member_relative(member) for member in self.members)])


class TemporaryStoreTestCase(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.temporary_root = Path(temporary_directory.name).resolve()
        process_pool_guard = patch.object(pinned_store_verification, 'ProcessPoolExecutor', side_effect=AssertionError(
            'the unittest process must not start a pool; use pooled_walk_outcome'))
        process_pool_guard.start()
        self.addCleanup(process_pool_guard.stop)

    def make_junction(self, link, target):
        if JUNCTION_FACTORY is None:
            self.skipTest(JUNCTION_UNAVAILABLE_REASON)
        link.parent.mkdir(parents=True, exist_ok=True)
        JUNCTION_FACTORY(str(target), str(link))
        self.addCleanup(os.rmdir, link)

    def pooled_walk_outcome(self, store_root, catalog):
        catalog_file = self.temporary_root / 'pooled-walk-catalog.json'
        catalog_file.write_text(json.dumps(catalog), encoding='utf-8')
        completed = subprocess.run([sys.executable, '-B', '-c', POOLED_WALK_PROGRAM, str(ROOT / 'scripts'), str(store_root), str(catalog_file),
                                    str(POOLED_WALK_WORKER_COUNT)], capture_output=True, text=True, check=False)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return json.loads(completed.stdout)

    def assert_every_walk_verifies(self, store_root, catalog):
        verified = {key: sha256_hex(payload) for key, (_, payload) in pinned_store_files(store_root, catalog).items()}
        self.assertEqual(verify_pinned_store_files(store_root, catalog, POOLED_WALK_WORKER_COUNT), verified)
        self.assertEqual(self.pooled_walk_outcome(store_root, catalog),
                         {'verifiedSha256ByStoreFileKey': verified, 'poolWorkerCounts': [POOLED_WALK_WORKER_COUNT]})

    def assert_every_walk_refuses(self, error_type, message_pattern, store_root, catalog, pool_worker_counts=(POOLED_WALK_WORKER_COUNT,)):
        with self.assertRaisesRegex(error_type, message_pattern) as collecting_walk:
            pinned_store_files(store_root, catalog)
        refusal_type, refusal_message = type(collecting_walk.exception), str(collecting_walk.exception)
        with self.assertRaises(refusal_type) as verify_only_walk:
            verify_pinned_store_files(store_root, catalog, POOLED_WALK_WORKER_COUNT)
        self.assertIs(type(verify_only_walk.exception), refusal_type)
        self.assertEqual(str(verify_only_walk.exception), refusal_message)
        self.assertEqual(self.pooled_walk_outcome(store_root, catalog),
                         {'refusalType': f'{refusal_type.__module__}.{refusal_type.__qualname__}', 'refusalMessage': refusal_message,
                          'poolWorkerCounts': list(pool_worker_counts)})


class ProfileBundleProjectTestCase(TemporaryStoreTestCase):
    def setUp(self):
        super().setUp()
        self.project = self.temporary_root / 'project'
        (self.project / 'artifacts').mkdir(parents=True)
        write_file(self.project / 'public' / 'l2' / 'catalog.json', GOLDEN_CATALOG_BYTES)
        self.actors_store = lane_store_root(self.project, 'actors')
        self.bundle = ProfileBundle(synthetic_profile_bundle_members())
        self.bundle.write(self.actors_store)


class ProfileBundleLaneTests(ProfileBundleProjectTestCase):
    def test_a_profile_bundle_manifest_pins_its_files_by_relative_path_and_members_are_never_parsed_for_pins(self):
        catalog = json.loads((self.actors_store / 'catalog.json').read_bytes())
        files = pinned_store_files(self.actors_store, catalog)
        self.assertEqual(sorted(relative for relative, _ in files.values()), self.bundle.pinned_relative_paths())
        for member, payload in self.bundle.members.items():
            self.assertEqual(files[self.bundle.member_relative(member).casefold()], (self.bundle.member_relative(member), payload))

    def test_the_lane_catalog_pins_the_bundle_and_plan_prints_the_restage_command(self):
        subprocess.run(['git', 'init', '--quiet', str(self.project)], check=True, capture_output=True)
        summary = write_lane_catalog(self.project, 'actors')
        self.assertEqual(summary['recordsBySlice'], {'models': 0, 'npcProfiles': 1})
        catalog = json.loads((self.actors_store / 'catalog.json').read_bytes())
        self.assertEqual(catalog['sourceCatalogSha256'], sha256_hex(GOLDEN_CATALOG_BYTES))
        snapshot = snapshot_tree(self.project)
        plan = write_lane_catalog(self.project, 'actors', plan_only=True)
        self.assertEqual(plan['filesWritten'], 0)
        self.assertIn(f'--lane-store {self.actors_store.as_posix()} --target public/l2 '
                      f'--expected-base-catalog-sha256 {sha256_hex(GOLDEN_CATALOG_BYTES)}', plan['restageCommand'])
        self.assertEqual(snapshot_tree(self.project), snapshot)

    def test_a_union_lane_takes_the_bundle_files_and_the_profile_record(self):
        write_lane_catalog(self.project, 'actors')
        write_lane_catalog(self.project, 'integration', ('actors',))
        integration_store = lane_store_root(self.project, 'integration')
        self.assertEqual(json.loads((integration_store / 'catalog.json').read_bytes())['npcProfiles'], [self.bundle.record])
        for relative in self.bundle.pinned_relative_paths():
            self.assertEqual((integration_store / relative).read_bytes(), (self.actors_store / relative).read_bytes())

    def test_the_merge_copies_the_pinned_bundle_files_to_their_content_addresses_and_leaves_the_unpinned_receipt(self):
        write_lane_catalog(self.project, 'actors')
        target_root = self.temporary_root / 'target' / 'l2'
        shutil.copytree(GOLDEN_ROOT / 'l2', target_root)
        result = merge_lane_store(self.actors_store, target_root, sha256_hex(GOLDEN_CATALOG_BYTES))
        self.assertEqual(result['copiedFiles'], self.bundle.pinned_relative_paths())
        self.assertEqual(result['addedRecordsBySlice'], {'npcProfiles': 1})
        merged_manifest = (target_root / self.bundle.manifest_relative).read_bytes()
        self.assertEqual(sha256_hex(merged_manifest), Path(self.bundle.folder).name)
        for pin in json.loads(merged_manifest)['files']:
            self.assertEqual(sha256_hex((target_root / self.bundle.member_relative(pin['file'])).read_bytes()), pin['sha256'])
        self.assertFalse((target_root / self.bundle.member_relative('receipt.json')).exists())
        self.assertEqual(json.loads((target_root / 'catalog.json').read_bytes())['npcProfiles'], [self.bundle.record])

    def test_the_merge_refuses_a_tampered_bundle_file_without_touching_the_target(self):
        write_lane_catalog(self.project, 'actors')
        write_file(self.actors_store / self.bundle.member_relative(RAW_CLASS_EXPORT), b'tampered class export')
        target_root = self.temporary_root / 'target' / 'l2'
        shutil.copytree(GOLDEN_ROOT / 'l2', target_root)
        snapshot = snapshot_tree(target_root)
        with self.assertRaisesRegex(LaneStoreMergeRefusedError, 'pinned store file SHA-256 differs from its pin'):
            merge_lane_store(self.actors_store, target_root, sha256_hex(GOLDEN_CATALOG_BYTES))
        self.assertEqual(snapshot_tree(target_root), snapshot)

    def test_the_lane_catalog_refuses_a_bundle_file_that_steps_out_of_its_folder(self):
        payload = b'outside bytes'
        bundle = ProfileBundle({}, member_pins=[bundle_member_pin('../outside.bin', payload)])
        shutil.rmtree(self.actors_store)
        bundle.write(self.actors_store)
        with self.assertRaisesRegex(CatalogWriteError, r"steps out of its bundle folder with \.\.: '\.\./outside\.bin'"):
            write_lane_catalog(self.project, 'actors')


class BundleMemberGuardTests(TemporaryStoreTestCase):
    def setUp(self):
        super().setUp()
        self.store_root = self.temporary_root / 'store' / 'l2'

    def pin_store(self, member, payload, member_pin=None, write_member=True):
        bundle = ProfileBundle({}, member_pins=[member_pin or bundle_member_pin(member, payload)])
        catalog = bundle.write(self.store_root)
        if write_member:
            write_file(self.store_root / bundle.member_relative(member), payload)
        return bundle, catalog

    def assert_pin_refused(self, error_type, message_pattern, member, payload=b'member bytes', member_pin=None, write_member=False):
        bundle, catalog = self.pin_store(member, payload, member_pin, write_member)
        with self.assertRaisesRegex(error_type, message_pattern):
            pinned_store_files(self.store_root, catalog)
        return bundle

    def test_path_guards_refuse_absolute_drive_parent_backslash_and_separator_tricks(self):
        cases = (('/source/x.bin', 'bundle file path is absolute'), ('C:/source/x.bin', 'bundle file path names a drive'),
                 ('source/../../x.bin', 'steps out of its bundle folder with ..'), ('source\\x.bin', 'bundle file path holds a backslash'),
                 ('source//x.bin', 'not a portable relative path'), ('./source/x.bin', 'not a portable relative path'),
                 ('source/x.bin:stream', 'not a portable relative path'), ('source/x.bin/', 'not a portable relative path'),
                 ('', 'bundle file path must be a non-empty string'))
        for member, message in cases:
            with self.subTest(member=member):
                shutil.rmtree(self.store_root, ignore_errors=True)
                self.assert_pin_refused(CatalogWriteError, message.replace('.', r'\.'),
                                        member, member_pin={'file': member, 'bytes': 1, 'sha256': '6' * 64})

    def test_a_missing_bundle_file_is_refused(self):
        self.assert_pin_refused(CatalogWriteError, 'pinned store file is missing from .*: npc-profiles/[0-9a-f]{64}/source/absent.bin',
                                'source/absent.bin')

    def test_a_bundle_file_whose_bytes_or_length_differ_from_its_pin_is_refused(self):
        payload = b'member bytes'
        self.assert_pin_refused(CatalogWriteError, 'pinned store file SHA-256 differs from its pin', 'source/x.bin', payload,
                                member_pin={'file': 'source/x.bin', 'bytes': len(payload), 'sha256': sha256_hex(b'other bytes')}, write_member=True)
        shutil.rmtree(self.store_root)
        self.assert_pin_refused(CatalogWriteError, 'pinned store file byte length differs from its pin 99', 'source/x.bin', payload,
                                member_pin={'file': 'source/x.bin', 'bytes': 99, 'sha256': sha256_hex(payload)}, write_member=True)

    def test_a_malformed_sha256_or_byte_length_is_refused(self):
        self.assert_pin_refused(CatalogWriteError, 'SHA-256 must be 64 lowercase hex characters', 'source/x.bin',
                                member_pin={'file': 'source/x.bin', 'bytes': 1, 'sha256': 'A' * 64})
        shutil.rmtree(self.store_root)
        self.assert_pin_refused(CatalogWriteError, 'byte length must be a safe integer of at least 0', 'source/x.bin',
                                member_pin={'file': 'source/x.bin', 'bytes': -1, 'sha256': '6' * 64})

    def test_a_bundle_file_that_resolves_outside_its_bundle_folder_through_a_junction_is_refused(self):
        outside = self.temporary_root / 'outside'
        write_file(outside / 'x.bin', b'outside bytes')
        bundle, catalog = self.pin_store('linked/x.bin', b'outside bytes', write_member=False)
        self.make_junction(self.store_root / bundle.member_relative('linked'), outside)
        with self.assertRaisesRegex(CatalogWriteError, 'bundle file resolves outside its bundle folder npc-profiles/[0-9a-f]{64}'):
            pinned_store_files(self.store_root, catalog)

    def test_a_junction_inside_the_bundle_folder_is_refused(self):
        payload = b'member bytes behind a junction'
        bundle, catalog = self.pin_store('linked/x.bin', payload, write_member=False)
        write_file(self.store_root / bundle.member_relative('real/x.bin'), payload)
        self.make_junction(self.store_root / bundle.member_relative('linked'), self.store_root / bundle.member_relative('real'))
        with self.assertRaisesRegex(StorePathError, 'Symlink/junction/reparse boundary refused'):
            pinned_store_files(self.store_root, catalog)

    def test_a_catalog_record_cannot_pin_a_file_by_relative_path(self):
        catalog = {'schemaVersion': 1, 'models': [], 'npcProfiles': [{'id': PROFILE_RECORD_ID, 'file': 'x.bin', 'sha256': '6' * 64}]}
        with self.assertRaisesRegex(CatalogWriteError, "pins 'x.bin' by a relative path; only a pinned store manifest names files"):
            pinned_store_files(self.store_root, catalog)

    def test_a_manifest_at_the_store_root_pins_files_beside_it(self):
        payload = b'member beside a root manifest'
        bundle = ProfileBundle({'flat-member.bin': payload}, manifest_folder='')
        catalog = bundle.write(self.store_root)
        files = pinned_store_files(self.store_root, catalog)
        self.assertEqual(sorted(relative for relative, _ in files.values()), ['flat-member.bin', 'manifest.json'])

    def test_an_effect_bundle_from_another_lane_follows_the_same_rule_and_pins_a_repeated_resource_once(self):
        bundle = SyntheticEffectBundle(self.store_root)
        folder, texture_pin = bundle.folder, bundle.texture_pin
        files = pinned_store_files(self.store_root, bundle.catalog)
        self.assertEqual(sorted(relative for relative, _ in files.values()), [f'{folder}/manifest.json', f'{folder}/{texture_pin["file"]}'])


class SyntheticEffectBundle:
    def __init__(self, store_root, resource_pin_sha256=None):
        texture = b'synthetic sprite texture bytes'
        self.texture_pin = {'assetId': 'interlude:Synthetic.Sprite', 'kind': 'texture',
                            **bundle_member_pin(f'resources/{sha256_hex(texture)}.png', texture)}
        resource_pin = self.texture_pin if resource_pin_sha256 is None else {**self.texture_pin, 'sha256': resource_pin_sha256}
        manifest_bytes = json_bytes({'schemaVersion': 1, 'kind': 'native-effect-components', 'id': 'interlude:skill:3:level:1:synthetic',
                                     'resources': {self.texture_pin['assetId']: resource_pin},
                                     'components': [{'object': 'synthetic.Sprite', 'bindings': {'texture': self.texture_pin, 'mesh': None}}]})
        manifest_sha256 = sha256_hex(manifest_bytes)
        self.folder = f'effects/{manifest_sha256}'
        write_file(store_root / self.folder / 'manifest.json', manifest_bytes)
        write_file(store_root / self.folder / self.texture_pin['file'], texture)
        self.catalog = {'schemaVersion': 1, 'models': [], 'effectComponents': [
            {'id': 'interlude:skill:3:level:1:synthetic', 'manifest': f'/l2/{self.folder}/manifest.json', 'manifestSha256': manifest_sha256}]}


def synthetic_glb_with_materials(materials):
    document = json_bytes({'asset': {'version': '2.0'}, 'materials': materials})
    document += b' ' * (-len(document) % 4)
    return struct.pack('<III', 0x46546C67, 2, 20 + len(document)) + struct.pack('<II', len(document), 0x4E4F534A) + document


def native_material_program_pin(program_sha256):
    return {'directory': f'native-materials/{program_sha256}', 'programSha256': program_sha256}


class SyntheticWorldTile:
    def __init__(self, store_root, program_pins=None):
        self.store_root = store_root
        self.program = json_bytes({'schemaVersion': 1, 'kind': 'ue2-material-program', 'nodes': []})
        self.program_sha256 = sha256_hex(self.program)
        program_pins = [native_material_program_pin(self.program_sha256)] if program_pins is None else program_pins
        self.sky_members = {'sky.glb': synthetic_glb_with_materials([{'name': 'sky'}]), 'WhiteCloud.png': b'synthetic sky texture bytes'}
        sky_manifest = json_bytes({'schemaVersion': 1, 'kind': 'native-tile-sky', 'layout': {'files': {'sky.json': 'evidence text, not a pin'}},
                                   'files': {name: {'bytes': len(payload), 'sha256': sha256_hex(payload)} for name, payload in self.sky_members.items()}})
        self.sky_folder = f'skies/{sha256_hex(sky_manifest)}'
        self.bsp_glb = synthetic_glb_with_materials([{'name': 'surface', 'extras': {'nativeMaterialProgram': pin}} for pin in program_pins])
        self.bsp_relative = f'native-tile-chunk-bsp/{sha256_hex(self.bsp_glb)}/bsp.glb'
        tile = json_bytes({'schemaVersion': 1, 'resources': [
            {'kind': 'sky', 'resource': f'/l2/{self.sky_folder}/manifest.json', 'sha256': sha256_hex(sky_manifest)},
            {'kind': 'bsp', 'resource': f'/l2/{self.bsp_relative}', 'sha256': sha256_hex(self.bsp_glb)}]})
        self.tile_relative = f'tiles/{sha256_hex(tile)}/tile.json'
        self.record = {'id': '15_20', 'manifest': f'/l2/{self.tile_relative}', 'manifestSha256': sha256_hex(tile), 'manifestBytes': len(tile)}
        write_file(store_root / self.tile_relative, tile)
        write_file(store_root / self.sky_folder / 'manifest.json', sky_manifest)
        for name, payload in self.sky_members.items():
            write_file(store_root / self.sky_folder / name, payload)
        write_file(store_root / self.bsp_relative, self.bsp_glb)
        write_file(store_root / f'native-materials/{self.program_sha256}/program.json', self.program)

    def catalog(self, source_catalog_sha256=None):
        catalog = {'schemaVersion': 1, 'models': [], 'tiles': [self.record]}
        if source_catalog_sha256 is not None:
            catalog['sourceCatalogSha256'] = source_catalog_sha256
        return catalog

    def runtime_relative_paths(self):
        return sorted([self.tile_relative, f'{self.sky_folder}/manifest.json', *(f'{self.sky_folder}/{name}' for name in self.sky_members),
                       self.bsp_relative, f'native-materials/{self.program_sha256}/program.json'])


class WorldTileRuntimePinTests(TemporaryStoreTestCase):
    def setUp(self):
        super().setUp()
        self.store_root = self.temporary_root / 'lane' / 'l2'

    def test_the_walk_reaches_sky_bundle_files_named_by_a_files_map_and_material_programs_named_by_glb_extras(self):
        tile = SyntheticWorldTile(self.store_root)
        files = pinned_store_files(self.store_root, tile.catalog())
        self.assertEqual(sorted(relative for relative, _ in files.values()), tile.runtime_relative_paths())

    def test_the_merge_copies_the_sky_glb_and_the_material_program_the_browser_fetches(self):
        tile = SyntheticWorldTile(self.store_root)
        write_file(self.store_root / 'catalog.json', json_bytes(tile.catalog(sha256_hex(GOLDEN_CATALOG_BYTES))))
        target_root = self.temporary_root / 'target' / 'l2'
        shutil.copytree(GOLDEN_ROOT / 'l2', target_root)
        result = merge_lane_store(self.store_root, target_root, sha256_hex(GOLDEN_CATALOG_BYTES))
        self.assertEqual(result['copiedFiles'], tile.runtime_relative_paths())
        self.assertEqual((target_root / tile.sky_folder / 'sky.glb').read_bytes(), tile.sky_members['sky.glb'])
        self.assertEqual((target_root / f'native-materials/{tile.program_sha256}/program.json').read_bytes(), tile.program)

    def test_a_glb_material_program_pin_whose_directory_differs_from_its_sha256_is_refused(self):
        tile = SyntheticWorldTile(self.store_root, [{'directory': f'native-materials/{"7" * 64}', 'programSha256': '6' * 64}])
        with self.assertRaisesRegex(ValueError, 'nativeMaterialProgram is not a native-materials program pin'):
            pinned_store_files(self.store_root, tile.catalog())

    def test_a_glb_material_program_whose_bytes_are_missing_is_refused(self):
        tile = SyntheticWorldTile(self.store_root, [native_material_program_pin('6' * 64)])
        with self.assertRaisesRegex(CatalogWriteError, f'pinned store file is missing from .*: native-materials/{"6" * 64}/program.json'):
            pinned_store_files(self.store_root, tile.catalog())

    def test_a_files_map_entry_with_fields_other_than_sha256_and_bytes_is_refused(self):
        manifest_bytes = json_bytes({'files': {'sky.glb': {'sha256': '6' * 64, 'bytes': 1, 'kind': 'glb'}}})
        folder = f'skies/{sha256_hex(manifest_bytes)}'
        write_file(self.store_root / folder / 'manifest.json', manifest_bytes)
        catalog = {'schemaVersion': 1, 'models': [], 'effectComponents': [
            {'id': 'interlude:sky:synthetic', 'manifest': f'/l2/{folder}/manifest.json', 'manifestSha256': sha256_hex(manifest_bytes)}]}
        with self.assertRaisesRegex(CatalogWriteError, "bundle file map entry 'sky.glb' must hold only sha256 and bytes"):
            pinned_store_files(self.store_root, catalog)


if __name__ == '__main__':
    unittest.main()
