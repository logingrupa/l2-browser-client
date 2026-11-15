from __future__ import annotations

import hashlib
import json

from hash_reference_client_tree import canonical_json_bytes
from interface_layout_adapter import INTERFACE_XDAT_PATH
from lane_unit_outcomes import lane_relative_path, replace_step_gap_row
from native_store.gap_rows import QUALIFIED_OBJECT_NAME_PATTERN
from native_store.store_paths import REPOSITORY_ROOT

CONTROLS_STEP = 'controls'
CONTROLS_ALGORITHM_VERSION = 1
CONTROL_GAPS_RECORD_NAME = 'control-gaps.json'
CONTROL_TYPES_RECIPE_PATH = REPOSITORY_ROOT / 'recipes' / 'data' / 'native-window-control-types.json'
CONTROL_TYPES_RECIPE_SCHEMA_VERSION = 1
CONTROL_TYPE_UNSUPPORTED_PREFIX = 'control-type-unsupported:'
PART_NAME = 'ui'


class WindowControlGapError(ValueError):
    pass


def read_rendered_control_types(path=CONTROL_TYPES_RECIPE_PATH):
    document = json.loads(path.read_bytes())
    rendered_types = document.get('renderedTypes') if isinstance(document, dict) else None
    if not (isinstance(document, dict) and document.get('schemaVersion') == CONTROL_TYPES_RECIPE_SCHEMA_VERSION
            and isinstance(rendered_types, list) and rendered_types
            and all(isinstance(control_type, str) and control_type for control_type in rendered_types)
            and len(set(rendered_types)) == len(rendered_types) and isinstance(document.get('source'), str)):
        raise WindowControlGapError(f'control type recipe must be {{schemaVersion {CONTROL_TYPES_RECIPE_SCHEMA_VERSION}, renderedTypes, source}} '
                                    f'with distinct non-empty type names: {path}')
    return tuple(rendered_types)


def manifest_controls(root_node):
    pending = [root_node]
    while pending:
        node = pending.pop()
        if not (isinstance(node, dict) and isinstance(node.get('name'), str) and isinstance(node.get('type'), str)
                and isinstance(node.get('children'), list)):
            raise WindowControlGapError(f'window manifest node needs a name, a type and children: {node!r}')
        yield node
        pending.extend(reversed(node['children']))


def control_source_identity(source_identity, window_name, control_name):
    identity = {'path': source_identity['path'], 'sha256': source_identity['sha256']}
    object_name = f'{window_name}.{control_name}'
    if QUALIFIED_OBJECT_NAME_PATTERN.fullmatch(object_name):
        identity['object'] = object_name
    return identity


def window_control_gap_rows(window_manifest, rendered_types, source_identity):
    window_id = window_manifest['windowId']
    window_name = window_id.split('#')[0]
    rows = []
    for node in manifest_controls(window_manifest['root']):
        if node['type'] in rendered_types:
            continue
        rows.append({'key': f'window:{window_id}', 'part': PART_NAME, 'step': CONTROLS_STEP, 'status': 'gap',
                     'reason': CONTROL_TYPE_UNSUPPORTED_PREFIX + node['type'],
                     'sourceIdentity': control_source_identity(source_identity, window_name, node['name'])})
    return rows


def interface_source_identity(window_manifest):
    return {'path': INTERFACE_XDAT_PATH, 'sha256': window_manifest['sourceSha256']}


def convert_window_controls(project_root, window_manifest, manifest_record, rendered_types, ledger):
    window_id = window_manifest['windowId']
    unit_key = f'window:{window_id}'
    inputs = [interface_source_identity(window_manifest),
              {'path': manifest_record['manifest'].removeprefix('/'), 'sha256': manifest_record['manifestSha256']}]
    config = {'controlsAlgorithmVersion': CONTROLS_ALGORITHM_VERSION, 'renderedTypes': list(rendered_types)}
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    if ledger.is_sealed(unit_key, fingerprint):
        return {'unit': unit_key, 'status': 'skipped-sealed'}
    step_directory = ledger.begin(unit_key, fingerprint)
    evidence_path = step_directory / CONTROL_GAPS_RECORD_NAME
    evidence = lane_relative_path(ledger, evidence_path)
    control_rows = [{**row, 'evidence': evidence} for row in window_control_gap_rows(window_manifest, rendered_types, interface_source_identity(window_manifest))]
    evidence_bytes = canonical_json_bytes({'unit': unit_key, 'renderedTypes': list(rendered_types), 'gapRows': control_rows})
    evidence_path.write_bytes(evidence_bytes)
    step_gap_row = control_rows[0] if control_rows else None
    replace_step_gap_row(project_root, ledger.lane_name, CONTROLS_STEP, unit_key, step_gap_row)
    ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': inputs, 'gapRows': [step_gap_row] if step_gap_row else [], 'outputs': [
        {'path': evidence, 'sha256': hashlib.sha256(evidence_bytes).hexdigest(), 'bytes': len(evidence_bytes)}]})
    return {'unit': unit_key, 'status': 'gap' if control_rows else 'converted', 'unsupportedControls': len(control_rows),
            'unsupportedTypes': sorted({row['reason'].removeprefix(CONTROL_TYPE_UNSUPPORTED_PREFIX) for row in control_rows})}
