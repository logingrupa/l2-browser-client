import shutil

from native_assets_lib.gltf import json_bytes, safe_name
from reference_client_guard import sha256_of_file

EXPORT_MANIFEST_NAME = 'export-manifest.json'
EXPORT_MANIFEST_SCHEMA_VERSION = 1
INTERMEDIATE_GLTF_SUFFIXES = ('.gltf', '.bin')


def is_intermediate_gltf_export(relative_path):
    directories = relative_path.split('/')[:-1]
    return 'export' in directories and any(relative_path.casefold().endswith(suffix) for suffix in INTERMEDIATE_GLTF_SUFFIXES)


def sorted_work_relative_paths(work):
    relative_paths = [safe_name(path.relative_to(work).as_posix()) for path in work.rglob('*') if path.is_file()]
    if any(relative_path.casefold() == EXPORT_MANIFEST_NAME for relative_path in relative_paths):
        raise ValueError(f'Work folder already holds {EXPORT_MANIFEST_NAME}; it would be overwritten by the export manifest')
    return sorted(relative_paths, key=lambda relative_path: (relative_path.casefold(), relative_path))


def write_conversion_evidence(work, evidence_directory, umodel_sha256):
    rows = []
    for relative_path in sorted_work_relative_paths(work):
        source = work / relative_path
        rows.append({'path': relative_path, 'sha256': sha256_of_file(source), 'bytes': source.stat().st_size,
                     'retained': not is_intermediate_gltf_export(relative_path)})
    evidence_directory.mkdir(parents=True)
    for row in rows:
        if row['retained']:
            destination = evidence_directory / row['path']
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(work / row['path'], destination)
    manifest = {'schemaVersion': EXPORT_MANIFEST_SCHEMA_VERSION, 'umodelSha256': umodel_sha256, 'files': rows}
    (evidence_directory / EXPORT_MANIFEST_NAME).write_bytes(json_bytes(manifest))
