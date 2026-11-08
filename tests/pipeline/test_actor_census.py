import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import struct
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from actors import actor_census
from actors.actor_census import (ActorPackageCensus, build_actor_census, check_committed_census, lock_skeletal_package_paths, main,
                                 skeletal_reader_gate, write_actor_census)
from actors.actor_unit_inventory import conversion_unit_key, npc_units_and_rows
from native_catalog.ue2 import summary
from native_store.canonical_json import canonical_json_bytes
from native_store.gap_rows import validate_gap_row
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, read_reference_client_lock, require_reference_client
from reference_client_lock_fixture import lock_client_as_checked_conversion_root
from test_texture_package_census import GARBAGE_HEADER, synthetic_wrapped_package_header

CONVERSION_CLIENT_ROOT = Path('E:/Lineage2-client')
UNREAL_PACKAGE_SIGNATURE = 0x9E2A83C1
LONG_ENCODED_BYTES_PATTERN = re.compile(r'[A-Za-z0-9+/=]{129,}')
SYNTHETIC_MESH = 'SyntheticMonsters.synthetic_m00'
SYNTHETIC_FIRST_TEXTURE = 'SyntheticMonstersTex.synthetic_t00'
SYNTHETIC_SECOND_TEXTURE = 'SyntheticMonstersTex.synthetic_t01'


def unwrapped_package_header(package_version, licensee):
    return struct.pack('<IHHIIIIIII', UNREAL_PACKAGE_SIGNATURE, package_version, licensee, 0, 1, 0, 1, 0, 1, 0).ljust(128, b'\0')


def wrapped_package(relative_path, package_version, licensee):
    return synthetic_wrapped_package_header(PurePosixPath(relative_path).name, package_version, licensee)


SYNTHETIC_PACKAGES = {
    'animations/SyntheticMonsters.ukx': wrapped_package('animations/SyntheticMonsters.ukx', 123, 28),
    'animations/SyntheticHeroes.ukx': wrapped_package('animations/SyntheticHeroes.ukx', 123, 30),
    'animations/SyntheticElders.ukx': wrapped_package('animations/SyntheticElders.ukx', 123, 23),
    'animations/SyntheticSkill.usk': unwrapped_package_header(123, 28),
    'animations/SyntheticBroken.ukx': GARBAGE_HEADER,
    'animations/SyntheticTwin.ukx': wrapped_package('animations/SyntheticTwin.ukx', 123, 28),
    'staticmeshes/syntheticTWIN.ukx': wrapped_package('staticmeshes/syntheticTWIN.ukx', 123, 28),
    'systextures/SyntheticMonstersTex.utx': wrapped_package('systextures/SyntheticMonstersTex.utx', 123, 28),
    'systextures/SyntheticEldersTex.utx': wrapped_package('systextures/SyntheticEldersTex.utx', 123, 23),
    'systextures/SyntheticUnusedTex.utx': wrapped_package('systextures/SyntheticUnusedTex.utx', 123, 28),
}


class SyntheticActorClient:
    def __init__(self, test_case, packages=SYNTHETIC_PACKAGES):
        temporary_directory = tempfile.TemporaryDirectory()
        test_case.addCleanup(temporary_directory.cleanup)
        base = Path(temporary_directory.name).resolve()
        self.client_root = base / 'conversion'
        for relative_path, payload in packages.items():
            path = self.client_root / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
        lock_client_as_checked_conversion_root(test_case, self.client_root, base / 'reference', list(packages))
        self.access = require_reference_client(self.client_root)

    def package_census(self):
        return ActorPackageCensus(self.access, lock_skeletal_package_paths(self.access.lock))


def synthetic_decoded_table(source, collection, rows):
    return {'source': source, 'sourceSha256': hashlib.sha256(source.encode('ascii')).hexdigest(),
            'data': {'data': len(rows), collection: rows}}


def synthetic_npcgrp(npc_selections):
    return synthetic_decoded_table('system/npcgrp.dat', 'npc', [
        {'npc_id': npc_id, 'mesh_name': mesh, 'texture_name': [{'param_texture_name': texture} for texture in textures]}
        for npc_id, (mesh, textures) in npc_selections.items()])


def rows_by_key(rows):
    return {row['key']: row for row in rows}


def string_values(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from string_values(item)
    elif isinstance(value, list):
        for item in value:
            yield from string_values(item)


class PackageHeaderGateTests(unittest.TestCase):
    def test_reviewed_skeletal_pairs_are_accepted_and_others_refused(self):
        for (package_version, licensee), expected_gate in (((123, 28), 'accepted'), ((123, 30), 'accepted'), ((123, 23), 'refused'),
                                                            ((123, 31), 'refused')):
            with self.subTest(package_version=package_version, licensee=licensee):
                self.assertEqual(skeletal_reader_gate(summary(unwrapped_package_header(package_version, licensee), 'Synthetic.ukx')), expected_gate)

    def test_package_rows_cover_every_lock_animations_package_with_its_header(self):
        client = SyntheticActorClient(self)
        rows = {row['path']: row for row in client.package_census().package_rows()}
        self.assertEqual(sorted(rows), ['animations/SyntheticBroken.ukx', 'animations/SyntheticElders.ukx', 'animations/SyntheticHeroes.ukx',
                                        'animations/SyntheticMonsters.ukx', 'animations/SyntheticSkill.usk', 'animations/SyntheticTwin.ukx'])
        self.assertEqual(rows['animations/SyntheticHeroes.ukx'], {
            'path': 'animations/SyntheticHeroes.ukx', 'packageVersion': 123, 'licensee': 30, 'wrapper': 'Lineage2Ver121',
            'skeletalReaderGate': 'accepted', 'textureReaderGate': 'not-applicable'})
        self.assertEqual(rows['animations/SyntheticElders.ukx']['skeletalReaderGate'], 'refused')
        self.assertEqual(rows['animations/SyntheticSkill.usk']['wrapper'], 'UnrealPackage')
        self.assertEqual(rows['animations/SyntheticBroken.ukx'], {
            'path': 'animations/SyntheticBroken.ukx', 'packageVersion': None, 'licensee': None, 'wrapper': None,
            'skeletalReaderGate': 'refused', 'textureReaderGate': 'not-applicable'})

    def test_texture_packages_join_the_census_only_when_an_actor_row_names_them(self):
        client = SyntheticActorClient(self)
        package_census = client.package_census()
        npc_units_and_rows(synthetic_npcgrp({1: (SYNTHETIC_MESH, [SYNTHETIC_FIRST_TEXTURE])}), package_census)
        rows = {row['path']: row for row in package_census.package_rows()}
        self.assertEqual(rows['systextures/SyntheticMonstersTex.utx']['textureReaderGate'], 'accepted')
        self.assertEqual(rows['systextures/SyntheticMonstersTex.utx']['skeletalReaderGate'], 'not-applicable')
        self.assertNotIn('systextures/SyntheticUnusedTex.utx', rows)


class NpcUnitInventoryTests(unittest.TestCase):
    def setUp(self):
        self.client = SyntheticActorClient(self)

    def inventory(self, npc_selections):
        return npc_units_and_rows(synthetic_npcgrp(npc_selections), self.client.package_census())

    def test_units_are_exact_mesh_and_ordered_texture_pairs(self):
        units, rows = self.inventory({
            101: (SYNTHETIC_MESH, [SYNTHETIC_FIRST_TEXTURE]),
            102: (SYNTHETIC_MESH, [SYNTHETIC_FIRST_TEXTURE]),
            103: (SYNTHETIC_MESH, [SYNTHETIC_SECOND_TEXTURE]),
            104: ('', []),
            105: (SYNTHETIC_MESH, [SYNTHETIC_FIRST_TEXTURE, SYNTHETIC_SECOND_TEXTURE]),
        })
        self.assertEqual(len(units), 3)
        rows = rows_by_key(rows)
        self.assertEqual(list(rows), ['npc:101', 'npc:102', 'npc:103', 'npc:104', 'npc:105'])
        first_key = conversion_unit_key('npc-model', {'mesh': SYNTHETIC_MESH, 'textures': [SYNTHETIC_FIRST_TEXTURE]})
        self.assertEqual(units[0]['key'], first_key)
        self.assertNotEqual(units[1]['key'], first_key)
        self.assertEqual((rows['npc:101']['status'], rows['npc:101']['reason']), ('pending', 'conversion-pending'))
        self.assertEqual(rows['npc:102'], rows['npc:101'] | {'key': 'npc:102'})
        self.assertEqual((rows['npc:104']['status'], rows['npc:104']['reason']), ('gap', 'no-mesh-in-row'))
        self.assertEqual((rows['npc:105']['status'], rows['npc:105']['reason']), ('gap', 'multi-slot-binding-unsupported'))
        self.assertEqual(units[0]['sourceIdentity'], {
            'path': 'animations/SyntheticMonsters.ukx', 'object': SYNTHETIC_MESH,
            'sha256': self.client.access.lock.record('animations/SyntheticMonsters.ukx')['eSha256']})
        for row in rows.values():
            with self.subTest(key=row['key']):
                self.assertIs(validate_gap_row(row), row)

    def test_reordered_textures_and_kept_empty_slots_are_distinct_units(self):
        units, _ = self.inventory({
            1: (SYNTHETIC_MESH, [SYNTHETIC_FIRST_TEXTURE, '']),
            2: (SYNTHETIC_MESH, ['', SYNTHETIC_FIRST_TEXTURE]),
            3: (SYNTHETIC_MESH, [SYNTHETIC_FIRST_TEXTURE]),
        })
        self.assertEqual(len({unit['key'] for unit in units}), 3)
        self.assertEqual({unit['status'] for unit in units}, {'convertible'})

    def test_missing_ambiguous_and_unreviewed_packages_are_listed_gaps(self):
        _, rows = self.inventory({
            1: ('AbsentMonsters.absent_m00', [SYNTHETIC_FIRST_TEXTURE]),
            2: ('SyntheticTwin.twin_m00', []),
            3: ('SyntheticElders.elder_m00', [SYNTHETIC_FIRST_TEXTURE]),
            4: (SYNTHETIC_MESH, ['AbsentTex.absent_t00']),
            5: (SYNTHETIC_MESH, ['SyntheticEldersTex.elder_t00']),
            6: ('SyntheticBroken.broken_m00', []),
            7: ('syntheticmonsters.synthetic_m00', ['SYNTHETICMONSTERSTEX.synthetic_t00']),
        })
        self.assertEqual({key: row['reason'] for key, row in rows_by_key(rows).items()}, {
            'npc:1': 'mesh-package-not-in-client:AbsentMonsters',
            'npc:2': 'package-name-ambiguous:SyntheticTwin',
            'npc:3': 'skeletal-licensee-unsupported:123/23',
            'npc:4': 'texture-package-not-in-client:AbsentTex',
            'npc:5': 'texture-licensee-unsupported:123/23',
            'npc:6': 'decode-failed:unsupported-native',
            'npc:7': 'conversion-pending',
        })
        for row in rows:
            with self.subTest(key=row['key']):
                validate_gap_row(row)


class ActorCensusBuildTests(unittest.TestCase):
    def setUp(self):
        self.client = SyntheticActorClient(self)
        self.tables = {'npcgrp': synthetic_npcgrp({
            7: (SYNTHETIC_MESH, [SYNTHETIC_SECOND_TEXTURE]),
            3: (SYNTHETIC_MESH, [SYNTHETIC_FIRST_TEXTURE]),
            5: ('', []),
        })}

    def test_census_is_byte_identical_across_builds_and_sorted_by_unit_key(self):
        first_census, first_rows = build_actor_census(self.client.access, self.tables)
        second_census, second_rows = build_actor_census(self.client.access, self.tables)
        self.assertEqual(canonical_json_bytes(first_census), canonical_json_bytes(second_census))
        self.assertEqual(first_rows, second_rows)
        self.assertEqual([unit['key'] for unit in first_census['units']], sorted(unit['key'] for unit in first_census['units']))
        self.assertEqual([row['key'] for row in first_rows], ['npc:7', 'npc:3', 'npc:5'])
        self.assertEqual(first_census['tables'], [{'table': 'npcgrp', 'path': 'system/npcgrp.dat', 'rowCount': 3,
                                                   'sha256': self.tables['npcgrp']['sourceSha256']}])

    def test_census_holds_no_encoded_bytes(self):
        census, _ = build_actor_census(self.client.access, self.tables)
        for value in string_values(census):
            self.assertIsNone(LONG_ENCODED_BYTES_PATTERN.search(value), value)

    def test_check_reports_the_first_differing_unit_key(self):
        census, _ = build_actor_census(self.client.access, self.tables)
        census_path = self.client.client_root.parent / 'census' / 'actor-unit-census.json'
        census_path.parent.mkdir()
        write_actor_census(census, census_path)
        self.assertIsNone(check_committed_census(census, census_path))
        self.assertEqual(census_path.read_bytes(), canonical_json_bytes(census))
        census_path.write_bytes(canonical_json_bytes(census).replace(b'\n', b'\r\n'))
        self.assertIsNone(check_committed_census(census, census_path))
        changed_unit = census['units'][1]
        committed = json.loads(census_path.read_bytes())
        committed['units'][1]['status'] = 'gap'
        census_path.write_bytes(canonical_json_bytes(committed))
        self.assertEqual(check_committed_census(census, census_path), 'units:' + changed_unit['key'])
        census_path.unlink()
        self.assertEqual(check_committed_census(census, census_path), 'census')


@unittest.skipUnless(CONVERSION_CLIENT_ROOT.is_dir() and REFERENCE_CLIENT_LOCK_PATH.is_file(),
                     'needs the conversion client E:/Lineage2-client and the committed reference client lock')
class CommittedActorCensusTests(unittest.TestCase):
    def test_committed_census_matches_a_fresh_census_of_the_conversion_client(self):
        self.assertEqual(main(['--client', str(CONVERSION_CLIENT_ROOT), '--check']), 0)

    def test_every_lock_animations_package_has_a_skeletal_gate(self):
        census = json.loads(actor_census.ACTOR_UNIT_CENSUS_PATH.read_bytes())
        lock = read_reference_client_lock(REFERENCE_CLIENT_LOCK_PATH)
        self.assertEqual(sorted(row['path'] for row in census['packages'] if row['skeletalReaderGate'] != 'not-applicable'),
                         lock_skeletal_package_paths(lock))


if __name__ == '__main__':
    unittest.main()
