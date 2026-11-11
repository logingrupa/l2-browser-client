from __future__ import annotations

import json
import math
from pathlib import Path
import re

from native_assets_lib.asset_manifest import reference_client_build
from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import CatalogWriteError, refuse_duplicate_json_keys, refuse_non_finite_json_number, replace_file
from native_store.coverage_denominators import COVERAGE_PART_ORDER
from native_store.load_check_records import is_catalog_key, is_riga_timestamp
from native_store.store_paths import SHA256_PATTERN, StorePathError, require_portable_relative_path
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, REPOSITORY_ROOT, read_reference_client_lock

SIDE_BY_SIDE_SCHEMA_VERSION = 1
SIDE_BY_SIDE_FILE_MAXIMUM_BYTES = 32 * 1024 * 1024
SIDE_BY_SIDE_CHECKS_FILE_NAME = 'side-by-side-checks.json'
SIDE_BY_SIDE_VERDICTS = ('pass', 'mismatch', 'unverified')
STORED_UNVERIFIED_REASONS = ('native-session-needs-owner', 'native-needs-server', 'listen-needs-owner', 'native-selection-unconfirmed',
                             'framing-not-comparable', 'reviewer-uncertain', 'review-pending')
COMPUTED_UNVERIFIED_REASONS = ('sandbox-capture-failed', 'loads-failed', 'loads-unrecorded', 'stale-after-fix', 'not-yet-queued',
                               'no-pair-shows-table')
AUDIO_PART = 'audio'
AUDIO_ROLES = ('ambience', 'placement', 'music', 'voice', 'combat', 'skill')
SIDE_BY_SIDE_DOCUMENT_FIELDS = frozenset({'schemaVersion', 'part', 'records'})
SIDE_BY_SIDE_RECORD_FIELDS = frozenset({'key', 'verdict', 'reason', 'nativeSelection', 'sandboxHalf', 'nativeHalf', 'difference',
                                        'suspectedStep', 'reviewer', 'judgedAtRiga', 'sandboxHalfHistory', 'displayedTableRows'})
SANDBOX_HALF_FIELDS = frozenset({'catalogSha256', 'keyContentSha256', 'pngPath', 'pngSha256', 'viewport', 'cameraPose', 'environment',
                                 'diagnosticMaterials', 'capturedBy', 'capturedAtRiga'})
SANDBOX_HALF_HISTORY_FIELDS = frozenset({'pngSha256', 'keyContentSha256', 'capturedAtRiga'})
VIEWPORT_FIELDS = frozenset({'width', 'height'})
CAMERA_POSE_FIELDS = frozenset({'target', 'alpha', 'beta', 'radius'})
ENVIRONMENT_FIELDS = frozenset({'gameMinutes', 'environmentType', 'source'})
DIAGNOSTIC_MATERIAL_FIELDS = frozenset({'root', 'unportedClass', 'reasons'})
CAPTURED_BY_PATTERN = re.compile(r'^executor:03-\d{2}$')
MAXIMUM_SAFE_INTEGER = 2 ** 53 - 1
WINDOW_KEY_PREFIX = 'window:'
SIDE_BY_SIDE_ARTIFACTS_FOLDER = ('artifacts', 'side-by-side')
SANDBOX_IMAGE_FOLDER = 'sandbox'
NATIVE_SELECTION_FIELDS_BY_KIND = {
    'tile': frozenset({'route', 'map'}),
    'npc': frozenset({'viewer', 'searchText', 'expectedMeshText', 'expectedTextureTexts'}),
    'item': frozenset({'viewer', 'itemId', 'expectedMeshTexts'}),
    'skill': frozenset({'viewer', 'skillId', 'level'}),
    'window': frozenset({'route', 'window'}),
    'minimap': frozenset({'route', 'window', 'map'}),
}
NATIVE_SELECTION_CHOICES_BY_KIND = {
    'tile': {'route': ('offline-debug-startup', 'server-world')},
    'npc': {'viewer': ('nv',)},
    'item': {'viewer': ('pv', 'server-world')},
    'skill': {'viewer': ('sv',)},
    'window': {'route': ('server-world',)},
    'minimap': {'route': ('server-world',)},
}
NATIVE_SELECTION_INTEGER_FIELDS = frozenset({'itemId', 'skillId', 'level'})
NATIVE_SELECTION_TEXT_LIST_FIELDS = frozenset({'expectedTextureTexts', 'expectedMeshTexts'})
MINIMAP_PART = 'minimap'


class SideBySideCheckRecordError(ValueError):
    pass


class RecordContext:
    def __init__(self, part, identity, path):
        self.part = part
        self.identity = identity
        self.path = path

    def refuse(self, rule):
        raise SideBySideCheckRecordError(f'side-by-side record {self.identity} of part {self.part} {rule}: {self.path}')


def require_known_part(part):
    if part not in COVERAGE_PART_ORDER:
        raise SideBySideCheckRecordError(f'side-by-side part must be one of {", ".join(COVERAGE_PART_ORDER)}: {part!r}')
    return part


def side_by_side_checks_path(project_root, part):
    return Path(project_root) / 'docs' / 'parts' / require_known_part(part) / SIDE_BY_SIDE_CHECKS_FILE_NAME


def current_reference_tree_lock_sha256(project_root):
    lock_path = Path(project_root) / REFERENCE_CLIENT_LOCK_PATH.relative_to(REPOSITORY_ROOT)
    return reference_client_build(read_reference_client_lock(lock_path))['referenceTreeLockSha256']


def is_sha256(value):
    return isinstance(value, str) and SHA256_PATTERN.fullmatch(value) is not None


def is_non_empty_text(value):
    return isinstance(value, str) and value.strip() != ''


def is_finite_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def is_positive_integer(value):
    return type(value) is int and 0 < value <= MAXIMUM_SAFE_INTEGER


def is_non_negative_integer(value):
    return type(value) is int and 0 <= value <= MAXIMUM_SAFE_INTEGER


def record_identity(record):
    return record['key']


def describe_identity(record):
    key = record.get('key') if isinstance(record, dict) else None
    return repr(key)


def require_sha256_fields(value, fields, owner, context):
    for field in fields:
        if not is_sha256(value[field]):
            context.refuse(f'{owner} {field} must be 64 lowercase hex characters, not {value[field]!r}')


def require_exact_fields(value, fields, owner, context):
    if not (isinstance(value, dict) and set(value) == fields):
        context.refuse(f'{owner} must hold exactly {", ".join(sorted(fields))}')


def require_confined_artifact_path(value, folder_parts, owner, context):
    try:
        require_portable_relative_path(value)
    except StorePathError:
        context.refuse(f'{owner} must be a portable repository-relative path, not {value!r}')
    path_parts = tuple(value.split('/'))
    if not (len(path_parts) > len(folder_parts) and path_parts[:len(folder_parts)] == folder_parts):
        context.refuse(f'{owner} must stay under {"/".join(folder_parts)}/, not {value!r}')


def require_capture_identity(half, owner, context):
    if not (isinstance(half['capturedBy'], str) and CAPTURED_BY_PATTERN.fullmatch(half['capturedBy'])):
        context.refuse(f'{owner} capturedBy must match {CAPTURED_BY_PATTERN.pattern}, not {half["capturedBy"]!r}')
    if not is_riga_timestamp(half['capturedAtRiga']):
        context.refuse(f'{owner} capturedAtRiga must be ISO 8601 with the Riga offset, not {half["capturedAtRiga"]!r}')


def validate_viewport(viewport, context):
    require_exact_fields(viewport, VIEWPORT_FIELDS, 'sandboxHalf.viewport', context)
    if not all(is_positive_integer(viewport[field]) for field in VIEWPORT_FIELDS):
        context.refuse('sandboxHalf.viewport width and height must be positive integers')


def validate_camera_pose(camera_pose, context):
    if camera_pose is None:
        return
    require_exact_fields(camera_pose, CAMERA_POSE_FIELDS, 'sandboxHalf.cameraPose', context)
    target = camera_pose['target']
    if not (isinstance(target, list) and len(target) == 3 and all(is_finite_number(component) for component in target)):
        context.refuse('sandboxHalf.cameraPose target must be three finite numbers')
    if not all(is_finite_number(camera_pose[field]) for field in ('alpha', 'beta', 'radius')):
        context.refuse('sandboxHalf.cameraPose alpha, beta and radius must be finite numbers')


def validate_environment(environment, context):
    if environment is None:
        return
    require_exact_fields(environment, ENVIRONMENT_FIELDS, 'sandboxHalf.environment', context)
    if not (is_finite_number(environment['gameMinutes']) and environment['gameMinutes'] >= 0):
        context.refuse('sandboxHalf.environment gameMinutes must be a finite number of at least 0')
    if not is_non_negative_integer(environment['environmentType']):
        context.refuse('sandboxHalf.environment environmentType must be an integer of at least 0')
    if not is_non_empty_text(environment['source']):
        context.refuse('sandboxHalf.environment source must be non-empty text')


def validate_diagnostic_materials(record, diagnostic_materials, context):
    if record['key'].startswith(WINDOW_KEY_PREFIX):
        if diagnostic_materials is not None:
            context.refuse('sandboxHalf.diagnosticMaterials must be null for a window key')
        return
    if not isinstance(diagnostic_materials, list):
        context.refuse('sandboxHalf.diagnosticMaterials must be a list for a key that is not a window')
    for diagnostic_material in diagnostic_materials:
        require_exact_fields(diagnostic_material, DIAGNOSTIC_MATERIAL_FIELDS, 'sandboxHalf.diagnosticMaterials entry', context)
        if not (is_non_empty_text(diagnostic_material['root'])
                and (diagnostic_material['unportedClass'] is None or is_non_empty_text(diagnostic_material['unportedClass']))
                and isinstance(diagnostic_material['reasons'], list)
                and all(is_non_empty_text(reason) for reason in diagnostic_material['reasons'])):
            context.refuse('sandboxHalf.diagnosticMaterials entry needs a root, an unportedClass text or null and a list of reason texts')
    roots = [diagnostic_material['root'] for diagnostic_material in diagnostic_materials]
    if roots != sorted(set(roots)):
        context.refuse('sandboxHalf.diagnosticMaterials must be sorted by root with no repeated root')


def validate_image_sandbox_half(record, part, context):
    half = record['sandboxHalf']
    require_exact_fields(half, SANDBOX_HALF_FIELDS, 'sandboxHalf', context)
    require_sha256_fields(half, ('catalogSha256', 'keyContentSha256', 'pngSha256'), 'sandboxHalf', context)
    require_confined_artifact_path(half['pngPath'], (*SIDE_BY_SIDE_ARTIFACTS_FOLDER, part, SANDBOX_IMAGE_FOLDER), 'sandboxHalf.pngPath',
                                   context)
    validate_viewport(half['viewport'], context)
    validate_camera_pose(half['cameraPose'], context)
    validate_environment(half['environment'], context)
    validate_diagnostic_materials(record, half['diagnosticMaterials'], context)
    require_capture_identity(half, 'sandboxHalf', context)


def native_selection_kind(record, part):
    if part == MINIMAP_PART:
        return MINIMAP_PART
    return record['key'].split(':', 1)[0]


def validate_native_selection(record, part, context):
    kind = native_selection_kind(record, part)
    if kind not in NATIVE_SELECTION_FIELDS_BY_KIND:
        context.refuse(f'has no native selection shape for {kind} keys')
    selection = record['nativeSelection']
    require_exact_fields(selection, NATIVE_SELECTION_FIELDS_BY_KIND[kind], f'nativeSelection of a {kind} key', context)
    for field, value in selection.items():
        choices = NATIVE_SELECTION_CHOICES_BY_KIND[kind].get(field)
        if choices is not None:
            valid = value in choices
        elif field in NATIVE_SELECTION_INTEGER_FIELDS:
            valid = is_non_negative_integer(value)
        elif field in NATIVE_SELECTION_TEXT_LIST_FIELDS:
            valid = isinstance(value, list) and all(is_non_empty_text(text) for text in value)
        else:
            valid = is_non_empty_text(value)
        if not valid:
            context.refuse(f'nativeSelection {field} is not valid for a {kind} key: {value!r}')


def validate_sandbox_half_history(record, context):
    history = record['sandboxHalfHistory']
    if not isinstance(history, list):
        context.refuse('sandboxHalfHistory must be a list')
    for entry in history:
        require_exact_fields(entry, SANDBOX_HALF_HISTORY_FIELDS, 'sandboxHalfHistory entry', context)
        require_sha256_fields(entry, sorted(SANDBOX_HALF_HISTORY_FIELDS - {'capturedAtRiga'}), 'sandboxHalfHistory entry', context)
        if not is_riga_timestamp(entry['capturedAtRiga']):
            context.refuse('sandboxHalfHistory entry capturedAtRiga must be ISO 8601 with the Riga offset')


def validate_verdict(record, context):
    if record['verdict'] not in SIDE_BY_SIDE_VERDICTS:
        context.refuse(f'verdict must be one of {", ".join(SIDE_BY_SIDE_VERDICTS)}, not {record["verdict"]!r}')
    if record['reason'] in COMPUTED_UNVERIFIED_REASONS:
        context.refuse(f'reason {record["reason"]} is computed by the report and is never stored')
    if record['reason'] not in STORED_UNVERIFIED_REASONS:
        context.refuse(f'unverified reason must be one of {", ".join(STORED_UNVERIFIED_REASONS)}, not {record["reason"]!r}')
    if record['nativeHalf'] is not None:
        context.refuse('nativeHalf must be null')
    for field in ('difference', 'suspectedStep', 'reviewer', 'judgedAtRiga'):
        if record[field] is not None:
            context.refuse(f'{field} must be null for an unverified record')


def validate_side_by_side_record(record, part, path, reference_tree_lock_sha256):
    require_known_part(part)
    context = RecordContext(part, describe_identity(record), path)
    require_exact_fields(record, SIDE_BY_SIDE_RECORD_FIELDS, 'record', context)
    if not is_catalog_key(record['key']):
        context.refuse('key must be a catalog key')
    validate_native_selection(record, part, context)
    validate_verdict(record, context)
    validate_image_sandbox_half(record, part, context)
    validate_sandbox_half_history(record, context)
    if record['displayedTableRows'] != []:
        context.refuse('displayedTableRows must be an empty list')
    return record


def validate_side_by_side_document(document, part, path, reference_tree_lock_sha256):
    if not (isinstance(document, dict) and set(document) == SIDE_BY_SIDE_DOCUMENT_FIELDS):
        raise SideBySideCheckRecordError(f'side-by-side document must hold exactly {", ".join(sorted(SIDE_BY_SIDE_DOCUMENT_FIELDS))}: {path}')
    if document['schemaVersion'] != SIDE_BY_SIDE_SCHEMA_VERSION:
        raise SideBySideCheckRecordError(f'side-by-side document schemaVersion must be {SIDE_BY_SIDE_SCHEMA_VERSION}: {path}')
    if document['part'] != part:
        raise SideBySideCheckRecordError(f'side-by-side document part {document["part"]!r} differs from its path part {part}: {path}')
    if not isinstance(document['records'], list):
        raise SideBySideCheckRecordError(f'side-by-side document records must be a list: {path}')
    identities = [record_identity(validate_side_by_side_record(record, part, path, reference_tree_lock_sha256))
                  for record in document['records']]
    if len(set(identities)) != len(identities):
        raise SideBySideCheckRecordError(f'side-by-side document of part {part} repeats a record identity: {path}')
    if identities != sorted(identities):
        raise SideBySideCheckRecordError(f'side-by-side document of part {part} records must be sorted by identity: {path}')
    return document


def decode_side_by_side_document(path):
    with open(path, 'rb') as stream:
        payload = stream.read(SIDE_BY_SIDE_FILE_MAXIMUM_BYTES + 1)
    if len(payload) > SIDE_BY_SIDE_FILE_MAXIMUM_BYTES:
        raise SideBySideCheckRecordError(f'side-by-side document exceeds {SIDE_BY_SIDE_FILE_MAXIMUM_BYTES} bytes: {path}')
    try:
        return json.loads(payload, object_pairs_hook=refuse_duplicate_json_keys, parse_constant=refuse_non_finite_json_number)
    except (CatalogWriteError, ValueError) as error:
        raise SideBySideCheckRecordError(f'side-by-side document is not strict JSON: {path}: {error}') from error


def read_side_by_side_records(project_root, part):
    path = side_by_side_checks_path(project_root, part)
    if not path.is_file():
        return []
    return validate_side_by_side_document(decode_side_by_side_document(path), part, path, None)['records']


def write_side_by_side_records(project_root, part, records):
    path = side_by_side_checks_path(project_root, part)
    for record in records:
        validate_side_by_side_record(record, part, path, None)
    records_by_identity = {record_identity(record): record for record in read_side_by_side_records(project_root, part)}
    incoming_identities = [record_identity(record) for record in records]
    if len(set(incoming_identities)) != len(incoming_identities):
        raise SideBySideCheckRecordError(f'side-by-side records written for part {part} repeat a record identity: {path}')
    for record in records:
        records_by_identity[record_identity(record)] = record
    document = {'schemaVersion': SIDE_BY_SIDE_SCHEMA_VERSION, 'part': part,
                'records': [records_by_identity[identity] for identity in sorted(records_by_identity)]}
    validate_side_by_side_document(document, part, path, None)
    replace_file(path, canonical_json_bytes(document))
    return document
