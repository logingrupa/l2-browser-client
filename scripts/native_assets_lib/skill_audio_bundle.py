from __future__ import annotations

import copy
import math
import re

from native_assets_lib.guard_clauses import require_condition
from native_assets_lib.sha256_identity import SHA256_HEX_PATTERN, sha256_hex_digest
from native_assets_lib.strict_json import decode_strict_json
from native_assets_lib.animation_audio_bundle import Inputs, dependency
from native_assets_lib.gltf import json_bytes
from native_assets_lib.placement_audio import index
from native_store.store_paths import confined_child_path, refuse_reparse_points, require_portable_relative_path

KIND = 'native-skill-audio-dependencies'
GROUPS = ('spelleffect', 'shoteffect', 'expeffect')
CAST_VOICES = ('mfighter_cast', 'ffighter_cast', 'mdarkelf_cast', 'fdarkelf_cast', 'mdwarf_cast', 'fdwarf_cast',
               'melf_cast', 'felf_cast', 'mmagic_cast', 'fmagic_cast', 'morc_cast', 'forc_cast',
               'mshaman_sub', 'fshaman_sub', 'RESERVED_sub_')
THROW_VOICES = ('mfighter_magic', 'ffighter_magic', 'mdarkelf_magic', 'fdarkelf_magic', 'mdwarf_magic', 'fdwarf_magic',
                'melf_magic', 'felf_magic', 'mmagic_throw', 'fmagic_throw', 'morc_magic', 'forc_magic',
                'mshaman_magic', 'fshaman_magic', 'RESERVED_throw_?')
REFERENCE_FIELDS = tuple(f'{group}_sound_{slot}' for group in GROUPS for slot in range(1, 4)) + CAST_VOICES + THROW_VOICES
NUMERIC_FIELDS = tuple(f'{group}_sound_{kind}_{slot}' for group in GROUPS for slot in range(1, 4) for kind in ('vol', 'rad')) + ('cast_volume', 'cast_rad')
REFERENCE = re.compile(r'[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+')
POLICY = {'exactIdentity': 'full-object-casefold', 'groupLessCandidates': 'package-leaf-candidate-only',
          'nativeLookupVerified': False, 'automaticCandidateSelection': False,
          'scope': 'Pinned corpus inventory only; candidates are dependencies, not executable bindings.'}


def identity(row):
    require_condition(isinstance(row, dict), 'Invalid raw table row')
    values = row.get('skill_id'), row.get('skill_level')
    require_condition(all(type(v) is int and 0 <= v <= 0xffffffff for v in values), 'Invalid original skill/level identity')
    return values


def load_table(inputs, spec, name, collection):
    original = inputs.read(spec['original'])
    table = decode_strict_json(inputs.read(spec['decoded']), max_bytes=64 * 1024 * 1024)
    require_condition(table.get('schemaVersion') == 1 and table.get('edition') == 'interlude' and
            table.get('source') == 'system/' + name + '.dat' and table.get('sourceSha256') == sha256_hex_digest(original),
            'Decoded/original table identity differs: ' + name)
    require_condition(isinstance(table.get('decodedSha256'), str) and SHA256_HEX_PATTERN.fullmatch(table['decodedSha256']) and
            isinstance(table.get('schema'), dict) and isinstance(table.get('formatDefinitionPins'), dict),
            'Missing decoded table/reader provenance: ' + name)
    rows = table.get('data', {}).get(collection)
    require_condition(isinstance(rows, list) and len(rows) <= 100000 and table['data'].get('data') == len(rows), 'Invalid complete table row count')
    for row in rows: identity(row)
    metadata = {key: copy.deepcopy(value) for key, value in table.items() if key != 'data'}
    return rows, {'original': copy.deepcopy(spec['original']), 'decoded': copy.deepcopy(spec['decoded']),
                  'reader': metadata, 'totalRows': len(rows)}


def reference_candidates(value, source_rows):
    if value is None: return 'null', []
    require_condition(isinstance(value, str), 'Sound reference must be a string or explicit null')
    if value == '': return 'empty', []
    if not REFERENCE.fullmatch(value): return 'unsupported-reference', []
    exact = [row for row in source_rows if row['export']['object'].casefold() == value.casefold()]
    if exact:
        return ('exact-identity' if len(exact) == 1 else 'ambiguous-exact-identity'), exact
    parts = value.split('.')
    if len(parts) != 2: return 'no-exact-identity-in-inventory', []
    candidates = [row for row in source_rows if row['export']['object'].split('.')[0].casefold() == parts[0].casefold()
                  and row['export']['object'].rsplit('.', 1)[-1].casefold() == parts[1].casefold()]
    return ('unique-package-leaf-candidate' if len(candidates) == 1 else 'ambiguous-package-leaf-candidates' if candidates else 'no-package-leaf-candidate-in-inventory'), candidates


def corpus_dependency(inputs, corpus_root, item, covered):
    exported, package = item['export'], item['sourcePackage']
    require_condition(item.get('status') == 'source-ready' and covered.get('status') == 'exported-and-verified' and
            item['stableId'] == covered['stableId'] and exported['classObject'] == 'Engine.Sound', 'Unverified candidate source/export')
    archive, audio = covered['products']['archive'], covered['products']['audio']
    source_object = exported['object']
    proof = {'authoredReference': source_object, 'sourceObject': source_object,
             'sourcePackageSha256': package['sha256'], 'exportIndex': exported['exportIndex'],
             'payload': {key: item['nativePayload'][key] for key in ('bytes', 'sha256')},
             'existingExport': {'archivePath': corpus_root + '/' + require_portable_relative_path(archive['path']), 'archiveSha256': archive['sha256'],
                 'id': item['id'], 'sourceObject': source_object, 'sourcePackageSha256': package['sha256'],
                 'nativeExportIndex': exported['exportIndex'], 'stableId': item['stableId'],
                 'wavPath': corpus_root + '/' + require_portable_relative_path(audio['path']), 'wavSha256': audio['sha256'], 'wavBytes': audio['bytes']}}
    sound, wav = dependency(inputs, proof)
    sound['provenance'] = {'kind': 'retained-uax-candidate-export-identity',
        'candidateIdentityReference': source_object,
        **{key: value for key, value in sound['provenance'].items() if key != 'authoredReference'}}
    source = item['nativePayload']
    original = inputs.read({**source, 'path': corpus_root + '/' + require_portable_relative_path(source['path'])})
    require_condition(original == wav and item['nativeSound']['embeddedPayloadSha256'] == sha256_hex_digest(wav) and
            item['nativeSound']['exportIndex'] == exported['exportIndex'], 'Candidate native payload differs')
    sound['source'].update(package=copy.deepcopy(package), serializedExport=copy.deepcopy(item['serializedExport']), nativeSound=copy.deepcopy(item['nativeSound']))
    sound['role'] = 'candidate-dependency-only'
    sound['nativeLookupVerified'] = False
    return sound, wav


def prepare(root, recipe_path):
    inputs = Inputs(root); recipe_path = refuse_reparse_points(recipe_path)
    require_condition(recipe_path.is_relative_to(inputs.root), 'Recipe must stay within project root')
    raw = recipe_path.read_bytes()
    recipe = decode_strict_json(inputs.read({'path': recipe_path.relative_to(inputs.root).as_posix(), 'sha256': sha256_hex_digest(raw)}))
    require_condition(recipe.get('schemaVersion') == 1 and recipe.get('kind') == 'native-skill-audio-bundle', 'Unsupported skill audio recipe')
    require_condition(recipe.get('referencePolicy') == POLICY, 'Explicit supported candidate-only policy required')
    selections = recipe.get('selections')
    require_condition(isinstance(selections, list) and 0 < len(selections) <= 512, 'Invalid selected skill/level list')
    selected = []
    for row in selections:
        require_condition(isinstance(row, dict) and set(row) == {'skillId', 'level'}, 'Only explicit skillId/level selections are supported')
        value = identity({'skill_id': row['skillId'], 'skill_level': row['level']})
        require_condition(value not in selected, 'Duplicate recipe selection'); selected.append(value)
    skill_rows, skill_table = load_table(inputs, recipe['tables']['skillgrp'], 'skillgrp', 'skill')
    sound_rows, sound_table = load_table(inputs, recipe['tables']['skillsoundgrp'], 'skillsoundgrp', 'skillsound')
    corpus = recipe['corpus']; corpus_root = require_portable_relative_path(corpus['root'])
    inventory_bytes = inputs.read(corpus['inventory']); inventory = decode_strict_json(inventory_bytes, max_bytes=32 * 1024 * 1024)
    coverage = decode_strict_json(inputs.read(corpus['coverage']), max_bytes=32 * 1024 * 1024)
    require_condition(inventory.get('kind') == 'native-staged-sound-inventory' and coverage.get('kind') == 'native-staged-sound-coverage' and
            coverage.get('inventorySha256') == sha256_hex_digest(inventory_bytes), 'Corpus inventory/coverage join differs')
    source_index = index(inventory['sounds'], 'stableId', 'source sound', 100000)
    covered = index(coverage['sounds'], 'stableId', 'sound coverage', 100000)
    for item in source_index.values():
        require_condition(isinstance(item.get('export'), dict) and isinstance(item['export'].get('object'), str) and
                REFERENCE.fullmatch(item['export']['object']) and item['export'].get('classObject') == 'Engine.Sound', 'Invalid corpus Sound identity')
    raw_skills, raw_sounds, sounds, payloads = [], [], {}, {}
    selected_set = set(selected)
    for ordinal, row in enumerate(skill_rows):
        if identity(row) in selected_set:
            raw_skills.append({'globalRowOrdinal': ordinal, 'manifestPointer': f'/data/skill/{ordinal}', 'rawFieldOrder': list(row), 'raw': copy.deepcopy(row)})
    statuses = {}; product_statuses = {}; total_candidates = 0
    for ordinal, row in enumerate(sound_rows):
        if identity(row) not in selected_set: continue
        for field in NUMERIC_FIELDS:
            value = row.get(field)
            require_condition(field not in row or value is None or type(value) in (int, float) and math.isfinite(value), 'Nonfinite/invalid authored numeric field')
        fields = []
        for field in REFERENCE_FIELDS:
            if field not in row: status, candidates = 'omitted', []
            else: status, candidates = reference_candidates(row[field], source_index.values())
            entry = {'field': field, 'present': field in row, 'status': status, 'nativeLookupVerified': False,
                     'candidateScope': 'pinned-corpus-inventory', 'candidates': []}
            if field in row: entry['rawReference'] = row[field]
            for item in candidates:
                key = item['stableId']; product = covered.get(key)
                product_status = 'source-not-ready' if item.get('status') != 'source-ready' else 'no-coverage-record' if product is None else \
                    'not-verified-export' if product.get('status') != 'exported-and-verified' else 'verified-export'
                if product_status == 'verified-export' and key not in sounds:
                    sound, wav = corpus_dependency(inputs, corpus_root, item, covered[key]); sounds[key] = sound
                    require_condition(sound['file'] not in payloads or payloads[sound['file']] == wav, 'Conflicting WAV content identity')
                    payloads[sound['file']] = wav
                entry['candidates'].append({'stableId': key, 'dependencyId': key if product_status == 'verified-export' else None,
                    'productStatus': product_status, 'object': item['export']['object'],
                    'sourcePackageSha256': item['sourcePackage']['sha256'], 'exportIndex': item['export']['exportIndex']})
                product_statuses[product_status] = product_statuses.get(product_status, 0) + 1
            total_candidates += len(candidates); statuses[status] = statuses.get(status, 0) + 1
            fields.append(entry)
        raw_sounds.append({'globalRowOrdinal': ordinal, 'manifestPointer': f'/data/skillsound/{ordinal}',
                           'rawFieldOrder': list(row), 'raw': copy.deepcopy(row), 'referenceFields': fields})
    selection_receipts = []
    for skill_id, level in selected:
        a = [r['globalRowOrdinal'] for r in raw_skills if identity(r['raw']) == (skill_id, level)]
        b = [r['globalRowOrdinal'] for r in raw_sounds if identity(r['raw']) == (skill_id, level)]
        selection_receipts.append({'skillId': skill_id, 'level': level, 'skillRowOrdinals': a, 'soundRowOrdinals': b,
            'skillStatus': 'missing-exact-row' if not a else 'duplicate-rows-retained' if len(a)>1 else 'one-exact-row',
            'soundStatus': 'missing-exact-row' if not b else 'duplicate-rows-retained' if len(b)>1 else 'one-exact-row'})
    for proof in recipe.get('supportingEvidence', []): inputs.read(proof)
    inputs.unchanged()
    counts = {'selections': len(selected), 'skillRows': len(raw_skills), 'soundRows': len(raw_sounds),
              'referenceFields': len(raw_sounds) * len(REFERENCE_FIELDS), 'fieldStatuses': statuses,
              'candidateOccurrences': total_candidates, 'candidateProductStatuses': product_statuses,
              'dependencies': len(sounds), 'wavFiles': len(payloads)}
    if 'expectedCoverage' in recipe: require_condition(counts == recipe['expectedCoverage'], 'Selected coverage differs from recipe')
    manifest = {'schemaVersion': 1, 'kind': KIND, 'tables': {'skillgrp': skill_table, 'skillsoundgrp': sound_table},
        'inputs': [{k:v for k,v in record.items() if k != 'mtimeNs'} for record in inputs.records.values()],
        'referencePolicy': copy.deepcopy(POLICY), 'selections': selection_receipts, 'skillRows': raw_skills, 'soundRows': raw_sounds,
        'sounds': list(sounds.values()), 'coverage': counts,
        'runtime': {'connected': False, 'nativeLookupVerified': False, 'nativeDispatchVerified': False, 'timing': 'not-inferred',
                    'gainRadiusRandomSpatialPolicy': 'not-inferred'},
        'limits': ['Original table names/fields/global ordinals retained, including duplicate/empty/null/omitted rows and fields; no precedence or absent-level fallback.',
                   'All three groups of three sound slots and both fifteen-slot voice sets retained without assigning native stage roles.',
                   'Casefold matching indexes identities only; raw strings remain unchanged. Package-leaf candidates are not native lookup proof.',
                   'Existing original WAV bytes are copied. No sound re-export, resampling, downmixing or decode is performed.',
                   'This dependency package does not choose sound onset, animation, effects, random selection, gain, attenuation or gameplay.']}
    payloads['manifest.json'] = json_bytes(manifest)
    return manifest, payloads, inputs


def run(root, recipe_path, output, *, plan=False, verify_only=False):
    require_condition(not (plan and verify_only), 'Plan and verify-only are mutually exclusive')
    manifest, payloads, inputs = prepare(root, recipe_path); output = refuse_reparse_points(output)
    require_condition(any(output != inputs.root / name and output.is_relative_to(inputs.root / name)
                for name in ('artifacts', 'scratch', '.scratch')), 'Output must be a named artifacts/scratch subdirectory')
    for name in inputs.records:
        source = confined_child_path(inputs.root, name)
        require_condition(not source.is_relative_to(output) and not output.is_relative_to(source.parent), 'Output overlaps an input or retained directory')
    exists = output.exists()
    if exists:
        require_condition(output.is_dir(), 'Output is not a directory'); actual = set()
        for path in output.rglob('*'):
            refuse_reparse_points(path)
            if path.is_file(): actual.add(path.relative_to(output).as_posix())
        require_condition(actual == set(payloads), 'Existing output file set differs; preserved')
        for name, data in payloads.items():
            require_condition(confined_child_path(output, name).read_bytes() == data, 'Existing immutable output differs; preserved: ' + name)
    require_condition(not verify_only or exists, 'Verify-only requires a complete existing output')
    status = 'planned' if plan else 'verified' if verify_only else 'preserved' if exists else 'produced'; written = 0
    if status == 'produced':
        output.mkdir(parents=True, exist_ok=False)
        for name in sorted(payloads, key=lambda name: name == 'manifest.json'):
            path = confined_child_path(output, name); path.parent.mkdir(parents=True, exist_ok=True); refuse_reparse_points(path.parent)
            with path.open('xb') as stream: stream.write(payloads[name])
            written += 1
    inputs.unchanged()
    return {'status': status, 'manifestSha256': sha256_hex_digest(payloads['manifest.json']), 'coverage': manifest['coverage'],
            'filesWritten': written, 'sourceInputsUnchanged': True,
            'files': [{'path': name, 'bytes': len(data), 'sha256': sha256_hex_digest(data)} for name, data in sorted(payloads.items())]}
