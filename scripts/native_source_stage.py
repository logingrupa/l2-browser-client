"""Replay a pinned fleet input manifest without editing the source client."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from native_assets import hash_file
from native_catalog.ue2 import Package, summary

EXTENSIONS = {'.unr', '.ukx', '.usk', '.utx', '.uax', '.usx', '.u', '.dat', '.int', '.ogg', '.wav'}
# Exact source paths used as opaque, hash-pinned evidence; never load or execute.
BINARY_EVIDENCE_PATHS = {'system/engine.dll'}
RESERVED = re.compile(r'(?i)(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?')


def safe_components(parts):
    return all(part not in ('', '.', '..') and part.rstrip(' .') == part and not RESERVED.fullmatch(part) for part in parts)


def relative_path(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_./-]+', value):
        raise ValueError('Unsafe source-relative asset path')
    parts = value.split('/')
    if not safe_components(parts) or (Path(value).suffix.lower() not in EXTENSIONS
                                     and value.casefold() not in BINARY_EVIDENCE_PATHS):
        raise ValueError('Unsafe or unsupported source-relative asset path: ' + value)
    return value


def confined(root, relative):
    root = Path(root).absolute()
    target = root / relative_path(relative)
    # Reject junctions/symlinks even when they point back inside this root: a
    # staging destination must not alias an existing source or authored file.
    for path in (target, *target.parents):
        if path.is_symlink() or (path.exists() and getattr(path.lstat(), 'st_file_attributes', 0) & 0x400):
            raise ValueError('Asset path contains a symlink/reparse point')
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError('Asset path escapes its selected root')
    return target


def validate_source_root(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z]:/[A-Za-z0-9_./ -]+', value) or not safe_components(value[3:].split('/')):
        raise ValueError('Expected a canonical absolute Windows source root')
    return value


def fleet_alias(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', value):
        raise ValueError('Invalid fleet SSH alias')
    return value


def validate_manifest(manifest):
    if not isinstance(manifest, dict) or manifest.get('schemaVersion') != 1 or not isinstance(manifest.get('files'), list) or not manifest['files']:
        raise ValueError('Expected a nonempty schemaVersion1 source manifest')
    if not isinstance(manifest.get('sourceHost'), str) or not re.fullmatch(r'[A-Za-z0-9_-]+', manifest['sourceHost']):
        raise ValueError('Invalid source host identity')
    validate_source_root(manifest.get('sourceRoot'))
    seen = set()
    for entry in manifest['files']:
        if not isinstance(entry, dict):
            raise ValueError('Invalid source file record')
        name = relative_path(entry.get('relativePath'))
        if name.casefold() in seen:
            raise ValueError('Duplicate source path: ' + name)
        seen.add(name.casefold())
        if not isinstance(entry.get('sha256'), str) or not re.fullmatch('[0-9a-f]{64}', entry['sha256']) or type(entry.get('bytes')) is not int or entry['bytes'] < 0:
            raise ValueError('Invalid source hash or length: ' + name)
        if entry.get('sourceHost', manifest['sourceHost']) != manifest['sourceHost']:
            raise ValueError('File source host differs from manifest: ' + name)
        if entry.get('absolutePath', manifest['sourceRoot'] + '/' + name) != manifest['sourceRoot'] + '/' + name:
            raise ValueError('File source path differs from manifest: ' + name)
    protection = manifest.get('protectedIntegrity')
    if protection is not None and (not isinstance(protection, dict) or protection.get('relativePath', 'system/l2.ini') != 'system/l2.ini'
                                   or not isinstance(protection.get('sha256'), str) or not re.fullmatch('[0-9a-f]{64}', protection['sha256'])):
        raise ValueError('Invalid protected system/l2.ini integrity record')
    return manifest


def read_manifest(path):
    return validate_manifest(json.loads(Path(path).read_text(encoding='utf-8-sig')))


def verify_sources(manifest, client):
    validate_manifest(manifest)
    confined(client, manifest['files'][0]['relativePath'])
    client = Path(client).resolve(strict=True)
    failures = []
    for entry in manifest['files']:
        path = confined(client, entry['relativePath'])
        if not path.is_file() or path.stat().st_size != entry['bytes'] or hash_file(path) != entry['sha256']:
            failures.append(entry['relativePath'])
    if failures:
        raise ValueError('Staged source hash/length mismatch: ' + ', '.join(failures))
    return {'files': len(manifest['files']), 'bytes': sum(item['bytes'] for item in manifest['files']), 'hashesVerified': True}


def remote_hashes(alias, source_root, paths, protected=None):
    fleet_alias(alias)
    validate_source_root(source_root)
    if protected not in (None, 'system/l2.ini'):
        raise ValueError('Only protected system/l2.ini integrity may be queried separately')
    for name in paths:
        relative_path(name)
    # The shell sees only an encoded PowerShell program; paths are JSON data.
    config = base64.b64encode(json.dumps({'root': source_root, 'paths': paths, 'protected': protected}).encode()).decode()
    script = """$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
$c=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__CONFIG__'))|ConvertFrom-Json
$root=[IO.Path]::GetFullPath($c.root).TrimEnd([IO.Path]::DirectorySeparatorChar)
function Read-NativeItem($relative){
 $full=[IO.Path]::GetFullPath((Join-Path $root $relative))
 if(-not $full.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Native path escapes root'}
 $p=Get-Item -LiteralPath $full
 if($p.PSIsContainer){throw 'Expected a native file'}
 for($current=$p;$null -ne $current;$current=if($current -is [IO.DirectoryInfo]){$current.Parent}else{$current.Directory}){
  if($current.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Native path contains a reparse point'}
 }
 return $p
}
function Read-Sha256($path){
 $stream=[IO.File]::OpenRead($path);$hash=[Security.Cryptography.SHA256]::Create()
 try{return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}
 finally{$hash.Dispose();$stream.Dispose()}
}
$rows=@(foreach($relative in $c.paths){$p=Read-NativeItem $relative;[ordered]@{relativePath=$relative;bytes=$p.Length;sha256=(Read-Sha256 $p.FullName)}})
$protectedHash=if($c.protected){$p=Read-NativeItem $c.protected;Read-Sha256 $p.FullName}else{$null}
[ordered]@{sourceHost=$env:COMPUTERNAME;files=$rows;protectedSha256=$protectedHash}|ConvertTo-Json -Depth 5 -Compress
""".replace('__CONFIG__', config)
    encoded = base64.b64encode(script.encode('utf-16le')).decode()
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', alias, 'powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], capture_output=True, text=True, timeout=180, check=True)
    return json.loads(result.stdout.lstrip('\ufeff'))


def stage(manifest, destination, local_candidate=None, ssh_alias='fleet-importa-pc'):
    validate_manifest(manifest)
    fleet_alias(ssh_alias)
    confined(destination, manifest['files'][0]['relativePath'])
    destination = Path(destination).resolve()
    candidate = Path(local_candidate).absolute() if local_candidate else None
    native = Path(manifest['sourceRoot']).resolve()
    for protected_root in (native, candidate):
        if protected_root and (destination.is_relative_to(protected_root) or protected_root.is_relative_to(destination)):
            raise ValueError('Staging destination must be separate from the native client and local candidate')
    protection = manifest.get('protectedIntegrity', {})
    protected_path = 'system/l2.ini' if protection.get('sha256') else None
    entries = manifest['files']
    for start in range(0, len(entries), 24):
        response = remote_hashes(ssh_alias, manifest['sourceRoot'], [e['relativePath'] for e in entries[start:start + 24]], protected_path)
        if response['sourceHost'].casefold() != manifest['sourceHost'].casefold():
            raise ValueError('Fleet host differs from source provenance')
        if protected_path and response['protectedSha256'] != protection['sha256']:
            raise ValueError('Protected INI changed from recorded baseline; no native file was modified')
        observed = {entry['relativePath'].casefold(): entry for entry in response['files']}
        if len(observed) != len(response['files']) or set(observed) != {entry['relativePath'].casefold() for entry in entries[start:start + 24]}:
            raise ValueError('Fleet hash response differs from requested file set')
        for expected in entries[start:start + 24]:
            actual = observed.get(expected['relativePath'].casefold())
            if not actual or (actual['sha256'], actual['bytes']) != (expected['sha256'], expected['bytes']):
                raise ValueError('Authoritative source changed; preserve the old snapshot and inventory the new source: ' + expected['relativePath'])
    receipts = []
    for entry in entries:
        target = confined(destination, entry['relativePath'])
        if target.exists():
            if not target.is_file() or target.stat().st_size != entry['bytes'] or hash_file(target) != entry['sha256']:
                raise ValueError('Differing staged file preserved: ' + entry['relativePath'])
            method = 'reused-verified-stage'
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            descriptor, temporary = tempfile.mkstemp(prefix='.native-stage-', dir=target.parent)
            os.close(descriptor)
            temporary = Path(temporary)
            try:
                local = confined(candidate, entry['relativePath']) if candidate else None
                if local and local.is_file() and local.stat().st_size == entry['bytes'] and hash_file(local) == entry['sha256']:
                    shutil.copyfile(local, temporary)
                    method = 'local-copy-after-fleet-hash-proof'
                else:
                    subprocess.run(['scp', '-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', f'{ssh_alias}:{manifest["sourceRoot"]}/{entry["relativePath"]}', str(temporary)], check=True, timeout=600)
                    method = 'fleet-copy'
                if temporary.stat().st_size != entry['bytes'] or hash_file(temporary) != entry['sha256']:
                    raise ValueError('Copied source failed verification: ' + entry['relativePath'])
                if target.exists():
                    raise ValueError('Another process created the staged path; preserved without replacement')
                temporary.rename(target)
            finally:
                if temporary.exists():
                    temporary.unlink()
        receipts.append({'sourceHost': manifest['sourceHost'], 'sourcePath': manifest['sourceRoot'] + '/' + entry['relativePath'], 'relativePath': entry['relativePath'], 'sha256': entry['sha256'], 'bytes': entry['bytes'], 'method': method})
    if protected_path:
        after = remote_hashes(ssh_alias, manifest['sourceRoot'], [], protected_path)
        if after['sourceHost'].casefold() != manifest['sourceHost'].casefold():
            raise ValueError('Fleet host changed during protected INI verification')
        if after['protectedSha256'] != protection['sha256']:
            raise ValueError('Protected INI changed during staging; source files were not modified by staging')
    return {'schemaVersion': 1, 'files': receipts, 'protectedIniCopied': False, 'protectedIniUnchanged': True if protected_path else None}


def inventory(manifest, client):
    verification = verify_sources(manifest, client)
    records, classes = [], {}
    for entry in sorted(manifest['files'], key=lambda item: item['relativePath'].casefold()):
        path = confined(client, entry['relativePath'])
        record = {key: entry[key] for key in ('relativePath', 'sha256', 'bytes')}
        record['sourceHost'] = manifest['sourceHost']
        record['sourcePath'] = manifest['sourceRoot'] + '/' + entry['relativePath']
        record['id'] = manifest['sourceHost'] + ':' + entry['relativePath']
        if entry['relativePath'].casefold() in BINARY_EVIDENCE_PATHS:
            record['status'] = 'binary-evidence-preserved-not-executed'
        elif path.suffix.lower() in EXTENSIONS - {'.dat', '.int', '.ogg', '.wav'}:
            try:
                with path.open('rb') as stream:
                    header = stream.read(128)
                record['format'] = summary(header, path.name)
                package = Package(path.read_bytes(), path.name)
                counts = {}
                for item in package.exports:
                    counts[item['className']] = counts.get(item['className'], 0) + 1
                    classes[item['className']] = classes.get(item['className'], 0) + 1
                record['exportClasses'] = dict(sorted(counts.items()))
                record['status'] = 'indexed-not-converted'
            except ValueError as error:
                record.update(status='unsupported-package-table-adapter', reason=str(error))
        else:
            record['status'] = 'inventoried-not-converted'
        records.append(record)
    return {'schemaVersion': 1, 'sourceHost': manifest['sourceHost'], 'sourceRoot': manifest['sourceRoot'], 'verification': verification, 'files': records, 'exportClassCounts': dict(sorted(classes.items())), 'scope': 'Declared staged dependency closure, not an inventory of the complete native client.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--local-candidate', type=Path)
    parser.add_argument('--ssh-alias', default='fleet-importa-pc')
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    manifest = read_manifest(args.manifest)
    result = verify_sources(manifest, args.destination) if args.verify else stage(manifest, args.destination, args.local_candidate, args.ssh_alias)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
