import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[2]
IMPORTA_SNAPSHOT = ROOT / 'artifacts/native-parity/inputs/IMPORTA-PC'
sys.path.insert(0, str(ROOT / 'scripts'))
from native_animation_families import build_animation_families, resolve_animation_references, section_records
from native_catalog.ue2 import FormatError

SPEC = importlib.util.spec_from_file_location('report_native_animation_aliases', ROOT / 'scripts/report-native-animation-aliases.py')
subject = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(subject)

SCRIPT = b'''class Pawn extends Actor;
enum WeaponType { WT_HAND, WT_1HS };
var Pawn.WeaponType CurWeaponType;
var localized name WaitAnimName[2];
var localized name SpAtk13AnimName[2];
var localized name DamageAnimName[2];
var localized name DamageFlyAnimName[2];
var localized name DeathAnimName[2];
function name GetWaitAnimName()
{
    return WaitAnimName[int(CurWeaponType)];
    return;
}
function name GetSpAtk13AnimName()
{
    return SpAtk13AnimName[int(CurWeaponType)];
    return;
}
function name GetDamageAnimName()
{
    return DamageAnimName[int(CurWeaponType)];
    return;
}
'''


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encrypted(payload):
    body = 'Lineage2Ver111'.encode('utf-16le') + bytes(value ^ 0xac for value in payload)
    return body + struct.pack('<5I', 0, 8, 71, zlib.crc32(body), 0)


def evidence():
    return {'object': 'Engine.Pawn', 'sourceScriptSha256': digest(SCRIPT),
            'source': {'object': 'Engine.Pawn', 'packageSha256': '1' * 64},
            'enums': {'WeaponType': {'WT_HAND': 0, 'WT_1HS': 1}}}


def source(raw):
    return {'host': 'fixture', 'path': 'system/Warrior.int', 'sha256': digest(raw)}


PLAIN = (b'[FMagic]\r\nWaitAnimName[0]=wait_Hand_FMagic\r\nWaitAnimName[0]=wait_Hand_FMagic\r\n'
         b'DamageFlyAnimName[0]=DamageFly_FMagic\r\nDeathAnimName[0]=Death_FMagic\r\nSpAtk13AnimName[1]=atkWait_1HS_FMagic\r\n')
CONFLICT = PLAIN + b'SpAtk13AnimName[1]=Atk02_1HS_FMagic\r\n'


class ConflictPreservingReaderTests(unittest.TestCase):
    def test_matches_shared_reader_without_conflicts(self):
        records, conflicts = subject.section_records_preserving_conflicts(PLAIN, 'FMagic')
        self.assertEqual(conflicts, [])
        self.assertEqual(records, section_records(PLAIN, 'FMagic'))
        raw = encrypted(PLAIN)
        built = subject.build_families_preserving_conflicts(raw, source=source(raw), section='FMagic',
                                                            class_defaults=evidence(), class_script_bytes=SCRIPT)
        self.assertEqual(built, build_animation_families(raw, source=source(raw), section='FMagic',
                                                         class_defaults=evidence(), class_script_bytes=SCRIPT))

    def test_retains_both_conflicting_rows_without_precedence(self):
        with self.assertRaisesRegex(FormatError, 'nonidentical'):
            section_records(CONFLICT, 'FMagic')
        raw = encrypted(CONFLICT)
        built = subject.build_families_preserving_conflicts(raw, source=source(raw), section='FMagic',
                                                            class_defaults=evidence(), class_script_bytes=SCRIPT)
        rows = [row for row in built['records'] if row['key'] == 'SpAtk13AnimName[1]']
        self.assertEqual([row['value'] for row in rows], ['atkWait_1HS_FMagic', 'Atk02_1HS_FMagic'])
        self.assertTrue(all(len(row['conflictingAssignments']) == 2 for row in rows))
        field = built['families'][1]['fields']['SpAtk13AnimName']
        self.assertIsNone(field['value'])
        self.assertEqual(field['status'], 'conflicting-source-rows-unresolved')
        self.assertEqual([candidate['value'] for candidate in field['candidates']], ['atkWait_1HS_FMagic', 'Atk02_1HS_FMagic'])
        self.assertEqual(built['conflictingDuplicates'][0]['key'], 'SpAtk13AnimName[1]')
        self.assertEqual(len(built['identicalDuplicates']), 1)
        self.assertEqual(built['families'][0]['fields']['WaitAnimName']['value'], 'wait_Hand_FMagic')
        self.assertIn('DamageFlyAnimName[0]', built['unverifiedSelectionKeys'])

    def test_hash_mismatch_is_refused(self):
        raw = encrypted(CONFLICT)
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            subject.build_families_preserving_conflicts(raw, source={**source(raw), 'sha256': '0' * 64}, section='FMagic',
                                                        class_defaults=evidence(), class_script_bytes=SCRIPT)


class AliasRowTests(unittest.TestCase):
    def setUp(self):
        raw = encrypted(CONFLICT)
        self.family = subject.build_families_preserving_conflicts(raw, source=source(raw), section='FMagic',
                                                                  class_defaults=evidence(), class_script_bytes=SCRIPT)
        self.clips = ['Wait_Hand_FMagic', 'Damagefly_FMagic', 'Death_FMagic', 'Rebirth_FMagic']
        self.family['clipResolution'] = resolve_animation_references(self.family, self.clips)
        self.rows = {row['alias']: row for row in subject.alias_rows(self.family, self.clips, 'FMagic')}

    def test_statuses_follow_localization_only(self):
        self.assertEqual((self.rows['wait']['status'], self.rows['wait']['clip']), ('case-only', 'Wait_Hand_FMagic'))
        self.assertEqual(self.rows['wait']['getter'], 'GetWaitAnimName')
        self.assertEqual((self.rows['death']['status'], self.rows['death']['selectionPath']), ('exact', 'unverified'))
        self.assertEqual((self.rows['damageFly']['status'], self.rows['damageFly']['clip']), ('case-only', 'Damagefly_FMagic'))
        self.assertEqual(self.rows['damage']['status'], 'no-family-value')
        self.assertIsNone(self.rows['damage']['clip'])
        self.assertIn('GetDamageAnimName', self.rows['damage']['reason'])
        self.assertEqual(self.rows['rebirth']['status'], 'no-native-field')
        self.assertEqual(self.rows['rebirth']['exportedClip'], 'Rebirth_FMagic')
        self.assertEqual(self.rows['rebirth']['exportedClipSelectedBy'], [])
        self.assertEqual(self.rows['spAtk13']['status'], 'no-family-value')
        self.assertEqual(self.rows['walk']['status'], 'no-family-value')

    def test_damage_answer_never_maps_damage(self):
        answer = subject.damage_answer('FMagic', self.clips, self.family, list(self.rows.values()))
        self.assertEqual(answer['damageLikeClips'], ['Damagefly_FMagic'])
        self.assertEqual(answer['damageAnimNameAssignments'], [])
        self.assertIn("'damage' alias must stay unmapped", answer['answer'])

    def test_missing_clip_is_reported_not_replaced(self):
        rows = {row['alias']: row for row in subject.alias_rows(self.family, ['Death_FMagic'], 'FMagic')}
        self.assertEqual((rows['wait']['status'], rows['wait']['clip']), ('missing-clip', None))


@unittest.skipUnless((IMPORTA_SNAPSHOT / subject.LOCALIZATION).is_file(), 'Private IMPORTA-PC localization input is not staged in this checkout')
class RealReportTests(unittest.TestCase):
    def test_four_staged_packages_verify_without_writes(self):
        output = ROOT / 'artifacts/native-parity/research/dev-sheet-audio-20261107/models'
        catalog = ROOT / 'public/l2/catalog.json'
        if not (output / 'ALIAS_COVERAGE.json').is_file() or not catalog.is_file():
            self.skipTest('Staged packages or report output are absent')
        ids = {row['id'] for row in json.loads(catalog.read_bytes())['models']}
        if not {catalog_id for catalog_id, _, _ in subject.PACKAGES} <= ids:
            self.skipTest('Not all four Human packages are staged')
        before = {path: path.stat().st_mtime_ns for path in output.rglob('*') if path.is_file() and path.suffix in ('.json', '.md')}
        result = subject.run(output, catalog, IMPORTA_SNAPSHOT, ROOT / 'public/l2', verify_only=True)
        self.assertEqual((result['status'], result['filesWritten']), ('verified', 0))
        self.assertEqual(before, {path: path.stat().st_mtime_ns for path in before})
        report = json.loads((output / 'ALIAS_COVERAGE.json').read_bytes())
        for package in report['packages']:
            rows = {row['alias']: row for row in package['aliases']}
            self.assertEqual(package['damage']['damageLikeClips'], ['Damagefly_' + package['class']])
            self.assertIsNone(rows['damage']['clip'])
            for alias in ('wait', 'walk', 'run', 'atk01', 'death', 'damageFly'):
                self.assertIsNotNone(rows[alias]['clip'], package['class'] + ' ' + alias)
        families = {package['class']: package['familySource']['kind'] for package in report['packages']}
        self.assertEqual(families, {'MFighter': 'staged-package', 'FFighter': 'staged-package', 'MMagic': 'staged-package',
                                    'FMagic': 'conflict-preserving-report-product'})

    def test_refuses_to_overwrite_a_different_output(self):
        catalog = ROOT / 'public/l2/catalog.json'
        ids = {row['id'] for row in json.loads(catalog.read_bytes())['models']} if catalog.is_file() else set()
        if not {catalog_id for catalog_id, _, _ in subject.PACKAGES} <= ids:
            self.skipTest('Not all four Human packages are staged')
        with tempfile.TemporaryDirectory(dir=ROOT / 'artifacts') as directory:
            output = Path(directory)
            (output / 'ALIAS_COVERAGE.md').write_text('edited by hand', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'refusing to overwrite'):
                subject.run(output, catalog, IMPORTA_SNAPSHOT, ROOT / 'public/l2')
            self.assertEqual((output / 'ALIAS_COVERAGE.md').read_text(encoding='utf-8'), 'edited by hand')
            self.assertFalse((output / 'ALIAS_COVERAGE.json').exists())


if __name__ == '__main__':
    unittest.main()
