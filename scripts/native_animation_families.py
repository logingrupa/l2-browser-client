"""Preserve localized animation families and reviewed Engine.Pawn getter evidence.

No UnrealScript executes here. The caller supplies pinned source bytes and the
existing read_class_defaults result plus its exact decompiled script. These are
base-class getters, not proof of native/derived dispatch or playback rates.
"""
import hashlib
import re
import struct
import zlib

from native_catalog.ue2 import FormatError


IDENT = r'[A-Za-z_][A-Za-z_0-9]*'
MAX_SOURCE_BYTES = 8 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise FormatError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def _decode_localization111(data):
    """Decode the reviewed111 localization envelope and retain exact framing.

    The codec cross-check establishes a20-byte plaintext footer after encrypted
    text. Accept only the observed fixed words and validated CRC32; other111
    footer variants and files without this footer remain unsupported.
    """
    require(48 < len(data) <= MAX_SOURCE_BYTES, 'Native localization size outside bounds')
    require(data[:28] == 'Lineage2Ver111'.encode('utf-16le'), 'Unsupported localization wrapper; expected Lineage2Ver111')
    footer_offset = len(data) - 20
    footer = data[footer_offset:]
    words = struct.unpack('<5I', footer)
    require((words[0], words[1], words[2], words[4]) == (0, 8, 71, 0),
            'Unsupported localization111 footer framing')
    crc = zlib.crc32(data[:footer_offset])
    require(words[3] == crc, 'Localization111 footer CRC32 mismatch')
    encrypted = data[28:footer_offset]
    payload = encrypted.translate(bytes(value ^ 0xac for value in range(256)))
    require(b'\0' not in payload, 'Unsupported localization text encoding or NUL bytes')
    require(not payload.startswith((b'\xef\xbb\xbf', b'\xff\xfe', b'\xfe\xff')), 'Unreviewed localization BOM')
    framing = {'schemaVersion': 1, 'offsetSpace': 'original-encrypted-file',
               'layout': 'reviewed111 header28/XOR0xAC-text/footer20 with fixed words0,8,71,CRC32,0',
               'header': {'offset': 0, 'bytes': 28, 'sha256': sha256(data[:28]), 'hex': data[:28].hex()},
               'encryptedPayload': {'offset': 28, 'bytes': len(encrypted), 'sha256': sha256(encrypted)},
               'footer': {'offset': footer_offset, 'bytes': 20, 'sha256': sha256(footer),
                          'hex': footer.hex(), 'littleEndianUint32': list(words)},
               'crc32': {'coveredOffset': 0, 'coveredBytes': footer_offset, 'valueHex': f'{crc:08x}', 'matches': True},
               'limitation': 'Only this reviewed footer form is supported; other versions/forms are rejected, not silently truncated.'}
    return payload, framing


def decode_localization111(data):
    """Return exact plaintext after validating the reviewed header and CRC footer."""
    return _decode_localization111(data)[0]


def section_records(payload, section):
    require(re.fullmatch(IDENT, section) is not None, 'Invalid localization section')
    records, active, found, offset = [], False, 0, 0
    seen = {}
    for line_number, raw in enumerate(payload.splitlines(keepends=True), 1):
        line = raw.rstrip(b'\r\n').strip()
        if line.startswith(b'['):
            require(re.fullmatch(rb'\[[A-Za-z_][A-Za-z_0-9]*\]', line) is not None,
                    'Unsupported localization section header')
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
            identity = (name.casefold(), index)
            require(index is None or index < 4096, 'Localization array index outside bounds')
            row = {'key': name + ('[' + digits + ']' if digits is not None else ''),
                   'arrayName': name, 'index': index, 'value': value,
                   'line': line_number, 'payloadByteOffset': offset, 'rawLine': text}
            if identity in seen:
                first_raw, first = seen[identity]
                # Exact repeated source bytes need no native precedence rule.
                # Keep both physical records, including their line endings;
                # even semantically similar but differently spelled rows stay
                # unsupported until their source interpretation is established.
                require(raw == first_raw, 'Duplicate localization key/index has nonidentical source rows: ' + name)
                first['rawLineHex'] = row['rawLineHex'] = raw.hex()
                row['identicalDuplicateOf'] = {'line': first['line'], 'payloadByteOffset': first['payloadByteOffset']}
            else:
                seen[identity] = (raw, row)
            records.append(row)
            require(len(records) <= 4096, 'Too many localization assignments')
        offset += len(raw)
    require(found == 1 and records, 'Missing or empty localization section: ' + section)
    return records


def class_getters(class_defaults, class_script_bytes):
    require(class_defaults.get('object') == 'Engine.Pawn', 'Only reviewed Engine.Pawn getter evidence is supported')
    require(sha256(class_script_bytes) == class_defaults.get('sourceScriptSha256'), 'Class script hash mismatch')
    source = class_defaults.get('source', {})
    require(source.get('object') == 'Engine.Pawn' and re.fullmatch(r'[0-9a-f]{64}', source.get('packageSha256', '')),
            'Missing pinned class source evidence')
    require(len(class_script_bytes) <= MAX_SOURCE_BYTES, 'Class script size outside bounds')
    try:
        script = class_script_bytes.decode('utf-8-sig')
    except UnicodeDecodeError as error:
        raise FormatError('Class script must use the existing extractor UTF-8 encoding') from error
    require(not re.search(r'failed to decompile|exception occurred|deserialization error', script, re.I),
            'Incomplete decompiled class evidence')
    enum_blocks = re.findall(r'\benum\s+WeaponType\s*\{([^{}]*)\}', script)
    require(len(enum_blocks) == 1, 'Missing or ambiguous WeaponType enum')
    enum_text = re.sub(r'//[^\r\n]*', '', enum_blocks[0])
    enum_names = [value.strip() for value in enum_text.split(',') if value.strip()]
    require(0 < len(enum_names) <= 256 and all(re.fullmatch(IDENT, value) for value in enum_names), 'Unsupported WeaponType enum')
    require(len({name.casefold() for name in enum_names}) == len(enum_names), 'Duplicate WeaponType enum entry')
    enum = {name: index for index, name in enumerate(enum_names)}
    require(enum == class_defaults.get('enums', {}).get('WeaponType'), 'Class enum evidence mismatch')
    require(len(re.findall(r'(?m)^[ \t]*var\s+Pawn\.WeaponType\s+CurWeaponType\s*;', script)) == 1,
            'Missing or ambiguous CurWeaponType declaration')
    declarations = {}
    pattern = r'(?m)^[ \t]*var\s+localized\s+(name|float|int|bool)\s+(' + IDENT + r')(?:\[([0-9]+)\])?\s*;'
    for match in re.finditer(pattern, script):
        kind, name, length = match.groups()
        require(name.casefold() not in declarations, 'Duplicate localized class declaration')
        declarations[name.casefold()] = {'name': name, 'type': kind, 'length': int(length) if length else None}
    # Accept only an entire direct-return body; branches and native operations
    # remain unresolved. A similarly named method is insufficient evidence.
    pattern = (r'(?m)^[ \t]*function\s+(name|float)\s+(' + IDENT + r')\s*\(\s*\)\s*\{\s*'
               r'return\s+(' + IDENT + r')\[int\(CurWeaponType\)\];\s*(?:return;\s*)?\}')
    getters = {}
    for match in re.finditer(pattern, script):
        kind, function, field = match.groups()
        declaration = declarations.get(field.casefold())
        require(declaration is not None and declaration['type'] == kind and declaration['length'] == len(enum),
                'Getter/declaration mismatch for ' + field)
        require(field.casefold() not in getters, 'Ambiguous getter for ' + field)
        names = re.findall(r'\bfunction\s+(?:' + IDENT + r'\s+)?(' + IDENT + r')\s*\(', script)
        require(sum(name.casefold() == function.casefold() for name in names) == 1, 'Duplicate getter declaration')
        getters[field.casefold()] = {'function': function, 'field': field, 'selector': 'int(CurWeaponType)',
                                     'line': script[:match.start()].count('\n') + 1,
                                     'script': match.group(0).strip(), 'scope': 'Engine.Pawn base-class script'}
    require(getters, 'No reviewed direct weapon-family getters found')
    return enum, declarations, getters


def build_animation_families(source_bytes, *, source, section, class_defaults, class_script_bytes):
    """Return JSON data; all file staging and production dependency pins stay with caller.

    source must contain host/path/sha256. The class evidence is an unmodified
    read_class_defaults('Engine.Pawn') result and its sourceScript bytes.
    """
    require(isinstance(source, dict) and all(isinstance(source.get(key), str) and source[key] for key in ('host', 'path', 'sha256')),
            'Missing localization source provenance')
    require(sha256(source_bytes) == source['sha256'], 'Localization source hash mismatch')
    payload, framing = _decode_localization111(source_bytes)
    records = section_records(payload, section)
    enum, declarations, getters = class_getters(class_defaults, class_script_bytes)
    families = [{'index': index, 'enum': name, 'fields': {}} for name, index in enum.items()]
    unresolved = []
    for row in records:
        declaration = declarations.get(row['arrayName'].casefold())
        getter = getters.get(row['arrayName'].casefold())
        if declaration is not None:
            length = declaration['length']
            require((length is None and row['index'] is None) or
                    (length is not None and row['index'] is not None and row['index'] < length),
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
            else:
                fields[row['arrayName']] = {
                    'key': row['key'], 'value': row['value'], 'line': row['line'], 'getter': getter['function']}
        else:
            row['selectionPath'] = 'unverified'
            unresolved.append(row['key'])
    result = {'schemaVersion': 1, 'source': dict(source), 'section': section,
            'wrapper': 'Lineage2Ver111', 'sourceBytes': len(source_bytes), 'sourceFraming': framing,
            'decodedPayloadBytes': len(payload), 'decodedPayloadSha256': sha256(payload),
            'textPolicy': 'Selected animation assignments must be ASCII; other section bytes are not decoded or recoded.',
            'classEvidence': {'object': class_defaults['object'], 'source': dict(class_defaults['source']),
                              'sourceScriptSha256': class_defaults['sourceScriptSha256'],
                              'uelibSha256': class_defaults.get('uelibSha256'),
                              'helperSha256': class_defaults.get('helperSha256')},
            'weaponTypes': enum, 'baseClassGetters': list(getters.values()),
            'records': records, 'families': families, 'unverifiedSelectionKeys': unresolved,
            'limitations': [
                'Exact localizations and base Engine.Pawn getters only; derived overrides and native runtime dispatch remain unverified.',
                'Missing indexed values are not filled from defaults, adjacent families or clip-name patterns.',
                'Equipment table weapon_type to CurWeaponType assignment is not established by this data.',
                'Authored rate strings remain unchanged; native playback-rate formulas are not established.',
                'Unqualified clip references still require resolution against the exact animation source; no alias or clip existence is inferred.',
                'Death, swimming, riding, social and other indirect selection paths remain unverified when no direct getter is recorded.'
            ]}
    duplicates = [{'key': row['key'], 'firstLine': row['identicalDuplicateOf']['line'],
                   'line': row['line'], 'firstPayloadByteOffset': row['identicalDuplicateOf']['payloadByteOffset'],
                   'payloadByteOffset': row['payloadByteOffset'], 'rawLineHex': row['rawLineHex']}
                  for row in records if 'identicalDuplicateOf' in row]
    if duplicates:
        result['identicalDuplicates'] = duplicates
        result['limitations'].append(
            'Byte-identical duplicate assignments retain all physical source rows; no native precedence for differing rows is inferred.')
    return result


def resolve_animation_references(family_metadata, clip_names):
    """Compare declared name fields with actual exported clips; never rewrite names.

    A missing reference can be valid native data outside a bounded export, so it
    is coverage rather than a fatal conversion error. Multiple casefold matches
    are ambiguous even if one candidate's case happens to be identical.
    """
    require(isinstance(family_metadata, dict) and isinstance(family_metadata.get('records'), list),
            'Missing animation-family records')
    require(not isinstance(clip_names, (str, bytes)), 'Expected a collection of exported clip names')
    names = list(clip_names)
    require(len(names) <= 65536 and all(isinstance(name, str) and name for name in names),
            'Invalid or excessive exported clip names')
    by_fold = {}
    for index, name in enumerate(names):
        by_fold.setdefault(name.casefold(), []).append({'index': index, 'name': name})
    counts = {status: 0 for status in ('exact', 'case-only', 'missing', 'ambiguous', 'unsupported-syntax')}
    references = []
    for row in family_metadata['records']:
        if row.get('declaration', {}).get('type') != 'name':
            continue
        value = row.get('value')
        if not isinstance(value, str) or re.fullmatch(IDENT, value) is None:
            matches, status = [], 'unsupported-syntax'
        else:
            matches = by_fold.get(value.casefold(), [])
            status = ('missing' if not matches else 'ambiguous' if len(matches) != 1 else
                      'exact' if matches[0]['name'] == value else 'case-only')
        counts[status] += 1
        references.append({'key': row.get('key'), 'reference': value, 'line': row.get('line'),
                           'selectionPath': row.get('selectionPath', 'unverified'),
                           'status': status, 'matchingExportedClips': [dict(match) for match in matches]})
    return {'schemaVersion': 1, 'clipCount': len(names), 'referenceCount': len(references),
            'counts': counts, 'references': references,
            'policy': 'Exact or unique casefold match only; authored reference and exported case remain unchanged. No naming aliases.',
            'limitations': ['Missing clips may be outside this bounded export and are not replaced.',
                            'Only fields declared as native name are examined; rate/flag values are excluded.',
                            'Only plain ASCII unqualified name references are reviewed; other syntax remains unsupported.',
                            'Reference resolution does not establish native dispatch, timing, attachment or visual equivalence.']}
