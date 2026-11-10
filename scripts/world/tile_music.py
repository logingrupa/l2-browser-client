import json
import shutil
import subprocess
from typing import NamedTuple

from native_assets_lib.gltf import json_bytes
from native_assets_lib.world_music import KIND as MUSIC_KIND, encode, encoder_identity, music_volumes, restore_l2_ogg, unpatch
from native_catalog.tables import decode_table
from native_store.catalog_writer import sha256_hex
from native_store.store_paths import REPOSITORY_ROOT
from world.music_volume_join import MUSICINFO_TABLE, join_music_volumes, musicinfo_rows
from world.static_placement_plan import FAILED_STATUS
from world.static_mesh_step import conversion_failure_reason
from world.tile_census_validation import GAP_STATUS
from world.tile_json_resource import BUNDLE_MANIFEST_NAME

MUSIC_ENCODER_RECIPE_PATH = REPOSITORY_ROOT / 'recipes' / 'world' / 'music-derivative-encoder.json'
MUSIC_VOLUME_UNREADABLE_REASON = 'music-volume-unreadable'
MUSIC_FORMAT_UNSUPPORTED_REASON_PREFIX = 'music-format-unsupported:'
MUSIC_DERIVATIVE_ENCODER_UNPINNED_REASON = 'music-derivative-encoder-unpinned'
DERIVATIVE_SOURCE_LAYOUT = (2, 44100)
LOCK_EQUAL_CLASS = 'equal'
OGG_VORBIS_MIME = 'audio/ogg; codecs=vorbis'
ENCODER_FAILURES = (ValueError, OSError, subprocess.SubprocessError)
MUSIC_LIMITS = ['Ordered musicinfo strings are source facts; sequential/random selection, looping and transitions are unverified.',
                'bForcePlayMusic is retained authored metadata; its priority/interruption consumer is unresolved.',
                'Point-in-volume uses the brush BSP planes with identity Rotation/DrawScale assumed; native Encompasses is unverified.',
                'The restored Ogg differs from the original only by the documented capture/trailer patch; the AAC file is a lossy derivative.',
                'Native music gain (historical l2.ini MusicVolume=0.1), default/no-volume music and native audible parity remain unverified.']


class TileMusic(NamedTuple):
    files: dict | None
    coverage: dict
    input_paths: list


class MusicTrackRefused(ValueError):
    def __init__(self, reason, message):
        super().__init__(message)
        self.reason = reason


def music_derivative_spec():
    return json.loads(MUSIC_ENCODER_RECIPE_PATH.read_text(encoding='utf-8'))['derivative']


def lock_equal_paths(client_access):
    return sorted(path for path, record in client_access.lock.records_by_path.items() if record['class'] == LOCK_EQUAL_CLASS)


def music_track(client_access, relative_path, stored_string, derivative, encoder, identity):
    original = client_access.require_equal_file(relative_path).read_bytes()
    restored, facts = restore_l2_ogg(original)
    if unpatch(restored, facts['patch']) != original:
        raise ValueError(f'{relative_path} restoration does not unpatch to the original bytes')
    if (facts['channels'], facts['sampleRate']) != DERIVATIVE_SOURCE_LAYOUT:
        raise MusicTrackRefused(f'{MUSIC_FORMAT_UNSUPPORTED_REASON_PREFIX}{facts["channels"]}/{facts["sampleRate"]}',
                                f'{relative_path} is not the 44.1 kHz stereo layout the derivative arguments assume')
    derived = encode(encoder, derivative['args'], restored)
    track = {'key': 'music:' + stored_string, 'storedString': stored_string, 'file': f'audio/{sha256_hex(restored)}.ogg', 'bytes': len(restored),
             'sha256': sha256_hex(restored), 'mime': OGG_VORBIS_MIME, 'durationSeconds': facts['durationSeconds'], 'channels': facts['channels'],
             'sampleRate': facts['sampleRate'], 'oggPages': facts['pages'],
             'original': {'relativePath': relative_path, 'sourcePath': relative_path, 'bytes': len(original), 'sha256': sha256_hex(original),
                          'patch': facts['patch']},
             'derivative': {'file': f'derived/{sha256_hex(derived)}.m4a', 'bytes': len(derived), 'sha256': sha256_hex(derived), 'mime': derivative['mime'],
                            'kind': derivative['kind'], 'label': derivative['label'], 'encoder': identity, 'args': list(derivative['args'])}}
    return track, {track['file']: restored, track['derivative']['file']: derived}


def tile_music_volumes(map_data, map_path, gaps):
    try:
        return music_volumes(map_data, map_path), None
    except ValueError as error:
        gaps.add(GAP_STATUS, MUSIC_VOLUME_UNREADABLE_REASON)
        return [], str(error)


def pinned_encoder(derivative, gaps):
    encoder = shutil.which('ffmpeg')
    try:
        return encoder, encoder_identity(encoder, derivative['encoder'])
    except ENCODER_FAILURES:
        gaps.add(GAP_STATUS, MUSIC_DERIVATIVE_ENCODER_UNPINNED_REASON)
        return None, None


def joined_volume_tracks(client_access, join, tracks, payloads, derivative, encoder, identity, gaps):
    keys = []
    for stored_string, relative_path in zip(join.ordered_strings, join.music_files):
        key = 'music:' + stored_string
        if key not in tracks:
            try:
                tracks[key], files = music_track(client_access, relative_path, stored_string, derivative, encoder, identity)
            except MusicTrackRefused as refusal:
                gaps.add(GAP_STATUS, refusal.reason, join.volume['object'])
                return None
            except ENCODER_FAILURES as error:
                gaps.add(FAILED_STATUS, conversion_failure_reason(error), join.volume['object'])
                return None
            payloads.update(files)
        keys.append(key)
    return keys


def music_manifest(tile_id, lock_record, volumes, tracks, payloads):
    return {'schemaVersion': 1, 'kind': MUSIC_KIND, 'tileId': tile_id, 'map': {'relativePath': f'maps/{tile_id}.unr', 'sha256': lock_record['eSha256']},
            'coordinates': {'space': 'native Unreal world units (X, Y, Z-up)', 'browser': 'browser = (X, Z, Y) * 0.01, as section placements'},
            'volumes': volumes, 'tracks': [tracks[key] for key in sorted(tracks)],
            'files': [{'path': name, 'bytes': len(data), 'sha256': sha256_hex(data), 'mime': 'audio/mp4' if name.endswith('.m4a') else 'audio/ogg'}
                      for name, data in sorted(payloads.items())],
            'coverage': {'volumes': len(volumes), 'tracks': len(tracks), 'files': len(payloads), 'runtimeConnected': False}, 'limits': MUSIC_LIMITS}


def convert_tile_music(client, client_access, tile_id, lock_record, map_data, gaps):
    volumes, refusal = tile_music_volumes(map_data, f'maps/{tile_id}.unr', gaps)
    if not volumes:
        return TileMusic(None, {'volumes': 0, 'musicVolumeRefusal': refusal}, [])
    decoded = decode_table(client, MUSICINFO_TABLE)
    lock_rows = lock_equal_paths(client_access)
    joins, join_gaps = join_music_volumes(volumes, musicinfo_rows(decoded), lock_rows)
    for join_gap in join_gaps:
        gaps.add(GAP_STATUS, join_gap.reason, join_gap.volume['object'])
    input_paths = [decoded['source'], *sorted({path for join in joins for path in join.music_files})]
    derivative = music_derivative_spec()
    encoder, identity = pinned_encoder(derivative, gaps)
    if encoder is None:
        return TileMusic(None, {'volumes': len(volumes), 'joined': len(joins)}, input_paths)
    tracks, payloads, music_volume_rows = {}, {}, []
    for join in joins:
        keys = joined_volume_tracks(client_access, join, tracks, payloads, derivative, encoder, identity, gaps)
        if keys is not None:
            music_volume_rows.append({**join.volume, 'musicInfo': {'id': join.music_id, 'cnt': len(join.ordered_strings),
                                                                   'orderedStrings': list(join.ordered_strings), 'files': list(join.music_files)},
                                      'tracks': keys})
    coverage = {'volumes': len(volumes), 'joined': len(joins), 'presented': len(music_volume_rows), 'tracks': len(tracks)}
    if not music_volume_rows:
        return TileMusic(None, coverage, input_paths)
    used = {key for row in music_volume_rows for key in row['tracks']}
    tracks = {key: track for key, track in tracks.items() if key in used}
    payloads = {name: data for name, data in payloads.items() if any(name in (track['file'], track['derivative']['file']) for track in tracks.values())}
    files = dict(payloads)
    files[BUNDLE_MANIFEST_NAME] = json_bytes(music_manifest(tile_id, lock_record, music_volume_rows, tracks, payloads))
    return TileMusic(files, coverage, input_paths)
