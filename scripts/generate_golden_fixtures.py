#!/usr/bin/env python3
import argparse
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import wave

sys.path.insert(0, str(Path(__file__).resolve().parent))

from native_assets import SOURCE_TO_GLTF, archive_bytes, sha
from native_assets_lib.asset_manifest import asset_coordinates_record, build_asset_manifest, reference_client_build, source_path_record
from native_assets_lib.gltf import json_bytes
from reference_client_guard import (ENGINE_LIBRARY_RELATIVE_PATH, REFERENCE_CLIENT_LOCK_FILE_FIELDS, REFERENCE_CLIENT_LOCK_SCHEMA_VERSION,
    read_reference_client_lock)

SYNTHETIC_PACKAGE = 'SyntheticFixture'
SYNTHETIC_HOST = 'SYNTHETIC-HOST'
SYNTHETIC_CLIENT_ROOT = 'C:/SyntheticClient'
SYNTHETIC_ENGINE_LIBRARY_BYTES = b'synthetic engine library bytes for golden fixtures'
SYNTHETIC_SOURCE_UNITS_PER_METRE = 100
SYNTHETIC_CONVERTER_VERSION = hashlib.sha256(b'synthetic converter version for golden fixtures').hexdigest()
SYNTHETIC_SKILL_EFFECT_COMPONENT_ID = 'interlude:skill:0:level:1:synthetic-fixture'
SYNTHETIC_SECTION_ID = 'map-00-00-section'
REFERENCE_CLIENT_LOCK_NAME = 'reference-client-tree.lock.json'
FIXTURES_LOCK_NAME = 'fixtures.lock.json'


def synthetic_glb():
    document = json.dumps({'asset': {'version': '2.0', 'generator': 'synthetic golden fixture'}, 'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'name': 'SyntheticNode'}]}, separators=(',', ':'), sort_keys=True).encode('utf-8')
    document += b' ' * (-len(document) % 4)
    total = 12 + 8 + len(document)
    return struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(document), 0x4E4F534A) + document


def synthetic_wav():
    output = io.BytesIO()
    with wave.open(output, 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(8000)
        stream.writeframes(b''.join(struct.pack('<h', (index % 16) * 64) for index in range(160)))
    return output.getvalue()


def synthetic_reference_client_lock():
    engine_sha256 = sha(SYNTHETIC_ENGINE_LIBRARY_BYTES)
    engine_bytes = len(SYNTHETIC_ENGINE_LIBRARY_BYTES)
    return {
        'schemaVersion': REFERENCE_CLIENT_LOCK_SCHEMA_VERSION, 'referenceHost': 'SYNTHETIC-REFERENCE', 'referenceRoot': SYNTHETIC_CLIENT_ROOT,
        'conversionHost': SYNTHETIC_HOST, 'conversionRoot': SYNTHETIC_CLIENT_ROOT, 'fileFields': REFERENCE_CLIENT_LOCK_FILE_FIELDS,
        'files': {ENGINE_LIBRARY_RELATIVE_PATH: ['equal', engine_bytes, engine_sha256, engine_bytes, engine_sha256, 0]},
    }


def synthetic_source(object_name, payload):
    return {'edition': 'interlude', 'package': SYNTHETIC_PACKAGE, 'object': f'{SYNTHETIC_PACKAGE}.{object_name}', 'sha256': sha(payload)}


def file_table(files, mimes):
    return [{'path': name, 'sha256': sha(payload), 'bytes': len(payload), 'mime': mimes[name]} for name, payload in sorted(files.items())]


def package_files(primary_name, primary_payload, primary_mime, object_name):
    provenance = json_bytes({'schemaVersion': 1, 'synthetic': True, 'object': object_name})
    files = {primary_name: primary_payload, 'provenance.json': provenance}
    return files, {primary_name: primary_mime, 'provenance.json': 'application/json'}


def version_two_package(kind, object_name, primary_name, primary_payload, primary_mime, client_build):
    files, mimes = package_files(primary_name, primary_payload, primary_mime, object_name)
    manifest = build_asset_manifest(
        identity=f'{SYNTHETIC_PACKAGE}.{object_name}', kind=kind, source=synthetic_source(object_name, primary_payload),
        source_path=source_path_record(SYNTHETIC_HOST, f'{SYNTHETIC_CLIENT_ROOT}/{SYNTHETIC_PACKAGE}.ukx'),
        client_build=client_build, converter_version=SYNTHETIC_CONVERTER_VERSION, limitations=['Synthetic golden fixture.'],
        animation_events=[], primary_file=primary_name,
        coordinates=asset_coordinates_record(SOURCE_TO_GLTF, SYNTHETIC_SOURCE_UNITS_PER_METRE) if kind == 'model' else None,
        files=file_table(files, mimes))
    return archive_bytes(manifest, files)


def version_one_model_package(object_name, glb):
    files, mimes = package_files('model.glb', glb, 'model/gltf-binary', object_name)
    manifest = {
        'schemaVersion': 1, 'id': f'interlude:{SYNTHETIC_PACKAGE}.{object_name}', 'name': f'{SYNTHETIC_PACKAGE}.{object_name}', 'kind': 'model',
        'source': synthetic_source(object_name, glb), 'limitations': ['Synthetic golden fixture.'], 'animationEvents': [],
        'model': {'file': 'model.glb', 'unit': 'metre', 'sourceUnitsPerMetre': SYNTHETIC_SOURCE_UNITS_PER_METRE, 'sourceToGltf': SOURCE_TO_GLTF},
        'files': file_table(files, mimes),
    }
    return archive_bytes(manifest, files)


def catalog_model_record(archive, object_name):
    archive_sha256 = sha(archive)
    return {'id': f'interlude:{SYNTHETIC_PACKAGE}.{object_name}', 'archive': f'/l2/{archive_sha256}/asset.l2asset', 'archiveSha256': archive_sha256,
        'source': {'object': f'{SYNTHETIC_PACKAGE}.{object_name}'}}


def golden_fixture_files(lock_directory):
    reference_lock = synthetic_reference_client_lock()
    reference_lock_bytes = json_bytes(reference_lock)
    lock_directory.mkdir(parents=True, exist_ok=True)
    (lock_directory / REFERENCE_CLIENT_LOCK_NAME).write_bytes(reference_lock_bytes)
    client_build = reference_client_build(read_reference_client_lock(lock_directory / REFERENCE_CLIENT_LOCK_NAME))
    glb = synthetic_glb()
    model_v1 = version_one_model_package('SyntheticModelVersionOne', glb)
    model_v2 = version_two_package('model', 'SyntheticModelVersionTwo', 'model.glb', glb, 'model/gltf-binary', client_build)
    audio_v2 = version_two_package('audio', 'SyntheticSound', 'audio.wav', synthetic_wav(), 'audio/wav', client_build)
    catalog = {'schemaVersion': 1,
        'models': [catalog_model_record(model_v1, 'SyntheticModelVersionOne'), catalog_model_record(model_v2, 'SyntheticModelVersionTwo')],
        'sections': [{'id': SYNTHETIC_SECTION_ID}], 'effectComponents': [{'id': SYNTHETIC_SKILL_EFFECT_COMPONENT_ID}]}
    return {
        REFERENCE_CLIENT_LOCK_NAME: reference_lock_bytes, 'model-v1.l2asset': model_v1, 'model-v2.l2asset': model_v2,
        'audio-v2.l2asset': audio_v2, 'l2/catalog.json': json_bytes(catalog),
    }


def fixture_pin_bytes(relative_path, payload):
    return json_bytes(json.loads(payload)) if relative_path.endswith('.json') else payload


def fixtures_lock(files):
    return {'schemaVersion': 1, 'hashing': 'raw bytes for binaries; json_bytes canonical form for JSON',
        'files': [{'path': path, 'sha256': sha(fixture_pin_bytes(path, files[path])), 'bytes': len(fixture_pin_bytes(path, files[path]))} for path in sorted(files)]}


def write_golden_fixtures(output):
    output = Path(output)
    files = golden_fixture_files(output)
    for relative_path, payload in files.items():
        (output / relative_path).parent.mkdir(parents=True, exist_ok=True)
        (output / relative_path).write_bytes(payload)
    (output / FIXTURES_LOCK_NAME).write_bytes(json_bytes(fixtures_lock(files)))
    return sorted([*files, FIXTURES_LOCK_NAME])


def main():
    parser = argparse.ArgumentParser(description='Write synthetic, hash-pinned golden fixtures for the asset output contract.')
    parser.add_argument('--output', type=Path, required=True)
    arguments = parser.parse_args()
    for relative_path in write_golden_fixtures(arguments.output):
        print(relative_path)


if __name__ == '__main__':
    main()
