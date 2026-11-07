"""Localized families must retain native identity and never guess dispatch."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import struct
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
from native_animation_families import build_animation_families, decode_localization111, resolve_animation_references
from native_catalog.ue2 import FormatError


SCRIPT = b'''class Pawn extends Actor;
enum WeaponType { WT_HAND, WT_1HS };
var Pawn.WeaponType CurWeaponType;
var localized name WaitAnimName[2];
var localized name Atk01AnimName[2];
var localized float Atk01AnimRate[2];
var localized name DeathAnimName[2];
function name GetWaitAnimName()
{
    return WaitAnimName[int(CurWeaponType)];
    return;
}
function name GetAtk01AnimName()
{
    return Atk01AnimName[int(CurWeaponType)];
    return;
}
function name GetDeathAnimName()
{
    if (CurWeaponType == 0) { return OtherAnim; }
    return DeathAnimName[int(CurWeaponType)];
}
'''


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encrypted(payload):
    body='Lineage2Ver111'.encode('utf-16le') + bytes(value ^ 0xac for value in payload)
    return body + struct.pack('<5I',0,8,71,zlib.crc32(body),0)


def evidence(script=SCRIPT):
    return {'object': 'Engine.Pawn', 'sourceScriptSha256': digest(script),
            'source': {'object': 'Engine.Pawn', 'packageSha256': '1'*64},
            'enums': {'WeaponType': {'WT_HAND': 0, 'WT_1HS': 1}}}


def build(payload, script=SCRIPT, defaults=None):
    raw = encrypted(payload)
    return build_animation_families(raw, source={'host':'fixture', 'path':'system/Warrior.int', 'sha256':digest(raw)},
                                    section='MFighter', class_defaults=defaults or evidence(script), class_script_bytes=script)


class AnimationFamiliesTests(unittest.TestCase):
    def test_keeps_exact_names_rate_lexemes_and_offsets_without_filling_missing_family(self):
        payload=b'[MFighter]\r\nWaitAnimName[1]=wait_1HS_MFighter\r\nAtk01AnimName[1]=Atk01_1HS_MFighter\r\nAtk01AnimRate[1]=0.833300\r\nDeathAnimName[1]=Death_MFighter\r\n'
        result=build(payload)
        self.assertEqual(result['families'][0]['fields'],{})
        self.assertEqual(result['families'][1]['fields']['Atk01AnimName']['value'],'Atk01_1HS_MFighter')
        rows={row['key']:row for row in result['records']}
        self.assertEqual(rows['Atk01AnimRate[1]']['value'],'0.833300')
        self.assertEqual(rows['Atk01AnimRate[1]']['selectionPath'],'unverified')
        self.assertEqual(rows['DeathAnimName[1]']['selectionPath'],'unverified')
        self.assertEqual(result['decodedPayloadSha256'],digest(payload))
        for row in result['records']:
            self.assertTrue(payload[row['payloadByteOffset']:].startswith(row['rawLine'].encode('ascii')))
        self.assertEqual(decode_localization111(encrypted(payload)),payload)
        raw=encrypted(payload)
        framing=result['sourceFraming']
        for name in ('header','footer'):
            block=framing[name]
            self.assertEqual(raw[block['offset']:block['offset']+block['bytes']],bytes.fromhex(block['hex']))
            self.assertEqual(digest(bytes.fromhex(block['hex'])),block['sha256'])
        self.assertEqual(framing['encryptedPayload']['bytes'],len(payload))

    def test_footer_is_required_and_unknown_markers_bad_crc_or_truncation_fail(self):
        raw=encrypted(b'[MFighter]\nWaitAnimName[1]=wait_1HS_MFighter')
        malformed=[raw[:-20],raw[:-1],raw+b'\0',raw[:-20]+struct.pack('<5I',0,8,72,zlib.crc32(raw[:-20]),0),
                   raw[:-8]+b'\0\0\0\0'+raw[-4:],raw[:30]+bytes([raw[30]^1])+raw[31:]]
        for data in malformed:
            with self.subTest(tail=data[-20:].hex()), self.assertRaises(FormatError): decode_localization111(data)

    def test_duplicate_sections_keys_and_numeric_alias_indices_are_rejected(self):
        for payload in (b'[MFighter]\nWaitAnimName[1]=x\n[mfighter]\nWaitAnimName[0]=y',
                        b'[MFighter]\nWaitAnimName[1]=x\nwaitanimname[1]=y',
                        b'[MFighter]\nWaitAnimName[01]=x\nWaitAnimName[1]=y'):
            with self.subTest(payload=payload), self.assertRaises(FormatError): build(payload)

    def test_out_of_bounds_index_and_scalar_array_confusion_are_rejected(self):
        for payload in (b'[MFighter]\nWaitAnimName[2]=x', b'[MFighter]\nWaitAnimName=x',
                        b'[MFighter]\nUnknown[4096]=x'):
            with self.subTest(payload=payload), self.assertRaises(FormatError): build(payload)

    def test_unknown_assignment_retained_but_has_no_semantic_alias(self):
        result=build(b'[MFighter]\nUnknown[1]=wait_1HS_MFighter\nWaitAnimName[1]=  exact_case  ')
        self.assertIn('Unknown[1]', result['unverifiedSelectionKeys'])
        self.assertNotIn('Unknown', result['families'][1]['fields'])
        self.assertEqual(result['families'][1]['fields']['WaitAnimName']['value'],'  exact_case  ')

    def test_wrong_source_or_class_hash_and_class_enum_mismatch_are_rejected(self):
        raw=encrypted(b'[MFighter]\nWaitAnimName[1]=x')
        with self.assertRaisesRegex(FormatError,'source hash'):
            build_animation_families(raw,source={'host':'fixture','path':'x','sha256':'0'*64},section='MFighter',class_defaults=evidence(),class_script_bytes=SCRIPT)
        defaults=evidence()
        defaults['sourceScriptSha256']='0'*64
        with self.assertRaisesRegex(FormatError,'script hash'): build(b'[MFighter]\nWaitAnimName[1]=x',defaults=defaults)
        defaults=evidence()
        defaults['enums']['WeaponType']['WT_1HS']=7
        with self.assertRaisesRegex(FormatError,'enum evidence'): build(b'[MFighter]\nWaitAnimName[1]=x',defaults=defaults)

    def test_conflicting_getter_evidence_is_rejected(self):
        scripts=[SCRIPT+b'\nfunction name Other() { return WaitAnimName[int(CurWeaponType)]; }',
                 SCRIPT+b'\nfunction name GetWaitAnimName() { return OtherName; }',
                 SCRIPT.replace(b'WaitAnimName[2];',b'WaitAnimName[3];'),
                 SCRIPT+b'\nvar localized name WaitAnimName[2];']
        for script in scripts:
            with self.subTest(script=script[-60:]), self.assertRaises(FormatError): build(b'[MFighter]\nWaitAnimName[1]=x',script)

    def test_unreviewed_wrapper_encoding_and_section_syntax_fail(self):
        for raw in (b'', encrypted(b'[MFighter]\nA=x').replace(b'1\x001\x001',b'1\x002\x001',1),
                    encrypted(b'\xff\xfe[MFighter]'), encrypted(b'[MFighter]\0')):
            with self.subTest(raw=raw[:28]), self.assertRaises(FormatError): decode_localization111(raw)
        for payload in (b'[MFighter]\nWaitAnimName[1]=\xe9',b'[MFighter]\nMalformed',b'[Other]\nA=x'):
            with self.subTest(payload=payload), self.assertRaises(FormatError): build(payload)

    def test_other_sections_are_not_recoded_or_mapped(self):
        result=build(b'[Other]\nWord=\xe9\n[MFighter]\nWaitAnimName[1]=x\n[Later]\nUnknown=z')
        self.assertEqual([row['key'] for row in result['records']],['WaitAnimName[1]'])

    def test_reference_resolution_preserves_case_and_reports_bounded_missing_clips(self):
        metadata=build(b'[MFighter]\nWaitAnimName[1]=wait_1HS_MFighter\nAtk01AnimName[1]=atk01_1HS_MFighter\nDeathAnimName[1]=Death_MFighter\nAtk01AnimRate[1]=0.8333')
        before=copy.deepcopy(metadata)
        clips=['wait_1HS_MFighter','Atk01_1HS_MFighter']
        result=resolve_animation_references(metadata,clips)
        self.assertEqual(result['counts'],{'exact':1,'case-only':1,'missing':1,'ambiguous':0,'unsupported-syntax':0})
        self.assertEqual(result['references'][1]['reference'],'atk01_1HS_MFighter')
        self.assertEqual(result['references'][1]['matchingExportedClips'],[{'index':1,'name':'Atk01_1HS_MFighter'}])
        self.assertEqual(metadata,before)
        self.assertEqual(clips,['wait_1HS_MFighter','Atk01_1HS_MFighter'])

    def test_reference_resolution_requires_unique_casefold_match_even_with_exact_candidate(self):
        metadata=build(b'[MFighter]\nWaitAnimName[1]=Wait')
        for clips in (['Wait','Wait'],['Wait','wait']):
            result=resolve_animation_references(metadata,clips)
            self.assertEqual(result['references'][0]['status'],'ambiguous')
            self.assertEqual(len(result['references'][0]['matchingExportedClips']),2)

    def test_reference_resolution_does_not_trim_parse_or_alias_unreviewed_reference_syntax(self):
        metadata=build(b'[MFighter]\nWaitAnimName[1]= Wait \nAtk01AnimName[1]=Fighter.Attack\nUnknown[1]=Wait')
        result=resolve_animation_references(metadata,['Wait','Fighter.Attack'])
        self.assertEqual(result['referenceCount'],2)
        self.assertEqual(result['counts']['unsupported-syntax'],2)
        self.assertEqual(result['references'][0]['reference'],' Wait ')
        self.assertEqual(result['references'][0]['matchingExportedClips'],[])

    def test_reference_resolution_empty_export_reports_missing_and_invalid_names_fail(self):
        metadata=build(b'[MFighter]\nWaitAnimName[1]=Wait')
        self.assertEqual(resolve_animation_references(metadata,[])['counts']['missing'],1)
        for clips in ('Wait',[''],[123]):
            with self.subTest(clips=clips), self.assertRaises(FormatError): resolve_animation_references(metadata,clips)

    @unittest.skipUnless((ROOT/'artifacts/native-parity/research/weapon-attachment/LineageWarrior.int').is_file(), 'Verified staged INT unavailable')
    def test_authoritative_fighter_values_and_direct_getter_coverage(self):
        folder=ROOT/'artifacts/native-parity/research/weapon-attachment'
        raw=(folder/'LineageWarrior.int').read_bytes()
        self.assertEqual(digest(raw),'8d951cbccd010a849f05df827d7065ec5f9372245953e71f3e88344cf8189485')
        defaults=json.loads((folder/'Engine.Pawn/defaults.json').read_bytes())
        script=(folder/'Engine.Pawn/scripts/Engine.Pawn.uc').read_bytes()
        result=build_animation_families(raw,source={'host':'IMPORTA-PC','path':'C:/Lineage2-client/system/LineageWarrior.int','sha256':digest(raw)},section='MFighter',class_defaults=defaults,class_script_bytes=script)
        self.assertEqual(len(result['records']),380)
        self.assertEqual(len(result['baseClassGetters']),62)
        self.assertEqual(len(result['unverifiedSelectionKeys']),137)
        self.assertEqual(result['decodedPayloadBytes'],193494)
        self.assertEqual(result['decodedPayloadSha256'],'a2e5f8e2121d0c32c7e540d04fdac17c725da8c4aac36facccec24586d71b0b9')
        self.assertEqual(result['sourceFraming']['footer']['hex'],'0000000008000000470000003fe71d0900000000')
        codec=folder/'codec-crosscheck/LineageWarrior.decoded.int'
        if codec.is_file(): self.assertEqual(decode_localization111(raw),codec.read_bytes())
        self.assertEqual(result['families'][1]['fields']['Atk01AnimName']['value'],'Atk01_1HS_MFighter')
        rows={row['key']:row for row in result['records']}
        self.assertEqual(rows['Atk01AnimRate[1]']['value'],'0.8333')
        self.assertEqual(rows['DeathAnimName[1]']['selectionPath'],'unverified')
        self.assertEqual(result,build_animation_families(raw,source=result['source'],section='MFighter',class_defaults=copy.deepcopy(defaults),class_script_bytes=script))


if __name__=='__main__': unittest.main()
