import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from .ue2 import FormatError, Package, summary
from .tables import CRYPTO_SOURCE, SCHEMA_ROOT, TABLES, decode_table

NATIVE = {'.ukx', '.uax', '.usx', '.utx', '.unr', '.u', '.uix', '.usk'}
UMODEL = Path(os.environ.get('L2_UMODEL', 'C:/laragon/www/lineagen/.assets/skill-assets/work/native/tools/umodel/umodel.exe'))
UMODEL_SHA256 = '13502e5a4d8f6b5f32252afebd6360f7302ccfaccf6b8dda65beff0be2d364a0'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=True, allow_nan=False) + '\n').encode('utf-8')


def file_hash(path):
    before = path.stat()
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise FormatError(f'Source changed while reading: {path}')
    return result.hexdigest()


def within(root, name):
    candidate = (root / name).resolve()
    if not candidate.is_relative_to(root) or candidate == root:
        raise FormatError(f'Path escapes its root: {name}')
    return candidate


def safe_output(client, path):
    path = path.resolve()
    if path.is_relative_to(client):
        raise FormatError('Output must be outside the read-only native client')
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.resolve().is_relative_to(client):
        raise FormatError('Output redirects into the read-only client')
    return path


def write_output(client, path, data):
    path = safe_output(client, path)
    # No delete/move or source writes. Existing local reports are reproducible replacements.
    with path.open('wb') as stream:
        stream.write(data)
    if file_hash(path) != digest(data):
        raise FormatError(f'Output verification failed: {path}')
    return {'file': path.name, 'bytes': len(data), 'sha256': digest(data)}


def walk_files(client):
    files, ignored_links = [], []
    for directory, directories, names in os.walk(client, followlinks=False):
        base = Path(directory)
        for name in list(directories):
            path = base / name
            if path.is_symlink() or path.is_junction():
                ignored_links.append(path.relative_to(client).as_posix())
                directories.remove(name)
        for name in names:
            path = base / name
            if path.is_symlink() or path.is_junction():
                ignored_links.append(path.relative_to(client).as_posix())
            elif path.is_file():
                files.append(path)
    return sorted(files, key=lambda path: path.relative_to(client).as_posix()), sorted(ignored_links)


def inspect_header(path):
    with path.open('rb') as stream:
        prefix = stream.read(128)
    if path.suffix.lower() in NATIVE:
        try:
            return {'container': 'unreal-package', 'summary': summary(prefix, path.name), 'status': 'header-readable'}
        except (FormatError, UnicodeError) as error:
            return {'container': 'unsupported-native', 'status': 'unsupported', 'reason': str(error), 'prefixHex': prefix[:28].hex()}
    if path.suffix.lower() == '.ogg':
        container = 'ogg' if prefix[:4] == b'OggS' else 'l2sd' if prefix[:4] == b'L2SD' else 'unknown'
        return {'container': container, 'status': 'browser-container' if container == 'ogg' else 'decoder-required'}
    if path.suffix.lower() == '.dat':
        wrapper = prefix[:28].decode('utf-16le', errors='replace')
        return {'container': wrapper if re.fullmatch(r'Lineage2Ver\d{3}', wrapper) else 'unknown',
            'status': 'versioned-table-parser-required'}
    return {'status': 'catalog-only'}


def inventory(client):
    paths, ignored_links = walk_files(client)
    records = []
    directories, extensions = defaultdict(lambda: {'files': 0, 'bytes': 0}), defaultdict(lambda: {'files': 0, 'bytes': 0})
    for path in paths:
        name = path.relative_to(client).as_posix()
        record = {'path': name, 'bytes': path.stat().st_size, 'sha256': file_hash(path),
            'extension': path.suffix.lower(), 'observation': inspect_header(path)}
        records.append(record)
        for group in (directories[name.split('/')[0] if '/' in name else '(root)'], extensions[record['extension']]):
            group['files'] += 1
            group['bytes'] += record['bytes']
    return {'files': records, 'fileCount': len(records), 'totalBytes': sum(row['bytes'] for row in records),
        'inventorySha256': digest(json_bytes(records)), 'directories': dict(sorted(directories.items())),
        'extensions': dict(sorted(extensions.items())), 'ignoredLinks': ignored_links}


def parse_umodel_listing(text):
    rows = []
    for match in re.finditer(r'^\s*(\d+)\s+([0-9A-Fa-f]+)\s+([0-9A-Fa-f]+)\s+(\S+)\s+(\S+)\s*$', text, re.MULTILINE):
        index, offset, size, class_name, name = match.groups()
        rows.append({'exportIndex': int(index) + 1, 'offset': int(offset, 16), 'size': int(size, 16), 'className': class_name, 'name': name})
    return rows


def catalog_package(client, relative, destination, umodel):
    source = within(client, relative)
    if source.suffix.lower() not in NATIVE:
        raise FormatError('--package requires an original native package')
    source_sha = file_hash(source)
    label = re.sub(r'[^A-Za-z0-9_.-]', '_', relative) + '-' + source_sha[:12]
    work = safe_output(client, destination.parent / (destination.stem + '-packages') / label / 'umodel-list.txt').parent
    command = [str(umodel), '-list', '-game=l2', '-path=' + str(client), str(source)]
    result = subprocess.run(command, cwd=work, capture_output=True, timeout=120, stdin=subprocess.DEVNULL, check=False)
    log = result.stdout + result.stderr
    artifacts = []

    def save(name, data):
        path = work / name
        receipt = write_output(client, path, data)
        receipt['file'] = path.relative_to(destination.parent).as_posix()
        artifacts.append(receipt)
        return receipt['file']

    log_name = save('umodel-list.txt', log)
    if result.returncode:
        raise FormatError(f'UModel listing failed ({result.returncode}); see {log_name}')
    rows = parse_umodel_listing(log.decode('utf-8', errors='replace'))
    header = inspect_header(source)
    if not rows or len(rows) != header.get('summary', {}).get('exportCount'):
        raise FormatError(f'UModel listing did not cover every export: {relative}')
    record = {'source': relative, 'sourceSha256': source_sha, 'umodelLog': log_name,
        'classCounts': dict(sorted(Counter(row['className'] for row in rows).items())),
        'exportCount': len(rows), 'convertedAssets': 0, 'unsupported': []}
    try:
        package = Package(source.read_bytes(), source.name)
        for row, expected in zip(rows, package.exports):
            if any(row[key] != expected[key] for key in row):
                raise FormatError(f'Independent reader/UModel export mismatch: {relative} export {row["exportIndex"]}')
        record['index'] = save('package-index.json', json_bytes({'edition': 'interlude', 'source': relative,
            'sourceSha256': source_sha, 'summary': package.summary, 'exports': package.exports, 'imports': package.imports}))
        record['independentExportTableParity'] = True
        if any(item['className'].startswith('AnimNotify_') or item['className'] == 'MeshAnimation' for item in package.exports):
            sidecar = package.notification_sidecar()
            sidecar['source'] = relative
            record['animationEvents'] = save('animation-events.json', json_bytes(sidecar))
            record['eventCount'] = len(sidecar['animationEvents'])
            record['notifyCount'] = len(sidecar['notifies'])
            record['sequenceCount'] = sum(len(animation['sequences']) for animation in sidecar['animations'])
            record['unsupported'] += sidecar['unsupported']
    except FormatError as error:
        record['unsupported'].append({'adapter': 'typed-package-metadata', 'reason': str(error)})
        record['rawListing'] = save('raw-export-list.json', json_bytes(rows))
    if file_hash(source) != source_sha:
        raise FormatError(f'Package changed during listing: {relative}')
    record['unsupportedCount'] = len(record['unsupported'])
    return record, artifacts


def verify(client, output):
    receipt_path = output.with_suffix('.receipt.json')
    receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
    if file_hash(output) != receipt['catalogSha256']:
        raise FormatError('Catalog hash mismatch')
    catalog = json.loads(output.read_text(encoding='utf-8'))
    if catalog['sourceRoot'] != str(client):
        raise FormatError('Verification source does not match the recorded client')
    current_paths, ignored = walk_files(client)
    if [path.relative_to(client).as_posix() for path in current_paths] != [row['path'] for row in catalog['files']] or ignored != catalog['ignoredLinks']:
        raise FormatError('Native client file inventory changed')
    for row in catalog['files']:
        path = within(client, row['path'])
        if path.stat().st_size != row['bytes'] or file_hash(path) != row['sha256']:
            raise FormatError('Native source hash mismatch: ' + row['path'])
    if digest(json_bytes(catalog['files'])) != catalog['inventorySha256']:
        raise FormatError('Catalog inventory digest mismatch')
    for item in receipt['artifacts']:
        path = within(output.parent, item['file'])
        if path.stat().st_size != item['bytes'] or file_hash(path) != item['sha256']:
            raise FormatError('Catalog artifact mismatch: ' + item['file'])
    return catalog


def main(argv=None):
    parser = argparse.ArgumentParser(description='Read-only, fully hashed Interlude source catalog and selected package/event metadata.')
    parser.add_argument('--client', type=Path, default=Path('E:/lineage2-client'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--package', action='append', default=[], help='Exact relative original package path; repeat for more packages.')
    parser.add_argument('--umodel', type=Path, default=UMODEL, help='Installed pinned UModel executable; its SHA-256 is checked.')
    parser.add_argument('--table', action='append', default=[], choices=TABLES, help='Decode a selected native Interlude presentation table.')
    parser.add_argument('--table-source', action='append', default=[], metavar='TABLE=FILENAME', help='Select an exact system/ filename, for example npcname=npcname-e.dat when multiple languages exist.')
    parser.add_argument('--schema-root', type=Path, default=SCHEMA_ROOT, help='Pinned l2-editor structure directory; only the Interlude descriptor is used.')
    parser.add_argument('--crypto-source', type=Path, default=CRYPTO_SOURCE, help='Pinned open-l2encdec format constants source, read as data only.')
    parser.add_argument('--verify', action='store_true', help='Recheck source and output hashes without running tools or rewriting reports.')
    args = parser.parse_args(argv)
    try:
        table_sources = {}
        for selection in args.table_source:
            table, separator, filename = selection.partition('=')
            if not separator or not filename or table not in args.table or table in table_sources:
                raise FormatError('Each --table-source must uniquely select a requested TABLE=FILENAME')
            table_sources[table] = filename
        client = args.client.resolve(strict=True)
        if not client.is_dir():
            raise FormatError('Native client must be a directory')
        output = args.output.resolve()
        if output.is_relative_to(client):
            raise FormatError('Output must be outside the read-only native client')
        if args.verify:
            catalog = verify(client, output)
            print(f'Verified {catalog["fileCount"]} native source hashes and all catalog artifacts.')
            return 0
        if args.package and file_hash(args.umodel.resolve(strict=True)) != UMODEL_SHA256:
            raise FormatError('Installed UModel hash differs from the pinned tool; refusing to execute it')
        catalog = {'schemaVersion': 1, 'edition': 'interlude', 'sourceRoot': str(client),
            'sourceSelection': 'User-selected native client; no Classic/H5 asset substitutions',
            'createdAt': datetime.now(timezone.utc).isoformat(), **inventory(client), 'packages': [], 'tables': [],
            'convertedAssets': 0, 'tool': {'umodelSha256': UMODEL_SHA256} if args.package else None,
            'limitations': ['Inventory/header/listing metadata are not browser-ready asset conversion.',
                'Asset classes without typed adapters remain recorded and unconverted.',
                'Package version123/30 is the typed notify profile; older packages in the same client retain their own versions.']}
        artifacts = []
        for relative in dict.fromkeys(args.package):
            record, produced = catalog_package(client, relative, output, args.umodel.resolve())
            catalog['packages'].append(record)
            artifacts += produced
        for table in dict.fromkeys(args.table):
            decoded = decode_table(client, table, args.schema_root, args.crypto_source, source_filename=table_sources.get(table))
            path = output.parent / (output.stem + '-tables') / (table + '.json')
            record = write_output(client, path, json_bytes(decoded))
            record['file'] = path.relative_to(output.parent).as_posix()
            artifacts.append(record)
            catalog['tables'].append({'table': table, 'source': decoded['source'], 'sourceSha256': decoded['sourceSha256'],
                'file': record['file'], 'rows': next(len(value) for value in decoded['data'].values() if isinstance(value, list)),
                'schema': decoded['schema'], 'status': 'decoded-exact-end-and-safe-package-trailer'})
        source_hashes = {row['path'].lower(): row['sha256'] for row in catalog['files']}
        for selected in catalog['packages'] + catalog['tables']:
            if source_hashes.get(selected['source'].lower()) != selected['sourceSha256']:
                raise FormatError('Selected source changed after inventory hashing: ' + selected['source'])
        catalog['unsupportedCounts'] = {'nativeHeaders': sum(row['observation']['status'] == 'unsupported' for row in catalog['files']),
            'packageMetadataRecords': sum(row['unsupportedCount'] for row in catalog['packages']),
            'l2sdAudioRequiringDecoder': sum(row['observation'].get('container') == 'l2sd' for row in catalog['files'])}
        write_output(client, output, json_bytes(catalog))
        write_output(client, output.with_suffix('.receipt.json'), json_bytes({'schemaVersion': 1,
            'catalogSha256': file_hash(output), 'inventorySha256': catalog['inventorySha256'], 'artifacts': artifacts}))
        print(f'Cataloged {catalog["fileCount"]} files / {catalog["totalBytes"]} bytes; {len(catalog["packages"])} selected packages; {catalog["convertedAssets"]} conversions.')
        print(f'Inventory SHA-256: {catalog["inventorySha256"]}')
        return 0
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f'Native catalog failed: {error}', file=sys.stderr)
        return 1
