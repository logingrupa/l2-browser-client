from __future__ import annotations

import json
import os
from pathlib import Path
import re
import stat

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
LANE_OWNERSHIP_PATH = REPOSITORY_ROOT / '.planning' / 'lanes.json'
RESERVED_DEVICE_NAME_PATTERN = re.compile(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', re.IGNORECASE)
UNSAFE_NAME_CHARACTER_PATTERN = re.compile(r'[:*?<>"|\x00-\x1f]')
STEP_NAME_PATTERN = re.compile(r'^[a-z][a-z0-9-]{0,63}$')
SHA256_PATTERN = re.compile(r'^[a-f0-9]{64}$')
REPARSE_POINT_ATTRIBUTE = 0x400


class StorePathError(ValueError):
    pass


class ConverterOutputRefusedError(StorePathError):
    pass


def is_portable_name_part(part):
    return (bool(part) and part not in ('.', '..') and not UNSAFE_NAME_CHARACTER_PATTERN.search(part)
            and not part.endswith(('.', ' ')) and not RESERVED_DEVICE_NAME_PATTERN.fullmatch(part))


def require_portable_relative_path(value):
    if not (isinstance(value, str) and value and '\\' not in value
            and all(is_portable_name_part(part) for part in value.split('/'))):
        raise StorePathError(f'Unsafe relative path: {value}')
    return value


def is_reparse_entry(entry):
    information = entry.lstat()
    return stat.S_ISLNK(information.st_mode) or bool(getattr(information, 'st_file_attributes', 0) & REPARSE_POINT_ATTRIBUTE)


def refuse_reparse_points(path):
    path = Path(path).absolute()
    for entry in (path, *path.parents):
        if os.path.lexists(entry) and is_reparse_entry(entry):
            raise StorePathError(f'Symlink/junction/reparse boundary refused: {entry}')
    return path.resolve()


def confined_child_path(root, relative):
    root = refuse_reparse_points(root)
    path = refuse_reparse_points(root / require_portable_relative_path(relative))
    if not (path.is_relative_to(root) and path != root):
        raise StorePathError(f'Path escapes its root: {relative}')
    return path


def read_lane_parts_by_name():
    ownership = json.loads(LANE_OWNERSHIP_PATH.read_text(encoding='utf-8'))
    lanes = ownership.get('lanes') if isinstance(ownership, dict) else None
    if not isinstance(lanes, dict) or not lanes:
        raise StorePathError(f'lane ownership has no lanes: {LANE_OWNERSHIP_PATH}')
    parts_by_lane_name = {}
    for lane_name, lane in lanes.items():
        parts = lane.get('parts') if isinstance(lane, dict) else None
        if not isinstance(parts, list) or not all(isinstance(part, str) and part for part in parts):
            raise StorePathError(f'lane {lane_name} has no part list in {LANE_OWNERSHIP_PATH}')
        parts_by_lane_name[lane_name] = tuple(parts)
    return parts_by_lane_name


def require_known_lane_name(lane_name):
    lane_names = sorted(read_lane_parts_by_name())
    if lane_name not in lane_names:
        raise StorePathError(f'unknown lane {lane_name}; lanes: {", ".join(lane_names)}')
    return lane_name


def require_converter_output(project_root, output):
    if output is None or output == '':
        raise ConverterOutputRefusedError(f'converter output is empty: {output!r}')
    try:
        candidate = refuse_reparse_points(Path(output).absolute())
    except StorePathError as error:
        raise ConverterOutputRefusedError(str(error)) from error
    artifacts = refuse_reparse_points(Path(project_root) / 'artifacts')
    if not (candidate.is_relative_to(artifacts) and candidate != artifacts):
        raise ConverterOutputRefusedError(f'converter output must be a dedicated folder under {artifacts}: {candidate}')
    shared_store = Path(os.path.realpath(Path(project_root) / 'public' / 'l2'))
    if candidate.is_relative_to(shared_store):
        raise ConverterOutputRefusedError(f'converter output resolves into the shared native store {shared_store}: {candidate}')
    return candidate


def lane_folder(project_root, lane_name):
    return Path(project_root) / 'artifacts' / 'lane-store' / require_known_lane_name(lane_name)


def lane_store_root(project_root, lane_name):
    return require_converter_output(project_root, lane_folder(project_root, lane_name) / 'l2')


def lane_work_root(project_root, lane_name):
    return require_converter_output(project_root, lane_folder(project_root, lane_name) / 'work')


def lane_gap_rows_path(project_root, lane_name, step):
    if not (isinstance(step, str) and STEP_NAME_PATTERN.fullmatch(step)):
        raise StorePathError(f'step name must match {STEP_NAME_PATTERN.pattern}: {step!r}')
    return require_converter_output(project_root, lane_folder(project_root, lane_name) / 'gap-rows') / f'{step}.json'


def lane_load_check_path(project_root, lane_name, catalog_sha256):
    if not (isinstance(catalog_sha256, str) and SHA256_PATTERN.fullmatch(catalog_sha256)):
        raise StorePathError(f'catalog SHA-256 must be 64 lowercase hex characters: {catalog_sha256!r}')
    return require_converter_output(project_root, lane_folder(project_root, lane_name) / 'load-checks') / f'{catalog_sha256}.json'
