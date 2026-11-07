#!/usr/bin/env python3
"""Source-backed NPC presentation profiles; no native process or source writes.

The profile joins one exact localized name ID to npcgrp, resolves that actor's
qualified inheritance, and keeps actor defaults separate from mesh conversion.
Missing defaults are explicit gaps, never assumed zero or a model-size fit.
"""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

from native_assets_lib.gltf import safe_name
from native_catalog.cli import file_hash, json_bytes, safe_output, within, write_output
from native_catalog.effects import SourcePackages, UELIB_SHA256
from native_catalog.tables import (SCHEMA_ROOT, SCHEMA_HASHES, checked_bytes,
    decode413, decode_table, read_nodes, read_value, table_definition_pins)
from native_catalog.ue2 import FormatError, Reader
from native_effect_bundle import DefaultReader, _tool_paths

OWNER_FILE = '.native-npc-profiles-owner.json'
KIND = 'native-npc-profiles'
SUPPORT = 'source-profile-fields-ready'


def digest(value):
    return hashlib.sha256(json_bytes(value)).hexdigest()


def _recipe(value):
    required = {'schemaVersion', 'id', 'nameTable', 'sourceUnitsPerMetre', 'profiles'}
    if not isinstance(value, dict) or set(value) != required or value.get('schemaVersion') != 1:
        raise FormatError('NPC profile recipe requires exactly schemaVersion, id, nameTable, sourceUnitsPerMetre and profiles')
    if not isinstance(value['id'], str) or not re.fullmatch(r'[a-z0-9][a-z0-9:.-]{0,119}', value['id']):
        raise FormatError('NPC profile bundle requires a stable id')
    if not isinstance(value['nameTable'], str) or not re.fullmatch(r'npcname-\w+\.dat', value['nameTable']):
        raise FormatError('NPC profile recipe requires an explicit native npcname locale filename')
    if type(value['sourceUnitsPerMetre']) is not int or value['sourceUnitsPerMetre'] != 100:
        raise FormatError('Only the existing 100 native units per metre conversion policy is supported')
    if not isinstance(value['profiles'], list) or not 1 <= len(value['profiles']) <= 128:
        raise FormatError('NPC profile recipe requires 1 to 128 explicit profiles')
    seen = set()
    for row in value['profiles']:
        if not isinstance(row, dict) or set(row) != {'npcId', 'expectedName', 'expectedMesh', 'expectedActorClass'}:
            raise FormatError('NPC selection requires id and exact expected name, mesh and actor class')
        if type(row['npcId']) is not int or row['npcId'] < 1 or row['npcId'] in seen:
            raise FormatError('NPC profile id is invalid or duplicated')
        seen.add(row['npcId'])
        if not isinstance(row['expectedName'], str) or not row['expectedName']:
            raise FormatError('NPC expected name must be nonempty')
        for key in ('expectedMesh', 'expectedActorClass'):
            if not isinstance(row[key], str) or not re.fullmatch(r'\w+(?:\.\w+)+', row[key]):
                raise FormatError('NPC expected mesh/class must be qualified native identities')
    return json.loads(json_bytes(value))


def _tool_pins():
    _, library, powershell = _tool_paths()
    if file_hash(library) != UELIB_SHA256:
        raise FormatError('NPC defaults require the pinned UELib build')
    here = Path(__file__).parent
    implementation = {name: file_hash(here / name) for name in (
        'native_actor_profiles.py', 'native_effect_bundle.py', 'native_catalog/effects.py',
        'native_catalog/extract_ue_defaults.ps1', 'native_catalog/tables.py',
        'native_catalog/ue2.py', 'native_catalog/cli.py', 'native_assets_lib/gltf.py')}
    return {'implementation': implementation, 'uelibSha256': UELIB_SHA256,
        'powershellSha256': file_hash(powershell), 'pythonVersion': '.'.join(map(str, sys.version_info[:3])),
        'formatDefinitions': {name: table_definition_pins(name) for name in ('npcname', 'npcgrp')}}


def select_rows(names, groups, selection):
    """Never substitute another NPC that happens to share this skeletal mesh."""
    selected = []
    for table, key in ((names, 'id'), (groups, 'npc_id')):
        rows = table['data']['npc']
        identifiers = [row[key] for row in rows]
        if len(set(identifiers)) != len(identifiers):
            raise FormatError('Duplicate native NPC table identifiers')
        matches = [(index, row) for index, row in enumerate(rows) if row[key] == selection['npcId']]
        if len(matches) != 1:
            raise FormatError('Exact requested NPC id must exist uniquely in both tables')
        selected.append(matches[0])
    if selected[0][1]['name'] != selection['expectedName']:
        raise FormatError('NPC name differs from exact recipe selection')
    for key, expected in (('mesh_name', 'expectedMesh'), ('class_name', 'expectedActorClass')):
        if selected[1][1][key] != selection[expected]:
            raise FormatError('NPC presentation ' + key + ' differs from exact recipe selection')
    return selected


def audit_selected_row(client, table, index):
    """Retain exact decoded row/field offsets; independently cross-check typed data."""
    _, decoded = decode413(within(client, table['source']).read_bytes())
    if hashlib.sha256(decoded).hexdigest() != table['decodedSha256']:
        raise FormatError('NPC table changed during row audit')
    schema = table['schema']
    document = ET.fromstring(checked_bytes(SCHEMA_ROOT / schema['file'], SCHEMA_HASHES[schema['file']]))
    layouts = [node for node in document if node.get('pattern') == schema['layout']]
    if len(layouts) != 1:
        raise FormatError('NPC table layout is not unique')
    layout = list(layouts[0])
    if (len(layout) != 2 or layout[0].attrib != {'name': 'data', 'reader': 'UINT'}
            or layout[1].tag != 'for' or layout[1].get('name') != 'npc' or layout[1].get('size') != '#data'):
        raise FormatError('Unsupported NPC row audit layout')
    reader = Reader(decoded)
    count = read_value(reader, 'UINT')
    if count != len(table['data']['npc']) or not 0 <= index < count:
        raise FormatError('NPC row audit count/index mismatch')
    for row_index in range(index + 1):
        start = reader.position
        row = read_nodes(reader, layout[1])
        if row != table['data']['npc'][row_index]:
            raise FormatError('NPC audited row differs from the decoded table')
    end = reader.position
    fields = []
    audit = Reader(decoded, start, end)

    def walk(nodes, prefix=''):
        values = {}
        for node in nodes:
            name, offset = node.get('name'), audit.position
            field = prefix + name
            if node.tag == 'node':
                value = read_value(audit, node.get('reader'))
                values[name] = value
                fields.append({'field': field, 'reader': node.get('reader'), 'offset': offset,
                    'bytes': audit.position - offset, 'rawHex': decoded[offset:audit.position].hex(), 'value': value})
            elif node.tag == 'for':
                size = node.get('size')
                count = values.get(size[1:]) if size.startswith('#') else int(size)
                if type(count) is not int or not 0 <= count <= 100_000:
                    raise FormatError('Unsupported NPC field count')
                if size == '#' + name:
                    values.setdefault('_counts', {})[name] = count
                values[name] = [walk(node, field + '[' + str(i) + '].') for i in range(count)]
            else:
                raise FormatError('Unsupported NPC field audit node')
        return values

    if walk(layout[1]) != row or audit.position != end:
        raise FormatError('NPC audited field spans differ from the complete decoded row')
    return {'rowIndex': index, 'offsetSpace': 'decoded-Ver413-payload', 'offset': start,
        'bytes': end - start, 'sha256': hashlib.sha256(decoded[start:end]).hexdigest(),
        'rawHex': decoded[start:end].hex(), 'fields': fields, 'row': row}


def resolved_profile(selection, definition, units):
    properties = definition['effectiveProperties']
    profile = {'id': 'npc:' + str(selection['npcId']), 'npcId': selection['npcId'],
        'name': selection['expectedName'], 'mesh': selection['expectedMesh'],
        'actorClass': selection['expectedActorClass'], 'sourceUnitsPerMetre': units}
    for native, field in (('DrawScale', 'drawScale'), ('CollisionRadius', 'collisionRadius'), ('CollisionHeight', 'collisionHeight')):
        value = properties.get(native)
        if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
            raise FormatError('Unsupported or unresolved positive native actor field: ' + native)
        profile[field] = value
    for native, field in (('DrawScale3D', 'drawScale3D'), ('PrePivot', 'prePivot')):
        if native not in properties and native == 'PrePivot':
            profile['unsupportedFields'] = [{'field': field,
                'reason': 'No authored or inherited PrePivot default. Native constructor/zero-initialization value is not proven by this adapter; no offset is synthesized.'}]
            continue
        vector = properties.get(native)
        if (not isinstance(vector, dict) or set(vector) != set('XYZ')
                or any(type(vector[key]) not in (int, float) or not math.isfinite(vector[key]) for key in 'XYZ')):
            raise FormatError('Unsupported or unresolved complete native vector: ' + native)
        if native == 'DrawScale3D' and any(vector[key] <= 0 for key in 'XYZ'):
            raise FormatError('Nonpositive actor scale components are unsupported')
        profile[field] = [vector[key] for key in 'XYZ']
    return profile


def _extract_bundle(client, recipe, output, save):
    tables = {'npcname': decode_table(client, 'npcname', source_filename=recipe['nameTable']),
        'npcgrp': decode_table(client, 'npcgrp')}
    packages = SourcePackages(client)
    defaults = DefaultReader(client, packages, output / '.work', save)
    profiles, selections, mesh_sources = [], [], []
    for selection in recipe['profiles']:
        rows = select_rows(tables['npcname'], tables['npcgrp'], selection)
        definition = defaults.get(selection['expectedActorClass'])
        if definition['object'] != selection['expectedActorClass']:
            raise FormatError('Actor class requires an exact qualified export identity')
        chain, current = [], definition
        while current:
            chain.append(current['object'])
            parent = current['nativeSuperClass']
            current = defaults.definitions[parent.casefold()] if parent else None
        if 'Engine.Actor' not in chain or chain[-1] != 'Core.Object':
            raise FormatError('NPC actor class inheritance must resolve through Engine.Actor to Core.Object')
        mesh, _, _ = packages.resolve(selection['expectedMesh'], 'SkeletalMesh')
        if mesh['object'] != selection['expectedMesh'] or mesh['resolution'] != 'exact-qualified-object':
            raise FormatError('NPC mesh requires an exact qualified skeletal mesh export')
        mesh_sources.append(mesh)
        profiles.append(resolved_profile(selection, definition, recipe['sourceUnitsPerMetre']))
        selections.append({'id': profiles[-1]['id'], 'classChain': chain, 'meshSource': mesh,
            'nameRow': audit_selected_row(client, tables['npcname'], rows[0][0]),
            'groupRow': audit_selected_row(client, tables['npcgrp'], rows[1][0])})
    source_files = {}

    def source(name, expected):
        path = within(client, name)
        if file_hash(path) != expected:
            raise FormatError('NPC profile source changed during extraction: ' + name)
        source_files[name] = {'path': name, 'bytes': path.stat().st_size, 'sha256': expected}

    for table in tables.values():
        source(table['source'], table['sourceSha256'])
    for mesh in mesh_sources:
        source(mesh['package'], mesh['packageSha256'])
    classes = sorted(defaults.definitions.values(), key=lambda row: row['object'])
    for definition in classes:
        source(definition['source']['package'], definition['source']['packageSha256'])
        save('source/classes/' + definition['object'] + '.json', json_bytes(definition))
    save('source/npc-selections.json', json_bytes({'tables': {name: {key: value for key, value in table.items() if key != 'data'}
        for name, table in tables.items()}, 'selections': selections}))
    return {'profiles': profiles, 'sourceFiles': [source_files[key] for key in sorted(source_files)],
        'sourceSelections': 'source/npc-selections.json', 'classDefinitions': [row['object'] for row in classes],
        'support': SUPPORT, 'coverage': {'requestedProfiles': len(profiles), 'resolvedProfiles': len(profiles),
            'nativeNameRows': len(tables['npcname']['data']['npc']), 'nativePresentationRows': len(tables['npcgrp']['data']['npc'])},
        'gaps': ['Source profile fields only; complete native actor placement, collision sweeps and runtime resource overrides are not certified.',
            'No NPC gameplay/server statistics or full NPC coverage is claimed.',
            'Unproven native fields remain in each profile unsupportedFields list; mesh origin and skeletal import offsets remain in the unchanged model asset.'],
        'unsupported': [], 'visualAcceptance': 'unverified'}


def _check_sources(client, records):
    seen = set()
    for record in records:
        name = safe_name(record['path'])
        if name.casefold() in seen:
            raise FormatError('Duplicate source file in NPC profile receipt')
        seen.add(name.casefold())
        path = within(client, name)
        if not path.is_file() or path.stat().st_size != record['bytes'] or file_hash(path) != record['sha256']:
            raise FormatError('NPC profile source hash/size mismatch: ' + name)


def _verify(client, output, pins):
    receipt = json.loads((output / 'receipt.json').read_text(encoding='utf-8'))
    manifest = json.loads((output / 'manifest.json').read_text(encoding='utf-8'))
    if receipt.get('schemaVersion') != 1 or manifest.get('schemaVersion') != 1 or manifest.get('kind') != KIND:
        raise FormatError('Unsupported NPC profile bundle version/kind')
    if receipt.get('tools') != pins or manifest.get('tools') != pins:
        raise FormatError('NPC profile tool/implementation pins changed')
    if file_hash(output / 'manifest.json') != receipt.get('manifestSha256'):
        raise FormatError('NPC profile manifest hash mismatch')
    if receipt.get('recipeSha256') != digest(_recipe(manifest['recipe'])):
        raise FormatError('NPC profile recipe hash mismatch')
    if manifest.get('sourceFiles') != receipt.get('sourceFiles'):
        raise FormatError('NPC profile source provenance differs between manifest and receipt')
    _check_sources(client, receipt['sourceFiles'])
    seen = set()
    for record in receipt['files']:
        name = safe_name(record['file'])
        if name.casefold() in seen or name in ('manifest.json', 'receipt.json', OWNER_FILE):
            raise FormatError('Duplicate/reserved NPC profile artifact path')
        seen.add(name.casefold())
        path = within(output, name)
        if not path.is_file() or path.stat().st_size != record['bytes'] or file_hash(path) != record['sha256']:
            raise FormatError('NPC profile artifact hash/size mismatch: ' + name)
    if manifest.get('files') != receipt['files']:
        raise FormatError('NPC profile file allowlist differs from receipt')
    return manifest


def _summary(manifest, output, cache_hit):
    return {'id': manifest['id'], 'manifest': str(output / 'manifest.json'),
        'sha256': file_hash(output / 'manifest.json'), 'cacheHit': cache_hit,
        'support': manifest['support'], 'coverage': manifest['coverage'], 'gaps': manifest['gaps']}


def verify_npc_profiles(client, output):
    client, output = Path(client).resolve(strict=True), Path(output).resolve(strict=True)
    if output.is_relative_to(client) or client.is_relative_to(output):
        raise FormatError('NPC profile output must be outside the read-only client')
    return _summary(_verify(client, output, _tool_pins()), output, True)


def migrate_npc_profiles(client, recipe, output):
    client, output = Path(client).resolve(strict=True), Path(output).resolve()
    if not client.is_dir() or output.is_relative_to(client) or client.is_relative_to(output):
        raise FormatError('NPC profile output must be outside an existing read-only client directory')
    recipe, pins = _recipe(recipe), _tool_pins()
    owner_path = output / OWNER_FILE
    if owner_path.exists():
        owner = json.loads(owner_path.read_text(encoding='utf-8'))
        if owner.get('owner') != KIND or owner.get('schemaVersion') != 1 or owner.get('id') != recipe['id']:
            raise FormatError('Existing output is not owned by this NPC profile recipe')
        for name in owner.get('files', {}):
            safe_name(name)
    else:
        if output.exists() and (not output.is_dir() or any(output.iterdir())):
            raise FormatError('Refusing nonempty unowned NPC profile output')
        owner = {'schemaVersion': 1, 'owner': KIND, 'id': recipe['id'], 'files': {}}
        write_output(client, owner_path, json_bytes(owner))
    receipt_path = output / 'receipt.json'
    if receipt_path.exists():
        receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
        if receipt.get('tools') == pins and receipt.get('recipeSha256') == digest(recipe):
            try:
                _check_sources(client, receipt['sourceFiles'])
            except FormatError:
                pass
            else:
                return _summary(_verify(client, output, pins), output, True)
    artifacts = {}
    safe_output(client, output / 'manifest.json')

    def write_owned(name, data):
        name = safe_name(name)
        path = within(output, name)
        previous = owner['files'].get(name)
        if path.exists() and (not previous or file_hash(path) != previous['sha256']):
            raise FormatError('Refusing to overwrite unowned or modified NPC profile artifact: ' + name)
        result = write_output(client, path, data)
        owner['files'][name] = {'bytes': result['bytes'], 'sha256': result['sha256']}
        owner['files'] = dict(sorted(owner['files'].items()))
        write_output(client, owner_path, json_bytes(owner))
        return result

    def save(name, data):
        if name in ('manifest.json', 'receipt.json', OWNER_FILE):
            raise FormatError('Reserved NPC profile artifact path')
        result = write_owned(name, data)
        artifacts[name] = {**result, 'file': name}
        return name

    data = _extract_bundle(client, recipe, output, save)
    _check_sources(client, data['sourceFiles'])
    if _tool_pins() != pins:
        raise FormatError('NPC profile implementation/tool changed during extraction; rerun')
    files = [artifacts[name] for name in sorted(artifacts)]
    manifest = {'schemaVersion': 1, 'id': recipe['id'], 'kind': KIND, 'recipe': recipe,
        'tools': pins, **data, 'files': files}
    write_owned('manifest.json', json_bytes(manifest))
    write_owned('receipt.json', json_bytes({'schemaVersion': 1, 'recipeSha256': digest(recipe),
        'tools': pins, 'manifestSha256': file_hash(output / 'manifest.json'),
        'sourceFiles': data['sourceFiles'], 'files': files}))
    return _summary(_verify(client, output, pins), output, False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--recipe', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    if args.verify:
        result = verify_npc_profiles(args.client, args.output)
    else:
        if not args.recipe:
            parser.error('--recipe is required unless --verify is supplied')
        result = migrate_npc_profiles(args.client, json.loads(args.recipe.read_text(encoding='utf-8-sig')), args.output)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError) as error:
        print('Native NPC profiles failed: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
