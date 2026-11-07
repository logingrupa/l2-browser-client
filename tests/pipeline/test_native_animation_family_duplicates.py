"""Admit identical native assignments without inventing duplicate precedence."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from native_animation_families import build_animation_families, section_records, resolve_animation_references
from native_catalog.ue2 import FormatError
from test_native_animation_families import SCRIPT, build, digest, encrypted, evidence


class IdenticalAnimationAssignmentTests(unittest.TestCase):
    def test_retains_both_physical_records_with_exact_crlf_bytes(self):
        header = b"[MFighter]\r\n"
        assignment = b"WaitAnimName[1]=wait_1HS_MFighter\r\n"
        payload = header + assignment + assignment
        rows = section_records(payload, "MFighter")
        self.assertEqual(len(rows), 2)
        self.assertEqual([row["line"] for row in rows], [2, 3])
        self.assertEqual([row["payloadByteOffset"] for row in rows],
                         [len(header), len(header) + len(assignment)])
        self.assertNotIn("identicalDuplicateOf", rows[0])
        self.assertEqual(rows[1]["identicalDuplicateOf"],
                         {"line": 2, "payloadByteOffset": len(header)})
        for row in rows:
            self.assertEqual(row["rawLineHex"], assignment.hex())
            start = row["payloadByteOffset"]
            self.assertEqual(payload[start:start + len(assignment)], bytes.fromhex(row["rawLineHex"]))
            self.assertEqual(row["value"], "wait_1HS_MFighter")

    def test_three_separated_copies_keep_first_binding_and_all_source_lines(self):
        header = b"[MFighter]\r\n"
        assignment = b"WaitAnimName[1]=wait_1HS_MFighter\r\n"
        between = b"; preserved source spacing\r\n\r\n"
        payload = header + assignment + between + assignment + assignment
        result = build(payload)
        rows = result["records"]
        self.assertEqual([row["line"] for row in rows], [2, 5, 6])
        field = result["families"][1]["fields"]["WaitAnimName"]
        self.assertEqual(field["line"], 2)
        self.assertEqual(field["sourceLines"], [2, 5, 6])
        self.assertEqual(field["value"], "wait_1HS_MFighter")
        self.assertEqual(result["identicalDuplicates"], [
            {"key": "WaitAnimName[1]", "firstLine": 2, "line": row["line"],
             "firstPayloadByteOffset": len(header), "payloadByteOffset": row["payloadByteOffset"],
             "rawLineHex": assignment.hex()}
            for row in rows[1:]
        ])
        for row in rows[1:]:
            self.assertEqual(row["identicalDuplicateOf"],
                             {"line": 2, "payloadByteOffset": len(header)})

    def test_equal_parsed_values_are_insufficient_when_source_rows_differ(self):
        original = b"WaitAnimName[1]=wait_1HS_MFighter\r\n"
        alternatives = {
            "conflicting-value": b"WaitAnimName[1]=different\r\n",
            "key-case": b"waitanimname[1]=wait_1HS_MFighter\r\n",
            "numeric-alias": b"WaitAnimName[01]=wait_1HS_MFighter\r\n",
            "leading-space": b" WaitAnimName[1]=wait_1HS_MFighter\r\n",
            "key-spacing": b"WaitAnimName[1] =wait_1HS_MFighter\r\n",
            "value-spacing": b"WaitAnimName[1]=wait_1HS_MFighter \r\n",
            "line-feed-only": b"WaitAnimName[1]=wait_1HS_MFighter\n",
            "no-line-terminator": b"WaitAnimName[1]=wait_1HS_MFighter",
        }
        for label, alternative in alternatives.items():
            with self.subTest(case=label), self.assertRaisesRegex(FormatError, "Duplicate localization key/index"):
                build(b"[MFighter]\r\n" + original + alternative)

    def test_unique_output_stays_byte_equivalent_to_before_duplicate_fix(self):
        payload = (b"[MFighter]\r\nWaitAnimName[1]=wait_1HS_MFighter\r\n"
                   b"Atk01AnimRate[1]=0.833300\r\nUnknown[0]=raw_value  \r\n")
        result = build(payload)
        canonical = json.dumps(result, sort_keys=True, separators=(",", ":")).encode()
        # Captured from the unchanged reader before the duplicate admission edit.
        self.assertEqual(hashlib.sha256(canonical).hexdigest(),
                         "f2b66258aefba557c5ab85473833fe3269227b268ae4d0a806677ba539c3ecf0")
        self.assertNotIn("identicalDuplicates", result)
        self.assertTrue(all("rawLineHex" not in row and "identicalDuplicateOf" not in row
                            for row in result["records"]))
        self.assertNotIn("sourceLines", result["families"][1]["fields"]["WaitAnimName"])

    def test_unknown_identical_assignments_stay_unverified(self):
        assignment = b"UnresolvedAction[0]=Native_Unknown\n"
        result = build(b"[MFighter]\n" + assignment + assignment)
        self.assertEqual(len(result["records"]), 2)
        self.assertTrue(all(row["selectionPath"] == "unverified" for row in result["records"]))
        self.assertEqual(result["unverifiedSelectionKeys"], ["UnresolvedAction[0]", "UnresolvedAction[0]"])
        self.assertTrue(all(family["fields"] == {} for family in result["families"]))
        self.assertEqual(len(result["identicalDuplicates"]), 1)

    def test_physical_duplicate_references_are_not_coalesced_or_mutated(self):
        assignment = b"WaitAnimName[1]=wait_1HS_MFighter\n"
        metadata = build(b"[MFighter]\n" + assignment + assignment)
        before = copy.deepcopy(metadata)
        coverage = resolve_animation_references(metadata, ["wait_1HS_MFighter"])
        self.assertEqual(coverage["referenceCount"], 2)
        self.assertEqual(coverage["counts"]["exact"], 2)
        self.assertEqual([row["line"] for row in coverage["references"]], [2, 3])
        self.assertEqual(metadata, before)

    def test_repeated_section_and_nonselected_rows_are_not_merged(self):
        row = b"WaitAnimName[1]=wait_1HS_MFighter\n"
        with self.assertRaisesRegex(FormatError, "Duplicate localization section"):
            build(b"[MFighter]\n" + row + b"[MFighter]\n" + row)
        selected = build(b"[Other]\n" + row + b"[MFighter]\n" + row + b"[Later]\n" + row)
        self.assertEqual(len(selected["records"]), 1)
        self.assertNotIn("identicalDuplicates", selected)

    def test_duplicate_admission_does_not_bypass_record_limit(self):
        row = b"UnresolvedAction[0]=Native_Unknown\n"
        self.assertEqual(len(section_records(b"[MFighter]\n" + row * 4096, "MFighter")), 4096)
        with self.assertRaisesRegex(FormatError, "Too many localization assignments"):
            section_records(b"[MFighter]\n" + row * 4097, "MFighter")

    def test_duplicate_source_still_requires_original_hash_and_valid_crc(self):
        row = b"WaitAnimName[1]=wait_1HS_MFighter\n"
        raw = encrypted(b"[MFighter]\n" + row + row)
        kwargs = {"section": "MFighter", "class_defaults": evidence(), "class_script_bytes": SCRIPT}
        with self.assertRaisesRegex(FormatError, "source hash"):
            build_animation_families(raw, source={"host": "fixture", "path": "x", "sha256": "0" * 64}, **kwargs)
        corrupt = raw[:30] + bytes([raw[30] ^ 1]) + raw[31:]
        with self.assertRaisesRegex(FormatError, "CRC32 mismatch"):
            build_animation_families(corrupt, source={"host": "fixture", "path": "x", "sha256": digest(corrupt)}, **kwargs)


SOURCE = ROOT / "artifacts/native-parity/inputs/IMPORTA-PC/system/LineageWarrior.int"
CLASS = ROOT / "artifacts/native-parity/research/weapon-attachment/Engine.Pawn"
ORACLE = ROOT / "artifacts/native-parity/research/unified-asset-batch-20261107/next-character/LOCALIZATION_PHYSICAL_ROWS.json"


@unittest.skipUnless(SOURCE.is_file() and ORACLE.is_file() and (CLASS / "defaults.json").is_file()
                     and (CLASS / "scripts/Engine.Pawn.uc").is_file(), "Pinned FFighter source/evidence unavailable")
class OriginalFemaleFamilyDuplicateTests(unittest.TestCase):
    def test_all_original_physical_rows_join_to_independent_source_oracle(self):
        source = SOURCE.read_bytes()
        oracle = json.loads(ORACLE.read_bytes())
        self.assertEqual(digest(source), "8d951cbccd010a849f05df827d7065ec5f9372245953e71f3e88344cf8189485")
        self.assertEqual(digest(source), oracle["sourceSha256"])
        defaults = json.loads((CLASS / "defaults.json").read_bytes())
        script = (CLASS / "scripts/Engine.Pawn.uc").read_bytes()
        result = build_animation_families(source,
            source={"host": "IMPORTA-PC", "path": "C:/Lineage2-client/system/LineageWarrior.int", "sha256": digest(source)},
            section="FFighter", class_defaults=defaults, class_script_bytes=script)
        self.assertEqual(len(result["records"]), 380)
        self.assertEqual(len(result["records"]), oracle["recordCount"])
        self.assertEqual(result["decodedPayloadSha256"], oracle["decodedSha256"])
        for actual, original in zip(result["records"], oracle["records"]):
            with self.subTest(line=original["line"]):
                self.assertEqual(actual["arrayName"], original["name"])
                self.assertEqual(actual["index"], original["index"])
                self.assertEqual(actual["value"], original["value"])
                self.assertEqual(actual["line"], original["line"])
                self.assertEqual(actual["payloadByteOffset"], original["payloadByteOffset"])
                self.assertEqual(actual["rawLine"], original["rawLine"].rstrip("\r\n"))
                start = original["sourceByteOffset"]
                exact = bytes.fromhex(original["rawLineHex"])
                encrypted_span = source[start:start + len(exact)]
                self.assertEqual(bytes(value ^ 0xAC for value in encrypted_span), exact)
        duplicated = [row for row in result["records"] if row["key"] == "SpAtk05AnimName[0]"]
        self.assertEqual([row["line"] for row in duplicated], [453, 454])
        self.assertEqual([row["payloadByteOffset"] for row in duplicated], [15333, 15375])
        raw_line = b"SpAtk05AnimName[0]=Social_dance_FFighter\r\n"
        self.assertEqual([row["rawLineHex"] for row in duplicated], [raw_line.hex()] * 2)
        self.assertNotIn("identicalDuplicateOf", duplicated[0])
        self.assertEqual(duplicated[1]["identicalDuplicateOf"], {"line": 453, "payloadByteOffset": 15333})
        self.assertEqual(result["identicalDuplicates"], [{
            "key": "SpAtk05AnimName[0]", "firstLine": 453, "line": 454,
            "firstPayloadByteOffset": 15333, "payloadByteOffset": 15375, "rawLineHex": raw_line.hex(),
        }])
        self.assertEqual(len(result["baseClassGetters"]), 62)
        self.assertEqual(result["families"][1]["fields"]["Atk01AnimName"]["value"], "Atk01_1HS_FFighter")


if __name__ == "__main__":
    unittest.main()
