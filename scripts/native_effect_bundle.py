#!/usr/bin/env python3
"""Repeatable raw native effects with table or reviewed binary dispatch evidence.

Pinned switch and class-literal checks establish bounded source associations;
they do not execute native dispatch or certify timing, attachment or playback.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import sys
import zipfile

from native_assets import Converter, UMODEL, UMODEL_SHA256, implementation_hash, verify_archive
from native_assets_lib.gltf import safe_name
from native_catalog.cli import file_hash, json_bytes, safe_output, within, write_output
from native_catalog.effects import (SourcePackages, UELIB, UELIB_SHA256, POWERSHELL,
    read_class_defaults, references, skill_actions, tagged_values)
from native_catalog.tables import (decode_table, SCHEMA_ROOT, SCHEMA_HASHES,
    CRYPTO_SOURCE, CRYPTO_HASH, checked_bytes)
from native_catalog.ue2 import FormatError

SCHEMA_VERSION = 1
MAX_CLASSES = 96
MAX_DEPENDENCIES = 1024
OWNER_FILE = '.native-effect-bundle-owner.json'
MATERIAL_CLASSES = {'Texture', 'Shader', 'FinalBlend', 'TexPanner', 'TexRotator',
    'TexOscillator', 'TexScaler', 'TexEnvMap', 'Combiner', 'ColorModifier',
    'ConstantColor', 'FadeColor', 'MaterialSwitch', 'MaterialSequence', 'TexCoordSource'}
ASSET_KINDS = {'StaticMesh': 'model', 'SkeletalMesh': 'model', 'Texture': 'texture', 'Sound': 'audio'}


def digest(value):
    return hashlib.sha256(json_bytes(value)).hexdigest()


def merge_properties(base, override):
    """Merge typed defaults while keeping undecoded native values opaque.

    A raw property replaces the entire inherited value. Combining its bytes
    with inherited struct components would falsely imply decoded components.
    """
    result = copy.deepcopy(base)
    for key, value in override.items():
        previous = result.get(key)
        if (isinstance(value, dict) and isinstance(previous, dict)
                and 'object' not in value
                and 'unparsedHex' not in value and 'unparsedHex' not in previous):
            result[key] = merge_properties(previous, value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def _tool_paths():
    return (Path(os.environ.get('L2_UMODEL', str(UMODEL))),
        Path(os.environ.get('L2_UELIB', str(UELIB))),
        Path(os.environ.get('L2_POWERSHELL', str(POWERSHELL))))


def _tool_pins():
    umodel, library, powershell = _tool_paths()
    if file_hash(umodel) != UMODEL_SHA256 or file_hash(library) != UELIB_SHA256:
        raise FormatError('Effect migration requires the pinned UModel and UELib builds')
    definitions = {'crypto': hashlib.sha256(checked_bytes(CRYPTO_SOURCE, CRYPTO_HASH)).hexdigest()}
    for name in ('06_interlude.xml', 'dats/skillgrp.xml', 'dats/skillsoundgrp.xml'):
        definitions[name] = hashlib.sha256(checked_bytes(SCHEMA_ROOT / name, SCHEMA_HASHES[name])).hexdigest()
    return {'effectBundleSha256': file_hash(Path(__file__)), 'converterSha256': implementation_hash(),
        'umodelSha256': UMODEL_SHA256, 'uelibSha256': UELIB_SHA256,
        'powershellSha256': file_hash(powershell), 'formatDefinitions': definitions,
        'pythonVersion': '.'.join(map(str, sys.version_info[:3]))}


def _recipe(value):
    if not isinstance(value, dict) or value.get('schemaVersion') != SCHEMA_VERSION:
        raise FormatError('Effect recipe requires schemaVersion 1')
    allowed = {'schemaVersion', 'id', 'skillId', 'level', 'effectClasses', 'source', 'notes', 'sourceDispatch'}
    if set(value) - allowed:
        raise FormatError('Unknown effect recipe fields: ' + ', '.join(sorted(set(value) - allowed)))
    if not isinstance(value.get('id'), str) or not value['id']:
        raise FormatError('Effect recipe requires a stable id')
    for key in ('skillId', 'level'):
        if type(value.get(key)) is not int or value[key] < 1:
            raise FormatError('Effect recipe requires a positive integer ' + key)
    candidates = value.get('effectClasses', [])
    if not isinstance(candidates, list) or len(candidates) > 32:
        raise FormatError('effectClasses must be an array of at most 32 pinned candidates')
    seen = set()
    for item in candidates:
        if not isinstance(item, dict) or set(item) != {'object', 'packageSha256'}:
            raise FormatError('Each candidate requires only object and packageSha256')
        if not isinstance(item['object'], str) or not re.fullmatch(r'\w+(?:\.\w+)+', item['object']):
            raise FormatError('Candidate must be a qualified native class identity')
        if not isinstance(item['packageSha256'], str) or not re.fullmatch(r'[0-9a-f]{64}', item['packageSha256']):
            raise FormatError('Candidate requires a lowercase SHA-256 source package pin')
        if item['object'].casefold() in seen:
            raise FormatError('Duplicate effect-class candidate')
        seen.add(item['object'].casefold())
    if 'sourceDispatch' in value:
        _dispatch_recipe(value['sourceDispatch'], seen)
    # Canonical JSON also rejects NaN and unsupported recipe data before writes.
    return json.loads(json_bytes(value))


def _dispatch_recipe(dispatch, effects):
    """Keep reviewed observations separate from the machine-checked binding."""
    fields = {'binary', 'bindings', 'reviewedObservations', 'evidence', 'limitations'}
    if not isinstance(dispatch, dict) or set(dispatch) != fields:
        raise FormatError('sourceDispatch requires binary, bindings, reviewedObservations, evidence and limitations')
    binary = dispatch['binary']
    if (not isinstance(binary, dict) or set(binary) != {'path', 'bytes', 'sha256'}
            or not isinstance(binary['path'], str) or not binary['path'].lower().endswith('.dll')
            or type(binary['bytes']) is not int or binary['bytes'] < 1
            or not isinstance(binary['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', binary['sha256'])):
        raise FormatError('Dispatch binary requires a source-relative DLL path, size and SHA-256')
    safe_name(binary['path'])
    if (not isinstance(dispatch['reviewedObservations'], dict)
            or any(not isinstance(dispatch[key], list) or not dispatch[key]
                or any(not isinstance(item, str) or not item for item in dispatch[key])
                for key in ('evidence', 'limitations'))):
        raise FormatError('Dispatch observations require explicit evidence and limitations')
    bindings = dispatch['bindings']
    if not isinstance(bindings, list) or not 1 <= len(bindings) <= 32:
        raise FormatError('Dispatch requires 1 to 32 reviewed bindings')
    addresses = {'switchVA', 'selectorBase', 'targetTable', 'caseVA', 'classPushVA', 'classLiteralVA'}
    fields = addresses | {'stage', 'effectObject', 'caseIndex', 'nativeSuperClass',
        'authoredPropertiesSha256', 'emittersSha256'}
    stages = set()
    for binding in bindings:
        if not isinstance(binding, dict) or set(binding) != fields:
            raise FormatError('Dispatch binding has missing or unknown fields')
        if (not isinstance(binding['stage'], str) or binding['stage'] not in ('init', 'preshot', 'shot', 'explosion')
                or binding['stage'] in stages):
            raise FormatError('Dispatch stage must be known and unique')
        stages.add(binding['stage'])
        if not isinstance(binding['effectObject'], str) or binding['effectObject'].casefold() not in effects:
            raise FormatError('Dispatch binding must name an explicitly pinned effect class')
        if type(binding['caseIndex']) is not int or not 0 <= binding['caseIndex'] <= 255:
            raise FormatError('Dispatch caseIndex must fit the native byte selector')
        if any(not isinstance(binding[key], str) or not re.fullmatch('0x[0-9a-f]{8}', binding[key]) for key in addresses):
            raise FormatError('Dispatch addresses must be lowercase 32-bit hexadecimal VAs')
        if (not isinstance(binding['nativeSuperClass'], str)
                or not re.fullmatch(r'\w+(?:\.\w+)+', binding['nativeSuperClass'])
                or any(not isinstance(binding[key], str) or not re.fullmatch('[0-9a-f]{64}', binding[key])
                    for key in ('authoredPropertiesSha256', 'emittersSha256'))):
            raise FormatError('Dispatch binding requires superclass and authored-default pins')


def _pe32_reader(data):
    """Read only file-backed PE32 sections; never load or execute a DLL."""
    try:
        pe = struct.unpack_from('<I', data, 0x3c)[0]
        machine, sections = struct.unpack_from('<HH', data, pe + 4)
        optional_size = struct.unpack_from('<H', data, pe + 20)[0]
        optional = pe + 24
        if (data[:2] != b'MZ' or data[pe:pe + 4] != b'PE\0\0' or machine != 0x14c
                or struct.unpack_from('<H', data, optional)[0] != 0x10b
                or optional_size < 96 or not 1 <= sections <= 96):
            raise FormatError('Dispatch binary must be an x86 PE32 image')
        base = struct.unpack_from('<I', data, optional + 28)[0]
        ranges = []
        for index in range(sections):
            _, rva, size, offset = struct.unpack_from('<IIII', data, optional + optional_size + index * 40 + 8)
            if offset + size > len(data):
                raise FormatError('Dispatch PE section exceeds source file')
            ranges.append((base + rva, offset, size))
    except struct.error as error:
        raise FormatError('Truncated dispatch PE32 image') from error

    def read(va, size):
        matches = [(offset + va - address) for address, offset, length in ranges
            if address <= va and va + size <= address + length]
        if len(matches) != 1:
            raise FormatError('Dispatch address is not uniquely file-backed: ' + hex(va))
        return data[matches[0]:matches[0] + size]
    return read


def validate_source_dispatch(client, recipe):
    dispatch = recipe.get('sourceDispatch')
    if dispatch is None:
        return None
    _dispatch_recipe(dispatch, {item['object'].casefold() for item in recipe['effectClasses']})
    _check_sources(client, [dispatch['binary']])
    data = within(client, safe_name(dispatch['binary']['path'])).read_bytes()
    if hashlib.sha256(data).hexdigest() != dispatch['binary']['sha256']:
        raise FormatError('Dispatch binary changed while reading')
    read, checks = _pe32_reader(data), []
    for binding in dispatch['bindings']:
        addresses = {key: int(binding[key], 16) for key in
            ('switchVA', 'selectorBase', 'targetTable', 'caseVA', 'classPushVA', 'classLiteralVA')}
        expected = [
            ('switch', addresses['switchVA'], b'\x0f\xb6\x80' + struct.pack('<I', addresses['selectorBase'])
                + b'\xff\x24\x85' + struct.pack('<I', addresses['targetTable'])),
            ('skill-selector', addresses['selectorBase'] + recipe['skillId'] - 1, bytes([binding['caseIndex']])),
            ('case-target', addresses['targetTable'] + binding['caseIndex'] * 4, struct.pack('<I', addresses['caseVA'])),
            ('class-push', addresses['classPushVA'], b'\x68' + struct.pack('<I', addresses['classLiteralVA'])),
            ('class-literal', addresses['classLiteralVA'], (binding['effectObject'] + '\0').encode('utf-16-le')),
        ]
        for label, address, wanted in expected:
            actual = read(address, len(wanted))
            if actual != wanted:
                raise FormatError('Reviewed native dispatch check failed: ' + binding['stage'] + '/' + label)
            checks.append({'stage': binding['stage'], 'check': label, 'va': hex(address), 'hex': actual.hex()})
    return {**copy.deepcopy(dispatch), 'checks': checks,
        'validationScope': 'Pinned binary, reviewed switch selectors/targets, class literals and authored defaults only; observations are retained review metadata, not executed behavior.'}


def validate_dispatch_defaults(dispatch, effects):
    if dispatch is None:
        return
    indexed = {effect['object'].casefold(): effect for effect in effects}
    for binding in dispatch['bindings']:
        effect = indexed[binding['effectObject'].casefold()]
        emitters = [{key: child[key] for key in ('name', 'class', 'properties')} for child in effect['children']]
        if (effect['nativeSuperClass'].casefold() != binding['nativeSuperClass'].casefold()
                or digest(effect['properties']) != binding['authoredPropertiesSha256']
                or digest(emitters) != binding['emittersSha256']):
            raise FormatError('Dispatch class authored defaults differ from reviewed source: ' + effect['object'])


def select_rows(skill_table, sound_table, skill_id, level):
    """Empty native descriptions are valid data, not an excuse to guess a join."""
    result = []
    for table, key in ((skill_table, 'skill'), (sound_table, 'skillsound')):
        rows = [row for row in table['data'][key]
            if row['skill_id'] == skill_id and row['skill_level'] == level]
        if len(rows) != 1:
            raise FormatError('Exact native skill/level and sound rows must each be unique')
        result.append(copy.deepcopy(rows[0]))
    return tuple(result)


def select_effect_roots(packages, recipe, skill, dispatch=None):
    """Associate only table actions or separately checked reviewed binary bindings."""
    root, stages, other, verified = None, [], [], {}
    description = skill.get('description')
    if description:
        if not isinstance(description, str) or '.' not in description:
            raise FormatError('Nonempty skill description is not a qualified visual-effect reference')
        root, package, item = packages.resolve(description, 'SkillVisualEffect')
        stages, other = skill_actions(package, item)
        for stage in stages:
            value = stage['properties'].get('EffectClass')
            if not isinstance(value, dict) or not value.get('object'):
                raise FormatError('Native skill action lacks an explicit effect-class reference')
            record, _, _ = packages.resolve(value['object'], 'Class')
            verified[record['object'].casefold()] = record
            stage['effectObject'] = record['object']
    records = dict(verified)
    for candidate in recipe.get('effectClasses', []):
        record, _, _ = packages.resolve(candidate['object'], 'Class')
        if record['packageSha256'] != candidate['packageSha256']:
            raise FormatError('Candidate source package differs from recipe pin: ' + candidate['object'])
        records[record['object'].casefold()] = record
    if not records:
        raise FormatError('No effect class: empty native description needs an explicit pinned candidate recipe')
    associations = []
    for key in sorted(records):
        bindings = [item for item in dispatch['bindings'] if item['effectObject'].casefold() == key] if dispatch else []
        association = {'effectObject': records[key]['object'],
            'status': 'verified-native-description-action' if key in verified else 'candidate-unverified',
            'evidence': 'skillgrp.description -> SkillVisualEffect action -> EffectClass' if key in verified
                else 'Explicit recipe class; native skill dispatch and visual equivalence are unverified'}
        if bindings:
            association.update(status='verified-reviewed-native-dispatch',
                dispatchStages=[item['stage'] for item in bindings],
                evidence='Pinned native binary and reviewed switch/class-literal checks; live behavior remains unverified')
        associations.append(association)
    return root, stages, other, [records[key] for key in sorted(records)], associations


class DefaultReader:
    """Resolve inheritance using package superIndex, not guessed class packages."""
    def __init__(self, client, packages, work, save):
        self.client, self.packages, self.work, self.save = client, packages, work, save
        self.definitions = {}
        self.library, self.powershell = _tool_paths()[1:]

    def get(self, reference, trail=()):
        record, package, item = self.packages.resolve(reference, 'Class')
        key = record['object'].casefold()
        if key in trail:
            raise FormatError('Cyclic native class inheritance: ' + record['object'])
        if key in self.definitions:
            return self.definitions[key]
        if len(self.definitions) + len(trail) >= MAX_CLASSES:
            raise FormatError('Native class inheritance/dependency limit exceeded')
        class_work = self.work / 'classes' / hashlib.sha256(key.encode()).hexdigest()[:20]
        definition = read_class_defaults(self.client, record['object'], class_work,
            library=self.library, powershell=self.powershell)
        parent = package.object_name(item['superIndex'])
        declared = definition['superClass']
        if bool(parent) != bool(declared) or (parent and parent.rsplit('.', 1)[-1].casefold() != declared.rsplit('.', 1)[-1].casefold()):
            raise FormatError('Decompiled superclass differs from native export table: ' + record['object'])
        base = self.get(parent, trail + (key,))['effectiveProperties'] if parent else {}
        definition['nativeSuperClass'] = parent
        definition['effectiveProperties'] = merge_properties(base, definition['properties'])
        name = record['object']
        if not re.fullmatch(r'\w+(?:\.\w+)+', name):
            raise FormatError('Unsafe native class identity')
        script = class_work / definition['sourceScript']
        definition['sourceScript'] = self.save('source/classes/' + name + '.uc', script.read_bytes())
        definition['rawExport'] = self.save('source/classes/' + name + '.bin',
            package.data[item['offset']:item['offset'] + item['size']])
        self.definitions[key] = definition
        return definition


def _object_references(tags):
    for tag in tags:
        if tag['type'] in (5, 8) and isinstance(tag.get('value'), dict) and tag['value'].get('object'):
            yield tag['name'] + (f'[{tag["arrayIndex"]}]' if tag.get('arrayIndex') is not None else ''), tag['value']['object']


def object_values(package, tags):
    """An omitted fixed-array tag index is element zero, not a separate scalar.

    Only apply that interpretation when this same native property also has an
    explicitly indexed tag. Original tags remain untouched in the source graph.
    """
    indexed = {tag['name'] for tag in tags if tag.get('arrayIndex') is not None}
    normalized, seen = [], set()
    for tag in tags:
        value = dict(tag)
        if value['name'] in indexed and value.get('arrayIndex') is None:
            value['arrayIndex'] = 0
        identity = (value['name'], value.get('arrayIndex'))
        if identity in seen:
            raise FormatError('Duplicate native property path cannot be collapsed; original tags retained: ' + value['name'])
        seen.add(identity)
        normalized.append(value)
    return tagged_values(package, normalized)


def _normal_reason(error, client, output):
    value = str(error).replace(str(client), '<source>').replace(str(output), '<output>')
    value = value.replace(str(client).replace('\\', '/'), '<source>').replace(str(output).replace('\\', '/'), '<output>')
    return re.sub(r'([/\\]\.work[/\\])[^/\\\s]+', r'\1<job>', value)


def _extract_bundle(client, recipe, output, save):
    dispatch = validate_source_dispatch(client, recipe)
    skill_table, sound_table = decode_table(client, 'skillgrp'), decode_table(client, 'skillsoundgrp')
    skill, sounds = select_rows(skill_table, sound_table, recipe['skillId'], recipe['level'])
    tables = [{key: value for key, value in table.items() if key != 'data'} for table in (skill_table, sound_table)]
    save('source/skill-rows.json', json_bytes({'skillRow': skill, 'soundRow': sounds, 'tables': tables}))
    packages = SourcePackages(client)
    root, stages, other, records, associations = select_effect_roots(packages, recipe, skill, dispatch)
    defaults = DefaultReader(client, packages, output / '.work', save)
    effects = []
    pending, edges, objects, unresolved, converted, extra_sources = [], [], {}, [], [], {}
    gaps = [
        {'feature': 'native-particle-runtime', 'reason': 'Raw authored emitter data is migrated; Babylon particle integration is not implemented.'},
        {'feature': 'native-blend-equations', 'reason': 'DrawStyle/material values and enums are retained; native render equations are not inferred from names.'},
        {'feature': 'native-attachment-and-dispatch', 'reason':
            'Reviewed source dispatch and attachment observations are retained; live attachment, conditional placement and lifecycle behavior remain unverified.' if dispatch else
            'Native C++ skill dispatch, attachment and trail formulas are not recovered.'},
        {'feature': 'full-character-attack-motion', 'reason': 'Full native attack and coordinated skill motion remain visually unverified; no clip is guessed.'},
        {'feature': 'implicit-native-constructor-values', 'reason': 'Only recovered authored/inherited defaults are represented; absent constructor/zero values are not synthesized.'},
    ]
    if any(row['status'] == 'candidate-unverified' for row in associations):
        gaps.append({'feature': 'skill-effect-association', 'reason': 'Candidate class is independently source-verified; its association with the selected skill is not established.'})
    for record in records:
        definition = copy.deepcopy(defaults.get(record['object']))
        for child in definition['children']:
            child['effectiveProperties'] = merge_properties(defaults.get(child['class'])['effectiveProperties'], child['properties'])
            pending.extend((child['object'], field, expected, ref)
                for field, expected, ref in references(child['effectiveProperties']))
        pending.extend((definition['object'], field, expected, ref)
            for field, expected, ref in references(definition['effectiveProperties']))
        effects.append(definition)
    validate_dispatch_defaults(dispatch, effects)
    for stage in stages:
        stage['effectiveProperties'] = merge_properties(defaults.get(stage['class'])['effectiveProperties'], stage['properties'])
        pending.extend((stage['object'], field, expected, ref)
            for field, expected, ref in references(stage['effectiveProperties']))
    for field, reference in sounds.items():
        if isinstance(reference, str) and '.' in reference:
            pending.append(('skillsoundgrp', field, 'Sound', reference))
    if root:
        pending.append(('skillgrp', 'description', 'SkillVisualEffect', root['object']))
    converter = Converter(client, output / '.work' / 'converted', _tool_paths()[0])
    seen_edges = set()
    while pending:
        from_object, field, expected, reference = pending.pop(0)
        edge_key = (from_object, field, expected, reference)
        if edge_key in seen_edges:
            continue
        seen_edges.add(edge_key)
        if len(seen_edges) > MAX_DEPENDENCIES * 16 or len(objects) >= MAX_DEPENDENCIES:
            raise FormatError('Native effect dependency limit exceeded')
        try:
            record, package, item = packages.resolve(reference, None if expected in ('Object', 'Material') else expected)
        except FormatError as error:
            unresolved.append({'from': from_object, 'field': field, 'reference': reference,
                'expectedClass': expected, 'reason': _normal_reason(error, client, output)})
            continue
        edges.append({'from': from_object, 'field': field, **record})
        key = record['object'].casefold()
        if key in objects:
            continue
        name = hashlib.sha256(key.encode()).hexdigest()[:24]
        node = {'source': record, 'rawExport': save('source/objects/' + name + '.bin',
            package.data[item['offset']:item['offset'] + item['size']])}
        objects[key] = node
        if item['className'] == 'Class':
            node['status'] = 'class-reference-preserved'
            continue
        try:
            tags, reader = package.properties(item)
            node.update(propertyTags=tags, trailingNativeBytes=reader.end - reader.position)
            node['properties'] = object_values(package, tags)
            node['propertyValuePolicy'] = 'Omitted fixed-array index is zero only when indexed sibling tags establish the array; original tags remain exact.'
            pending.extend((record['object'], prop, 'Object', ref) for prop, ref in _object_references(tags))
            if item['className'] in MATERIAL_CLASSES:
                try:
                    inherited = defaults.get(item['classObject'])
                    node['effectiveProperties'] = merge_properties(inherited['effectiveProperties'], node['properties'])
                    pending.extend((record['object'], 'inherited.' + prop, 'Object', ref)
                        for prop, _, ref in references(node['effectiveProperties']))
                except FormatError as error:
                    gaps.append({'feature': 'material-class-defaults', 'object': record['object'],
                        'reason': _normal_reason(error, client, output)})
        except FormatError as error:
            node['propertyDecodeGap'] = _normal_reason(error, client, output)
        kind = ASSET_KINDS.get(item['className'])
        if not kind:
            node['status'] = 'raw-native-data-only'
            if item['className'] not in MATERIAL_CLASSES | {'SkillVisualEffect'}:
                gaps.append({'feature': 'asset-adapter', 'object': record['object'], 'class': item['className'],
                    'reason': 'Raw export and tagged properties retained; no browser payload adapter for this class.'})
            continue
        request = {'kind': kind, 'package': record['package'], 'object': record['object']}
        try:
            result = converter.convert(request)
            verify_archive(Path(result['file']))
        except (ValueError, FormatError) as error:
            node['status'] = 'conversion-unsupported'
            node['conversionGap'] = _normal_reason(error, client, output)
            gaps.append({'feature': 'asset-conversion', 'object': record['object'], 'reason': node['conversionGap']})
            continue
        archive_path = Path(result['file'])
        prefix = 'assets/' + result['sha256'] + '/'
        archive_file = save(prefix + 'asset.l2asset', archive_path.read_bytes())
        with zipfile.ZipFile(archive_path) as archive:
            asset = json.loads(archive.read('asset.json'))
            provenance = json.loads(archive.read('provenance.json'))
            for entry in archive.infolist():
                save(prefix + safe_name(entry.filename), archive.read(entry.filename))
        extra_sources.update(provenance['dependencies'])
        primary = asset.get('model', asset.get('image', asset.get('audio')))['file']
        product = {'object': record['object'], 'id': asset['id'], 'kind': kind,
            'archive': archive_file, 'archiveSha256': result['sha256'], 'manifest': prefix + 'asset.json',
            'primary': prefix + primary, 'limitations': asset['limitations']}
        converted.append(product)
        node.update(status='converted-with-native-metadata', product=product)
        for slot in provenance.get('metadata', {}).get('materialSlots', []):
            for property_name in ('sourceReference', 'texture'):
                if slot.get(property_name):
                    pending.append((record['object'], f'materialSlots[{slot["slot"]}].{property_name}', 'Object', slot[property_name]))
            for material in slot.get('nativeMaterialGraph', []):
                pending.append((record['object'], f'materialSlots[{slot["slot"]}].material', 'Object', material['object']))
    source_files = {}
    if dispatch:
        source_files[dispatch['binary']['path']] = dispatch['binary']['sha256']
    for path, package in packages.loaded.values():
        source_files[path.relative_to(client).as_posix()] = package.source_hash
    source_files.update(extra_sources)
    for table in (skill_table, sound_table):
        source_files[table['source']] = table['sourceSha256']
    checked_sources = []
    for name, expected_hash in sorted(source_files.items()):
        path = within(client, safe_name(name))
        if file_hash(path) != expected_hash:
            raise FormatError('Source changed during effect migration: ' + name)
        checked_sources.append({'path': name, 'bytes': path.stat().st_size, 'sha256': expected_hash})
    class_definitions = [defaults.definitions[key] for key in sorted(defaults.definitions)]
    for definition in class_definitions:
        save('source/classes/' + definition['object'] + '.json', json_bytes(definition))
    graph = {'skillRow': skill, 'soundRow': sounds, 'tableSources': tables, 'visualRoot': root,
        'stages': stages, 'rootOtherProperties': other, 'effects': effects,
        'classDefaults': class_definitions, 'associations': associations, 'sourceDispatch': dispatch,
        'dependencies': sorted(edges, key=lambda row: (row['from'], row['field'], row['object'])),
        'nativeObjects': [objects[key] for key in sorted(objects)],
        'unresolvedDependencies': sorted(unresolved, key=lambda row: (row['from'], row['field'], row['reference']))}
    save('effect-source.json', json_bytes(graph))
    gaps = [json.loads(value) for value in sorted({json.dumps(row, sort_keys=True) for row in gaps})]
    return {'skillId': recipe['skillId'], 'level': recipe['level'], 'sourceFiles': checked_sources,
        'sourceGraph': 'effect-source.json', 'associations': associations,
        'assets': sorted(converted, key=lambda row: row['object']), 'gaps': gaps,
        'support': {'authoredEffectClasses': len(effects), 'inheritedClassDefinitions': len(class_definitions),
            'emitters': sum(len(effect['children']) for effect in effects),
            'convertedAssets': len(converted), 'unresolvedDependencies': len(unresolved),
            'rawNativeObjects': len(objects), 'runtimeImplemented': False, 'fullCharacterMotionVerified': False,
            'sourceDispatchVerified': dispatch is not None,
            'skillAssociationVerified': all(row['status'] in ('verified-native-description-action',
                'verified-reviewed-native-dispatch') for row in associations)}}


def _check_sources(client, records):
    seen = set()
    for record in records:
        name = safe_name(record['path'])
        if name.casefold() in seen:
            raise FormatError('Duplicate source file in effect receipt')
        seen.add(name.casefold())
        path = within(client, name)
        if not path.is_file() or path.stat().st_size != record['bytes'] or file_hash(path) != record['sha256']:
            raise FormatError('Effect source hash/size mismatch: ' + name)


def _verify(client, output, pins):
    receipt = json.loads((output / 'receipt.json').read_text(encoding='utf-8'))
    manifest_path = output / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if receipt.get('schemaVersion') != SCHEMA_VERSION or manifest.get('schemaVersion') != SCHEMA_VERSION:
        raise FormatError('Unsupported native effect bundle version')
    if receipt.get('tools') != pins or manifest.get('tools') != pins:
        raise FormatError('Effect bundle tool/implementation pins changed')
    if file_hash(manifest_path) != receipt.get('manifestSha256'):
        raise FormatError('Effect manifest hash mismatch')
    if receipt.get('recipeSha256') != digest(_recipe(manifest['recipe'])):
        raise FormatError('Effect recipe hash mismatch')
    if manifest.get('sourceFiles') != receipt.get('sourceFiles'):
        raise FormatError('Effect source provenance differs between manifest and receipt')
    _check_sources(client, receipt['sourceFiles'])
    seen = set()
    for record in receipt['files']:
        name = safe_name(record['file'])
        if name.casefold() in seen or name in ('manifest.json', 'receipt.json'):
            raise FormatError('Duplicate/reserved effect artifact path')
        seen.add(name.casefold())
        path = within(output, name)
        if not path.is_file() or path.stat().st_size != record['bytes'] or file_hash(path) != record['sha256']:
            raise FormatError('Effect artifact hash/size mismatch: ' + name)
    if manifest.get('files') != receipt['files']:
        raise FormatError('Effect file allowlist differs between manifest and receipt')
    return manifest


def _summary(manifest, output, cache_hit):
    return {'id': manifest['id'], 'manifest': str(output / 'manifest.json'),
        'sha256': file_hash(output / 'manifest.json'), 'cacheHit': cache_hit,
        'support': manifest['support'], 'gaps': manifest['gaps']}


def verify_effect_bundle(client: Path, output: Path):
    client, output = Path(client).resolve(strict=True), Path(output).resolve(strict=True)
    if output.is_relative_to(client) or client.is_relative_to(output):
        raise FormatError('Effect output must be outside the read-only client')
    return _summary(_verify(client, output, _tool_pins()), output, True)


def migrate_effect_bundle(client: Path, recipe: dict, output: Path):
    client, output = Path(client).resolve(strict=True), Path(output).resolve()
    if not client.is_dir() or output.is_relative_to(client) or client.is_relative_to(output):
        raise FormatError('Effect output must be outside an existing read-only client directory')
    recipe, pins = _recipe(recipe), _tool_pins()
    owner_path = output / OWNER_FILE
    if owner_path.exists():
        owner = json.loads(owner_path.read_text(encoding='utf-8'))
        if owner.get('owner') != 'native-effect-bundle' or owner.get('schemaVersion') != 1 or owner.get('id') != recipe['id']:
            raise FormatError('Existing output is not owned by this effect recipe')
        for name in owner.get('files', {}):
            safe_name(name)
    else:
        if output.exists() and (not output.is_dir() or any(output.iterdir())):
            raise FormatError('Refusing nonempty unowned effect output; choose a new directory')
        owner = {'schemaVersion': 1, 'owner': 'native-effect-bundle', 'id': recipe['id'], 'files': {}}
        write_output(client, owner_path, json_bytes(owner))
    receipt_path = output / 'receipt.json'
    if receipt_path.exists():
        receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
        if receipt.get('tools') == pins and receipt.get('recipeSha256') == digest(recipe):
            try:
                _check_sources(client, receipt['sourceFiles'])
            except FormatError:
                pass  # Changed source requests a new extraction; damaged output never passes cache reuse.
            else:
                return _summary(_verify(client, output, pins), output, True)
    artifacts = {}
    safe_output(client, output / 'manifest.json')

    def write_owned(name, data):
        name = safe_name(name)
        path = within(output, name)
        previous = owner['files'].get(name)
        if path.exists() and (not previous or file_hash(path) != previous['sha256']):
            raise FormatError('Refusing to overwrite an unowned or modified effect artifact: ' + name)
        result = write_output(client, path, data)
        owner['files'][name] = {'bytes': result['bytes'], 'sha256': result['sha256']}
        owner['files'] = dict(sorted(owner['files'].items()))
        write_output(client, owner_path, json_bytes(owner))
        return result

    def save(name, data):
        if name in ('manifest.json', 'receipt.json', OWNER_FILE):
            raise FormatError('Reserved effect artifact path')
        result = write_owned(name, data)
        artifacts[name] = {**result, 'file': name}
        return name

    data = _extract_bundle(client, recipe, output, save)
    _check_sources(client, data['sourceFiles'])
    if _tool_pins() != pins:
        raise FormatError('Effect migration implementation/tool changed while the job ran; rerun the job')
    files = [artifacts[name] for name in sorted(artifacts)]
    manifest = {'schemaVersion': SCHEMA_VERSION, 'id': recipe['id'], 'kind': 'native-effect-bundle',
        'recipe': recipe, 'tools': pins, **data, 'files': files}
    write_owned('manifest.json', json_bytes(manifest))
    receipt = {'schemaVersion': SCHEMA_VERSION, 'recipeSha256': digest(recipe), 'tools': pins,
        'manifestSha256': file_hash(output / 'manifest.json'), 'sourceFiles': data['sourceFiles'], 'files': files}
    write_owned('receipt.json', json_bytes(receipt))
    return _summary(_verify(client, output, pins), output, False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--recipe', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    try:
        if args.verify:
            result = verify_effect_bundle(args.client, args.output)
        else:
            if not args.recipe:
                parser.error('--recipe is required unless --verify is supplied')
            result = migrate_effect_bundle(args.client, json.loads(args.recipe.read_text(encoding='utf-8-sig')), args.output)
        print(json.dumps(result, indent=2))
        return 0
    except (OSError, ValueError, KeyError, FormatError, zipfile.BadZipFile) as error:
        print('Native effect bundle failed: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
