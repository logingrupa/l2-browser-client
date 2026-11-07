import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_source_stage import (confined, inventory, read_manifest, relative_path,
                                 remote_hashes, stage, validate_manifest, verify_sources)


def digest(payload):
    return hashlib.sha256(payload).hexdigest()


def directory_link(alias, target):
    try:
        alias.symlink_to(target, target_is_directory=True)
    except OSError:
        if os.name != 'nt':
            raise
        # NTFS junctions exercise the same reparse guard without requiring the
        # administrator/developer-mode privilege needed for Windows symlinks.
        config = base64.b64encode(json.dumps({'path': str(alias), 'target': str(target)}).encode()).decode()
        script = "$ErrorActionPreference='Stop';$c=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + config + "'))|ConvertFrom-Json;New-Item -ItemType Junction -Path $c.path -Target $c.target|Out-Null"
        subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', base64.b64encode(script.encode('utf-16le')).decode()],
                       capture_output=True, text=True, timeout=20, check=True)


def manifest(payload=b'native-source', relative='animations/Fighter.ukx', protected=True):
    value = {'schemaVersion': 1, 'sourceHost': 'IMPORTA-PC', 'sourceRoot': 'C:/Lineage2-client',
             'files': [{'relativePath': relative, 'sha256': digest(payload), 'bytes': len(payload)}]}
    if protected:
        value['protectedIntegrity'] = {'relativePath': 'system/l2.ini', 'sha256': digest(b'protected')}
    return value


class ManifestTests(unittest.TestCase):
    def test_only_reviewed_engine_binary_path_is_allowed(self):
        for value in ('system/Engine.dll', 'SYSTEM/engine.DLL'):
            with self.subTest(value=value):
                self.assertEqual(relative_path(value), value)
                validate_manifest(manifest(relative=value))
        for value in ('Engine.dll', 'textures/Engine.dll', 'system/Other.dll',
                      'system/Engine.exe', 'system/Engine.dll/other.dll',
                      'system/../system/Engine.dll', 'system/Engine.dll:stream'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                relative_path(value)

    def test_rejects_traversal_devices_aliases_and_unsupported_extension(self):
        for value in ('../file.utx', '/maps/file.unr', 'C:/file.utx', 'a//b.dat', 'maps/./a.unr',
                      'maps/NUL.utx', 'CON/a.utx', 'maps/LPT1.dat', 'maps./a.unr',
                      'maps/a.unr.', 'system/l2.ini', 'maps/a.unr:stream', 'a\\b.utx'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                relative_path(value)
        self.assertEqual(relative_path('maps/20_20.unr'), 'maps/20_20.unr')

    def test_manifest_identity_duplicates_and_hashes_are_validated(self):
        original = manifest()
        self.assertIs(validate_manifest(original), original)
        invalid = []
        for key, value in (('sourceRoot', 'C:/client/../outside'), ('sourceRoot', 'C:/client/'),
                           ('sourceRoot', 'C:/NUL'), ('sourceHost', 'host;command'), ('files', [])):
            candidate = copy.deepcopy(original)
            candidate[key] = value
            invalid.append(candidate)
        candidate = copy.deepcopy(original)
        candidate['files'].append({**candidate['files'][0], 'relativePath': 'ANIMATIONS/fighter.ukx'})
        invalid.append(candidate)
        for key, value in (('bytes', True), ('bytes', -1), ('sha256', 'bad'),
                           ('sourceHost', 'OTHER-PC'), ('absolutePath', 'C:/elsewhere/Fighter.ukx')):
            candidate = copy.deepcopy(original)
            candidate['files'][0][key] = value
            invalid.append(candidate)
        candidate = copy.deepcopy(original)
        candidate['protectedIntegrity']['relativePath'] = '../l2.ini'
        invalid.append(candidate)
        for candidate in invalid:
            with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                validate_manifest(candidate)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'source.json'
            path.write_text(json.dumps(original), encoding='utf-8-sig')
            self.assertEqual(read_manifest(path), original)

    def test_rejects_root_and_descendant_symlinks_including_internal_alias(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            native = root / 'native'
            (native / 'textures').mkdir(parents=True)
            (native / 'textures/a.utx').write_bytes(b'asset')
            alias = root / 'alias'
            try:
                directory_link(alias, native)
                directory_link(native / 'mirror', native / 'textures')
            except (OSError, subprocess.CalledProcessError):
                self.skipTest('Filesystem links unavailable')
            with self.assertRaisesRegex(ValueError, 'symlink/reparse'):
                confined(alias, 'textures/a.utx')
            with self.assertRaisesRegex(ValueError, 'symlink/reparse'):
                confined(native, 'mirror/a.utx')


class StageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.client, self.output = self.root / 'local', self.root / 'stage'
        self.payload, self.manifest = b'native-source', manifest()
        path = self.client / self.manifest['files'][0]['relativePath']
        path.parent.mkdir(parents=True)
        path.write_bytes(self.payload)

    def tearDown(self):
        self.temporary.cleanup()

    def remote(self, alias, root, paths, protected):
        return {'sourceHost': 'IMPORTA-PC', 'files': [entry.copy() for entry in self.manifest['files'] if entry['relativePath'] in paths],
                'protectedSha256': self.manifest['protectedIntegrity']['sha256']}

    def test_local_copy_requires_remote_proof_and_second_run_reuses_verified_stage(self):
        with patch('native_source_stage.remote_hashes', side_effect=self.remote) as remote, patch('native_source_stage.subprocess.run') as transfer:
            result = stage(self.manifest, self.output, self.client)
            self.assertEqual(result['files'][0]['method'], 'local-copy-after-fleet-hash-proof')
            self.assertTrue(result['protectedIniUnchanged'])
            self.assertFalse(result['protectedIniCopied'])
            self.assertEqual(remote.call_count, 2)
            target = self.output / self.manifest['files'][0]['relativePath']
            before = target.stat().st_mtime_ns
            result = stage(self.manifest, self.output, self.client)
            self.assertEqual(result['files'][0]['method'], 'reused-verified-stage')
            self.assertEqual(target.stat().st_mtime_ns, before)
            transfer.assert_not_called()
        self.assertEqual(verify_sources(self.manifest, self.output)['files'], 1)
        self.assertEqual((self.client / self.manifest['files'][0]['relativePath']).read_bytes(), self.payload)
        self.assertFalse((self.output / 'system/l2.ini').exists())

    def test_engine_evidence_is_hash_verified_copied_and_inventoried_without_execution(self):
        self.payload = b'MZ opaque reviewed dispatch evidence'
        self.manifest = manifest(self.payload, 'system/Engine.dll')
        source = self.client / 'system/Engine.dll'
        source.parent.mkdir()
        source.write_bytes(self.payload)
        with patch('native_source_stage.remote_hashes', side_effect=self.remote), \
                patch('native_source_stage.subprocess.run') as process, \
                patch('native_source_stage.Package') as package:
            result = stage(self.manifest, self.output, self.client)
            self.assertEqual(result['files'][0]['method'], 'local-copy-after-fleet-hash-proof')
            report = inventory(self.manifest, self.output)
            self.assertEqual(report['files'][0]['status'], 'binary-evidence-preserved-not-executed')
            self.assertEqual(report['exportClassCounts'], {})
            package.assert_not_called()
            process.assert_not_called()
        self.assertEqual(source.read_bytes(), self.payload)
        target = self.output / 'system/Engine.dll'
        self.assertEqual(target.read_bytes(), self.payload)
        target.write_bytes(self.payload + b'changed')
        with self.assertRaisesRegex(ValueError, 'hash/length mismatch'):
            verify_sources(self.manifest, self.output)

    def test_authoritative_mismatch_does_not_create_destination(self):
        def wrong(*args):
            result = self.remote(*args)
            result['files'][0]['sha256'] = '0' * 64
            return result
        with patch('native_source_stage.remote_hashes', side_effect=wrong), self.assertRaisesRegex(ValueError, 'Authoritative source changed'):
            stage(self.manifest, self.output, self.client)
        self.assertFalse(self.output.exists())

    def test_rejects_wrong_fleet_host_duplicate_rows_and_protected_hash_change(self):
        for key, value, reason in (('sourceHost', 'OTHER-PC', 'Fleet host'),
                                   ('protectedSha256', '0' * 64, 'Protected INI'),
                                   ('files', self.manifest['files'] * 2, 'file set')):
            result = self.remote(None, None, [self.manifest['files'][0]['relativePath']], None)
            result[key] = value
            with self.subTest(key=key), patch('native_source_stage.remote_hashes', return_value=result), self.assertRaisesRegex(ValueError, reason):
                stage(self.manifest, self.output, self.client)
        self.assertFalse(self.output.exists())

    def test_final_protected_integrity_check_also_verifies_host(self):
        first = self.remote(None, None, [self.manifest['files'][0]['relativePath']], None)
        final = self.remote(None, None, [], None)
        final['sourceHost'] = 'OTHER-PC'
        with patch('native_source_stage.remote_hashes', side_effect=[first, final]), self.assertRaisesRegex(ValueError, 'Fleet host changed'):
            stage(self.manifest, self.output, self.client)

    def test_scp_fallback_verifies_copy_and_failed_copy_leaves_no_target_or_temp(self):
        source = self.client / self.manifest['files'][0]['relativePath']
        source.write_bytes(b'local version differs')

        def transfer(command, **kwargs):
            self.assertEqual(command[0], 'scp')
            Path(command[-1]).write_bytes(self.payload)
            return subprocess.CompletedProcess(command, 0)

        with patch('native_source_stage.remote_hashes', side_effect=self.remote), patch('native_source_stage.subprocess.run', side_effect=transfer):
            result = stage(self.manifest, self.output, self.client)
        self.assertEqual(result['files'][0]['method'], 'fleet-copy')

        def corrupted(command, **kwargs):
            Path(command[-1]).write_bytes(b'bad transfer')
            return subprocess.CompletedProcess(command, 0)

        failure = self.root / 'failed-stage'
        with patch('native_source_stage.remote_hashes', side_effect=self.remote), patch('native_source_stage.subprocess.run', side_effect=corrupted), self.assertRaisesRegex(ValueError, 'failed verification'):
            stage(self.manifest, failure, self.client)
        self.assertFalse((failure / self.manifest['files'][0]['relativePath']).exists())
        self.assertEqual(list(failure.rglob('.native-stage-*')), [])
        self.assertEqual(source.read_bytes(), b'local version differs')

    def test_existing_different_stage_and_overlapping_output_are_preserved(self):
        target = self.output / self.manifest['files'][0]['relativePath']
        target.parent.mkdir(parents=True)
        target.write_bytes(b'authored or different source')
        with patch('native_source_stage.remote_hashes', side_effect=self.remote), self.assertRaisesRegex(ValueError, 'Differing staged file preserved'):
            stage(self.manifest, self.output, self.client)
        self.assertEqual(target.read_bytes(), b'authored or different source')
        with patch('native_source_stage.remote_hashes') as remote:
            for output in (self.client, self.client / 'copy', self.root):
                with self.subTest(output=output), self.assertRaisesRegex(ValueError, 'separate'):
                    stage(self.manifest, output, self.client)
            remote.assert_not_called()

    def test_direct_api_rejects_invalid_manifest_or_option_like_alias_before_io(self):
        bad = copy.deepcopy(self.manifest)
        bad['files'][0]['relativePath'] = '../outside.ukx'
        with patch('native_source_stage.remote_hashes') as remote:
            with self.assertRaises(ValueError):
                stage(bad, self.output, self.client)
            with self.assertRaises(ValueError):
                stage(self.manifest, self.output, self.client, '-bad')
            remote.assert_not_called()

    def test_inventory_retains_unsupported_package_instead_of_aborting(self):
        result = inventory(self.manifest, self.client)
        self.assertEqual(result['files'][0]['status'], 'unsupported-package-table-adapter')
        self.assertIn('Unsupported native wrapper', result['files'][0]['reason'])
        self.assertEqual(result['files'][0]['sha256'], digest(self.payload))

    def test_localization_input_is_staged_verbatim_without_package_or_ini_handling(self):
        payload = 'Lineage2Ver111'.encode('utf-16le') + b'original encoded localization'
        entry = manifest(payload, 'system/LineageWarrior.int', protected=False)
        source = self.client / 'system/LineageWarrior.int'
        source.parent.mkdir(exist_ok=True)
        source.write_bytes(payload)
        remote = {'sourceHost': 'IMPORTA-PC', 'files': entry['files'], 'protectedSha256': None}
        with patch('native_source_stage.remote_hashes', return_value=remote):
            receipt = stage(entry, self.output, self.client)
        self.assertEqual((self.output / 'system/LineageWarrior.int').read_bytes(), payload)
        self.assertEqual(receipt['files'][0]['method'], 'local-copy-after-fleet-hash-proof')
        row = inventory(entry, self.output)['files'][0]
        self.assertEqual(row['status'], 'inventoried-not-converted')
        self.assertNotIn('exportClasses', row)
        self.assertEqual(source.read_bytes(), payload)
        with self.assertRaises(ValueError):
            relative_path('system/l2.ini')


class RemoteHashTests(unittest.TestCase):
    def test_remote_program_uses_encoded_arguments_and_no_shell_interpolation(self):
        response = {'sourceHost': 'IMPORTA-PC', 'files': [], 'protectedSha256': None}
        with patch('native_source_stage.subprocess.run', return_value=subprocess.CompletedProcess([], 0, json.dumps(response), '')) as run:
            self.assertEqual(remote_hashes('fleet-importa-pc', 'C:/Native Client', ['maps/20_20.unr']), response)
        command = run.call_args.args[0]
        self.assertEqual(command[-2], '-EncodedCommand')
        script = base64.b64decode(command[-1]).decode('utf-16le')
        self.assertIn('Read-NativeItem', script)
        self.assertIn('ReparsePoint', script)
        self.assertNotIn('C:/Native Client', script)
        self.assertNotIn('shell', run.call_args.kwargs)
        for alias in ('-bad', 'host;command', 'host name'):
            with self.subTest(alias=alias), self.assertRaises(ValueError):
                remote_hashes(alias, 'C:/Client', [])

    @unittest.skipUnless(os.name == 'nt' and shutil.which('powershell'), 'local PowerShell integration requires Windows')
    def test_encoded_read_only_program_executes_locally_without_ssh(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'maps').mkdir()
            (root / 'system').mkdir()
            (root / 'maps/20_20.unr').write_bytes(b'map bytes')
            (root / 'system/l2.ini').write_bytes(b'protected ini')
            real_run = subprocess.run

            def local_only(command, **kwargs):
                # Exercise exactly the generated PowerShell program against
                # temporary files; never SSH or touch the actual native client.
                start = command.index('powershell')
                return real_run(command[start:], **kwargs)

            with patch('native_source_stage.subprocess.run', side_effect=local_only):
                result = remote_hashes('test-host', root.as_posix(), ['maps/20_20.unr'], 'system/l2.ini')
            self.assertEqual(result['files'][0]['sha256'], digest(b'map bytes'))
            self.assertEqual(result['protectedSha256'], digest(b'protected ini'))
            self.assertEqual((root / 'system/l2.ini').read_bytes(), b'protected ini')
            alias = root / 'alias'
            directory_link(alias, root / 'maps')
            with patch('native_source_stage.subprocess.run', side_effect=local_only), self.assertRaises(subprocess.CalledProcessError) as raised:
                remote_hashes('test-host', root.as_posix(), ['alias/20_20.unr'])
            self.assertIn('reparse point', raised.exception.stderr)


if __name__ == '__main__':
    unittest.main()
