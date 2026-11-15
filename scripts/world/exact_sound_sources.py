import hashlib
import json
from pathlib import Path, PurePosixPath
from typing import NamedTuple
import zipfile

from native_assets import Converter, UMODEL, verify_archive
from native_assets_lib.footstep_config import REFERENCE, sound_payload
from native_assets_lib.world_ambience import wav_facts
from native_catalog.ue2 import FormatError, Package
from native_store.interprocess_lock import convert_under_request_lock
from native_store.store_paths import lane_work_root
from world.tile_census import WORLD_LANE_NAME

SOUND_PACKAGE_SUFFIX = '.uax'
SOUND_CLASS_NAME = 'Sound'
SOUND_CONVERTER_FOLDER = 'sound-converter'
SOUND_IDENTITY_UNRESOLVED_REASON = 'sound-identity-unresolved'
SOUND_PAYLOAD_UNVERIFIED_REASON_PREFIX = 'sound-payload-unverified:'
WAV_MIME = 'audio/wav'
LOCK_EQUAL_CLASS = 'equal'


class SoundSourceGap(ValueError):
    def __init__(self, reason, message):
        super().__init__(message)
        self.reason = reason


class ResolvedSound(NamedTuple):
    reference: str
    package_path: str
    package_sha256: str
    export: dict
    payload: bytes
    native: dict


class ConvertedSound(NamedTuple):
    resolved: ResolvedSound
    wav: bytes
    facts: dict
    archive_sha256: str


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def lock_equal_sound_package_paths(lock):
    return sorted(path for path, record in lock.records_by_path.items()
                  if PurePosixPath(path).suffix.casefold() == SOUND_PACKAGE_SUFFIX and record['class'] == LOCK_EQUAL_CLASS)


class ExactSoundPackages:
    def __init__(self, client_access, lock_rows):
        self.client_access, self.lock_rows, self.packages = client_access, list(lock_rows), {}

    def candidates(self, reference):
        package_name = reference.split('.')[0].casefold()
        return [path for path in self.lock_rows if PurePosixPath(path).stem.casefold() == package_name]

    def package(self, relative):
        if relative not in self.packages:
            path = self.client_access.require_equal_file(relative)
            self.packages[relative] = Package(path.read_bytes(), path.name)
        return self.packages[relative]


def unresolved(reference, detail):
    return SoundSourceGap(SOUND_IDENTITY_UNRESOLVED_REASON, f'{reference}: {detail}')


def resolve_exact_sound(sound_packages, reference):
    if not (isinstance(reference, str) and REFERENCE.fullmatch(reference)):
        raise unresolved(reference, 'not a fully qualified sound reference')
    candidates = sound_packages.candidates(reference)
    if len(candidates) != 1:
        raise unresolved(reference, f'{len(candidates)} lock-equal sound packages are named {reference.split(".")[0]}')
    package = sound_packages.package(candidates[0])
    matches = [item for item in package.exports if item['object'].casefold() == reference.casefold()]
    if len(matches) != 1 or matches[0]['className'] != SOUND_CLASS_NAME:
        raise unresolved(reference, f'{len(matches)} exports of {candidates[0]} carry this full name with class Sound')
    payload, native = sound_payload(package, matches[0])
    return ResolvedSound(reference, candidates[0], package.source_hash, matches[0], bytes(payload), native)


def world_sound_converter(project_root, client):
    return Converter(client, lane_work_root(project_root, WORLD_LANE_NAME) / SOUND_CONVERTER_FOLDER, UMODEL, project_root=project_root)


def payload_unverified(check, resolved, detail):
    return SoundSourceGap(SOUND_PAYLOAD_UNVERIFIED_REASON_PREFIX + check, f'{resolved.export["object"]}: {detail}')


def convert_exact_sound(converter, resolved):
    request = {'kind': 'audio', 'package': resolved.package_path, 'object': resolved.export['object']}
    converted = convert_under_request_lock(converter, request)
    archive_path = Path(converted['file'])
    checked = verify_archive(archive_path)
    with zipfile.ZipFile(archive_path) as archive:
        asset = json.loads(archive.read('asset.json'))
        provenance = json.loads(archive.read('provenance.json'))
        audio = archive.read(asset['audio']['file'])
    metadata = provenance['metadata']
    if (asset['kind'] != 'audio' or asset['source']['object'] != resolved.export['object'] or provenance['request'] != request
            or metadata.get('nativeExportIndex') != resolved.export['exportIndex']):
        raise FormatError(f'converted archive of {resolved.export["object"]} names another source or request')
    if metadata.get('encodedAudioUnchanged') is not True or metadata.get('nativePayloadSha256') != sha256_hex(resolved.payload):
        raise payload_unverified('encodedAudioUnchanged', resolved, 'the converter does not record the original payload as unchanged')
    if audio[:4] != b'RIFF' or audio[8:12] != b'WAVE' or audio != resolved.payload:
        raise payload_unverified('wav', resolved, 'the converted audio is not the original RIFF/WAVE payload')
    return ConvertedSound(resolved, audio, wav_facts(audio), checked['sha256'])


def sound_record(converted, key, occurrences):
    resolved, wav = converted.resolved, converted.wav
    return {'key': key, 'object': resolved.export['object'], 'id': 'interlude:' + resolved.export['object'], 'file': f'audio/{sha256_hex(wav)}.wav',
            'bytes': len(wav), 'sha256': sha256_hex(wav), 'mime': WAV_MIME, **converted.facts, 'exportIndex': resolved.export['exportIndex'],
            'occurrences': occurrences, 'archiveSha256': converted.archive_sha256,
            'sourcePackage': {'relativePath': resolved.package_path, 'sha256': resolved.package_sha256}}
