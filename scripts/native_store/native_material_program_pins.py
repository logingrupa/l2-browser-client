from __future__ import annotations

from native_store.glb_container import glb_document_and_binary
from native_store.store_paths import SHA256_PATTERN

NATIVE_MATERIALS_FOLDER = 'native-materials'
MATERIAL_PROGRAM_FILE_NAME = 'program.json'
NATIVE_MATERIAL_PROGRAM_EXTRAS_FIELD = 'nativeMaterialProgram'
PROGRAM_DIRECTORY_FIELD = 'directory'
PROGRAM_SHA256_FIELD = 'programSha256'


class NativeMaterialProgramPinError(ValueError):
    pass


def native_material_program_directory(program_sha256):
    return f'{NATIVE_MATERIALS_FOLDER}/{program_sha256}'


def require_native_material_program_pin(pin, label):
    program_sha256 = pin.get(PROGRAM_SHA256_FIELD) if isinstance(pin, dict) else None
    if not (isinstance(program_sha256, str) and SHA256_PATTERN.fullmatch(program_sha256)
            and pin.get(PROGRAM_DIRECTORY_FIELD) == native_material_program_directory(program_sha256)):
        raise NativeMaterialProgramPinError(f'{label} {NATIVE_MATERIAL_PROGRAM_EXTRAS_FIELD} is not a native-materials program pin: {pin!r}')
    return program_sha256


def glb_native_material_program_sha256s(glb, label):
    document, _ = glb_document_and_binary(glb)
    materials = document.get('materials', [])
    if not isinstance(materials, list):
        raise NativeMaterialProgramPinError(f'{label} glTF materials is not a list')
    program_sha256s = []
    for index, material in enumerate(materials):
        extras = material.get('extras') if isinstance(material, dict) else None
        pin = extras.get(NATIVE_MATERIAL_PROGRAM_EXTRAS_FIELD) if isinstance(extras, dict) else None
        if pin is not None:
            program_sha256s.append(require_native_material_program_pin(pin, f'{label} material {index}'))
    return program_sha256s
