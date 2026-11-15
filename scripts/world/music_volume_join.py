from pathlib import PurePosixPath
from typing import NamedTuple

MUSIC_FOLDER = 'music'
MUSIC_FILE_SUFFIX = '.ogg'
MUSICINFO_TABLE = 'musicinfo'
MUSICINFO_RECORDS = 'music'
MUSIC_JOIN_UNRESOLVED_REASON_PREFIX = 'music-join-unresolved:'


class MusicVolumeJoin(NamedTuple):
    volume: dict
    music_id: int
    ordered_strings: list
    music_files: list


class MusicJoinGap(NamedTuple):
    volume: dict
    reason: str
    detail: str


def musicinfo_rows(decoded_table):
    rows = decoded_table['data'].get(MUSICINFO_RECORDS)
    if not isinstance(rows, list):
        raise ValueError(f'decoded {decoded_table["source"]} has no {MUSICINFO_RECORDS} records')
    return rows


def music_file_paths(lock_rows):
    return [path for path in lock_rows
            if PurePosixPath(path).parent.as_posix().casefold() == MUSIC_FOLDER and PurePosixPath(path).suffix.casefold() == MUSIC_FILE_SUFFIX]


def unresolved_join(volume, detail):
    return MusicJoinGap(volume, f'{MUSIC_JOIN_UNRESOLVED_REASON_PREFIX}{volume["musicId"]}', detail)


def join_music_volume(volume, musicinfo_rows_by_id, music_paths):
    rows = musicinfo_rows_by_id.get(volume['musicId'], [])
    if len(rows) != 1:
        return unresolved_join(volume, f'musicinfo holds {len(rows)} rows with id {volume["musicId"]}')
    ordered_strings = [entry['name'] for entry in rows[0]['title']]
    if not ordered_strings or any(not isinstance(name, str) or not name for name in ordered_strings):
        return unresolved_join(volume, f'musicinfo row {volume["musicId"]} lists no named tracks')
    files = []
    for stored_string in ordered_strings:
        matches = [path for path in music_paths if PurePosixPath(path).stem.casefold() == stored_string.casefold()]
        if len(matches) != 1:
            return unresolved_join(volume, f'{len(matches)} lock-equal music files are named {stored_string}{MUSIC_FILE_SUFFIX}')
        files.append(matches[0])
    return MusicVolumeJoin(volume, volume['musicId'], ordered_strings, files)


def join_music_volumes(volumes, musicinfo_rows, lock_rows):
    rows_by_id, music_paths = {}, music_file_paths(lock_rows)
    for row in musicinfo_rows:
        rows_by_id.setdefault(row['id'], []).append(row)
    joins, gaps = [], []
    for volume in volumes:
        joined = join_music_volume(volume, rows_by_id, music_paths)
        (joins if isinstance(joined, MusicVolumeJoin) else gaps).append(joined)
    return joins, gaps
