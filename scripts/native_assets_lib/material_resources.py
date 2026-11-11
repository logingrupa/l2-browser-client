from __future__ import annotations

import hashlib
from pathlib import Path

from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import immutable_write
from native_store.native_material_program_pins import MATERIAL_PROGRAM_FILE_NAME, native_material_program_directory
from native_store.store_paths import REPOSITORY_ROOT, require_converter_output

MATERIAL_GRAPH_FILE_NAME = 'graph.json'


class MaterialResourceError(ValueError):
    pass


def write_native_material_resources(output_root, graph, program):
    store_root = require_converter_output(REPOSITORY_ROOT, Path(output_root))
    graph_bytes, program_bytes = canonical_json_bytes(graph), canonical_json_bytes(program)
    if program.get('graphSha256') != hashlib.sha256(graph_bytes).hexdigest():
        raise MaterialResourceError(f'material program of {graph.get("root")} was derived from another graph')
    if program.get('root') != graph.get('root'):
        raise MaterialResourceError(f'material program root {program.get("root")!r} differs from graph root {graph.get("root")!r}')
    directory = native_material_program_directory(hashlib.sha256(program_bytes).hexdigest())
    files = []
    for file_name, payload in ((MATERIAL_GRAPH_FILE_NAME, graph_bytes), (MATERIAL_PROGRAM_FILE_NAME, program_bytes)):
        immutable_write(store_root / directory / file_name, payload)
        files.append({'path': f'{directory}/{file_name}', 'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)})
    return {'directory': directory, 'files': files}
