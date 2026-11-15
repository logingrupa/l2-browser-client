from __future__ import annotations

import json
import struct

GLB_MAGIC = b'glTF'
GLB_VERSION = 2
GLB_HEADER_BYTES = 12
GLB_CHUNK_HEADER_BYTES = 8
GLB_JSON_CHUNK_TYPE = 0x4E4F534A
GLB_BINARY_CHUNK_TYPE = 0x004E4942


class GlbContainerError(ValueError):
    pass


def glb_chunk(glb, offset, expected_type, chunk_name):
    if offset + GLB_CHUNK_HEADER_BYTES > len(glb):
        raise GlbContainerError(f'GLB {chunk_name} chunk header runs past the {len(glb)}-byte container')
    chunk_length, chunk_type = struct.unpack_from('<II', glb, offset)
    chunk_start = offset + GLB_CHUNK_HEADER_BYTES
    if chunk_type != expected_type or chunk_start + chunk_length > len(glb):
        raise GlbContainerError(f'GLB {chunk_name} chunk at byte {offset} has type {chunk_type:#010x} and {chunk_length} bytes, '
                                f'not type {expected_type:#010x} inside the {len(glb)}-byte container')
    return glb[chunk_start:chunk_start + chunk_length], chunk_start + chunk_length


def glb_document_and_binary(glb):
    if len(glb) < GLB_HEADER_BYTES or glb[:len(GLB_MAGIC)] != GLB_MAGIC:
        raise GlbContainerError('GLB container does not start with the glTF magic')
    version, declared_length = struct.unpack_from('<II', glb, len(GLB_MAGIC))
    if version != GLB_VERSION or declared_length != len(glb):
        raise GlbContainerError(f'GLB container declares version {version} and {declared_length} bytes, not version {GLB_VERSION} and {len(glb)} bytes')
    document_bytes, binary_offset = glb_chunk(glb, GLB_HEADER_BYTES, GLB_JSON_CHUNK_TYPE, 'JSON')
    try:
        document = json.loads(document_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GlbContainerError(f'GLB JSON chunk is not JSON: {error}') from error
    if not isinstance(document, dict):
        raise GlbContainerError('GLB JSON chunk is not a glTF document object')
    if binary_offset == len(glb):
        return document, b''
    binary, _ = glb_chunk(glb, binary_offset, GLB_BINARY_CHUNK_TYPE, 'BIN')
    return document, binary
