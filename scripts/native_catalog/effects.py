import copy
import hashlib
import json
from pathlib import Path
import re
import subprocess

from .cli import file_hash, json_bytes, safe_output, within, write_output
from .tables import decode_table
from .ue2 import FormatError, Package, Reader, unwrap
from reference_client_guard import require_reference_client

UELIB = Path('C:/laragon/www/lineagen/.assets/skill-assets/work/native/tools/ue-explorer/Eliot.UELib.dll')
UELIB_SHA256 = '64ebfa8b290429b9d5b5e81f5018734c03ded27bb814c69b904cc269268f7bbc'
POWERSHELL = Path('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
ENGINE_CLASSES = ['Object', 'Actor', 'SkillAction', 'SkillVisualEffect', 'SkillAction_LocateEffect',
    'ParticleEmitter', 'SpriteEmitter', 'MeshEmitter', 'BeamEmitter', 'Emitter']
ACTION_ARRAYS = {'CastingActions', 'ChannelingActions', 'PreshotActions', 'ShotActions', 'ExplosionActions'}
REFERENCE_IDENTITY_KEYS_SKIPPED_WHILE_DESCENDING_INTO_EMITTER_PROPERTIES = ('class', 'object')


def split_fields(text):
    fields, start, depth, quote, escaped = [], 0, 0, None, False
    for index, char in enumerate(text):
        if escaped:
            escaped = False
            continue
        if char == '\\' and quote:
            escaped = True
            continue
        if char in ('"', "'"):
            quote = None if quote == char else char if quote is None else quote
        if quote:
            continue
        if char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
        elif char == ',' and depth == 0:
            fields.append(text[start:index].strip())
            start = index + 1
        if depth < 0:
            raise FormatError('Unbalanced default-property tuple')
    if depth or quote:
        raise FormatError('Unterminated default-property expression')
    fields.append(text[start:].strip())
    return fields


def parse_value(text):
    text = text.strip()
    if text.startswith('(') and text.endswith(')'):
        value = {}
        for item in split_fields(text[1:-1]):
            key, separator, content = item.partition('=')
            if not separator or key.strip() in value:
                raise FormatError('Malformed default-property tuple')
            value[key.strip()] = parse_value(content)
        return value
    if text.lower() in ('true', 'false'):
        return text.lower() == 'true'
    if text.lower() == 'none':
        return None
    if text.startswith('"') and text.endswith('"'):
        return text[1:-1]
    match = re.fullmatch(r"([\w.]+)'([^']+)'", text)
    if match:
        return {'class': match[1], 'object': match[2]}
    if re.fullmatch(r'[-+]?\d+', text):
        return int(text)
    if re.fullmatch(r'[-+]?(?:\d+\.\d*|\.\d+)(?:[eE][-+]?\d+)?', text):
        return float(text)
    if re.fullmatch(r'[A-Za-z_]\w*(?:\.\w+)*', text):
        return {'symbol': text}
    raise FormatError('Uninterpreted default-property syntax: ' + text[:120])


def assign(properties, key, value):
    match = re.fullmatch(r'(\w+)\[(\d+)\]', key)
    if match:
        name, index = match[1], int(match[2])
        if index > 100_000:
            raise FormatError('Oversized property array')
        target = properties.setdefault(name, [])
        while len(target) <= index:
            target.append(None)
        target[index] = value
    elif re.fullmatch(r'\w+', key):
        properties[key] = value
    else:
        raise FormatError('Unsupported property assignment: ' + key)


def parse_uc(text, object_name):
    declaration = re.search(r'\bclass\s+(\w+)(?:\s+extends\s+([\w.]+))?', text)
    if not declaration:
        raise FormatError('Missing decompiled class declaration')
    enums = {}
    for match in re.finditer(r'enum\s+(\w+)\s*\{(.*?)\}', text, re.DOTALL):
        body = re.sub(r'//[^\n]*', '', match[2])
        enums[match[1]] = {name.strip(): index for index, name in enumerate(body.split(',')) if name.strip()}
    result = {'object': object_name, 'className': declaration[1], 'superClass': declaration[2],
        'properties': {}, 'children': [], 'enums': enums, 'unparsed': [],
        'nativeDeclarations': [line.strip() for line in text.splitlines() if re.search(r'\bnative\b.*\bfunction\b', line)]}
    active, current = False, result['properties']
    for number, line in enumerate(text.splitlines(), 1):
        value = line.strip()
        if value == 'defaultproperties':
            active = True
            continue
        if not active or value in ('', '{', '}') or value.startswith('//'):
            continue
        match = re.fullmatch(r'begin object name="([^"]+)" class=([\w.]+)', value, re.IGNORECASE)
        if match:
            if current is not result['properties']:
                raise FormatError('Nested emitter subobjects are not supported')
            child = {'name': match[1], 'class': match[2], 'object': object_name + '.' + match[1], 'properties': {}}
            result['children'].append(child)
            current = child['properties']
        elif value.lower() == 'end object':
            current = result['properties']
        else:
            key, separator, content = value.partition('=')
            try:
                if not separator:
                    raise FormatError('Non-assignment default-property line')
                assign(current, key, parse_value(content))
            except FormatError as error:
                result['unparsed'].append({'line': number, 'text': value, 'reason': str(error)})
    if current is not result['properties']:
        raise FormatError('Unclosed native subobject')
    return result


def merge_properties(base, override):
    result = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict) and 'object' not in value:
            result[key] = merge_properties(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def references(value, path=''):
    if isinstance(value, dict):
        if isinstance(value.get('object'), str) and isinstance(value.get('class'), str):
            yield path, value['class'], value['object']
        for key, child in value.items():
            if key not in REFERENCE_IDENTITY_KEYS_SKIPPED_WHILE_DESCENDING_INTO_EMITTER_PROPERTIES:
                yield from references(child, path + '.' + key if path else key)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from references(child, f'{path}[{index}]')


def unparsed_values(value, path=''):
    if isinstance(value, dict):
        if 'unparsedHex' in value:
            yield {'field': path, 'reason': 'Native tagged property preserved without a typed decoder', **value}
        else:
            for key, child in value.items():
                yield from unparsed_values(child, path + '.' + key if path else key)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from unparsed_values(child, f'{path}[{index}]')


class SourcePackages:
    def __init__(self, client):
        self.client, self.loaded = client, {}
        self.client_access = require_reference_client(client)
        self.paths = {}
        for folder in ('animations', 'system', 'systextures', 'textures', 'sounds', 'staticmeshes'):
            directory = client / folder
            if not directory.is_dir():
                continue
            for path in directory.iterdir():
                if path.suffix.lower() in {'.u', '.usk', '.ukx', '.utx', '.uax', '.usx'} and path.is_file():
                    if not path.resolve().is_relative_to(client):
                        raise FormatError('Package link escapes selected source')
                    self.paths.setdefault(path.stem.lower(), []).append(path)

    def get(self, name):
        key = name.lower()
        if key not in self.loaded:
            paths = self.paths.get(key, [])
            if len(paths) != 1:
                raise FormatError('Native package missing/ambiguous: ' + name)
            path = paths[0]
            self.client_access.require_equal_file(path.relative_to(self.client).as_posix())
            self.loaded[key] = (path, Package(path.read_bytes(), path.name))
        return self.loaded[key]

    def resolve(self, reference, expected=None):
        path, package = self.get(reference.split('.')[0])
        exact = [item for item in package.exports if item['object'].lower() == reference.lower()]
        resolution = 'exact-qualified-object'
        if not exact:
            exact = [item for item in package.exports if item['name'].lower() == reference.rsplit('.', 1)[-1].lower()]
            resolution = 'unique-package-leaf-reference'
        if len(exact) != 1:
            raise FormatError('Native object missing/ambiguous: ' + reference)
        item = exact[0]
        actual_class = item['classObject'] if expected and '.' in expected else item['className']
        if expected and actual_class.lower() != expected.lower():
            raise FormatError(f'Native object class mismatch: {reference}: {item["className"]}, expected {expected}')
        return {'reference': reference, 'object': item['object'], 'class': item['className'], 'classObject': item['classObject'], 'resolution': resolution,
            'package': path.relative_to(self.client).as_posix(), 'packageSha256': package.source_hash,
            'exportIndex': item['exportIndex'], 'sourceOffset': item['offset'], 'sourceBytes': item['size']}, package, item


def tagged_values(package, properties):
    values = {}
    for prop in properties:
        value = prop.get('value')
        if prop['type'] in (5, 8):
            value = {'class': 'Object', 'object': value['object']} if value['object'] else None
        elif prop['type'] == 10 and prop['structName'] == 'Vector':
            reader = Reader(bytes.fromhex(prop['payloadHex']))
            value = {axis: reader.number('f') for axis in 'XYZ'}
            if reader.position != reader.end:
                raise FormatError('Unexpected Vector size')
        elif prop['status'] != 'decoded':
            value = {'unparsedHex': prop['payloadHex'], 'type': prop['type'], 'struct': prop['structName']}
        assign(values, prop['name'] + (f'[{prop["arrayIndex"]}]' if prop['arrayIndex'] is not None else ''), value)
    return values


def skill_actions(package, item):
    properties, reader = package.properties(item)
    if reader.position != reader.end:
        raise FormatError('SkillVisualEffect has trailing native data')
    stages, other = [], []
    for prop in properties:
        if prop['name'] not in ACTION_ARRAYS:
            other.append(prop)
            continue
        if prop['type'] != 9:
            raise FormatError('Skill action list is not an array')
        reader = Reader(package.data, prop['payloadOffset'], prop['payloadOffset'] + len(bytes.fromhex(prop['payloadHex'])))
        for index in range(reader.count(10000)):
            fields, after = package.properties({'offset': reader.position, 'size': reader.end - reader.position})
            reader.position = after.position
            values = tagged_values(package, fields)
            action_ref = next((field['value']['index'] for field in fields if field['name'] == 'Action' and field['type'] == 5), None)
            if not action_ref or action_ref < 0:
                raise FormatError('Skill action is not a local authored object')
            action = package.exports[action_ref - 1]
            action_properties, action_reader = package.properties(action)
            if action_reader.position != action_reader.end:
                raise FormatError('Skill action has trailing native data')
            stages.append({'stage': prop['name'], 'index': index, 'info': values, 'infoTags': fields,
                'object': action['object'], 'class': action['classObject'], 'properties': tagged_values(package, action_properties),
                'propertyTags': action_properties, 'sourceOffset': action['offset'], 'sourceBytes': action['size']})
        if reader.position != reader.end:
            raise FormatError('Skill action array was not fully consumed')
    return stages, other


def read_class_defaults(client, reference, work_directory, library=UELIB, powershell=POWERSHELL):
    client, work = Path(client).resolve(strict=True), Path(work_directory).resolve()
    if work.is_relative_to(client):
        raise FormatError('Class-default output must be outside the native client')
    if file_hash(library) != UELIB_SHA256:
        raise FormatError('UELib binary does not match its pinned parser hash')
    packages = SourcePackages(client)
    source, package, item = packages.resolve(reference, 'Class')
    if not re.fullmatch(r'\w+', item['name']):
        raise FormatError('Unsupported native class export name')
    source_path = within(client, source['package'])
    decoded = work / 'decoded' / source_path.name
    script_dir = safe_output(client, work / 'scripts' / 'placeholder').parent
    write_output(client, decoded, package.data)
    request_path = work / 'request.json'
    write_output(client, request_path, json_bytes({'library': str(library.resolve()), 'output': str(script_dir),
        'packages': [{'path': str(decoded), 'label': source_path.stem, 'classes': [item['name']]}]}))
    helper = Path(__file__).with_name('extract_ue_defaults.ps1')
    run = subprocess.run([str(powershell), '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(helper), '-Request', str(request_path)],
        cwd=work, capture_output=True, timeout=120, stdin=subprocess.DEVNULL, check=False)
    write_output(client, work / 'decompile.log', run.stdout + run.stderr)
    if run.returncode:
        raise FormatError('Native class decompilation failed; see ' + str(work / 'decompile.log'))
    script = script_dir / (source_path.stem + '.' + item['name'] + '.uc')
    text = script.read_text(encoding='utf-8-sig')
    if re.search(r'(failed to decompile|exception occurred|deserialization error)', text, re.IGNORECASE):
        raise FormatError('UELib reported incomplete class decompilation: ' + reference)
    result = parse_uc(text, source['object'])
    if result['unparsed']:
        raise FormatError('Native class contains unsupported default-property syntax: ' + reference)
    if file_hash(source_path) != source['packageSha256']:
        raise FormatError('Native class source changed during extraction')
    result.update({'schemaVersion': 1, 'source': source,
        'sourceScript': script.relative_to(work).as_posix(), 'sourceScriptSha256': file_hash(script),
        'uelibSha256': UELIB_SHA256, 'helperSha256': file_hash(helper),
        'limitations': ['Authored class defaults only; omitted and inherited values are not fabricated.',
            'Class export bounds are known; individual serialized default-property offsets are not exposed by this adapter.',
            'Bone names and mesh bindings do not establish native C++ attachment formulas.']})
    write_output(client, work / 'defaults.json', json_bytes(result))
    return result


def select_skill_rows(skill_table, sound_table, skill_id, level):
    skill_rows = [row for row in skill_table['data']['skill'] if row['skill_id'] == skill_id and row['skill_level'] == level]
    sound_rows = [row for row in sound_table['data']['skillsound'] if row['skill_id'] == skill_id and row['skill_level'] == level]
    if len(skill_rows) != 1 or len(sound_rows) != 1:
        raise FormatError('Exact native skill/level presentation and sound rows must each be unique; no fallback is inferred')
    skill, sounds = skill_rows[0], sound_rows[0]
    if not skill['description'] or '.' not in skill['description']:
        raise FormatError('The selected skill has no explicit native visual-effect object reference')
    return skill, sounds


def verify(client, output):
    client, output = client.resolve(strict=True), output.resolve(strict=True)
    client_access = require_reference_client(client)
    if output.is_relative_to(client):
        raise FormatError('Effect output must be outside the native client')
    receipt = json.loads(output.with_suffix('.receipt.json').read_text())
    if file_hash(output) != receipt['outputSha256']:
        raise FormatError('Effect graph hash mismatch')
    graph = json.loads(output.read_text())
    if graph['schemaVersion'] != 1 or receipt['schemaVersion'] != 1:
        raise FormatError('Unsupported effect graph or receipt version')
    if graph['sourceRoot'] != str(client):
        raise FormatError('Verification client differs from source provenance')
    if graph['sourceFiles'] != receipt['sourceFiles'] or graph['tools'] != receipt['tools']:
        raise FormatError('Effect receipt provenance differs from graph')
    for record in receipt['sourceFiles']:
        path = client_access.require_equal_file(record['path'])
        if path.stat().st_size != record['bytes'] or file_hash(path) != record['sha256']:
            raise FormatError('Native effect source hash mismatch: ' + record['path'])
    for record in receipt['artifacts']:
        path = within(output.parent, record['file'])
        if path.stat().st_size != record['bytes'] or file_hash(path) != record['sha256']:
            raise FormatError('Native effect artifact hash mismatch: ' + record['file'])
    return graph


def extract(client, output, skill_id=1011, level=1, library=UELIB, powershell=POWERSHELL):
    client, output = client.resolve(strict=True), output.resolve()
    if output.is_relative_to(client):
        raise FormatError('Effect output must be outside the native client')
    if file_hash(library) != UELIB_SHA256:
        raise FormatError('UELib binary does not match its pinned parser hash')
    skill_table, sound_table = decode_table(client, 'skillgrp'), decode_table(client, 'skillsoundgrp')
    skill, sounds = select_skill_rows(skill_table, sound_table, skill_id, level)
    reference = skill['description']
    packages = SourcePackages(client)
    root, package, item = packages.resolve(reference, 'SkillVisualEffect')
    stages, other = skill_actions(package, item)
    effect_records = []
    for stage in stages:
        value = stage['properties'].get('EffectClass')
        if not isinstance(value, dict) or not value.get('object'):
            raise FormatError('Unsupported skill action without an explicit effect-class reference')
        record, _, effect_item = packages.resolve(value['object'], 'Class')
        effect_records.append(record)
        stage['effectObject'] = record['object']
    effect_records = list({row['object']: row for row in effect_records}.values())
    work = safe_output(client, output.parent / (output.stem + '-source') / 'request.json').parent
    scripts = work / 'scripts'
    safe_output(client, scripts / 'placeholder')
    requests = []
    classes_by_package = {'engine': list(ENGINE_CLASSES[1:]), 'core': ['Object']}
    for row in effect_records:
        classes_by_package.setdefault(row['object'].split('.')[0].lower(), []).append(row['object'].rsplit('.', 1)[-1])
    source_records = []
    artifacts = []

    def save(path, data):
        receipt = write_output(client, path, data)
        receipt['file'] = path.relative_to(output.parent).as_posix()
        artifacts.append(receipt)
        return receipt['file']

    for name, classes in classes_by_package.items():
        path, native = packages.get(name)
        decoded_path = work / 'decoded' / path.name
        save(decoded_path, native.data)
        requests.append({'path': str(decoded_path), 'label': path.stem, 'classes': sorted(set(classes))})
    request = {'library': str(library.resolve()), 'output': str(scripts), 'packages': requests}
    request_path = work / 'request.json'
    save(request_path, json_bytes(request))
    helper = Path(__file__).with_name('extract_ue_defaults.ps1')
    result = subprocess.run([str(powershell), '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(helper), '-Request', str(request_path)],
        cwd=work, capture_output=True, timeout=120, stdin=subprocess.DEVNULL, check=False)
    save(work / 'decompile.log', result.stdout + result.stderr)
    if result.returncode:
        raise FormatError('Native class decompilation failed; see ' + str(work / 'decompile.log'))
    defaults = {}
    for request_package in requests:
        for name in request_package['classes']:
            path = scripts / (request_package['label'] + '.' + name + '.uc')
            text = path.read_text(encoding='utf-8-sig')
            if re.search(r'(failed to decompile|exception occurred|deserialization error)', text, re.IGNORECASE):
                raise FormatError('UELib reported incomplete class decompilation: ' + name)
            source_name = request_package['label'] + '.' + name
            value = parse_uc(text, source_name)
            value['sourceScript'] = save(path, path.read_bytes())
            value['sourceScriptSha256'] = file_hash(path)
            defaults[source_name.lower()] = value

    def inherited(name, trail=()):
        name = name.lower()
        if name in trail or len(trail) > 50:
            raise FormatError('Cyclic native class default inheritance')
        definition = defaults.get(name)
        if not definition:
            raise FormatError('Required class defaults were not recovered: ' + name)
        parent = definition['superClass']
        parent_name = parent if parent and '.' in parent else 'core.Object' if parent == 'Object' else 'engine.' + parent if parent else None
        base = inherited(parent_name, trail + (name,)) if parent_name else {}
        return merge_properties(base, definition['properties'])

    effects = []
    for record in effect_records:
        definition = defaults[record['object'].lower()]
        definition['effectiveProperties'] = inherited(record['object'])
        for child in definition['children']:
            child['effectiveProperties'] = merge_properties(inherited(child['class']), child['properties'])
        effects.append(definition)
    for stage in stages:
        stage['effectiveProperties'] = merge_properties(inherited(stage['class']), stage['properties'])
    dependency_rows, unresolved = [], []
    seen = set()
    for effect in effects:
        for field, expected, ref in references({'properties': effect['effectiveProperties'], 'children': effect['children']}):
            key = (effect['object'], field, ref)
            if key in seen:
                continue
            seen.add(key)
            try:
                record, _, _ = packages.resolve(ref, expected)
                dependency_rows.append({'from': effect['object'], 'field': field, **record})
            except FormatError as error:
                unresolved.append({'from': effect['object'], 'field': field, 'reference': ref, 'reason': str(error)})
    for field, reference in sounds.items():
        if not isinstance(reference, str) or '.' not in reference:
            continue
        try:
            record, _, _ = packages.resolve(reference, 'Sound')
            dependency_rows.append({'from': 'skillsoundgrp', 'field': field, **record})
        except FormatError as error:
            unresolved.append({'from': 'skillsoundgrp', 'field': field, 'reference': reference, 'reason': str(error)})
    for path, native in packages.loaded.values():
        if file_hash(path) != native.source_hash:
            raise FormatError('Source package changed during extraction')
        source_records.append({'path': path.relative_to(client).as_posix(), 'bytes': path.stat().st_size, 'sha256': native.source_hash})
    for table in (skill_table, sound_table):
        path = packages.client_access.require_equal_file(table['source'])
        if file_hash(path) != table['sourceSha256']:
            raise FormatError('Source table changed during extraction')
        source_records.append({'path': table['source'], 'bytes': path.stat().st_size, 'sha256': table['sourceSha256']})
    unsupported = [
        {'feature': 'native-skill-dispatch', 'reason': 'TriggerCasting/Shot and SkillAction Notify are native C++ declarations; implementations are absent.'},
        {'feature': 'native-attachment', 'reason': 'EAM_Trail, bRelativeToCylinder, offsets and target flags are recovered; native attachment formulas are not.'},
        {'feature': 'native-particle-integration', 'reason': 'ParticleEmitter integration is native; exact spin/polar/velocity-loss/forced-lifetime behavior is not implemented here.'},
        {'feature': 'native-blend-equations', 'reason': 'DrawStyle enum labels are recovered; original renderer equations are not inferred from labels.'},
        {'feature': 'native-audio-gain-and-randomness', 'reason': 'Original volume/radius/voice columns are preserved; Web Audio gain and native random dispatch are not inferred.'},
        {'feature': 'implicit-class-values', 'reason': 'All recovered authored class defaults are inherited; omitted zero/constructor values are not fabricated.'},
        {'feature': 'transitive-asset-conversion', 'reason': 'Referenced asset identities are resolved; geometry/material/audio conversion is a separate tool.'},
    ]
    other_values = tagged_values(package, other)
    unparsed = [{'object': value['object'], **entry} for value in defaults.values() for entry in value['unparsed']]
    unparsed.extend(unparsed_values({'stages': stages, 'rootOtherValues': other_values}))
    graph = {'schemaVersion': 1, 'edition': 'interlude', 'sourceRoot': str(client), 'skillId': skill_id, 'level': level,
        'skillRow': skill, 'soundRow': sounds, 'tableSchemas': [skill_table['schema'], sound_table['schema']],
        'visualRoot': root, 'stages': stages, 'rootOtherProperties': other, 'rootOtherValues': other_values, 'effects': effects,
        'classDefaults': [value for key, value in defaults.items() if key.startswith(('engine.', 'core.'))],
        'dependencies': dependency_rows, 'unresolvedDependencies': unresolved, 'sourceFiles': sorted(source_records, key=lambda row: row['path']),
        'unsupported': unsupported, 'unsupportedFeatureCount': len(unsupported), 'unparsedPropertyCount': len(unparsed),
        'unparsedProperties': unparsed, 'rendererImplemented': False,
        'previewFeasibility': {'castingMeshEmitters': sum(child['class'] == 'Engine.MeshEmitter' for effect in effects for child in effect['children']),
            'spriteEmitters': sum(child['class'] == 'Engine.SpriteEmitter' for effect in effects for child in effect['children']),
            'beamEmitters': sum(child['class'] == 'Engine.BeamEmitter' for effect in effects for child in effect['children']),
            'scope': 'A source-backed preview can display exported meshes/textures and author a documented supported subset of timing/colour/size fields; it cannot claim native equivalence from this graph.'},
        'tools': {'uelibSha256': UELIB_SHA256, 'helperSha256': file_hash(helper),
            'parserImplementation': {name: file_hash(Path(__file__).with_name(name))
                for name in ('effects.py', 'ue2.py', 'tables.py', 'cli.py')}}}
    save(output, json_bytes(graph))
    receipt = {'schemaVersion': 1, 'outputSha256': file_hash(output), 'sourceFiles': graph['sourceFiles'],
        'artifacts': artifacts, 'tools': graph['tools']}
    write_output(client, output.with_suffix('.receipt.json'), json_bytes(receipt))
    return graph
