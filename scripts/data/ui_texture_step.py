from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess

from hash_reference_client_tree import canonical_json_bytes
from interface_layout_adapter import INTERFACE_XDAT_PATH
from lane_unit_outcomes import DECODE_FAILED_REASON_PREFIX, lane_relative_path, replace_step_gap_row
from native_store.catalog_writer import add_store_file, merge_catalog_slice, read_store_catalog, write_store
from native_store.gap_rows import QUALIFIED_OBJECT_NAME_PATTERN, read_gap_rows
from native_store.store_paths import SHA256_PATTERN, STEP_NAME_PATTERN
from texture_package_census import reference_tree_lock_sha256, validate_texture_package_census

UI_TEXTURE_ALGORITHM_VERSION = 1
UI_TEXTURE_RECIPE_SCHEMA_VERSION = 1
TEXTURES_STEP = 'textures'
TEXTURES_CATALOG_SLICE = 'textures'
UI_TEXTURE_ID_PREFIX = 'ui-texture:'
TEXTURE_PACKAGE_SUFFIX = '.utx'
TEXTURE_REFERENCE_UNRESOLVED_REASON = 'texture-reference-unresolved'
ADAPTER_FIELD_ABSENT_PATTERN = re.compile(r'adapter-field-absent:(?P<field>[a-z][A-Za-z0-9]*)')
ABSENT_FIELD_STEP_PREFIX = 'field-'
TEXTURE_OUTCOMES_RECORD_NAME = 'texture-outcomes.json'
PART_NAME = 'ui'
TEXTURE_CONVERSION_ERRORS = (ValueError, OSError, subprocess.SubprocessError)
UNRESOLVED_PACKAGE_FIELDS = {'packageName': None, 'packagePath': None, 'packageSha256': None, 'packageVersion': None, 'licensee': None,
                             'nativeSidecarReviewed': None}


class UiTextureStepError(ValueError):
    pass


def lock_equal_packages_by_casefolded_stem(lock):
    packages = {}
    for path, record in lock.records_by_path.items():
        package_path = PurePosixPath(path)
        if record['class'] == 'equal' and package_path.suffix.casefold() == TEXTURE_PACKAGE_SUFFIX:
            packages.setdefault(package_path.stem.casefold(), []).append(path)
    return packages


def window_references(window_manifests):
    window_ids_by_reference = {}
    interface_sha256s = set()
    for manifest in window_manifests:
        interface_sha256s.add(manifest['sourceSha256'])
        for reference in manifest['textureRefs']:
            window_ids_by_reference.setdefault(reference, set()).add(manifest['windowId'])
    if len(interface_sha256s) != 1:
        raise UiTextureStepError(f'window manifests must come from one interface.xdat, not {sorted(interface_sha256s)}')
    return interface_sha256s.pop(), window_ids_by_reference


def texture_request(reference, window_ids, packages_by_stem, census_rows_by_path, lock):
    candidates = packages_by_stem.get(reference.split('.')[0].casefold(), [])
    if len(candidates) != 1:
        return {'reference': reference, **UNRESOLVED_PACKAGE_FIELDS, 'reason': TEXTURE_REFERENCE_UNRESOLVED_REASON, 'windowIds': sorted(window_ids)}
    package_path = candidates[0]
    census_row = census_rows_by_path.get(package_path, {})
    return {'reference': reference, 'packageName': PurePosixPath(package_path).stem, 'packagePath': package_path,
            'packageSha256': lock.records_by_path[package_path]['eSha256'], 'packageVersion': census_row.get('packageVersion'),
            'licensee': census_row.get('licensee'), 'nativeSidecarReviewed': census_row.get('reviewed'), 'reason': None,
            'windowIds': sorted(window_ids)}


def ui_texture_requests(window_manifests, texture_census, lock):
    validate_texture_package_census(texture_census)
    if texture_census['referenceTreeLockSha256'] != reference_tree_lock_sha256(lock):
        raise UiTextureStepError('texture package census was written for another reference client lock; rerun texture_package_census.py')
    interface_sha256, window_ids_by_reference = window_references(window_manifests)
    packages_by_stem = lock_equal_packages_by_casefolded_stem(lock)
    census_rows_by_path = {row['path']: row for row in texture_census['packages']}
    return {'schemaVersion': UI_TEXTURE_RECIPE_SCHEMA_VERSION, 'interfaceSha256': interface_sha256,
            'textures': [texture_request(reference, window_ids_by_reference[reference], packages_by_stem, census_rows_by_path, lock)
                         for reference in sorted(window_ids_by_reference)]}


def ui_texture_recipe_bytes(recipe):
    return (json.dumps(recipe, indent=1, sort_keys=True, ensure_ascii=False) + '\n').encode('utf-8')


def window_gap_bindings(field_bindings_document, window_id):
    bindings = field_bindings_document.get('bindings') if isinstance(field_bindings_document, dict) else None
    if not isinstance(bindings, list):
        raise UiTextureStepError('window field binding recipe needs a bindings list')
    gap_bindings = []
    for binding in bindings:
        if not (isinstance(binding, dict) and isinstance(binding.get('windowId'), str) and isinstance(binding.get('controlName'), str)):
            raise UiTextureStepError(f'window field binding row needs a windowId and controlName: {binding!r}')
        if binding['windowId'] != window_id or binding.get('gapReason') is None:
            continue
        match = ADAPTER_FIELD_ABSENT_PATTERN.fullmatch(binding['gapReason']) if isinstance(binding['gapReason'], str) else None
        if match is None or not STEP_NAME_PATTERN.fullmatch(ABSENT_FIELD_STEP_PREFIX + match['field']):
            raise UiTextureStepError(f'window field binding gap reason must be adapter-field-absent:<field>: {binding["gapReason"]!r}')
        gap_bindings.append({'controlName': binding['controlName'], 'gapReason': binding['gapReason'], 'field': match['field']})
    return gap_bindings


def source_identity(path, sha256, object_name):
    identity = {'path': path, 'sha256': sha256}
    if QUALIFIED_OBJECT_NAME_PATTERN.fullmatch(object_name):
        identity['object'] = object_name
    return identity


def converted_texture_record(request, conversion):
    archive_path = Path(conversion['file'])
    archive_sha256 = conversion['sha256']
    if not SHA256_PATTERN.fullmatch(archive_sha256) or hashlib.sha256(archive_path.read_bytes()).hexdigest() != archive_sha256:
        raise UiTextureStepError(f'converted archive {archive_path} differs from its reported SHA-256')
    asset_manifest = json.loads((archive_path.parent / 'asset.json').read_bytes())
    image_name = asset_manifest['image']['file']
    [image_entry] = [entry for entry in asset_manifest['files'] if entry['path'] == image_name]
    image_bytes = (archive_path.parent / image_name).read_bytes()
    if (hashlib.sha256(image_bytes).hexdigest(), len(image_bytes)) != (image_entry['sha256'], image_entry['bytes']):
        raise UiTextureStepError(f'converted image {image_name} of {request["reference"]} differs from its asset.json entry')
    record = {'id': UI_TEXTURE_ID_PREFIX + request['reference'], 'archive': f'/l2/{archive_sha256}/asset.l2asset', 'archiveSha256': archive_sha256,
              'assetId': asset_manifest['id'], 'image': f'/l2/{archive_sha256}/{image_name}', 'imageBytes': len(image_bytes),
              'imageSha256': image_entry['sha256'], 'source': {key: value for key, value in asset_manifest['source'].items() if key != 'path'}}
    return record, {f'{archive_sha256}/asset.l2asset': archive_path.read_bytes(), f'{archive_sha256}/{image_name}': image_bytes}


def convert_reference(request, converter):
    if request['reason'] is not None:
        return {'reference': request['reference'], 'status': 'gap', 'reason': request['reason']}, None
    try:
        conversion = converter.convert({'kind': 'texture', 'package': request['packageName'], 'object': request['reference']})
    except TEXTURE_CONVERSION_ERRORS as error:
        return {'reference': request['reference'], 'status': 'gap', 'reason': DECODE_FAILED_REASON_PREFIX + type(error).__name__,
                'message': str(error)}, None
    record, files = converted_texture_record(request, conversion)
    return {'reference': request['reference'], 'status': 'converted', 'id': record['id'], 'archiveSha256': record['archiveSha256']}, (record, files)


def write_texture_records(output_root, conversions, capacity):
    catalog, before = read_store_catalog(output_root)
    store_files = {}
    for record, files in conversions:
        catalog = merge_catalog_slice(catalog, TEXTURES_CATALOG_SLICE, record, capacity)
        for relative, payload in files.items():
            add_store_file(store_files, relative, payload)
    catalog[TEXTURES_CATALOG_SLICE] = sorted(catalog[TEXTURES_CATALOG_SLICE], key=lambda record: record['id'])
    write_store(output_root, store_files, before, canonical_json_bytes(catalog))
    return [{'path': f'l2/{relative}', 'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)}
            for relative, payload in sorted(store_files.values())]


def window_gap_rows(window_name, unit_key, requests_by_reference, outcomes, gap_bindings, interface_sha256, evidence):
    rows = []
    first_texture_gap = next((outcome for outcome in outcomes if outcome['status'] == 'gap'), None)
    if first_texture_gap is not None:
        request = requests_by_reference[first_texture_gap['reference']]
        identity = (source_identity(request['packagePath'], request['packageSha256'], request['reference']) if request['packagePath']
                    else source_identity(INTERFACE_XDAT_PATH, interface_sha256, request['reference']))
        rows.append({'key': unit_key, 'part': PART_NAME, 'step': TEXTURES_STEP, 'status': 'gap', 'reason': first_texture_gap['reason'],
                     'sourceIdentity': identity, 'evidence': evidence})
    for binding in gap_bindings:
        rows.append({'key': unit_key, 'part': PART_NAME, 'step': ABSENT_FIELD_STEP_PREFIX + binding['field'], 'status': 'gap',
                     'reason': binding['gapReason'], 'evidence': evidence,
                     'sourceIdentity': source_identity(INTERFACE_XDAT_PATH, interface_sha256, f'{window_name}.{binding["controlName"]}')})
    return rows


def replace_window_gap_rows(project_root, lane_name, unit_key, gap_rows):
    gap_rows_by_step = {row['step']: row for row in gap_rows}
    previous_field_steps = {row['step'] for row in read_gap_rows(project_root, lane_name)
                            if row['key'] == unit_key and row['step'].startswith(ABSENT_FIELD_STEP_PREFIX)}
    for step in sorted({TEXTURES_STEP, *previous_field_steps, *gap_rows_by_step}):
        replace_step_gap_row(project_root, lane_name, step, unit_key, gap_rows_by_step.get(step))


def convert_window_textures(project_root, window_id, requests, converter, ledger, output_root, *, converter_identity, field_bindings_document):
    unit_key = f'window:{window_id}'
    window_name = window_id.split('#')[0]
    window_requests = [request for request in requests['textures'] if window_id in request['windowIds']]
    gap_bindings = window_gap_bindings(field_bindings_document, window_id)
    inputs = [{'path': INTERFACE_XDAT_PATH, 'sha256': requests['interfaceSha256']}, *sorted(
        {request['packagePath']: {'path': request['packagePath'], 'sha256': request['packageSha256']} for request in window_requests
         if request['packagePath']}.values(), key=lambda record: record['path'])]
    config = {'uiTextureAlgorithmVersion': UI_TEXTURE_ALGORITHM_VERSION, 'converterIdentity': converter_identity, 'gapBindings': gap_bindings,
              'textures': [{key: value for key, value in request.items() if key != 'windowIds'} for request in window_requests]}
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    if ledger.is_sealed(unit_key, fingerprint):
        return {'unit': unit_key, 'status': 'skipped-sealed'}
    step_directory = ledger.begin(unit_key, fingerprint)
    converted_outcomes = [convert_reference(request, converter) for request in window_requests]
    outcomes = [outcome for outcome, _ in converted_outcomes]
    conversions = [conversion for _, conversion in converted_outcomes if conversion is not None]
    store_outputs = write_texture_records(output_root, conversions, len(requests['textures'])) if conversions else []
    outcomes_path = step_directory / TEXTURE_OUTCOMES_RECORD_NAME
    outcomes_bytes = canonical_json_bytes({'unit': unit_key, 'outcomes': outcomes})
    outcomes_path.write_bytes(outcomes_bytes)
    evidence = lane_relative_path(ledger, outcomes_path)
    gap_rows = window_gap_rows(window_name, unit_key, {request['reference']: request for request in window_requests}, outcomes, gap_bindings,
                               requests['interfaceSha256'], evidence)
    replace_window_gap_rows(project_root, ledger.lane_name, unit_key, gap_rows)
    ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': inputs, 'gapRows': gap_rows, 'outputs': [
        {'path': evidence, 'sha256': hashlib.sha256(outcomes_bytes).hexdigest(), 'bytes': len(outcomes_bytes)}, *store_outputs]})
    return {'unit': unit_key, 'status': 'gap' if gap_rows else 'converted', 'converted': len(conversions),
            'textureGaps': sum(1 for outcome in outcomes if outcome['status'] == 'gap'), 'fieldGaps': len(gap_bindings)}
