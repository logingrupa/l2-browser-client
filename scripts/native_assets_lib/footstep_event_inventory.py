from __future__ import annotations

import copy

from native_assets_lib.animation_audio_bundle import OBJECT, Inputs, pointer
from native_assets_lib.gltf import json_bytes
from stage_native_players import checked, child, decode, digest, require, CATALOG_ID

KIND = 'native-footstep-event-inventory'
RECIPE_KIND = 'native-footstep-event-inventory-recipe'
EVENT_FIELDS = ('animationSet', 'clip', 'object', 'type', 'function', 'normalizedTime',
                'timeSeconds', 'sourceFrames', 'sourceRate', 'sound')
AUTHORED_SCALAR_PROPERTIES = ('Radius', 'Volume', 'Random')
SEXES = ('male', 'female')
UNRECOVERED_NOTIFICATION_OFFSET_STATUS = ('Copied unchanged from the exporter archive event at this manifest ordinal; '
                                          'notification property byte offsets were not recovered and no source package was reparsed.')


def index_pinned_dependency_rows_by_qualified_reference(rows):
    require(isinstance(rows, list) and 0 < len(rows) <= 4096, 'Dependency inventory must be a non-empty list')
    lookup = {}
    for row in rows:
        reference = row.get('authoredReference') if isinstance(row, dict) else None
        require(isinstance(reference, str) and OBJECT.fullmatch(reference) is not None, 'Unqualified dependency reference')
        require(reference.casefold() not in lookup, 'Ambiguous qualified dependency identity: ' + reference)
        lookup[reference.casefold()] = row
    return lookup


def copy_exporter_event_row_and_authored_references(actor, manifest_hash, source_hash, ordinal, raw):
    properties = raw.get('properties', {})
    require(isinstance(properties, dict), 'Event properties must be an object')
    row = {'sex': actor['sex'], 'catalogId': actor['catalogId'], 'assetManifestSha256': manifest_hash,
           'manifestPointer': f'/animationEvents/{ordinal}', **{key: copy.deepcopy(raw.get(key)) for key in EVENT_FIELDS},
           'resolvedFile': raw.get('resolvedFile'),
           'authoredScalars': {key: properties[key] for key in AUTHORED_SCALAR_PROPERTIES if key in properties},
           'nativeNotification': {'sourcePackageSha256': source_hash, 'offsetUnwrapped': None, 'status': UNRECOVERED_NOTIFICATION_OFFSET_STATUS}}
    references = []
    for name, values in properties.items():
        if not isinstance(values, list): continue
        require(0 < len(values) <= 4096, 'Invalid authored sound array: ' + name)
        for reference in values:
            require(isinstance(reference, str) and OBJECT.fullmatch(reference) is not None,
                    'Unqualified/empty authored dependency in ' + name)
            references.append(reference)
    return row, references


def build_footstep_event_inventory(root, recipe_path):
    inputs = Inputs(root)
    recipe_path = checked(recipe_path)
    require(recipe_path.is_relative_to(inputs.root), 'Recipe must stay within project root')
    recipe_bytes = recipe_path.read_bytes()
    recipe = decode(inputs.read({'path': recipe_path.relative_to(inputs.root).as_posix(), 'sha256': digest(recipe_bytes)}))
    require(recipe.get('schemaVersion') == 1 and recipe.get('kind') == RECIPE_KIND, 'Unsupported footstep inventory recipe')
    spec = recipe.get('dependencies')
    require(isinstance(spec, dict) and set(spec) == {'path', 'sha256', 'bytes', 'pointer'}, 'Invalid dependency inventory pin')
    lookup = index_pinned_dependency_rows_by_qualified_reference(pointer(decode(inputs.read(spec), max_bytes=32 * 1024 * 1024), spec['pointer']))
    selections = recipe.get('actors')
    require(isinstance(selections, list) and 0 < len(selections) <= 64, 'Invalid actor selection')
    actors, events, used, catalog_ids = [], [], set(), set()
    for selection in selections:
        require(isinstance(selection, dict) and set(selection) == {'catalogId', 'assetId', 'sex', 'archive', 'clips'},
                'Unsupported actor selection fields')
        catalog_id = selection['catalogId']
        require(isinstance(catalog_id, str) and CATALOG_ID.fullmatch(catalog_id) is not None and
                catalog_id not in catalog_ids, 'Duplicate/invalid actor catalog ID')
        catalog_ids.add(catalog_id)
        require(selection['sex'] in SEXES, 'Invalid actor sex')
        clips = selection['clips']
        require(isinstance(clips, list) and 0 < len(clips) <= 16 and len(set(clips)) == len(clips) and
                all(isinstance(name, str) and name for name in clips), 'Invalid explicit clip selection')
        result, asset, files = inputs.archive(selection['archive'])
        require(result['kind'] == 'model' and asset['id'] == selection['assetId'] and
                asset['source']['edition'] == 'interlude', 'Actor archive identity differs')
        manifest_hash, source_hash = digest(files['asset.json']), asset['source']['sha256']
        found = {}
        for ordinal, raw in enumerate(asset.get('animationEvents', [])):
            if raw.get('clip') not in clips: continue
            row, references = copy_exporter_event_row_and_authored_references(selection, manifest_hash, source_hash, ordinal, raw)
            for reference in references:
                require(reference.casefold() in lookup, 'Missing exact dependency: ' + reference)
                used.add(reference.casefold())
            events.append(row)
            found[raw['clip']] = found.get(raw['clip'], 0) + 1
        require(set(found) == set(clips), 'Selected clip has no retained notify events: ' +
                ', '.join(name for name in clips if name not in found))
        actors.append({'catalogId': catalog_id, 'assetId': asset['id'], 'sex': selection['sex'],
                       'archiveSha256': selection['archive']['sha256'], 'assetManifestSha256': manifest_hash,
                       'source': copy.deepcopy(asset['source']), 'clips': [{'name': name, 'events': found[name]} for name in clips]})
    require(used, 'Selected events author no qualified surface dependencies')
    dependencies = [copy.deepcopy(row) for key, row in lookup.items() if key in used]
    inputs.unchanged()
    inventory = {'schemaVersion': 1, 'kind': KIND,
                 'inputs': [{k: v for k, v in row.items() if k != 'mtimeNs'} for row in inputs.records.values()],
                 'actors': actors, 'locomotion': {'events': events, 'dependencies': dependencies},
                 'coverage': {'actors': len(actors), 'events': len(events),
                              'directSoundEvents': sum(row['sound'] is not None for row in events),
                              'dependencies': len(dependencies)},
                 'limits': ['Event rows are the exporter archive records at their manifest ordinals; native notification byte offsets are unrecovered.',
                            'Dependency rows are copied from the pinned existing inventory; a qualified-name join is not native lookup proof.',
                            'No surface, gait, random or playback rule is decided by this inventory.']}
    return inventory, {'inventory.json': json_bytes(inventory)}, inputs


def run(root, recipe_path, output, *, plan=False, verify_only=False):
    require(not (plan and verify_only), 'Plan and verify-only are mutually exclusive')
    inventory, payloads, inputs = build_footstep_event_inventory(root, recipe_path)
    output = checked(output)
    require(any(output != inputs.root / name and output.is_relative_to(inputs.root / name)
                for name in ('artifacts', 'scratch', '.scratch')), 'Output must be a named artifacts/scratch subdirectory')
    for name in inputs.records:
        source = child(inputs.root, name)
        require(not source.is_relative_to(output) and not output.is_relative_to(source.parent),
                'Output overlaps an input or its retained directory')
    exists = output.exists()
    if exists:
        require(output.is_dir(), 'Output is not a directory')
        actual = {path.relative_to(output).as_posix() for path in output.rglob('*') if checked(path).is_file()}
        require(actual == set(payloads), 'Existing output file set differs; preserved')
        for name, value in payloads.items():
            require(child(output, name).read_bytes() == value, 'Existing immutable output differs; preserved: ' + name)
    require(not verify_only or exists, 'Verify-only requires a complete existing output')
    status = 'planned' if plan else 'verified' if verify_only else 'preserved' if exists else 'produced'
    written = 0
    if status == 'produced':
        output.mkdir(parents=True, exist_ok=False)
        for name, value in payloads.items():
            with child(output, name).open('xb') as handle: handle.write(value)
            written += 1
    inputs.unchanged()
    return {'status': status, 'inventorySha256': digest(payloads['inventory.json']), 'coverage': inventory['coverage'],
            'filesWritten': written, 'sourceInputsUnchanged': True,
            'files': [{'path': name, 'bytes': len(value), 'sha256': digest(value)} for name, value in sorted(payloads.items())]}
