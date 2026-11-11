from __future__ import annotations

import math
import re

from native_store.load_check_records import is_riga_timestamp
from native_store.store_paths import SHA256_PATTERN, StorePathError, require_portable_relative_path

MAXIMUM_SAFE_INTEGER = 2 ** 53 - 1
SIDE_BY_SIDE_ARTIFACTS_FOLDER = ('artifacts', 'side-by-side')
SANDBOX_IMAGE_FOLDER = 'sandbox'
AUDIO_PART = 'audio'
AUDIO_CLIP_FOLDER = (*SIDE_BY_SIDE_ARTIFACTS_FOLDER, AUDIO_PART, 'clips')
WINDOW_KEY_PREFIX = 'window:'
OWNER_IDENTITY = 'owner'
EXECUTOR_CAPTURE_PATTERN = re.compile(r'^executor:03-\d{2}$')
IMAGE_SANDBOX_HALF_FIELDS = frozenset({'catalogSha256', 'keyContentSha256', 'pngPath', 'pngSha256', 'viewport', 'cameraPose', 'environment',
                                       'diagnosticMaterials', 'capturedBy', 'capturedAtRiga'})
AUDIO_SANDBOX_HALF_FIELDS = frozenset({'catalogSha256', 'keyContentSha256', 'clipPath', 'clipSha256', 'durationSeconds', 'peakAboveZero',
                                       'capturedBy', 'capturedAtRiga'})
NATIVE_HALF_FIELDS = frozenset({'referenceTreeLockSha256', 'receiptPath', 'receiptSha256', 'pngSha256', 'windowSize', 'l2IniSha256Before',
                                'l2IniSha256After', 'controllerSha256', 'controlDocumentSha256', 'capturedBy', 'capturedAtRiga'})
NATIVE_HALF_SHA256_FIELDS = ('referenceTreeLockSha256', 'receiptSha256', 'pngSha256', 'l2IniSha256Before', 'l2IniSha256After',
                             'controllerSha256', 'controlDocumentSha256')
SIZE_FIELDS = frozenset({'width', 'height'})
CAMERA_POSE_FIELDS = frozenset({'target', 'alpha', 'beta', 'radius'})
ENVIRONMENT_FIELDS = frozenset({'gameMinutes', 'environmentType', 'source'})
DIAGNOSTIC_MATERIAL_FIELDS = frozenset({'root', 'unportedClass', 'reasons'})


class SideBySideCheckRecordError(ValueError):
    pass


class RecordContext:
    def __init__(self, part, identity, path):
        self.part = part
        self.identity = identity
        self.path = path

    def refuse(self, rule):
        raise SideBySideCheckRecordError(f'side-by-side record {self.identity} of part {self.part} {rule}: {self.path}')


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


def require_exact_fields(value, fields, owner, context):
    if not (isinstance(value, dict) and set(value) == fields):
        context.refuse(f'{owner} must hold exactly {", ".join(sorted(fields))}')


def require_sha256_fields(value, fields, owner, context):
    for field in fields:
        if not is_sha256(value[field]):
            context.refuse(f'{owner} {field} must be 64 lowercase hex characters, not {value[field]!r}')


def require_confined_artifact_path(value, folder_parts, owner, context):
    try:
        require_portable_relative_path(value)
    except StorePathError:
        context.refuse(f'{owner} must be a portable repository-relative path, not {value!r}')
    path_parts = tuple(value.split('/'))
    if not (len(path_parts) > len(folder_parts) and path_parts[:len(folder_parts)] == folder_parts):
        context.refuse(f'{owner} must stay under {"/".join(folder_parts)}/, not {value!r}')


def require_capture_identity(half, owner, accepted_capturers, context):
    captured_by = half['capturedBy']
    if not (isinstance(captured_by, str) and (EXECUTOR_CAPTURE_PATTERN.fullmatch(captured_by) or captured_by in accepted_capturers)):
        accepted = ' or '.join((EXECUTOR_CAPTURE_PATTERN.pattern, *accepted_capturers))
        context.refuse(f'{owner} capturedBy must match {accepted}, not {captured_by!r}')
    if not is_riga_timestamp(half['capturedAtRiga']):
        context.refuse(f'{owner} capturedAtRiga must be ISO 8601 with the Riga offset, not {half["capturedAtRiga"]!r}')


def require_size(size, owner, context):
    require_exact_fields(size, SIZE_FIELDS, owner, context)
    if not all(is_positive_integer(size[field]) for field in SIZE_FIELDS):
        context.refuse(f'{owner} width and height must be positive integers')


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


def validate_diagnostic_materials(key, diagnostic_materials, context):
    if key.startswith(WINDOW_KEY_PREFIX):
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


def validate_image_sandbox_half(key, half, part, context):
    require_exact_fields(half, IMAGE_SANDBOX_HALF_FIELDS, 'sandboxHalf', context)
    require_sha256_fields(half, ('catalogSha256', 'keyContentSha256', 'pngSha256'), 'sandboxHalf', context)
    require_confined_artifact_path(half['pngPath'], (*SIDE_BY_SIDE_ARTIFACTS_FOLDER, part, SANDBOX_IMAGE_FOLDER), 'sandboxHalf.pngPath',
                                   context)
    require_size(half['viewport'], 'sandboxHalf.viewport', context)
    validate_camera_pose(half['cameraPose'], context)
    validate_environment(half['environment'], context)
    validate_diagnostic_materials(key, half['diagnosticMaterials'], context)
    require_capture_identity(half, 'sandboxHalf', (), context)


def validate_audio_sandbox_half(half, context):
    require_exact_fields(half, AUDIO_SANDBOX_HALF_FIELDS, 'sandboxHalf', context)
    require_sha256_fields(half, ('catalogSha256', 'keyContentSha256', 'clipSha256'), 'sandboxHalf', context)
    require_confined_artifact_path(half['clipPath'], AUDIO_CLIP_FOLDER, 'sandboxHalf.clipPath', context)
    if not (is_finite_number(half['durationSeconds']) and half['durationSeconds'] > 0):
        context.refuse('sandboxHalf.durationSeconds must be a finite number above 0')
    if type(half['peakAboveZero']) is not bool:
        context.refuse('sandboxHalf.peakAboveZero must be true or false')
    require_capture_identity(half, 'sandboxHalf', (), context)


def validate_sandbox_half(key, half, part, context):
    if part == AUDIO_PART:
        validate_audio_sandbox_half(half, context)
    else:
        validate_image_sandbox_half(key, half, part, context)


def validate_native_half(half, part, reference_tree_lock_sha256, context):
    require_exact_fields(half, NATIVE_HALF_FIELDS, 'nativeHalf', context)
    require_sha256_fields(half, NATIVE_HALF_SHA256_FIELDS, 'nativeHalf', context)
    if reference_tree_lock_sha256 is not None and half['referenceTreeLockSha256'] != reference_tree_lock_sha256:
        context.refuse(f'nativeHalf referenceTreeLockSha256 differs from reference_client_build of the current lock '
                       f'{reference_tree_lock_sha256}: {half["referenceTreeLockSha256"]}')
    require_confined_artifact_path(half['receiptPath'], (*SIDE_BY_SIDE_ARTIFACTS_FOLDER, part), 'nativeHalf.receiptPath', context)
    require_size(half['windowSize'], 'nativeHalf.windowSize', context)
    require_capture_identity(half, 'nativeHalf', (OWNER_IDENTITY,), context)


def sandbox_half_image_field(part):
    return 'clipSha256' if part == AUDIO_PART else 'pngSha256'


def sandbox_half_history_entry(half, part):
    image_field = sandbox_half_image_field(part)
    return {image_field: half[image_field], 'keyContentSha256': half['keyContentSha256'], 'capturedAtRiga': half['capturedAtRiga']}


def validate_sandbox_half_history(history, part, context):
    if not isinstance(history, list):
        context.refuse('sandboxHalfHistory must be a list')
    image_field = sandbox_half_image_field(part)
    for entry in history:
        require_exact_fields(entry, frozenset({image_field, 'keyContentSha256', 'capturedAtRiga'}), 'sandboxHalfHistory entry', context)
        require_sha256_fields(entry, (image_field, 'keyContentSha256'), 'sandboxHalfHistory entry', context)
        if not is_riga_timestamp(entry['capturedAtRiga']):
            context.refuse('sandboxHalfHistory entry capturedAtRiga must be ISO 8601 with the Riga offset')
