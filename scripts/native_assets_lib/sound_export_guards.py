from __future__ import annotations

import json
from pathlib import Path
import re
import shutil

from native_assets_lib.guard_clauses import require_condition
from native_assets_lib.sha256_identity import SHA256_HEX_PATTERN, sha256_hex_digest
from native_catalog.ue2 import Package
from native_store.store_paths import confined_child_path, refuse_reparse_points, require_portable_relative_path
from reference_client_guard import require_reference_client

ADAPTER_SCRATCH_FOLDER_PATTERN = re.compile(r'[a-f0-9]{12}-[A-Za-z0-9_-]+')
OUTPUT_RECEIPT_EXCLUDED_NAMES = ('SHA256-MANIFEST.json', '.run.lock')


def sound_export_json_bytes(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')


def write_exact_output_file(root, relative_path, data):
    target = confined_child_path(root, relative_path)
    if target.exists():
        require_condition(target.is_file() and target.read_bytes() == data, 'Conflicting existing output: ' + relative_path)
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as stream:
            stream.write(data)


class LockedSoundSources:
    def __init__(self, snapshot, lock):
        self.snapshot, self.lock, self.checked, self.packages = snapshot, lock, {}, {}
        self.client_access = require_reference_client(snapshot)
        require_condition(lock.get('schemaVersion') == 1 and isinstance(lock.get('sourceHost'), str) and
                          isinstance(lock.get('sourceRoot'), str) and isinstance(lock.get('files'), list), 'Invalid source lock')
        self.pins = {}
        for row in lock['files']:
            relative_path = require_portable_relative_path(row['relativePath'])
            require_condition(relative_path.casefold() not in self.pins and type(row.get('bytes')) is int and row['bytes'] > 0 and
                              isinstance(row.get('sha256'), str) and SHA256_HEX_PATTERN.fullmatch(row['sha256']),
                              'Invalid or duplicate locked input')
            self.pins[relative_path.casefold()] = row

    def read(self, relative_path):
        pin = self.pins.get(relative_path.casefold())
        require_condition(pin is not None and pin['relativePath'] == relative_path, 'Source is not exactly locked: ' + relative_path)
        self.client_access.require_equal_file(relative_path)
        data = confined_child_path(self.snapshot, relative_path).read_bytes()
        require_condition(len(data) == pin['bytes'] and sha256_hex_digest(data) == pin['sha256'],
                          'Locked source hash/length mismatch: ' + relative_path)
        self.checked[relative_path] = pin
        return data

    def package(self, relative_path):
        if relative_path not in self.packages:
            self.packages[relative_path] = Package(self.read(relative_path), Path(relative_path).name)
        return self.packages[relative_path]

    def identity(self, relative_path):
        pin = self.pins[relative_path.casefold()]
        return {'sourceHost': self.lock['sourceHost'], 'sourcePath': self.lock['sourceRoot'].rstrip('/\\') + '/' + relative_path,
                'relativePath': relative_path, 'bytes': pin['bytes'], 'sha256': pin['sha256']}

    def verify_unchanged(self):
        for relative_path in sorted(self.checked):
            self.read(relative_path)


def output_files_receipt(output):
    records = []
    for path in sorted(output.rglob('*')):
        refuse_reparse_points(path)
        if path.is_file() and path.relative_to(output).as_posix() not in OUTPUT_RECEIPT_EXCLUDED_NAMES:
            data = path.read_bytes()
            records.append({'path': path.relative_to(output).as_posix(), 'bytes': len(data), 'sha256': sha256_hex_digest(data)})
    return records


def clean_adapter_work(cache):
    work = confined_child_path(cache, '.work')
    if work.exists():
        for path in work.iterdir():
            refuse_reparse_points(path)
            require_condition(path.is_dir() and path.parent == work and ADAPTER_SCRATCH_FOLDER_PATTERN.fullmatch(path.name),
                              'Unexpected adapter scratch entry')
            for descendant in path.rglob('*'):
                refuse_reparse_points(descendant)
            shutil.rmtree(path)
