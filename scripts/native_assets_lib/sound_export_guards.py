from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import shutil

from native_assets_lib.gltf import safe_name
from native_catalog.ue2 import FormatError, Package
from reference_client_guard import require_reference_client

HASH = re.compile(r'[a-f0-9]{64}')
REFERENCE = re.compile(r'[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+')


def require(condition, message):
    if not condition:
        raise FormatError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')


def load_json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(data.decode('utf-8-sig'), object_pairs_hook=unique,
                      parse_constant=lambda value: (_ for _ in ()).throw(FormatError('Nonfinite JSON: ' + value)))


def reject_links(path):
    for item in (path, *path.parents):
        if item.exists() or item.is_symlink():
            stat = item.lstat()
            require(not item.is_symlink() and not getattr(stat, 'st_file_attributes', 0) & 0x400,
                    'Linked/reparse path is unsupported: ' + str(item))


def relative_name(value):
    safe_name(value)
    for part in value.split('/'):
        require(not re.search(r'[<>"|?*\x00-\x1f]', part) and part.rstrip(' .') == part and
                not re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', part, re.I),
                'Unsafe path component: ' + part)
    return value


def child(root, name):
    target = root.joinpath(*relative_name(name).split('/'))
    reject_links(target)
    require(target.resolve().is_relative_to(root.resolve()), 'Path escapes its root')
    return target


def write_exact(root, name, data):
    target = child(root, name)
    if target.exists():
        require(target.is_file() and target.read_bytes() == data, 'Conflicting existing output: ' + name)
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as stream:
            stream.write(data)


class Sources:
    def __init__(self, snapshot, lock):
        self.snapshot, self.lock, self.checked, self.packages = snapshot, lock, {}, {}
        self.client_access = require_reference_client(snapshot)
        require(lock.get('schemaVersion') == 1 and isinstance(lock.get('sourceHost'), str) and
                isinstance(lock.get('sourceRoot'), str) and isinstance(lock.get('files'), list), 'Invalid source lock')
        self.pins = {}
        for row in lock['files']:
            name = relative_name(row['relativePath'])
            require(name.casefold() not in self.pins and type(row.get('bytes')) is int and row['bytes'] > 0 and
                    isinstance(row.get('sha256'), str) and HASH.fullmatch(row['sha256']), 'Invalid or duplicate locked input')
            self.pins[name.casefold()] = row

    def read(self, name):
        pin = self.pins.get(name.casefold())
        require(pin is not None and pin['relativePath'] == name, 'Source is not exactly locked: ' + name)
        self.client_access.require_equal_file(name)
        path = child(self.snapshot, name)
        data = path.read_bytes()
        require(len(data) == pin['bytes'] and digest(data) == pin['sha256'], 'Locked source hash/length mismatch: ' + name)
        self.checked[name] = pin
        return data

    def package(self, name):
        if name not in self.packages:
            self.packages[name] = Package(self.read(name), Path(name).name)
        return self.packages[name]

    def identity(self, name):
        pin = self.pins[name.casefold()]
        return {'sourceHost': self.lock['sourceHost'], 'sourcePath': self.lock['sourceRoot'].rstrip('/\\') + '/' + name,
                'relativePath': name, 'bytes': pin['bytes'], 'sha256': pin['sha256']}

    def verify_unchanged(self):
        for name in sorted(self.checked):
            self.read(name)


def files_receipt(output):
    records = []
    for path in sorted(output.rglob('*')):
        reject_links(path)
        if path.is_file() and path.relative_to(output).as_posix() not in ('SHA256-MANIFEST.json', '.run.lock'):
            data = path.read_bytes()
            records.append({'path': path.relative_to(output).as_posix(), 'bytes': len(data), 'sha256': digest(data)})
    return records


def clean_adapter_work(cache):
    work = child(cache, '.work')
    if work.exists():
        for path in work.iterdir():
            reject_links(path)
            require(path.is_dir() and path.parent == work and re.fullmatch(r'[a-f0-9]{12}-[A-Za-z0-9_-]+', path.name),
                    'Unexpected adapter scratch entry')
            for descendant in path.rglob('*'):
                reject_links(descendant)
            shutil.rmtree(path)
