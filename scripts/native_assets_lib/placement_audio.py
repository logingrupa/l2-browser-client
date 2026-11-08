from __future__ import annotations

import copy

from native_assets_lib.animation_audio_bundle import Inputs, dependency, HASH, OBJECT
from native_assets_lib.gltf import json_bytes
from native_catalog.ue2 import Reader
from native_store.store_paths import confined_child_path, refuse_reparse_points, require_portable_relative_path
from stage_native_players import decode, digest, require

PROPERTIES = ('StepSound_1', 'StepSound_2', 'StepSound_3')
KIND = 'native-placement-audio-dependencies'


def index(rows, field, label, limit=65536):
    require(isinstance(rows, list) and len(rows) <= limit, 'Invalid ' + label + ' list')
    result, folded = {}, set()
    for row in rows:
        require(isinstance(row, dict), 'Invalid ' + label + ' record')
        name = row.get(field)
        require(isinstance(name, str) and name and name.casefold() not in folded, 'Duplicate/invalid ' + label + ' identity')
        result[name] = row; folded.add(name.casefold())
    return result


def pin_equal(left, right):
    return all(left.get(key) == right.get(key) for key in ('path', 'bytes', 'sha256'))


def prepare(root, recipe_path):
    inputs = Inputs(root)
    recipe_path = refuse_reparse_points(recipe_path)
    require(recipe_path.is_relative_to(inputs.root), 'Recipe must stay within project root')
    raw_recipe = recipe_path.read_bytes()
    recipe = decode(inputs.read({'path': recipe_path.relative_to(inputs.root).as_posix(), 'sha256': digest(raw_recipe)}))
    require(recipe.get('schemaVersion') == 1 and recipe.get('kind') == 'native-placement-audio-bundle', 'Unsupported placement recipe')
    require(recipe.get('properties') == list(PROPERTIES), 'Unsupported source slot declaration')
    section, source, corpus = recipe['section'], recipe['source'], recipe['corpus']
    require(isinstance(section['id'], str) and section['id'], 'Missing section identity')
    manifest = decode(inputs.read(section['manifest']))
    require(manifest.get('schemaVersion') == 1 and manifest.get('kind') == 'native-map-section-runtime' and
            manifest.get('errors') == [], 'Invalid selected section manifest')
    selected = index(manifest['placements'], 'id', 'placement')
    require(selected, 'No selected placements')
    models = index(manifest['models'], 'id', 'model')
    receipt = decode(inputs.read(source['receipt']))
    require(receipt.get('schemaVersion') == 1 and receipt.get('kind') == 'native-map-raw', 'Invalid raw source receipt')
    map_source = source['map']
    require(require_portable_relative_path(map_source['path']) and HASH.fullmatch(map_source['sha256']) and
            receipt['dependencies'][map_source['path']] == {k: map_source[k] for k in ('bytes', 'sha256')}, 'Original map identity differs')
    for name, key in [('actors', 'actors.json'), ('rawMap', 'raw/map.unwrapped.bin')]:
        require(all(source[name][k] == receipt['outputs'][key][k] for k in ('bytes', 'sha256')), 'Raw source receipt identity differs: ' + name)
    actors = index(decode(inputs.read(source['actors']), max_bytes=64 * 1024 * 1024), 'id', 'source actor')
    actor_ordinals = {key: ordinal for ordinal, key in enumerate(actors)}
    raw_map = inputs.read(source['rawMap'])
    proof = decode(inputs.read(source['qualification']), max_bytes=32 * 1024 * 1024)
    require(proof.get('schemaVersion') == 1 and proof.get('nativeAutomaticSelectionQualified') is False and
            pin_equal(proof['sourceActorTable'], source['actors']) and pin_equal(proof['sourceRawMap'], source['rawMap']) and
            pin_equal(proof['sectionManifest'], section['manifest']) and
            proof['originalMap'] == {k: map_source[k] for k in ('bytes', 'sha256')}, 'Qualification source identity differs')
    declared_proof = index(proof['placements'], 'placementId', 'qualified placement')
    omitted_proof = index(proof['omittedPlacements'], 'placementId', 'omitted placement')
    require(not declared_proof.keys() & omitted_proof.keys() and declared_proof.keys() | omitted_proof.keys() == selected.keys(),
            'Qualification does not cover selected placements exactly')
    inventory_bytes = inputs.read(corpus['inventory'])
    inventory = decode(inventory_bytes, max_bytes=32 * 1024 * 1024)
    coverage = decode(inputs.read(corpus['coverage']), max_bytes=32 * 1024 * 1024)
    require(inventory.get('kind') == 'native-staged-sound-inventory' and coverage.get('kind') == 'native-staged-sound-coverage' and
            coverage['inventorySha256'] == digest(inventory_bytes), 'Corpus inventory/coverage join differs')
    sound_rows = index(inventory['sounds'], 'stableId', 'sound inventory', 100000)
    covered = index(coverage['sounds'], 'stableId', 'sound coverage', 100000)
    sound_proof = index(proof['soundProducts'], 'sourceActorReference', 'qualified sound')
    qualified_by_fold = {key.casefold(): row for key, row in sound_proof.items()}
    corpus_root = require_portable_relative_path(corpus['root'])
    placements, sounds, payloads, used_proofs = [], {}, {}, set()
    counts = {'placements': len(selected), 'declaredPlacements': 0, 'omittedPlacements': 0,
              'declaredSlots': 0, 'omittedSlots': 0, 'nullSlots': 0, 'soundReferenceSlots': 0}
    for ordinal, (placement_id, placement) in enumerate(selected.items()):
        actor = actors[placement_id]
        require(actor['classObject'] == 'Engine.StaticMeshActor' and actor['staticMesh']['object'] == placement['sourceMesh'] and
                placement['modelId'] in models, 'Placement/source actor identity differs')
        tags = [tag for tag in actor['properties'] if tag.get('name') in PROPERTIES]
        tag_index = index(tags, 'name', 'source slot', len(PROPERTIES))
        property_ordinals = {tag['name']: ordinal for ordinal, tag in enumerate(actor['properties']) if tag.get('name') in PROPERTIES}
        row = {'placementId': placement_id, 'manifestPointer': '/placements/' + str(ordinal),
               'sourceActor': {'object': actor['object'], 'class': actor['classObject'], 'exportIndex': actor['exportIndex'],
                               'tableOrdinal': actor_ordinals[placement_id]},
               'sourceMesh': placement['sourceMesh'], 'modelId': placement['modelId'], 'slots': []}
        if tags:
            counts['declaredPlacements'] += 1
            require(placement_id in declared_proof, 'Declared placement missing qualification')
            evidence = declared_proof[placement_id]
            expected = {'manifestPointer': row['manifestPointer'], 'object': actor['object'], 'class': actor['classObject'],
                        'exportIndex': actor['exportIndex'], 'stateFrameBytes': actor['stateFrameBytes'],
                        'sourceMesh': placement['sourceMesh'], 'modelId': placement['modelId'],
                        'modelResource': models[placement['modelId']]['model'], 'sourcePlacementMatrix': placement['matrix']}
            require(all(evidence.get(k) == v for k, v in expected.items()), 'Placement qualification differs')
            require([entry['sourceTag'] for entry in evidence['stepSounds']] == tags, 'Source tag qualification differs')
        else:
            counts['omittedPlacements'] += 1
            expected = {'placementId': placement_id, 'object': actor['object'], 'exportIndex': actor['exportIndex'],
                        'status': 'not-serialized-in-retained-actor', 'defaultOrRuntimeValue': None}
            require(omitted_proof.get(placement_id) == expected, 'Omitted declaration qualification differs')
        for slot_index, name in enumerate(PROPERTIES):
            tag = tag_index.get(name)
            if tag is None:
                row['slots'].append({'property': name, 'slot': slot_index, 'status': 'omitted', 'reference': None,
                                     'dependencyId': None, 'nativeDefaultOrFallback': None})
                counts['omittedSlots'] += 1
                continue
            require(tag['type'] == 5 and tag['status'] == 'decoded' and tag['arrayIndex'] is None and tag['structName'] is None,
                    'Step sound must be a scalar decoded ObjectProperty')
            evidence = next(entry for entry in declared_proof[placement_id]['stepSounds'] if entry['sourceTag']['name'] == name)
            span = tag['payload']; start, finish = span['offset'], span['offset'] + span['bytes']
            require(type(start) is int and type(span['bytes']) is int and span['bytes'] > 0 and
                    type(tag['offset']) is int and 0 <= tag['offset'] < start < finish <= len(raw_map) and
                    span['path'] == 'raw/map.unwrapped.bin', 'Invalid source property byte span')
            payload, full = raw_map[start:finish], raw_map[tag['offset']:finish]
            require(digest(payload) == span['sha256'] and evidence['rawTagAndPayload'] ==
                    {'offset': tag['offset'], 'bytes': len(full), 'hex': full.hex(), 'sha256': digest(full)}, 'Source property bytes differ')
            reader = Reader(payload)
            object_index = reader.compact()
            require(reader.position == reader.end and type(tag['value']['index']) is int and object_index == tag['value']['index'],
                    'Serialized object index differs from source tag')
            reference = tag['value']['object']
            record = {'property': name, 'slot': slot_index, 'sourcePropertyOrdinal': property_ordinals[name], 'sourceTag': copy.deepcopy(tag),
                      'rawTagAndPayload': copy.deepcopy(evidence['rawTagAndPayload']), 'reference': reference}
            counts['declaredSlots'] += 1
            if object_index == 0:
                require(reference is None, 'Explicit null object has a sound name')
                record.update(status='explicit-null', dependencyId=None)
                counts['nullSlots'] += 1
            else:
                require(isinstance(reference, str) and OBJECT.fullmatch(reference), 'Unqualified actor sound reference')
                sound_evidence = qualified_by_fold.get(reference.casefold())
                require(sound_evidence is not None, 'Missing exact qualified Sound: ' + reference)
                used_proofs.add(sound_evidence['sourceActorReference'])
                item, product = sound_evidence['inventory'], sound_evidence['existingCoverage']
                key = item['stableId']; exported = item['export']; package = item['sourcePackage']
                require(item == sound_rows.get(key) and product == covered.get(key) and product['status'] == 'exported-and-verified' and
                        exported['classObject'] == 'Engine.Sound' and reference.casefold() == exported['object'].casefold(), 'Sound corpus provenance differs')
                if key not in sounds:
                    audio, archive = product['products']['audio'], product['products']['archive']
                    dep = {'authoredReference': reference, 'sourceObject': exported['object'], 'sourcePackageSha256': package['sha256'],
                           'exportIndex': exported['exportIndex'], 'payload': copy.deepcopy(item['nativePayload']),
                           'existingExport': {'archivePath': corpus_root + '/' + require_portable_relative_path(archive['path']), 'archiveSha256': archive['sha256'],
                           'id': item['id'], 'sourceObject': exported['object'], 'sourcePackageSha256': package['sha256'],
                           'nativeExportIndex': exported['exportIndex'], 'stableId': key, 'wavPath': corpus_root + '/' + require_portable_relative_path(audio['path']),
                           'wavSha256': audio['sha256'], 'wavBytes': audio['bytes']}}
                    sound, wav = dependency(inputs, dep)
                    original = item['nativePayload']
                    native = inputs.read({**original, 'path': corpus_root + '/' + require_portable_relative_path(original['path'])})
                    require(native == wav and item['nativeSound']['embeddedPayloadSha256'] == digest(wav) and
                            item['nativeSound']['exportIndex'] == exported['exportIndex'], 'Native source payload provenance differs')
                    sound['source']['package'] = copy.deepcopy(package)
                    sound['source']['serializedExport'] = copy.deepcopy(item['serializedExport'])
                    sound['source']['nativeSound'] = copy.deepcopy(item['nativeSound'])
                    sounds[key] = sound
                    require(sound['file'] not in payloads or payloads[sound['file']] == wav, 'Conflicting audio content identity')
                    payloads[sound['file']] = wav
                record.update(status='source-declared', dependencyId=key)
                counts['soundReferenceSlots'] += 1
            row['slots'].append(record)
        placements.append(row)
    require(used_proofs == sound_proof.keys(), 'Unconsumed or missing qualified sound evidence')
    controls = recipe.get('absenceControls', [])
    require(isinstance(controls, list) and len(set(controls)) == len(controls) and all(key in omitted_proof for key in controls),
            'Absence control is declared, duplicated or outside selection')
    require(proof['explicitMissingControls'] == [omitted_proof[key] for key in omitted_proof if key in controls], 'Explicit absence controls differ')
    counts.update(dependencies=len(sounds), wavFiles=len(payloads))
    require(counts == recipe['expectedCoverage'], 'Selected coverage differs from recipe')
    for evidence in recipe.get('supportingEvidence', []):
        inputs.read(evidence)
    inputs.unchanged()
    manifest = {'schemaVersion': 1, 'kind': KIND, 'section': copy.deepcopy(section), 'sourceMap': copy.deepcopy(map_source),
                'inputs': [{k: v for k, v in value.items() if k != 'mtimeNs'} for value in inputs.records.values()],
                'properties': list(PROPERTIES), 'placements': placements, 'sounds': list(sounds.values()),
                'coverage': counts, 'absenceControls': controls,
                'runtime': {'connected': False, 'automaticSurfaceSelection': 'unqualified', 'nativeDispatchVerified': False},
                'limits': ['Original actor declarations only; omitted slots have no inferred default or fallback.',
                           'Placement order, slot order and original source tag bytes retained; geometry/model archives untouched.',
                           'Native support-object dispatch, selection/randomization and effective config overrides remain unproved.',
                           'Sound packaging does not establish audible world playback or native audio parity.']}
    payloads['manifest.json'] = json_bytes(manifest)
    return manifest, payloads, inputs


def run(root, recipe_path, output, *, plan=False, verify_only=False):
    require(not (plan and verify_only), 'Plan and verify-only are mutually exclusive')
    manifest, payloads, inputs = prepare(root, recipe_path)
    output = refuse_reparse_points(output)
    require(any(output != inputs.root / name and output.is_relative_to(inputs.root / name)
                for name in ('artifacts', 'scratch', '.scratch')), 'Output must be a named artifacts/scratch subdirectory')
    for name in inputs.records:
        path = confined_child_path(inputs.root, name)
        require(not path.is_relative_to(output) and not output.is_relative_to(path.parent), 'Output overlaps an input or retained directory')
    exists = output.exists()
    if exists:
        require(output.is_dir(), 'Output is not a directory')
        actual = set()
        for path in output.rglob('*'):
            refuse_reparse_points(path)
            if path.is_file(): actual.add(path.relative_to(output).as_posix())
        require(actual == set(payloads), 'Existing output file set differs; preserved')
        for name, data in payloads.items():
            require(confined_child_path(output, name).read_bytes() == data, 'Existing immutable output differs; preserved: ' + name)
    require(not verify_only or exists, 'Verify-only requires a complete existing output')
    status = 'planned' if plan else 'verified' if verify_only else 'preserved' if exists else 'produced'
    written = 0
    if status == 'produced':
        output.mkdir(parents=True, exist_ok=False)
        for name in sorted(payloads, key=lambda name: name == 'manifest.json'):
            path = confined_child_path(output, name); path.parent.mkdir(parents=True, exist_ok=True)
            refuse_reparse_points(path.parent)
            with path.open('xb') as stream: stream.write(payloads[name])
            written += 1
    inputs.unchanged()
    return {'status': status, 'manifestSha256': digest(payloads['manifest.json']), 'coverage': manifest['coverage'],
            'filesWritten': written, 'sourceInputsUnchanged': True,
            'files': [{'path': name, 'bytes': len(data), 'sha256': digest(data)} for name, data in sorted(payloads.items())]}
