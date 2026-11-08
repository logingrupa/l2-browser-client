#!/usr/bin/env python3
"""Report native animation-alias coverage for the four staged Human player packages.

For MFighter, FFighter, MMagic and FMagic this reads the staged package named by
public/l2/catalog.json (archive hash verified), its exported clip names and its
localized animation families, then resolves every WT_HAND/base Pawn alias to
the package's actual clip, or records why it is missing. No alias is invented
from clip-name patterns; a clip is bound only through an original localization
value (exact or unique casefold match).

The FMagic section contains one nonidentical duplicate assignment, which the
shared family reader correctly refuses. This report builds a conflict-preserving
family document for it with the same record/getter rules and no precedence.

Modes: default writes missing outputs (refusing to change different existing
bytes; an unchanged repeat writes nothing), --plan writes nothing, --verify-only
requires every output to exist and match.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from native_animation_families import (
    IDENT, _decode_localization111, build_animation_families, class_getters, resolve_animation_references, section_records)
from native_catalog.ue2 import FormatError
from reference_client_guard import require_reference_client
from stage_native_runtime import verified_archive

LOCALIZATION = 'system/LineageWarrior.int'
LOCALIZATION_SHA256 = '8d951cbccd010a849f05df827d7065ec5f9372245953e71f3e88344cf8189485'
LOCALIZATION_SOURCE = {'host': 'IMPORTA-PC', 'path': 'C:/Lineage2-client/system/LineageWarrior.int', 'sha256': LOCALIZATION_SHA256}
CLASS_DEFAULTS = 'animation-families/class-source/defaults.json'
CLASS_SCRIPT = 'animation-families/class-source/scripts/Engine.Pawn.uc'
PACKAGES = (
    ('human-male-fighter:0', 'MFighter', 'Human male fighter'),
    ('human-female-fighter:0', 'FFighter', 'Human female fighter'),
    ('human-male-mystic:0', 'MMagic', 'Human male mystic'),
    ('human-female-mystic:0', 'FMagic', 'Human female mystic'),
)
FAMILY = 'WT_HAND'
ENGINE_PAWN_LOCALIZED_ARRAY_OR_NONE_WITHOUT_NATIVE_FIELD_BY_ALIAS = (
    ('wait', 'WaitAnimName'), ('walk', 'WalkAnimName'), ('run', 'RunAnimName'), ('turn', 'TurnAnimName'),
    ('atkWait', 'AtkWaitAnimName'), ('atk01', 'Atk01AnimName'), ('atk02', 'Atk02AnimName'), ('atk03', 'Atk03AnimName'),
    ('castShort', 'CastShortAnimName'), ('castMid', 'CastMidAnimName'), ('castLong', 'CastLongAnimName'), ('castEnd', 'CastEndAnimName'),
    ('magicShot', 'MagicShotAnimName'), ('magicThrow', 'MagicThrowAnimName'), ('magicNoTarget', 'MagicNoTargetAnimName'),
    ('magicFriend', 'MagicFriendAnimName'),
    ('sit', 'SitAnimName'), ('sitWait', 'SitWaitAnimName'), ('stand', 'StandAnimName'),
    ('chairSit', 'ChairSitAnimName'), ('chairWait', 'ChairWaitAnimName'), ('chairStand', 'ChairStandAnimName'),
    ('picItem', 'PicItemAnimName'),
    ('death', 'DeathAnimName'), ('deathWait', 'DeathWaitAnimName'), ('deathStand', 'DeathStandAnimName'),
    ('damage', 'DamageAnimName'), ('damageFly', 'DamageFlyAnimName'), ('fall', 'FallAnimName'), ('rebirth', None),
    ('swim', 'SwimAnimName'), ('swimWait', 'SwimWaitAnimName'), ('swimAtkWait', 'SwimAtkWaitAnimName'),
    ('swimDeath', 'SwimDeathAnimName'), ('swimDeathWait', 'SwimDeathWaitAnimName'),
    ('jump', 'JumpAnimName'), ('bJump', 'BJumpAnimName'), ('stun', 'StunAnimName'), ('atkUp', 'AtkUpAnimName'),
    ('atkDown', 'AtkDownAnimName'), ('shieldAtk', 'ShieldAtkAnimName'), ('defence', 'DefenceAnimName'),
    ('dodge', 'DodgeAnimName'), ('throw', 'ThrowAnimName'),
    *((f'spAtk{number:02d}', f'SpAtk{number:02d}AnimName') for number in range(1, 29)),
)
DAMAGE_PATTERN = re.compile(r'dmg|damage|hit|hurt|flinch|knock', re.IGNORECASE)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return (json.dumps(value, indent=2, ensure_ascii=True) + '\n').encode('ascii')


def section_records_preserving_conflicts(payload, section):
    require(re.fullmatch(IDENT, section) is not None, 'Invalid localization section')
    records, active, found, offset, seen, conflicts = [], False, 0, 0, {}, {}
    for line_number, raw in enumerate(payload.splitlines(keepends=True), 1):
        line = raw.rstrip(b'\r\n').strip()
        if line.startswith(b'['):
            require(re.fullmatch(rb'\[[A-Za-z_][A-Za-z_0-9]*\]', line) is not None, 'Unsupported localization section header')
            active = line[1:-1].lower() == section.lower().encode('ascii')
            found += int(active)
            require(found <= 1, 'Duplicate localization section')
        elif active and line and not line.startswith(b';'):
            try:
                text = raw.rstrip(b'\r\n').decode('ascii')
            except UnicodeDecodeError as error:
                raise FormatError('Non-ASCII selected animation section; encoding unreviewed') from error
            match = re.fullmatch(r'\s*(' + IDENT + r')(?:\[([0-9]+)\])?\s*=([^\r\n]*)', text)
            require(match is not None, 'Unsupported localization assignment on line ' + str(line_number))
            name, digits, value = match.groups()
            index = int(digits) if digits is not None else None
            require(index is None or index < 4096, 'Localization array index outside bounds')
            identity = (name.casefold(), index)
            row = {'key': name + ('[' + digits + ']' if digits is not None else ''), 'arrayName': name, 'index': index,
                   'value': value, 'line': line_number, 'payloadByteOffset': offset, 'rawLine': text}
            if identity in seen:
                first_raw, first = seen[identity]
                first['rawLineHex'], row['rawLineHex'] = first_raw.hex(), raw.hex()
                if raw == first_raw:
                    row['identicalDuplicateOf'] = {'line': first['line'], 'payloadByteOffset': first['payloadByteOffset']}
                else:
                    conflicts.setdefault(identity, [first]).append(row)
            else:
                seen[identity] = (raw, row)
            records.append(row)
            require(len(records) <= 4096, 'Too many localization assignments')
        offset += len(raw)
    require(found == 1 and records, 'Missing or empty localization section: ' + section)
    for group in conflicts.values():
        for row in group:
            row['conflictingAssignments'] = [{'line': other['line'], 'payloadByteOffset': other['payloadByteOffset'], 'value': other['value']}
                                             for other in group]
    return records, [{'key': group[0]['key'], 'rows': [{'line': row['line'], 'payloadByteOffset': row['payloadByteOffset'],
                                                         'value': row['value'], 'rawLineHex': row['rawLineHex']} for row in group]}
                     for group in conflicts.values()]


def build_families_preserving_conflicts(source_bytes, *, source, section, class_defaults, class_script_bytes):
    require(sha256_of(source_bytes) == source['sha256'], 'Localization source hash mismatch')
    payload, framing = _decode_localization111(source_bytes)
    records, conflicts = section_records_preserving_conflicts(payload, section)
    if not conflicts:
        require(records == section_records(payload, section), 'Conflict-preserving parser differs from the shared reader')
        return build_animation_families(source_bytes, source=source, section=section,
                                        class_defaults=class_defaults, class_script_bytes=class_script_bytes)
    enum, declarations, getters = class_getters(class_defaults, class_script_bytes)
    families = [{'index': index, 'enum': name, 'fields': {}} for name, index in enum.items()]
    unresolved = []
    for row in records:
        declaration = declarations.get(row['arrayName'].casefold())
        getter = getters.get(row['arrayName'].casefold())
        if declaration is not None:
            length = declaration['length']
            require((length is None and row['index'] is None) or (length is not None and row['index'] is not None and row['index'] < length),
                    'Localization index conflicts with class declaration: ' + row['key'])
            row['declaration'] = dict(declaration)
        if getter is not None:
            require(row['index'] is not None and row['index'] < len(families), 'Weapon-family index outside enum')
            row['selectionPath'] = 'base-class-direct-getter'
            row['getter'] = getter['function']
            fields = families[row['index']]['fields']
            if 'identicalDuplicateOf' in row:
                field = fields[row['arrayName']]
                field.setdefault('sourceLines', [field['line']]).append(row['line'])
            elif 'conflictingAssignments' in row:
                fields[row['arrayName']] = {'key': row['key'], 'value': None, 'status': 'conflicting-source-rows-unresolved',
                                            'candidates': row['conflictingAssignments'], 'line': row['conflictingAssignments'][0]['line'],
                                            'getter': getter['function']}
            else:
                fields[row['arrayName']] = {'key': row['key'], 'value': row['value'], 'line': row['line'], 'getter': getter['function']}
        else:
            row['selectionPath'] = 'unverified'
            unresolved.append(row['key'])
    duplicates = [{'key': row['key'], 'firstLine': row['identicalDuplicateOf']['line'], 'line': row['line'],
                   'firstPayloadByteOffset': row['identicalDuplicateOf']['payloadByteOffset'],
                   'payloadByteOffset': row['payloadByteOffset'], 'rawLineHex': row['rawLineHex']}
                  for row in records if 'identicalDuplicateOf' in row]
    result = {'schemaVersion': 1, 'source': dict(source), 'section': section, 'wrapper': 'Lineage2Ver111',
              'sourceBytes': len(source_bytes), 'sourceFraming': framing, 'decodedPayloadBytes': len(payload),
              'decodedPayloadSha256': sha256_of(payload),
              'textPolicy': 'Selected animation assignments must be ASCII; other section bytes are not decoded or recoded.',
              'classEvidence': {'object': class_defaults['object'], 'source': dict(class_defaults['source']),
                                'sourceScriptSha256': class_defaults['sourceScriptSha256'],
                                'uelibSha256': class_defaults.get('uelibSha256'), 'helperSha256': class_defaults.get('helperSha256')},
              'weaponTypes': enum, 'baseClassGetters': list(getters.values()), 'records': records, 'families': families,
              'unverifiedSelectionKeys': unresolved, 'conflictingDuplicates': conflicts,
              'producer': 'scripts/report-native-animation-aliases.py (conflict-preserving variant of native_animation_families)',
              'limitations': [
                  'Exact localizations and base Engine.Pawn getters only; derived overrides and native runtime dispatch remain unverified.',
                  'Missing indexed values are not filled from defaults, adjacent families or clip-name patterns.',
                  'Equipment table weapon_type to CurWeaponType assignment is not established by this data.',
                  'Authored rate strings remain unchanged; native playback-rate formulas are not established.',
                  'Unqualified clip references still require resolution against the exact animation source; no alias or clip existence is inferred.',
                  'Death, swimming, riding, social and other indirect selection paths remain unverified when no direct getter is recorded.',
                  'Nonidentical duplicate assignments retain every physical source row; their family slot stays unresolved and no native precedence is applied.']}
    if duplicates:
        result['identicalDuplicates'] = duplicates
    return result


def sha256_of(data):
    return hashlib.sha256(data).hexdigest()


def clip_list(glb):
    require(len(glb) >= 28 and struct.unpack_from('<3I', glb) == (0x46546c67, 2, len(glb)), 'Invalid model GLB header')
    length, kind = struct.unpack_from('<2I', glb, 12)
    require(kind == 0x4e4f534a, 'Invalid model GLB JSON chunk')
    document = json.loads(glb[20:20 + length])
    names = [entry['name'] for entry in document.get('animations', [])]
    require(names and len(set(names)) == len(names), 'Missing/duplicate clip names')
    return names


def resolve_reference(value, clips):
    if value is None:
        return 'no-family-value', None, []
    if not isinstance(value, str) or re.fullmatch(IDENT, value) is None:
        return 'unsupported-syntax', None, []
    matches = [name for name in clips if name.casefold() == value.casefold()]
    if not matches:
        return 'missing-clip', None, []
    if len(matches) != 1:
        return 'ambiguous', None, matches
    return ('exact' if matches[0] == value else 'case-only'), matches[0], matches


def localized_keys_by_selected_exported_clip(family_document):
    result = {}
    for reference in family_document['clipResolution']['references']:
        if reference['status'] in ('exact', 'case-only'):
            result.setdefault(reference['matchingExportedClips'][0]['name'], []).append(reference['key'])
    return result


def alias_rows(family_document, clips, class_name):
    families = {row['enum']: row for row in family_document['families']}
    family = families[FAMILY]
    index = family['index']
    getters = {row['field'].casefold(): row for row in family_document['baseClassGetters']}
    records = family_document['records']
    declared = {row['arrayName'].casefold() for row in records if 'declaration' in row}
    selected = localized_keys_by_selected_exported_clip(family_document)
    rows = []
    for alias, field in ENGINE_PAWN_LOCALIZED_ARRAY_OR_NONE_WITHOUT_NATIVE_FIELD_BY_ALIAS:
        entry = {'alias': alias, 'family': FAMILY, 'familyIndex': index, 'field': field}
        if field is None:
            exported = [name for name in clips if name.casefold() == f'rebirth_{class_name}'.casefold()]
            keys = selected.get(exported[0], []) if exported else []
            if not exported:
                detail = 'No Rebirth clip is exported.'
            elif keys:
                detail = f'The exported clip {exported[0]} is selected only through {", ".join(keys)}; use that field, not a Rebirth alias.'
            else:
                detail = f'The exported clip {exported[0]} exists but no localization value selects it; its native selection path is unrecovered.'
            entry.update(key=None, status='no-native-field', clip=None, getter=None, selectionPath=None,
                         reason='Engine.Pawn declares no Rebirth animation field and the section assigns none. ' + detail,
                         exportedClip=exported[0] if exported else None, exportedClipSelectedBy=keys)
            rows.append(entry)
            continue
        getter = getters.get(field.casefold())
        key = f'{field}[{index}]'
        if getter is not None:
            value = family['fields'].get(field)
            entry.update(getter=getter['function'], selectionPath='base-class-direct-getter')
            if value is None:
                status, clip = 'no-family-value', None
                entry['reason'] = (f'Engine.Pawn declares {field} with getter {getter["function"]}, but the [{class_name}] section assigns no '
                                   f'{key}; no clip is bound.')
                entry['otherFamiliesAssigned'] = sorted(row['enum'] for row in family_document['families'] if field in row['fields'])
            elif value.get('status') == 'conflicting-source-rows-unresolved':
                status, clip = 'conflict-unresolved', None
                entry['reason'] = 'Nonidentical duplicate source rows; no native precedence is applied.'
                entry['candidates'] = value['candidates']
            else:
                status, clip, matches = resolve_reference(value['value'], clips)
                entry.update(reference=value['value'], line=value['line'])
                if status == 'missing-clip':
                    entry['reason'] = f'Localized value {value["value"]} matches no exported clip.'
            entry.update(key=key, status=status, clip=clip)
        else:
            matching = [row for row in records if row['arrayName'].casefold() == field.casefold() and row['index'] == index
                        and 'identicalDuplicateOf' not in row]
            entry.update(getter=None, key=key)
            if not matching:
                entry.update(status='no-family-value', clip=None, selectionPath=None,
                             reason=(f'The [{class_name}] section assigns no {key}' +
                                     ('' if field.casefold() in declared else ' and the field is not a reviewed Engine.Pawn localized declaration') + '.'))
            elif 'conflictingAssignments' in matching[0]:
                entry.update(status='conflict-unresolved', clip=None, selectionPath='unverified', candidates=matching[0]['conflictingAssignments'],
                             reason='Nonidentical duplicate source rows; no native precedence is applied.')
            else:
                require(len(matching) == 1, 'Unexpected duplicate unverified record: ' + key)
                row = matching[0]
                status, clip, matches = resolve_reference(row['value'], clips)
                entry.update(status=status, clip=clip, reference=row['value'], line=row['line'], selectionPath=row.get('selectionPath', 'unverified'),
                             note='No reviewed direct Engine.Pawn getter; this localized value is the per-weapon-type source row, native selection path unverified.')
        rows.append(entry)
    socials = [row for row in records if row['arrayName'].casefold() == 'pcsocialanimname']
    for row in socials:
        status, clip, _ = resolve_reference(row['value'], clips)
        rows.append({'alias': f'social[{row["index"]}]', 'family': None, 'familyIndex': None, 'field': 'PcSocialAnimName',
                     'key': row['key'], 'reference': row['value'], 'line': row['line'], 'getter': None,
                     'selectionPath': row.get('selectionPath', 'unverified'), 'status': status, 'clip': clip,
                     'note': 'Social-action index, not a weapon family; native social dispatch is unverified.'})
    return rows


def damage_answer(class_name, clips, family_document, rows):
    candidates = sorted(name for name in clips if DAMAGE_PATTERN.search(name))
    damage = next(row for row in rows if row['alias'] == 'damage')
    damage_fly = next(row for row in rows if row['alias'] == 'damageFly')
    assigned = sorted(row['key'] for row in family_document['records'] if row['arrayName'].casefold() == 'damageanimname')
    require(not assigned, f'{class_name} unexpectedly assigns DamageAnimName')
    require(damage['status'] == 'no-family-value' and damage['clip'] is None, 'Damage alias unexpectedly resolved')
    require(candidates == [damage_fly['clip']] if damage_fly['clip'] else not candidates, 'Unexpected damage-like clip set for ' + class_name)
    return {'damageLikeClips': candidates, 'pattern': DAMAGE_PATTERN.pattern,
            'damageAnimNameAssignments': assigned, 'damageFlyKey': damage_fly['key'], 'damageFlyReference': damage_fly.get('reference'),
            'damageFlyClip': damage_fly['clip'],
            'answer': (f'No hit-reaction clip exists in the native {class_name} animation set and the [{class_name}] section assigns no '
                       f'DamageAnimName (Engine.Pawn declares it with getter GetDamageAnimName, so the field is empty). The only damage-like clip is '
                       f'{damage_fly["clip"]}, bound through DamageFlyAnimName[0] = {damage_fly.get("reference")} (a knock-back). '
                       "The 'damage' alias must stay unmapped; do not substitute DamageFly or any invented clip.")}


def load_inputs(catalog_path, client, public):
    catalog_bytes = catalog_path.read_bytes()
    catalog = json.loads(catalog_bytes)
    records = {row['id']: row for row in catalog['models']}
    localization = require_reference_client(client).require_equal_file(LOCALIZATION).read_bytes()
    require(digest(localization) == LOCALIZATION_SHA256, 'LineageWarrior.int differs from its source pin')
    packages = []
    for catalog_id, class_name, label in PACKAGES:
        record = records.get(catalog_id)
        require(record is not None, 'Catalog lacks staged package ' + catalog_id)
        expected = record['archiveSha256']
        require(record['archive'] == f'/l2/{expected}/asset.l2asset', 'Unexpected archive reference for ' + catalog_id)
        _, _, asset, files = verified_archive(public / expected / 'asset.l2asset', expected)
        require(asset['id'] == record['assetId'] and asset['source']['edition'] == 'interlude', 'Package identity differs: ' + catalog_id)
        packages.append({'catalogId': catalog_id, 'class': class_name, 'label': label, 'record': record, 'asset': asset, 'files': files})
    evidence = [package for package in packages if CLASS_DEFAULTS in package['files']]
    require(evidence, 'No staged package carries Engine.Pawn class evidence')
    require(len({(package['files'][CLASS_DEFAULTS], package['files'][CLASS_SCRIPT]) for package in evidence}) == 1,
            'Staged packages carry different Engine.Pawn class evidence')
    class_defaults = json.loads(evidence[0]['files'][CLASS_DEFAULTS])
    class_script = evidence[0]['files'][CLASS_SCRIPT]
    require(class_defaults.get('object') == 'Engine.Pawn' and digest(class_script) == class_defaults.get('sourceScriptSha256'),
            'Engine.Pawn class evidence hash differs')
    return catalog_bytes, localization, class_defaults, class_script, packages


def build_report(catalog_path, client, public):
    _, localization, class_defaults, class_script, packages = load_inputs(catalog_path, client, public)
    outputs, summary = {}, []
    for package in packages:
        class_name, files = package['class'], package['files']
        clips = clip_list(files['model.glb'])
        rebuilt = build_families_preserving_conflicts(localization, source=LOCALIZATION_SOURCE, section=class_name,
                                                      class_defaults=class_defaults, class_script_bytes=class_script)
        rebuilt['clipResolution'] = resolve_animation_references(rebuilt, clips)
        if 'animation-families.json' in files:
            staged = json.loads(files['animation-families.json'])
            require(staged == rebuilt, 'Archived animation-families.json differs from a rebuild: ' + class_name)
            family_source = {'kind': 'staged-package', 'path': f'/l2/{package["record"]["archiveSha256"]}/animation-families.json',
                             'sha256': digest(files['animation-families.json']), 'rebuiltFromPinnedInputs': True}
        else:
            require(rebuilt.get('conflictingDuplicates'), 'Package without converter families must have a documented conflict: ' + class_name)
            name = f'families/{class_name}.animation-families.json'
            outputs[name] = canonical(rebuilt)
            family_source = {'kind': 'conflict-preserving-report-product', 'path': name, 'sha256': digest(outputs[name]),
                             'reason': 'The shared converter reader refuses nonidentical duplicate assignments; see conflictingDuplicates.'}
        rows = alias_rows(rebuilt, clips, class_name)
        bound = {row['clip'] for row in rows if row.get('clip')} | set(localized_keys_by_selected_exported_clip(rebuilt))
        counts = {}
        for row in rows:
            counts[row['status']] = counts.get(row['status'], 0) + 1
        entry = {'catalogId': package['catalogId'], 'class': class_name, 'label': package['label'],
                 'assetId': package['asset']['id'], 'archiveSha256': package['record']['archiveSha256'],
                 'sourceObject': package['asset']['source']['object'], 'sourceSha256': package['asset']['source']['sha256'],
                 'clipCount': len(clips), 'familySource': family_source, 'aliases': rows, 'statusCounts': dict(sorted(counts.items())),
                 'conflictingDuplicates': rebuilt.get('conflictingDuplicates', []),
                 'exportedClipsNotSelectedByAnyLocalizedValue': sorted((name for name in clips if name not in bound), key=str.casefold),
                 'damage': damage_answer(class_name, clips, rebuilt, rows), 'clips': clips}
        summary.append(entry)
    report = {'schemaVersion': 1, 'kind': 'native-human-animation-alias-coverage',
              'inputs': {'catalogRecords': {package['catalogId']: {key: package['record'][key] for key in ('archive', 'archiveSha256', 'assetId', 'modelSha256')}
                                            for package in packages},
                         'localization': {**LOCALIZATION_SOURCE, 'relativePath': LOCALIZATION},
                         'classEvidence': {'object': class_defaults['object'], 'sourceScriptSha256': class_defaults['sourceScriptSha256'],
                                           'packageSha256': class_defaults['source']['packageSha256']}},
              'policy': ('Aliases resolve only through original localization values (WT_HAND family for weapon-indexed fields) and exact or unique '
                         'casefold clip matches. No clip is bound from name patterns; missing values stay missing with a reason.'),
              'packages': summary,
              'damageAnswer': ("None of the four native Human animation sets contains a hit-reaction clip. Engine.Pawn declares DamageAnimName "
                               "(getter GetDamageAnimName) but none of the [MFighter]/[FFighter]/[MMagic]/[FMagic] sections assigns it. "
                               "The only damage-like clip in each set is Damagefly_<Class>, bound to DamageFlyAnimName (a knock-back). "
                               "There is no DamageAnimName family; 'damage' must stay unmapped."),
              'limitations': ['Coverage of localized names against exported clips only; native dispatch, blending, rates and timing are not established.',
                              'WT_HAND (bare hand) is the reported family; other weapon families remain in each families document.',
                              'Unverified selection paths (no reviewed direct getter) are reported with their source rows but not claimed as native dispatch.']}
    outputs['ALIAS_COVERAGE.json'] = canonical(report)
    outputs['ALIAS_COVERAGE.md'] = markdown(report).encode('utf-8')
    return report, outputs


def markdown(report):
    lines = ['# Native Human animation-alias coverage', '',
             'Generated by `scripts/report-native-animation-aliases.py` from the four staged packages named in `public/l2/catalog.json` '
             f'(archive hashes verified, listed per package below) and the pinned `{LOCALIZATION}` '
             f'(`{LOCALIZATION_SHA256}`). Do not edit by hand.', '', report['policy'], '', '## Damage', '', report['damageAnswer'], '']
    lines += ['| Package | Catalog id | Clips | ' + ' | '.join(sorted({status for package in report['packages'] for status in package['statusCounts']})) + ' |']
    statuses = sorted({status for package in report['packages'] for status in package['statusCounts']})
    lines += ['| --- | --- | ---: | ' + ' | '.join('---:' for _ in statuses) + ' |']
    for package in report['packages']:
        lines.append(f'| {package["class"]} | `{package["catalogId"]}` | {package["clipCount"]} | ' +
                     ' | '.join(str(package['statusCounts'].get(status, 0)) for status in statuses) + ' |')
    lines += ['', 'Status meanings: `exact`/`case-only` = bound to an exported clip; `no-family-value` = the section assigns no value; '
              '`no-native-field` = no Engine.Pawn field exists; `missing-clip` = value names no exported clip; '
              '`conflict-unresolved` = nonidentical duplicate source rows.', '']
    order = [alias for alias, _ in ENGINE_PAWN_LOCALIZED_ARRAY_OR_NONE_WITHOUT_NATIVE_FIELD_BY_ALIAS]
    socials = sorted({row['alias'] for package in report['packages'] for row in package['aliases'] if row['alias'].startswith('social[')},
                     key=lambda value: int(value[7:-1]))
    lines += ['## WT_HAND aliases', '', '| Alias | Key | ' + ' | '.join(package['class'] for package in report['packages']) + ' |',
              '| --- | --- | ' + ' | '.join('---' for _ in report['packages']) + ' |']
    for alias in order + socials:
        cells, key = [], ''
        for package in report['packages']:
            row = next((row for row in package['aliases'] if row['alias'] == alias), None)
            if row is None:
                cells.append('—')
                continue
            key = key or (row.get('key') or '—')
            cells.append(f'`{row["clip"]}`' if row.get('clip') else row['status'])
        lines.append(f'| {alias} | {key} | ' + ' | '.join(cells) + ' |')
    for package in report['packages']:
        lines += ['', f'## {package["label"]} ({package["class"]})', '',
                  f'- Catalog id `{package["catalogId"]}`, asset `{package["assetId"]}`, archive `{package["archiveSha256"]}`.',
                  f'- Family source: {package["familySource"]["kind"]} `{package["familySource"]["path"]}`.',
                  f'- Damage: {package["damage"]["answer"]}']
        for conflict in package['conflictingDuplicates']:
            values = ', '.join(f'line {row["line"]} `{row["value"]}`' for row in conflict['rows'])
            lines.append(f'- Conflict: `{conflict["key"]}` assigned twice ({values}); unresolved, no precedence applied.')
        unbound = package['exportedClipsNotSelectedByAnyLocalizedValue']
        lines.append(f'- Exported clips not selected by any localized value ({len(unbound)}): ' + ', '.join(f'`{name}`' for name in unbound))
        missing = [row for row in package['aliases'] if not row.get('clip')]
        if missing:
            lines.append('- Unbound aliases:')
            lines += [f'  - `{row["alias"]}`: {row["status"]} — {row.get("reason", row.get("note", ""))}' for row in missing]
    lines += ['', '## Limitations', ''] + [f'- {value}' for value in report['limitations']] + ['']
    return '\n'.join(lines)


def run(output, catalog, client, public, *, plan_only=False, verify_only=False):
    require(not (plan_only and verify_only), 'Choose plan or verify-only, not both')
    output, catalog, client, public = (Path(value).resolve() for value in (output, catalog, client, public))
    require(not output.is_relative_to(client) and not output.is_relative_to(public), 'Output must be outside the client and public/l2')
    _, outputs = build_report(catalog, client, public)
    missing, same = [], []
    for name, data in outputs.items():
        path = output / name
        if path.exists():
            require(path.read_bytes() == data, 'Existing report output differs; refusing to overwrite: ' + str(path))
            same.append(name)
        else:
            missing.append(name)
    require(not verify_only or not missing, 'Report outputs are incomplete: ' + ', '.join(missing))
    if not plan_only and not verify_only:
        for name in missing:
            path = output / name
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('xb') as stream:
                stream.write(outputs[name])
    return {'status': 'planned' if plan_only else 'verified' if verify_only else 'written' if missing else 'unchanged',
            'outputs': {name: digest(data) for name, data in outputs.items()}, 'newOutputs': missing,
            'filesWritten': 0 if plan_only or verify_only else len(missing)}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/native-parity/research/dev-sheet-audio-20261107/models')
    parser.add_argument('--catalog', type=Path, default=ROOT / 'public/l2/catalog.json')
    parser.add_argument('--public', type=Path, default=ROOT / 'public/l2')
    parser.add_argument('--client', type=Path, default=ROOT / 'artifacts/native-parity/inputs/IMPORTA-PC')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--plan', action='store_true')
    modes.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    try:
        require_reference_client(args.client)
        print(json.dumps(run(args.output, args.catalog, args.client, args.public, plan_only=args.plan, verify_only=args.verify_only), indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError, FormatError) as error:
        print('Alias coverage failed: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
