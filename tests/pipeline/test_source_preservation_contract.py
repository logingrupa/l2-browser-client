import ast
import hashlib
from pathlib import Path
import re
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import native_assets
from native_assets import Converter, archive_bytes, sha
from reference_client_lock_fixture import lock_client_as_reference_root
from source_preservation_scan import (acceptance_member_sha256s, acceptance_member_value_texts, acceptance_text_from_members,
    banned_identifier_violations, banned_identifiers_in_text, defect_evidence_problem, files_containing,
    normalisation_scan_files, read_source_preservation_section, scanned_source_preservation_steps, script_files,
    source_preservation_rows)

REVIEWED_UMODEL_BUILD1590_SHA256 = '13502e5a4d8f6b5f32252afebd6360f7302ccfaccf6b8dda65beff0be2d364a0'
REPO_OWNED_UMODEL_FOLDER = '/.assets/native-tools/umodel/'
NORMALISATION_SCAN_ALLOW_LIST = ('scripts/audit_musveren_weights.py',)
SKIN_WEIGHT_ATTRIBUTE_ALLOW_LIST = {
    'scripts/native_assets_lib/weights.py': 'restore_native_weights restores source float influences',
    'scripts/native_assets_lib/rigid.py': 'is_root_rigid reads weights to prove a root-only rigid skin',
    'scripts/audit_musveren_weights.py': 'read-only audit of exporter weights',
}
PARITY_ACCEPTANCE_PATH = ROOT / 'recipes' / 'native-parity.acceptance.json'
NATIVE_PARITY_DOC_PATH = ROOT / 'docs' / 'NATIVE_PARITY.md'
POL01_ACCEPTANCE_MEMBER_SHA256S = (
    ('schemaVersion', '6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b'),
    ('id', '5d7995649420e210e5ddfb67b0899e62a75427f623f5f41f454704d4a34b33cb'),
    ('definedBeforeImplementation', '5fcb572b528519139e2387488eb3b6ebaf08e890f45e59c93ac2161bba96e0e4'),
    ('source', 'ba4633ce9cb4447f6fb3155aa0ff6895be940e21153173fb6aa7ff4c11e8f5f8'),
    ('cases', '3d37059e709174f782192057d4ac99b4115a638e85db0a4eda19ba2c639426b2'),
    ('reference', '6dd83b7e49cfcc7a120ab17c1bf67236f7c152ff2971d7ab5c0e13a6b9487630'),
    ('structural', '108d79b4f7e36ebcb607021a2cb15dc6e480ee1f0c0f810e9b863f0e497bb3db'),
    ('visual', 'f084cba5d179d53bf9a7cd3408891f3bf3db16f58477d99765dd9a8ddfe6537a'),
    ('performance', '9c99e63c3907c474fb0eb44765add9408242c5a980f883b2c1a48a2db90084f9'),
    ('resultPolicy', '9573607ade9744885e4caa48b2fb2aa8bb2e11a2f9bd587070179e6f70ca823e'),
)


def umodel_cli_default_expression():
    tree = ast.parse((ROOT / 'scripts' / 'native_assets.py').read_text(encoding='utf-8'))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'add_argument'
                and node.args and isinstance(node.args[0], ast.Constant) and node.args[0].value == '--umodel'):
            return next(ast.unparse(keyword.value) for keyword in node.keywords if keyword.arg == 'default')
    raise AssertionError('scripts/native_assets.py declares no --umodel option')


def payload_manifest(files):
    return {'schemaVersion': 1, 'files': [{'path': name, 'bytes': len(payload), 'sha256': sha(payload), 'mime': 'application/octet-stream'}
                                          for name, payload in files.items()]}


def one_byte_payloads(count):
    return {f'payload-{index:03d}.bin': bytes([index % 256]) for index in range(count)}


def parity_acceptance_text():
    return PARITY_ACCEPTANCE_PATH.read_text(encoding='utf-8').replace('\r\n', '\n')


class UmodelPinContractTests(unittest.TestCase):
    def test_code_pins_reviewed_build1590(self):
        self.assertEqual(native_assets.UMODEL_SHA256, REVIEWED_UMODEL_BUILD1590_SHA256)

    def test_contract_states_the_same_pin(self):
        self.assertIn(native_assets.UMODEL_SHA256, read_source_preservation_section())

    def test_converter_refuses_a_differently_hashed_umodel(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client = root / 'source'
            client.mkdir()
            lock_client_as_reference_root(self, client)
            tool = root / 'umodel.exe'
            tool.write_bytes(b'not the reviewed umodel')
            with self.assertRaisesRegex(ValueError, 'UModel hash differs'):
                Converter(client, root / 'artifacts' / 'output', tool, project_root=root)
            self.assertFalse((root / 'artifacts' / 'output').exists())

    def test_default_umodel_is_the_repo_owned_tool(self):
        self.assertIn(REPO_OWNED_UMODEL_FOLDER, native_assets.UMODEL.as_posix().casefold())
        self.assertEqual(umodel_cli_default_expression(), 'str(UMODEL)')


class ArchiveLimitContractTests(unittest.TestCase):
    def test_limits_are_128_and_96_mebibytes(self):
        self.assertEqual(native_assets.MAX_ARCHIVE, 128 * 1024 * 1024)
        self.assertEqual(native_assets.MAX_PAYLOAD, 96 * 1024 * 1024)

    def test_255_payloads_fill_the_256_entry_limit_and_256_payloads_are_refused(self):
        accepted = one_byte_payloads(255)
        self.assertIsInstance(archive_bytes(payload_manifest(accepted), accepted), bytes)
        refused = one_byte_payloads(256)
        with self.assertRaisesRegex(ValueError, 'Package exceeds 256 files'):
            archive_bytes(payload_manifest(refused), refused)

    def test_payload_at_the_limit_passes_and_one_byte_over_is_refused(self):
        with patch('native_assets.MAX_PAYLOAD', 8):
            at_limit = {'payload.bin': b'12345678'}
            self.assertIsInstance(archive_bytes(payload_manifest(at_limit), at_limit), bytes)
            over_limit = {'payload.bin': b'123456789'}
            with self.assertRaisesRegex(ValueError, 'Payload exceeds 96 MiB'):
                archive_bytes(payload_manifest(over_limit), over_limit)

    def test_archive_at_the_limit_passes_and_one_byte_over_is_refused(self):
        files = {'payload.bin': b'archive limit sample'}
        archive_length = len(archive_bytes(payload_manifest(files), files))
        with patch('native_assets.MAX_ARCHIVE', archive_length):
            self.assertEqual(len(archive_bytes(payload_manifest(files), files)), archive_length)
        with patch('native_assets.MAX_ARCHIVE', archive_length - 1), self.assertRaisesRegex(ValueError, 'Package exceeds 128 MiB'):
            archive_bytes(payload_manifest(files), files)

    def test_contract_states_the_limits(self):
        section = read_source_preservation_section()
        for text in ('128 MiB', '96 MiB', '256 entries', 'ZIP_STORED'):
            self.assertIn(text, section)


class MagentaSlotContractTests(unittest.TestCase):
    def test_unbound_slot_is_the_named_magenta_diagnostic(self):
        document = SimpleNamespace(data={'materials': [{}]}, image=lambda payload, mime, name: 0)
        converter = SimpleNamespace(material_texture=lambda work, reference: self.fail('an unbound slot reads no texture'))
        slots, limitations = Converter.materials(converter, Path('work'), None, document, 'Sections[0] = { Material=None }', {})
        material = document.data['materials'][0]
        self.assertEqual(material['name'], 'UNBOUND_SOURCE_SLOT_0')
        self.assertEqual(material['pbrMetallicRoughness']['baseColorFactor'], [1, 0, 1, 1])
        self.assertEqual(slots[0]['binding'], 'unbound-source-slot')
        self.assertTrue(limitations[0].startswith('Material slot 0:'))

    def test_contract_states_the_magenta_diagnostic(self):
        section = read_source_preservation_section()
        self.assertIn('UNBOUND_SOURCE_SLOT_<index>', section)
        self.assertIn('[1, 0, 1, 1]', section)


class NormalisationIdentifierBanTests(unittest.TestCase):
    def test_scanner_flags_normalisation_identifiers(self):
        sample = 'def normalize_height(): pass\nconst fitToGround = 1\nremove_root_drift(x)\nrenormalize_weights(y)\n'
        self.assertEqual(banned_identifiers_in_text(sample), ['fitToGround', 'normalize_height', 'remove_root_drift', 'renormalize_weights'])

    def test_scanner_passes_unrelated_normalised_names(self):
        self.assertEqual(banned_identifiers_in_text('normalizedTime = normalized + 1'), [])

    def test_repo_has_no_banned_identifier_outside_the_allow_list(self):
        self.assertEqual(banned_identifier_violations(normalisation_scan_files(), NORMALISATION_SCAN_ALLOW_LIST), [])

    def test_every_allow_list_entry_still_suppresses_a_hit(self):
        for allowed in NORMALISATION_SCAN_ALLOW_LIST:
            with self.subTest(allowed=allowed):
                self.assertNotEqual(banned_identifier_violations([ROOT / allowed], ()), [])

    def test_contract_names_the_allow_list(self):
        section = read_source_preservation_section()
        for allowed in NORMALISATION_SCAN_ALLOW_LIST:
            self.assertIn(allowed, section)


class SkinWeightAttributeAllowListTests(unittest.TestCase):
    def test_only_documented_modules_reference_the_weight_attribute(self):
        self.assertEqual(files_containing(script_files('.py', '.mjs'), 'WEIGHTS_0'), sorted(SKIN_WEIGHT_ATTRIBUTE_ALLOW_LIST))

    def test_contract_names_every_allowed_module(self):
        section = read_source_preservation_section()
        for allowed in SKIN_WEIGHT_ATTRIBUTE_ALLOW_LIST:
            self.assertIn(allowed, section)


class SourcePreservationCensusTests(unittest.TestCase):
    def steps_table(self):
        return source_preservation_rows(read_source_preservation_section(), table_index=1)

    def test_every_scanned_step_has_a_row_and_every_row_names_a_scanned_step(self):
        documented = sorted(row['Step'] for row in self.steps_table())
        self.assertEqual(documented, scanned_source_preservation_steps())

    def test_every_row_has_repo_backed_or_explicitly_unresolved_defect_evidence(self):
        problems = sorted((row['Step'], defect_evidence_problem(row['Defect evidence'])) for row in self.steps_table()
                          if defect_evidence_problem(row['Defect evidence']))
        self.assertEqual(problems, [])

    def test_evidence_check_refuses_invented_and_empty_proof(self):
        self.assertIsNotNone(defect_evidence_problem('tests/pipeline/test_no_such_proof.py:1'))
        self.assertIsNotNone(defect_evidence_problem('unresolved: '))
        self.assertIsNotNone(defect_evidence_problem(''))
        self.assertIsNotNone(defect_evidence_problem('scripts/native_assets.py:999999'))
        self.assertIsNone(defect_evidence_problem('scripts/native_assets.py:1'))


class ParityAcceptanceFileTests(unittest.TestCase):
    def test_member_reader_returns_raw_value_texts_in_source_order(self):
        self.assertEqual(acceptance_member_value_texts('{ "b": [1, 2],\n "a": {"x": 0.970} }\n'), [('b', '[1, 2]'), ('a', '{"x": 0.970}')])

    def test_member_reader_refuses_duplicate_keys_and_trailing_data(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate top-level key'):
            acceptance_member_value_texts('{"a": 1, "a": 2}')
        with self.assertRaisesRegex(ValueError, 'Trailing data'):
            acceptance_member_value_texts('{"a": 1} {"b": 2}')

    def test_editor_round_trip_block_is_gone(self):
        self.assertNotIn('editor', [key for key, _ in acceptance_member_value_texts(parity_acceptance_text())])
        self.assertNotIn('gates nothing (NOED-05)', NATIVE_PARITY_DOC_PATH.read_text(encoding='utf-8'))

    def test_pol01_thresholds_are_byte_for_byte_unchanged(self):
        self.assertEqual(acceptance_member_sha256s(parity_acceptance_text()), POL01_ACCEPTANCE_MEMBER_SHA256S)

    def test_member_pins_detect_a_one_byte_threshold_change(self):
        text = parity_acceptance_text()
        members = acceptance_member_value_texts(text)
        keys = [key for key, _ in members]
        swapped = list(members)
        visual, structural = keys.index('visual'), keys.index('structural')
        swapped[visual], swapped[structural] = swapped[structural], swapped[visual]
        mutations = {
            'threshold 0.97 written as 0.970': text.replace('"minimumSilhouetteIntersectionOverUnion": 0.97,', '"minimumSilhouetteIntersectionOverUnion": 0.970,'),
            'resultPolicy deleted': acceptance_text_from_members([member for member in members if member[0] != 'resultPolicy']),
            'visual and structural swapped': acceptance_text_from_members(swapped),
        }
        for description, mutated in mutations.items():
            with self.subTest(mutation=description):
                self.assertNotEqual(mutated, text)
                self.assertNotEqual(acceptance_member_sha256s(mutated), POL01_ACCEPTANCE_MEMBER_SHA256S)

    def test_parity_doc_states_the_file_sha256(self):
        stated = re.search(r'committed SHA-256 `([0-9a-f]{64})`', NATIVE_PARITY_DOC_PATH.read_text(encoding='utf-8'))
        self.assertIsNotNone(stated)
        self.assertEqual(stated[1], hashlib.sha256(PARITY_ACCEPTANCE_PATH.read_bytes().replace(b'\r\n', b'\n')).hexdigest())


if __name__ == '__main__':
    unittest.main()
