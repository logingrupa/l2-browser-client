"""Preserve authored socket names and original FCoords without inventing a transform."""
import hashlib
import json
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
from native_catalog.skeletal import SkeletalReader, decode_skeletal_source
from native_catalog.ue2 import FormatError, Package, Reader


def compact(value):
    output = bytearray([value & 63])
    value >>= 6
    if value:
        output[0] |= 64
    while value:
        byte, value = value & 127, value >> 7
        output.append(byte | (128 if value else 0))
    return bytes(output)


def fixture(aliases=(1,), names=(2,), coords=None):
    coords = [(0.8,2.3,-0.0,1,0,0,0,1,0,0,0,1)] if coords is None else coords
    raw = (compact(len(aliases))+b''.join(compact(value) for value in aliases)+
           compact(len(names))+b''.join(compact(value) for value in names)+
           compact(len(coords))+b''.join(struct.pack('<12f',*value) for value in coords))
    package=Package.__new__(Package)
    package.data=b'prefix'+raw
    package.source_hash=hashlib.sha256(package.data).hexdigest()
    package.names=['None','e_Hand','Weapon_R_Bone']
    reader=object.__new__(SkeletalReader)
    reader.package=package
    reader.reader=Reader(package.data,6)
    reader.records=[]
    reader.item={'object':'Fixture.Gloves'}
    return reader,raw


class NativeAttachmentTests(unittest.TestCase):
    def test_exact_serialized_records_include_counts_and_negative_zero(self):
        reader,raw=fixture()
        source=bytes(reader.package.data)
        result=reader.attachments([{'name':'weapon_r_bone'}])
        entry=result['entries'][0]
        self.assertEqual((entry['alias'],entry['bone'],entry['boneIndices'],entry['boneResolution']),('e_Hand','Weapon_R_Bone',[0],'unique'))
        self.assertEqual(entry['nativeCoords']['axes'],[[1,0,0],[0,1,0],[0,0,1]])
        self.assertEqual(struct.pack('<f',entry['nativeCoords']['origin'][2]),b'\0\0\0\x80')
        self.assertEqual(b''.join(bytes.fromhex(value['hex']) for value in result['arrays'].values()),raw)
        for record in result['arrays'].values():
            payload=source[record['offset']:record['offset']+record['bytes']]
            self.assertEqual(bytes.fromhex(record['hex']),payload)
            self.assertEqual(record['sha256'],hashlib.sha256(payload).hexdigest())
        self.assertEqual(reader.package.data,source)
        self.assertEqual(reader.reader.position,len(source))

    def test_empty_arrays_remain_three_explicit_serialized_zero_counts(self):
        reader,_=fixture(aliases=(),names=(),coords=[])
        result=reader.attachments([])
        self.assertEqual(result['entries'],[])
        self.assertEqual([entry['hex'] for entry in result['arrays'].values()],['00']*3)

    def test_missing_ambiguous_bone_and_repeated_aliases_are_not_invented(self):
        values=(0,0,0,1,0,0,0,1,0,0,0,1)
        for bones,status,indices in (([],'missing',[]),([{'name':'Weapon_R_Bone'},{'name':'weapon_r_bone'}],'ambiguous',[0,1])):
            reader,_=fixture(aliases=(1,1),names=(2,2),coords=[values,values])
            result=reader.attachments(bones)
            self.assertEqual([row['alias'] for row in result['entries']],['e_Hand']*2)
            self.assertEqual([row['boneResolution'] for row in result['entries']],[status]*2)
            self.assertEqual(result['entries'][0]['boneIndices'],indices)

    def test_mismatched_counts_invalid_names_and_nonfinite_coords_fail(self):
        cases=[{'aliases':()}, {'names':(999,)}, {'coords':[(float('nan'),)+tuple([0]*11)]}, {'coords':[(float('inf'),)+tuple([0]*11)]}]
        for kwargs in cases:
            reader,_=fixture(**kwargs)
            with self.subTest(kwargs=kwargs),self.assertRaises(FormatError):
                reader.attachments([])

    def test_truncated_and_excessive_coords_fail(self):
        reader,_=fixture()
        reader.reader.end-=1
        with self.assertRaises(FormatError): reader.attachments([])
        reader,_=fixture()
        reader.package.data=b'\0\0'+compact(4097)
        reader.reader=Reader(reader.package.data)
        with self.assertRaisesRegex(FormatError,'collection count'): reader.attachments([])

    @unittest.skipUnless((ROOT/'artifacts/native-parity/inputs/IMPORTA-PC/animations/Fighter.ukx').is_file(),'Pinned native package unavailable')
    def test_real_glove_socket_matches_independent_source_offsets(self):
        path=ROOT/'artifacts/native-parity/inputs/IMPORTA-PC/animations/Fighter.ukx'
        raw=path.read_bytes()
        pins=json.loads((ROOT/'recipes/native-inputs.lock.json').read_bytes())['files']
        expected=next(row['sha256'] for row in pins if row['relativePath'].casefold()=='animations/fighter.ukx')
        self.assertEqual(hashlib.sha256(raw).hexdigest(),expected)
        package=Package(raw,path.name)
        item=next(item for item in package.exports if item['object']=='Fighter.MFighter_m001_g')
        socket=decode_skeletal_source(package,item)['attachments']
        self.assertEqual(len(socket['entries']),1)
        entry=socket['entries'][0]
        self.assertEqual((entry['alias'],entry['bone'],entry['boneIndices']),('e_Hand','Weapon_R_Bone',[32]))
        # Independent bounded audit located these source ranges before production changes.
        for name,start,end in [('AttachAliases',9801525,9801528),('AttachBoneNames',9801528,9801530),('AttachCoords',9801530,9801579)]:
            self.assertEqual(bytes.fromhex(socket['arrays'][name]['hex']),package.data[start:end])
            self.assertEqual(socket['arrays'][name]['offset'],start)
        self.assertEqual(entry['nativeCoords']['origin'],list(struct.unpack('<3f',package.data[9801531:9801543])))


if __name__=='__main__': unittest.main()
