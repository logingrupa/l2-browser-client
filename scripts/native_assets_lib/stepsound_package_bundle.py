from __future__ import annotations

import copy
import re

from native_assets_lib.guard_clauses import require_condition
from native_assets_lib.sha256_identity import SHA256_HEX_PATTERN, sha256_hex_digest
from native_assets_lib.strict_json import decode_strict_json
from native_assets_lib.animation_audio_bundle import Inputs, dependency, OBJECT
from native_assets_lib.gltf import json_bytes
from native_store.store_paths import confined_child_path, refuse_reparse_points, require_portable_relative_path

KIND = 'native-stepsound-package'
RECIPE_KIND = 'native-stepsound-package-bundle'
NUMBER = r'(\d{2})'
IDENTIFIER = re.compile(r'[A-Za-z][A-Za-z0-9_]{0,63}')


def unique_index(rows, field, label, limit=100000):
    require_condition(isinstance(rows, list) and len(rows) <= limit, 'Invalid ' + label + ' list')
    result = {}
    for row in rows:
        require_condition(isinstance(row, dict) and isinstance(row.get(field), str) and row[field] not in result,
                'Duplicate/invalid ' + label + ' identity')
        result[row[field]] = row
    return result


def classifiers(recipe):
    rules, ids = [], set()
    surfaces, events, layers = recipe.get('surfaces'), recipe.get('events'), recipe.get('layers')
    require_condition(isinstance(surfaces, list) and 0 < len(surfaces) <= 64 and isinstance(events, list) and len(events) <= 16 and
            isinstance(layers, list) and len(layers) <= 16, 'Invalid classification recipe')
    for row in surfaces:
        identity, group = row.get('id'), row.get('group')
        require_condition(isinstance(identity, str) and IDENTIFIER.fullmatch(identity) and identity.casefold() not in ids and
                isinstance(group, str) and IDENTIFIER.fullmatch(group), 'Invalid surface declaration')
        ids.add(identity.casefold())
        expected = row.get('expected')
        if row.get('gaitSplit') is True:
            require_condition(isinstance(expected, dict) and set(expected) == {'walk', 'run'} and
                    all(type(v) is int and 0 < v <= 16 for v in expected.values()), 'Invalid gait surface expectation')
            pattern = re.compile(re.escape(group.casefold()) + r'_(walk|run)_' + NUMBER)
            rules.append(('surface', identity, group, pattern, True, row))
        else:
            prefix = row.get('namePrefix')
            require_condition(row.get('gaitSplit') is False and isinstance(prefix, str) and IDENTIFIER.fullmatch(prefix) and
                    isinstance(expected, dict) and set(expected) == {'any'} and type(expected['any']) is int and
                    0 < expected['any'] <= 16, 'Invalid single-gait surface expectation')
            rules.append(('surface', identity, group, re.compile(re.escape(prefix.casefold()) + '_' + NUMBER), False, row))
    for row in events:
        identity, group, name = row.get('id'), row.get('group'), row.get('name')
        require_condition(isinstance(identity, str) and IDENTIFIER.fullmatch(identity) and identity.casefold() not in ids and
                isinstance(group, str) and isinstance(name, str) and IDENTIFIER.fullmatch(name), 'Invalid event declaration')
        ids.add(identity.casefold())
        rules.append(('event', identity, group, re.compile(re.escape(name.casefold())), False, row))
    for row in layers:
        identity, group, prefix, expected = row.get('id'), row.get('group'), row.get('namePrefix'), row.get('expected')
        require_condition(isinstance(identity, str) and IDENTIFIER.fullmatch(identity) and identity.casefold() not in ids and
                isinstance(group, str) and isinstance(prefix, str) and IDENTIFIER.fullmatch(prefix) and
                type(expected) is int and 0 < expected <= 16, 'Invalid layer declaration')
        ids.add(identity.casefold())
        rules.append(('layer', identity, group, re.compile(re.escape(prefix.casefold()) + '_' + NUMBER), False, row))
    return rules


def classify(rules, package_prefix, exported_object):
    parts = exported_object.split('.')
    require_condition(len(parts) == 3 and parts[0].casefold() == package_prefix.casefold(),
            'Sound object is not a package.group.name export: ' + exported_object)
    _, group, name = parts
    matches = []
    for kind, identity, rule_group, pattern, gait_split, _ in rules:
        if group.casefold() != rule_group.casefold():
            continue
        match = pattern.fullmatch(name.casefold())
        if not match:
            continue
        if kind == 'event':
            matches.append({'class': kind, 'id': identity, 'gait': None, 'variation': None})
        elif gait_split:
            matches.append({'class': kind, 'id': identity, 'gait': match.group(1), 'variation': int(match.group(2))})
        else:
            matches.append({'class': kind, 'id': identity, 'gait': None, 'variation': int(match.group(1))})
    require_condition(len(matches) == 1, ('Unclassified' if not matches else 'Ambiguously classified') + ' stepsound Sound: ' + exported_object)
    return group, name, matches[0]


def ordered(rows, label):
    numbers = [row['classification']['variation'] for row in rows]
    require_condition(sorted(numbers) == list(range(1, len(rows) + 1)), 'Variation numbers are not contiguous from 01: ' + label)
    return [row['dependencyId'] for row in sorted(rows, key=lambda row: row['classification']['variation'])]


def placement_declarations(inputs, spec, sounds):
    manifest = decode_strict_json(inputs.read(spec['manifest']), max_bytes=32 * 1024 * 1024)
    require_condition(manifest.get('schemaVersion') == 1 and manifest.get('kind') == 'native-placement-audio-dependencies',
            'Unsupported placement-audio manifest')
    section = manifest.get('section')
    require_condition(isinstance(section, dict) and isinstance(section.get('manifest'), dict) and
            SHA256_HEX_PATTERN.fullmatch(section['manifest'].get('sha256', '')) and
            section['manifest']['sha256'] == spec.get('sectionManifestSha256'), 'Placement section identity differs')
    placement_sounds = unique_index(manifest.get('sounds'), 'dependencyId', 'placement sound', 4096)
    rows, omitted, slots = [], 0, 0
    for placement in manifest.get('placements', []):
        declared = [slot for slot in placement['slots'] if slot['status'] == 'source-declared']
        require_condition(all(slot['status'] in ('source-declared', 'omitted', 'explicit-null') for slot in placement['slots']),
                'Unknown placement slot status')
        if not declared:
            omitted += 1
            continue
        result = []
        for slot in placement['slots']:
            entry = {'property': slot['property'], 'slot': slot['slot'], 'status': slot['status'], 'reference': slot['reference'],
                     'dependencyId': slot.get('dependencyId')}
            if slot['status'] == 'source-declared':
                key = slot['dependencyId']
                sound, theirs = sounds.get(key), placement_sounds.get(key)
                require_condition(sound is not None and theirs is not None and theirs['sha256'] == sound['sha256'] and
                        theirs['bytes'] == sound['bytes'] and isinstance(slot['reference'], str) and
                        OBJECT.fullmatch(slot['reference']) and slot['reference'].casefold() == sound['object'].casefold(),
                        'Placement declaration does not join an exact package Sound: ' + str(key))
                slots += 1
            result.append(entry)
        rows.append({'placementId': placement['placementId'], 'sourceActor': copy.deepcopy(placement['sourceActor']),
                     'sourceMesh': placement['sourceMesh'], 'modelId': placement['modelId'], 'slots': result})
    return {'section': copy.deepcopy(section), 'manifest': {k: spec['manifest'][k] for k in ('path', 'bytes', 'sha256')},
            'declared': rows, 'omittedPlacements': omitted, 'declaredSlots': slots}


def prepare(root, recipe_path):
    inputs = Inputs(root)
    recipe_path = refuse_reparse_points(recipe_path)
    require_condition(recipe_path.is_relative_to(inputs.root), 'Recipe must stay within project root')
    raw_recipe = recipe_path.read_bytes()
    recipe = decode_strict_json(inputs.read({'path': recipe_path.relative_to(inputs.root).as_posix(), 'sha256': sha256_hex_digest(raw_recipe)}))
    require_condition(recipe.get('schemaVersion') == 1 and recipe.get('kind') == RECIPE_KIND, 'Unsupported stepsound recipe')
    package, corpus = recipe['package'], recipe['corpus']
    require_condition(isinstance(package.get('relativePath'), str) and SHA256_HEX_PATTERN.fullmatch(package.get('sha256', '')) and
            type(package.get('bytes')) is int and IDENTIFIER.fullmatch(package.get('objectPrefix', '')),
            'Invalid package selection')
    rules = classifiers(recipe)
    inventory_bytes = inputs.read(corpus['inventory'])
    inventory = decode_strict_json(inventory_bytes, max_bytes=32 * 1024 * 1024)
    coverage = decode_strict_json(inputs.read(corpus['coverage']), max_bytes=32 * 1024 * 1024)
    require_condition(inventory.get('kind') == 'native-staged-sound-inventory' and coverage.get('kind') == 'native-staged-sound-coverage' and
            coverage.get('inventorySha256') == sha256_hex_digest(inventory_bytes), 'Corpus inventory/coverage join differs')
    packages = [row for row in inventory['packages'] if row['source']['relativePath'] == package['relativePath']]
    require_condition(len(packages) == 1, 'Selected package is not uniquely enumerated in the corpus')
    enumerated = packages[0]
    require_condition(enumerated['status'] == 'enumerated' and enumerated['source']['sha256'] == package['sha256'] and
            enumerated['source']['bytes'] == package['bytes'] and enumerated['soundCount'] == enumerated['expectedSounds'] ==
            recipe['expectedCoverage']['sounds'], 'Package identity or Sound count differs from the recipe')
    covered = unique_index(coverage['sounds'], 'stableId', 'sound coverage')
    selected = [row for row in inventory['sounds'] if row['sourcePackage']['sha256'] == package['sha256']]
    require_condition(len(selected) == enumerated['soundCount'], 'Package Sound rows differ from its enumerated count')
    corpus_root = require_portable_relative_path(corpus['root'])
    sounds, payloads, classes = {}, {}, {}
    for item in sorted(selected, key=lambda row: row['export']['exportIndex']):
        exported, key = item['export'], item['stableId']
        require_condition(item['status'] == 'source-ready' and exported['classObject'] == 'Engine.Sound' and
                OBJECT.fullmatch(exported['object']) and key not in sounds and
                key.endswith(':' + package['sha256'] + ':' + str(exported['exportIndex'])), 'Invalid package Sound row')
        product = covered.get(key)
        require_condition(product is not None and product['status'] == 'exported-and-verified', 'Package Sound is not exported: ' + key)
        group, name, classification = classify(rules, package['objectPrefix'], exported['object'])
        audio, archive = product['products']['audio'], product['products']['archive']
        row = {'authoredReference': exported['object'], 'sourceObject': exported['object'], 'sourcePackageSha256': package['sha256'],
               'exportIndex': exported['exportIndex'], 'payload': copy.deepcopy(item['nativePayload']),
               'existingExport': {'archivePath': corpus_root + '/' + require_portable_relative_path(archive['path']), 'archiveSha256': archive['sha256'],
                                  'id': item['id'], 'sourceObject': exported['object'], 'sourcePackageSha256': package['sha256'],
                                  'nativeExportIndex': exported['exportIndex'], 'stableId': key,
                                  'wavPath': corpus_root + '/' + require_portable_relative_path(audio['path']),
                                  'wavSha256': audio['sha256'], 'wavBytes': audio['bytes']}}
        sound, wav = dependency(inputs, row)
        native = inputs.read({**item['nativePayload'], 'path': corpus_root + '/' + require_portable_relative_path(item['nativePayload']['path'])})
        require_condition(native == wav and item['nativeSound']['embeddedPayloadSha256'] == sha256_hex_digest(wav) and
                item['nativeSound']['exportIndex'] == exported['exportIndex'], 'Native source payload provenance differs')
        duration = audio.get('metadata', {}).get('durationSeconds')
        require_condition(isinstance(duration, (int, float)) and not isinstance(duration, bool) and 0 < duration < 60,
                'Exported WAV duration is missing')
        sound.update(object=exported['object'], group=group, name=name, durationSeconds=duration, classification=classification)
        sound['source']['package'] = copy.deepcopy(item['sourcePackage'])
        sound['source']['serializedExport'] = copy.deepcopy(item['serializedExport'])
        require_condition(sound['file'] not in payloads or payloads[sound['file']] == wav, 'Conflicting audio content identity')
        payloads[sound['file']] = wav
        sounds[key] = sound
        classes.setdefault((classification['class'], classification['id']), []).append(sound)
    surfaces, events, layers = [], [], []
    counts = {'sounds': len(sounds), 'wavFiles': len(payloads), 'surfaces': 0, 'gaitSurfaces': 0, 'events': 0, 'layers': 0}
    for kind, identity, group, _, gait_split, spec in rules:
        rows = classes.get((kind, identity), [])
        if kind == 'surface':
            entry = {'id': identity, 'label': spec.get('label', identity), 'group': group, 'gaitSplit': gait_split}
            if gait_split:
                for gait in ('walk', 'run'):
                    gaited = [row for row in rows if row['classification']['gait'] == gait]
                    require_condition(len(gaited) == spec['expected'][gait], f'Surface {identity} {gait} count differs: {len(gaited)}')
                    entry[gait] = ordered(gaited, identity + ' ' + gait)
                counts['gaitSurfaces'] += 1
            else:
                require_condition(len(rows) == spec['expected']['any'], f'Surface {identity} count differs: {len(rows)}')
                entry['clips'] = ordered(rows, identity)
            surfaces.append(entry); counts['surfaces'] += 1
        elif kind == 'event':
            require_condition(len(rows) == 1, 'Event sound count differs: ' + identity)
            events.append({'id': identity, 'group': group, 'dependencyId': rows[0]['dependencyId']}); counts['events'] += 1
        else:
            require_condition(len(rows) == spec['expected'], f'Layer {identity} count differs: {len(rows)}')
            layers.append({'id': identity, 'group': group, 'clips': ordered(rows, identity)}); counts['layers'] += 1
    require_condition(sum(len(v) for v in classes.values()) == len(sounds), 'Classified Sound total differs')
    placements = placement_declarations(inputs, recipe['placementAudio'], sounds) if recipe.get('placementAudio') else None
    if placements:
        counts.update(declaredPlacements=len(placements['declared']), omittedPlacements=placements['omittedPlacements'],
                      placementSlots=placements['declaredSlots'])
    require_condition(counts == recipe['expectedCoverage'], 'Package coverage differs from recipe: ' + json_bytes(counts).decode())
    inputs.unchanged()
    manifest = {'schemaVersion': 1, 'kind': KIND,
                'package': {'object': package['objectPrefix'], 'relativePath': package['relativePath'],
                            'sha256': package['sha256'], 'bytes': package['bytes'], 'soundCount': enumerated['soundCount']},
                'inputs': [{k: v for k, v in value.items() if k != 'mtimeNs'} for value in inputs.records.values()],
                'surfaces': surfaces, 'events': events, 'layers': layers,
                'placements': placements, 'sounds': list(sounds.values()), 'coverage': counts,
                'classification': {'rule': 'case-insensitive package.group.name match against recipe groups; exact names retained',
                                   'labels': 'material labels come from original group/sound names; surface links are not native evidence'},
                'runtime': {'connected': False, 'automaticSurfaceSelection': 'browser-presentation', 'nativeDispatchVerified': False},
                'limits': ['Every Sound export of the selected package; unchanged original WAV payloads.',
                           'Group/name classification is a label join, not a native terrain/material/surface mapping.',
                           'Placement declarations are exact original StaticMeshActor slots; native dispatch/selection unproved.',
                           'Random, boots, water-transition and gait selection rules remain unproved native behaviour.']}
    payloads['manifest.json'] = json_bytes(manifest)
    return manifest, payloads, inputs


def run(root, recipe_path, output, *, plan=False, verify_only=False):
    require_condition(not (plan and verify_only), 'Plan and verify-only are mutually exclusive')
    manifest, payloads, inputs = prepare(root, recipe_path)
    output = refuse_reparse_points(output)
    require_condition(any(output != inputs.root / name and output.is_relative_to(inputs.root / name)
                for name in ('artifacts', 'scratch', '.scratch')), 'Output must be a named artifacts/scratch subdirectory')
    for name in inputs.records:
        path = confined_child_path(inputs.root, name)
        require_condition(not path.is_relative_to(output) and not output.is_relative_to(path.parent), 'Output overlaps an input or retained directory')
    exists = output.exists()
    if exists:
        require_condition(output.is_dir(), 'Output is not a directory')
        actual = set()
        for path in output.rglob('*'):
            refuse_reparse_points(path)
            if path.is_file():
                actual.add(path.relative_to(output).as_posix())
        require_condition(actual == set(payloads), 'Existing output file set differs; preserved')
        for name, data in payloads.items():
            require_condition(confined_child_path(output, name).read_bytes() == data, 'Existing immutable output differs; preserved: ' + name)
    require_condition(not verify_only or exists, 'Verify-only requires a complete existing output')
    status = 'planned' if plan else 'verified' if verify_only else 'preserved' if exists else 'produced'
    written = 0
    if status == 'produced':
        output.mkdir(parents=True, exist_ok=False)
        for name in sorted(payloads, key=lambda name: name == 'manifest.json'):
            path = confined_child_path(output, name)
            path.parent.mkdir(parents=True, exist_ok=True)
            refuse_reparse_points(path.parent)
            with path.open('xb') as stream:
                stream.write(payloads[name])
            written += 1
    inputs.unchanged()
    return {'status': status, 'manifestSha256': sha256_hex_digest(payloads['manifest.json']), 'coverage': manifest['coverage'],
            'filesWritten': written, 'sourceInputsUnchanged': True,
            'files': [{'path': name, 'bytes': len(data), 'sha256': sha256_hex_digest(data)} for name, data in sorted(payloads.items())]}
