"""Selected original combat sound table rows and existing verified WAV exports.

Joins explicitly selected chargrp/npcgrp/armorgrp/weapongrp/skillsoundgrp rows
and selected ALAudio.int [CharSound]/[ItemSound]/[EtcSound] values to products
already verified by export-native-sounds.py. No sound conversion, native
lookup, slot choice, onset timing or playback policy is decided here.

Role names follow the statically proved Q4 routes (native-sound-answers-
20261107 REPORT.md Q4: AttackItem/AttackVoice/AttackShot -> GetAttackItemSound,
GetAttackVoiceSound, GetDefenseItemSound, GetDamageSound, [EtcSound]).
Decoded labels that native code reads differently are renamed explicitly via
``nativeNumeric`` (npcgrp sound_vol/sound_radius are swapped in the decoded
table; native reads radius +0xcc, volume +0xd0, random +0xd4).
"""
from __future__ import annotations

import copy
import math
import re

from native_assets_lib.animation_audio_bundle import Inputs
from native_assets_lib.footstep_config import decode_config
from native_assets_lib.gltf import json_bytes
from native_assets_lib.placement_audio import index
from native_assets_lib.skill_audio_bundle import REFERENCE, corpus_dependency, reference_candidates
from stage_native_players import checked, child, decode, digest, relative_name, require, HASH, ID

KIND = 'native-combat-audio-dependencies'
RECIPE_KIND = 'native-combat-audio-bundle'
TABLES = {'chargrp': 'Char', 'npcgrp': 'npc', 'armorgrp': 'item', 'weapongrp': 'item', 'skillsoundgrp': 'skillsound'}
SELECTION_KINDS = {'actor': ('attackItem', 'attackVoice', 'defense', 'damage'), 'armor': ('defense',),
                   'weapon': ('attackItem',), 'skill': ('cast', 'shot'), 'config': ('critical', 'soulshot')}
ADMITTED = ('exact-identity', 'unique-package-leaf-candidate')
POLICY = {'exactIdentity': 'full-object-casefold', 'groupLessCandidates': 'unique-package-leaf-candidate-admitted-as-presentation',
          'nativeLookupVerified': False, 'slotSelection': 'runtime-appRand-modulo', 'roleMapping': 'native-q4-static-routes',
          'scope': 'Pinned corpus inventory only; admitted candidates are labelled presentation dependencies, not native lookup proof.'}
TABLE_LIMIT = 64 * 1024 * 1024
CONFIG_TABLE = 'alaudio'
CONFIG_IDENT = re.compile(r'[A-Za-z_][A-Za-z_0-9]*')
CONFIG_NUMBER = re.compile(r'[+-]?[0-9]+(?:\.[0-9]+)?')


def load_table(inputs, name, spec):
    require(name in TABLES and isinstance(spec, dict) and set(spec) == {'original', 'decoded'}, 'Unsupported table pin: ' + str(name))
    original = inputs.read(spec['original'])
    table = decode(inputs.read(spec['decoded']), max_bytes=TABLE_LIMIT)
    require(table.get('schemaVersion') == 1 and table.get('edition') == 'interlude' and
            table.get('source') == 'system/' + name + '.dat' and table.get('sourceSha256') == digest(original),
            'Decoded/original table identity differs: ' + name)
    require(isinstance(table.get('decodedSha256'), str) and HASH.fullmatch(table['decodedSha256']) and
            isinstance(table.get('schema'), dict), 'Missing decoded table/reader provenance: ' + name)
    data = table.get('data')
    rows = data.get(TABLES[name]) if isinstance(data, dict) else None
    require(isinstance(rows, list) and 0 < len(rows) <= 100000 and all(isinstance(row, dict) for row in rows), 'Invalid decoded table rows: ' + name)
    require('data' not in data or data['data'] == len(rows), 'Decoded table row count differs: ' + name)
    metadata = {key: copy.deepcopy(value) for key, value in table.items() if key != 'data'}
    return rows, {'original': copy.deepcopy(spec['original']), 'decoded': copy.deepcopy(spec['decoded']),
                  'reader': metadata, 'collection': TABLES[name], 'totalRows': len(rows)}


def config_sections(decoded, wanted):
    """Exact key=value records of the wanted sections, with byte offsets.

    Only the selected sections are parsed; duplicate sections or keys and
    malformed selected lines fail closed. Values stay original strings; a
    value is also given as a number only when it is a plain decimal literal.
    """
    starts, offset = [], 0
    for raw in decoded.splitlines(keepends=True):
        stripped = raw.rstrip(b'\r\n').strip()
        if stripped.startswith(b'['):
            match = re.fullmatch(rb'\[([^\[\]\r\n]+)\]', stripped)
            require(match is not None, f'Unsupported config section header at byte {offset}')
            starts.append((offset, match.group(1)))
        offset += len(raw)
    require(isinstance(wanted, dict) and 0 < len(wanted) <= 16, 'Invalid config section selection')
    result = {}
    for section, keys in wanted.items():
        require(isinstance(section, str) and CONFIG_IDENT.fullmatch(section) is not None and isinstance(keys, list) and
                0 < len(keys) <= 32 and len(set(keys)) == len(keys) and
                all(isinstance(key, str) and CONFIG_IDENT.fullmatch(key) for key in keys),
                'Invalid config section selection: ' + str(section))
        hits = [index for index, item in enumerate(starts) if item[1].lower() == section.lower().encode('ascii')]
        require(len(hits) == 1, 'Config section missing or duplicated: ' + section)
        start = starts[hits[0]][0]
        finish = starts[hits[0] + 1][0] if hits[0] + 1 < len(starts) else len(decoded)
        records, position = {}, start
        for raw in decoded[start:finish].splitlines(keepends=True):
            begin, position = position, position + len(raw)
            text = raw.rstrip(b'\r\n')
            stripped = text.strip()
            if begin == start or not stripped or stripped.startswith(b';'): continue
            try: line = text.decode('ascii')
            except UnicodeDecodeError as error: raise ValueError('Non-ASCII selected config line') from error
            match = re.fullmatch(r'\s*([A-Za-z_][A-Za-z_0-9]*)\s*=([^\r\n]*)', line)
            require(match is not None, f'Unsupported config assignment in [{section}] at byte {begin}')
            key = match.group(1)
            require(key.casefold() not in {name.casefold() for name in records}, f'Duplicate config key [{section}] {key}')
            records[key] = {'value': match.group(2), 'payloadByteOffset': begin, 'rawLine': line}
        for key in keys:
            require(key in records, f'Selected config key is missing: [{section}] {key}')
            entry = {'section': section, 'key': key, **records[key]}
            if CONFIG_NUMBER.fullmatch(entry['value']):
                entry['number'] = float(entry['value']) if '.' in entry['value'] else int(entry['value'])
            result[section + '.' + key] = entry
    return result


def load_config(inputs, spec):
    """ALAudio.int values as one pseudo-row keyed `Section.Key` (original strings or plain numbers)."""
    require(isinstance(spec, dict) and set(spec) == {'original', 'sections'}, 'Unsupported config pin')
    decoded, decoder = decode_config(inputs.read(spec['original']))
    values = config_sections(decoded, spec['sections'])
    row = {'source': 'ALAudio.int'}
    for name, entry in values.items(): row[name] = entry.get('number', entry['value'])
    return [row], {'original': copy.deepcopy(spec['original']), 'decoder': decoder, 'collection': 'config',
                   'totalRows': 1, 'records': list(values.values())}


def lookup(document, path):
    """JSON pointer read that reports absence instead of raising."""
    require(isinstance(path, str) and path.startswith('/') and len(path) <= 256, 'Invalid row pointer')
    for part in path[1:].split('/'):
        key = part.replace('~1', '/').replace('~0', '~')
        if isinstance(document, dict) and key in document: document = document[key]
        elif isinstance(document, list) and key.isdigit() and int(key) < len(document): document = document[int(key)]
        else: return None, False
    return document, True


def conditions(value, label):
    require(isinstance(value, list) and 0 < len(value) <= 4, 'Invalid ' + label + ' condition list')
    for item in value:
        require(isinstance(item, dict) and set(item) == {'pointer', 'value'} and
                (isinstance(item['value'], str) or type(item['value']) is int), 'Invalid ' + label + ' condition')
    return value


def select_row(rows, match, name):
    found = [ordinal for ordinal, row in enumerate(rows)
             if all(lookup(row, item['pointer']) == (item['value'], True) for item in match)]
    require(len(found) == 1, f'Selected {name} row is missing or ambiguous ({len(found)} matches)')
    return found[0]


def slots(row, field, pointer_prefix):
    """Original field values in order; single-key wrapper objects keep their key."""
    if field not in row: return 'omitted', []
    value = row[field]
    if value is None or isinstance(value, str): return 'scalar', [(pointer_prefix + '/' + field, value)]
    require(isinstance(value, list) and len(value) <= 64, 'Unsupported sound field shape: ' + field)
    result = []
    for slot, item in enumerate(value):
        if item is None or isinstance(item, str):
            result.append((f'{pointer_prefix}/{field}/{slot}', item)); continue
        require(isinstance(item, dict) and len(item) == 1, 'Unsupported sound slot wrapper: ' + field)
        key, raw = next(iter(item.items()))
        require(raw is None or isinstance(raw, str), 'Unsupported sound slot value: ' + field)
        result.append((f'{pointer_prefix}/{field}/{slot}/{key}', raw))
    return 'list', result


class Resolver:
    def __init__(self, inputs, corpus_root, source_index, covered):
        self.inputs, self.corpus_root, self.source_index, self.covered = inputs, corpus_root, source_index, covered
        self.sounds, self.payloads, self.statuses, self.products = {}, {}, {}, {}

    def slot(self, ordinal, source_pointer, raw):
        status, candidates = reference_candidates(raw, self.source_index.values())
        entry = {'index': ordinal, 'sourcePointer': source_pointer, 'reference': raw, 'status': status,
                 'nativeLookupVerified': False, 'candidates': [], 'dependencyId': None}
        for item in candidates:
            key, product = item['stableId'], self.covered.get(item['stableId'])
            product_status = 'source-not-ready' if item.get('status') != 'source-ready' else 'no-coverage-record' if product is None else \
                'not-verified-export' if product.get('status') != 'exported-and-verified' else 'verified-export'
            if product_status == 'verified-export' and key not in self.sounds:
                sound, wav = corpus_dependency(self.inputs, self.corpus_root, item, product)
                require(sound['file'] not in self.payloads or self.payloads[sound['file']] == wav, 'Conflicting WAV content identity')
                self.sounds[key] = sound; self.payloads[sound['file']] = wav
            entry['candidates'].append({'stableId': key, 'object': item['export']['object'], 'productStatus': product_status,
                                        'sourcePackageSha256': item['sourcePackage']['sha256'], 'exportIndex': item['export']['exportIndex']})
            self.products[product_status] = self.products.get(product_status, 0) + 1
        if status in ADMITTED and len(entry['candidates']) == 1 and entry['candidates'][0]['productStatus'] == 'verified-export':
            entry['dependencyId'] = entry['candidates'][0]['stableId']
        self.statuses[status] = self.statuses.get(status, 0) + 1
        return entry


def numeric(row, fields):
    require(isinstance(fields, list) and len(fields) <= 32 and len(set(fields)) == len(fields), 'Invalid numeric field list')
    result = {}
    for field in fields:
        require(isinstance(field, str) and field in row, 'Selected numeric field is missing: ' + str(field))
        value = row[field]
        require(type(value) in (int, float) and math.isfinite(value), 'Nonfinite/invalid numeric field: ' + field)
        result[field] = value
    return result


def native_numeric(row, mapping, pointer_prefix):
    """Native meaning -> decoded field, for labels the decoded table names differently."""
    require(isinstance(mapping, dict) and 0 < len(mapping) <= 16, 'Invalid native numeric mapping')
    values, sources = {}, {}
    for name, field in mapping.items():
        require(isinstance(name, str) and CONFIG_IDENT.fullmatch(name) is not None and isinstance(field, str) and field in row,
                'Native numeric field is missing: ' + str(field))
        value = row[field]
        require(type(value) in (int, float) and math.isfinite(value), 'Nonfinite/invalid numeric field: ' + field)
        values[name] = value
        sources[name] = {'decodedField': field, 'sourcePointer': pointer_prefix + '/' + field}
    return values, sources


def selection_record(spec, rows, table_name, resolver):
    kind = spec.get('kind')
    require(kind in SELECTION_KINDS and isinstance(spec.get('id'), str) and ID.fullmatch(spec['id']), 'Invalid combat selection')
    allowed = {'id', 'kind', 'table', 'match', 'join', 'roles', 'numericFields', 'nativeNumeric', 'catalogId', 'sourceObject',
               'itemId', 'skillId', 'level', 'label'}
    require(set(spec) <= allowed and spec.get('table') == table_name, 'Unsupported combat selection fields: ' + spec['id'])
    require((kind == 'config') == (table_name == CONFIG_TABLE), 'Config selections must name the pinned ALAudio.int config')
    ordinal = select_row(rows, conditions(spec.get('match'), 'match'), table_name)
    row = rows[ordinal]
    for item in conditions(spec['join'], 'join') if 'join' in spec else []:
        require(lookup(row, item['pointer']) == (item['value'], True), 'Selected row does not join to its declared source: ' + spec['id'])
    roles = spec.get('roles')
    require(isinstance(roles, dict) and set(roles) <= set(SELECTION_KINDS[kind]) and roles, 'Invalid role mapping: ' + spec['id'])
    pointer = f'/data/{TABLES[table_name]}/{ordinal}' if table_name in TABLES else '/config/' + table_name
    record = {'id': spec['id'], 'kind': kind, 'table': table_name, 'rowOrdinal': ordinal,
              'sourcePointer': pointer, 'rawFieldOrder': list(row), 'raw': copy.deepcopy(row),
              'match': copy.deepcopy(spec['match']), 'roles': {}}
    if 'join' in spec: record['join'] = copy.deepcopy(spec['join'])
    for key in ('label', 'catalogId', 'sourceObject', 'itemId', 'skillId', 'level'):
        if key in spec: record[key] = copy.deepcopy(spec[key])
    if kind == 'actor':
        require(isinstance(spec.get('catalogId'), str) and spec['catalogId'] and isinstance(spec.get('sourceObject'), str) and
                REFERENCE.fullmatch(spec['sourceObject']), 'Actor selection needs catalogId/sourceObject: ' + spec['id'])
    if kind in ('armor', 'weapon'): require(type(spec.get('itemId')) is int and spec['itemId'] >= 0, 'Item selection needs itemId')
    if kind == 'skill': require(type(spec.get('skillId')) is int and type(spec.get('level')) is int, 'Skill selection needs skillId/level')
    for role, field in roles.items():
        require(isinstance(field, str) and field, 'Invalid role field: ' + role)
        shape, values = slots(row, field, record['sourcePointer'])
        record['roles'][role] = {'field': field, 'shape': shape,
                                 'slots': [resolver.slot(position, pointer_value, raw) for position, (pointer_value, raw) in enumerate(values)]}
    if 'numericFields' in spec: record['numeric'] = numeric(row, spec['numericFields'])
    if 'nativeNumeric' in spec:
        values, sources = native_numeric(row, spec['nativeNumeric'], record['sourcePointer'])
        require(not set(values) & set(record.get('numeric', {})), 'Native numeric names collide with decoded names')
        record['numeric'] = {**record.get('numeric', {}), **values}
        record['numericSource'] = sources
    return record


def prepare(root, recipe_path):
    inputs = Inputs(root); recipe_path = checked(recipe_path)
    require(recipe_path.is_relative_to(inputs.root), 'Recipe must stay within project root')
    raw = recipe_path.read_bytes()
    recipe = decode(inputs.read({'path': recipe_path.relative_to(inputs.root).as_posix(), 'sha256': digest(raw)}))
    require(recipe.get('schemaVersion') == 1 and recipe.get('kind') == RECIPE_KIND, 'Unsupported combat audio recipe')
    require(recipe.get('referencePolicy') == POLICY, 'Explicit supported combat reference policy required')
    selections, tables = recipe.get('selections'), recipe.get('tables')
    require(isinstance(selections, list) and 0 < len(selections) <= 64, 'Invalid combat selection list')
    require(isinstance(tables, dict) and set(tables) <= set(TABLES) and tables, 'Invalid table pin set')
    loaded = {name: load_table(inputs, name, spec) for name, spec in sorted(tables.items())}
    config = recipe.get('config', {})
    require(isinstance(config, dict) and set(config) <= {CONFIG_TABLE}, 'Invalid config pin set')
    if CONFIG_TABLE in config: loaded[CONFIG_TABLE] = load_config(inputs, config[CONFIG_TABLE])
    corpus = recipe['corpus']; corpus_root = relative_name(corpus['root'])
    inventory_bytes = inputs.read(corpus['inventory']); inventory = decode(inventory_bytes, max_bytes=32 * 1024 * 1024)
    coverage = decode(inputs.read(corpus['coverage']), max_bytes=32 * 1024 * 1024)
    require(inventory.get('kind') == 'native-staged-sound-inventory' and coverage.get('kind') == 'native-staged-sound-coverage' and
            coverage.get('inventorySha256') == digest(inventory_bytes), 'Corpus inventory/coverage join differs')
    source_index = index(inventory['sounds'], 'stableId', 'source sound', 100000)
    covered = index(coverage['sounds'], 'stableId', 'sound coverage', 100000)
    for item in source_index.values():
        require(isinstance(item.get('export'), dict) and isinstance(item['export'].get('object'), str) and
                REFERENCE.fullmatch(item['export']['object']) and item['export'].get('classObject') == 'Engine.Sound', 'Invalid corpus Sound identity')
    resolver, records, identities = Resolver(inputs, corpus_root, source_index, covered), [], set()
    for spec in selections:
        require(isinstance(spec, dict) and spec.get('table') in loaded, 'Selection names an unpinned table')
        require(spec.get('id') not in identities, 'Duplicate combat selection identity'); identities.add(spec.get('id'))
        records.append(selection_record(spec, loaded[spec['table']][0], spec['table'], resolver))
    actor_ids = [record['catalogId'] for record in records if record['kind'] == 'actor']
    require(len(actor_ids) == len(set(actor_ids)), 'Duplicate actor catalog selection')
    for proof in recipe.get('supportingEvidence', []): inputs.read(proof)
    inputs.unchanged()
    slot_count = sum(len(role['slots']) for record in records for role in record['roles'].values())
    admitted = sum(1 for record in records for role in record['roles'].values() for slot in role['slots'] if slot['dependencyId'])
    counts = {'selections': len(records), 'slots': slot_count, 'admittedSlots': admitted,
              'slotStatuses': dict(sorted(resolver.statuses.items())), 'candidateProductStatuses': dict(sorted(resolver.products.items())),
              'dependencies': len(resolver.sounds), 'wavFiles': len(resolver.payloads)}
    if 'expectedCoverage' in recipe: require(counts == recipe['expectedCoverage'], 'Selected coverage differs from recipe: ' + json_bytes(counts).decode())
    manifest = {'schemaVersion': 1, 'kind': KIND,
        'tables': {name: value[1] for name, value in loaded.items() if name != CONFIG_TABLE},
        **({'config': {CONFIG_TABLE: loaded[CONFIG_TABLE][1]}} if CONFIG_TABLE in loaded else {}),
        'inputs': [{k: v for k, v in record.items() if k != 'mtimeNs'} for record in inputs.records.values()],
        'referencePolicy': copy.deepcopy(POLICY), 'selections': records,
        'sounds': sorted(resolver.sounds.values(), key=lambda sound: sound['dependencyId']), 'coverage': counts,
        'runtime': {'nativeLookupVerified': False, 'nativeRoutes': 'static-disassembly (native-sound-answers-20261107 REPORT.md Q4)',
                    'nativeSlotSelectionVerified': False,
                    'timing': 'not-inferred; browser uses source AttackItem/AttackShot/AttackVoice notify times',
                    'gainRadiusRandomSpatialPolicy': 'native numbers carried (npcgrp floats by native offset, ALAudio.int sections); '
                                                     'output attenuation unproved'},
        'limits': ['Original table names, fields, global ordinals and full raw rows are retained; empty strings stay empty and are never defaulted.',
                   'Role names follow the statically proved Q4 routes; npcgrp sound_vol/sound_radius decoded labels are swapped and are exposed only through nativeNumeric (soundRadius/soundVolume/soundRandom).',
                   'Group-less table strings admit only a unique package-plus-leaf candidate; that is not native name resolution.',
                   'Existing original WAV bytes are copied unchanged. No re-export, resampling, downmixing or decode is performed.',
                   'No onset, slot choice, probability, gain, attenuation or gameplay hit rule is decided by this dependency package.']}
    payloads = dict(resolver.payloads)
    payloads['manifest.json'] = json_bytes(manifest)
    return manifest, payloads, inputs


def run(root, recipe_path, output, *, plan=False, verify_only=False):
    require(not (plan and verify_only), 'Plan and verify-only are mutually exclusive')
    manifest, payloads, inputs = prepare(root, recipe_path); output = checked(output)
    require(any(output != inputs.root / name and output.is_relative_to(inputs.root / name)
                for name in ('artifacts', 'scratch', '.scratch')), 'Output must be a named artifacts/scratch subdirectory')
    for name in inputs.records:
        source = child(inputs.root, name)
        require(not source.is_relative_to(output) and not output.is_relative_to(source.parent), 'Output overlaps an input or retained directory')
    exists = output.exists()
    if exists:
        require(output.is_dir(), 'Output is not a directory'); actual = set()
        for path in output.rglob('*'):
            checked(path)
            if path.is_file(): actual.add(path.relative_to(output).as_posix())
        require(actual == set(payloads), 'Existing output file set differs; preserved')
        for name, data in payloads.items():
            require(child(output, name).read_bytes() == data, 'Existing immutable output differs; preserved: ' + name)
    require(not verify_only or exists, 'Verify-only requires a complete existing output')
    status = 'planned' if plan else 'verified' if verify_only else 'preserved' if exists else 'produced'; written = 0
    if status == 'produced':
        output.mkdir(parents=True, exist_ok=False)
        for name in sorted(payloads, key=lambda name: name == 'manifest.json'):
            path = child(output, name); path.parent.mkdir(parents=True, exist_ok=True); checked(path.parent)
            with path.open('xb') as stream: stream.write(payloads[name])
            written += 1
    inputs.unchanged()
    return {'status': status, 'manifestSha256': digest(payloads['manifest.json']), 'coverage': manifest['coverage'],
            'filesWritten': written, 'sourceInputsUnchanged': True,
            'files': [{'path': name, 'bytes': len(data), 'sha256': digest(data)} for name, data in sorted(payloads.items())]}
