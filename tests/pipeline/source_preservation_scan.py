import ast
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'scripts'
SOURCE = ROOT / 'src'
OUTPUT_CONTRACT_PATH = ROOT / 'docs' / 'OUTPUT_CONTRACT.md'
SOURCE_PRESERVATION_PREFIXES = ('repair_', 'restore_', 'preserve_')
SOURCE_PRESERVATION_FILE_PREFIXES = ('repair-', 'restore-', 'preserve-')
SOURCE_PRESERVATION_RECORD_KIND_PREFIXES = ('omit-', 'repair-', 'restore-', 'preserve-')
SOURCE_REPAIR_EXPORT_PATTERN = re.compile(r'export function ((?:fnRepair|repair)\w*)')
IDENTIFIER_PATTERN = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')
BANNED_NORMALISATION_PATTERN = re.compile('|'.join((
    r'(re)?normali[sz](e|es|ed|ing|ation)?(height|scale|size|weight|weights|skeleton|bone|bones|root|rootmotion)',
    r'(height|scale|size|weight|weights)(re)?normali[sz]',
    r'(fit|snap|align)(to)?ground',
    r'ground(fit|fitting|snap|align)',
    r'(remove|removal|strip|cancel|zero)root(drift|motion)',
    r'root(drift|motion)(remove|removal|strip|cancel)',
    r'scaleto(height|metres|meters)',
)))
JSON_WHITESPACE_PATTERN = re.compile(r'[ \t\n\r]*')
EVIDENCE_PATH_PATTERN = re.compile(r'(?P<path>[^\s:]+)(?::(?P<line>\d+))?')
UNRESOLVED_EVIDENCE_PREFIX = 'unresolved: '


def repo_relative(path):
    return Path(path).resolve().relative_to(ROOT).as_posix()


def script_files(*suffixes):
    vendor = SCRIPTS / 'vendor'
    return sorted((path for suffix in suffixes for path in SCRIPTS.rglob(f'*{suffix}')
                   if path.is_file() and not path.is_relative_to(vendor)), key=repo_relative)


def normalisation_scan_files():
    return sorted([*script_files('.py', '.mjs'), *SOURCE.rglob('*.ts')], key=repo_relative)


def banned_identifiers_in_text(text):
    return sorted({identifier for identifier in IDENTIFIER_PATTERN.findall(text)
                   if BANNED_NORMALISATION_PATTERN.search(identifier.replace('_', '').lower())})


def banned_identifier_violations(paths, allow_list):
    return sorted((repo_relative(path), identifier) for path in paths if repo_relative(path) not in allow_list
                  for identifier in banned_identifiers_in_text(path.read_text(encoding='utf-8')))


def files_containing(paths, literal):
    return sorted(repo_relative(path) for path in paths if literal in path.read_text(encoding='utf-8'))


def source_preservation_function_names(path):
    tree = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
    return {node.name for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith(SOURCE_PRESERVATION_PREFIXES)}


def source_preservation_record_kinds(path):
    tree = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
    return {value.value for node in ast.walk(tree) if isinstance(node, ast.Dict)
            for key, value in zip(node.keys, node.values)
            if isinstance(key, ast.Constant) and key.value == 'kind'
            and isinstance(value, ast.Constant) and isinstance(value.value, str)
            and value.value.startswith(SOURCE_PRESERVATION_RECORD_KIND_PREFIXES)}


def scanned_source_preservation_steps():
    steps = set()
    for path in script_files('.py'):
        steps |= source_preservation_function_names(path)
    steps |= {path.name for path in SCRIPTS.iterdir() if path.is_file() and path.name.startswith(SOURCE_PRESERVATION_FILE_PREFIXES)}
    for path in sorted((SCRIPTS / 'native_assets_lib').rglob('*.py'), key=repo_relative):
        steps |= source_preservation_record_kinds(path)
    for path in sorted(SOURCE.rglob('*.ts'), key=repo_relative):
        steps |= set(SOURCE_REPAIR_EXPORT_PATTERN.findall(path.read_text(encoding='utf-8')))
    return sorted(steps)


def defect_evidence_problem(cell):
    if cell.startswith(UNRESOLVED_EVIDENCE_PREFIX):
        return None if cell[len(UNRESOLVED_EVIDENCE_PREFIX):].strip() else 'unresolved evidence names no missing proof'
    match = EVIDENCE_PATH_PATTERN.fullmatch(cell)
    if not match:
        return f'evidence is neither a repo path nor unresolved: {cell!r}'
    path = ROOT / match['path']
    if not path.is_file():
        return f'evidence path does not exist: {match["path"]}'
    if match['line'] and not 1 <= int(match['line']) <= len(path.read_text(encoding='utf-8').splitlines()):
        return f'evidence line is outside {match["path"]}: {match["line"]}'
    return None


def read_source_preservation_section():
    lines = OUTPUT_CONTRACT_PATH.read_text(encoding='utf-8').splitlines()
    if '## Source preservation' not in lines:
        raise AssertionError('docs/OUTPUT_CONTRACT.md has no Source preservation section')
    section_lines = []
    for line in lines[lines.index('## Source preservation') + 1:]:
        if line.startswith('## '):
            break
        section_lines.append(line)
    return '\n'.join(section_lines)


def markdown_table_cells(line):
    return [cell.strip() for cell in line.strip().strip('|').split('|')]


def strip_one_backtick_pair(cell):
    if len(cell) >= 2 and cell.startswith('`') and cell.endswith('`') and cell.count('`') == 2:
        return cell[1:-1]
    return cell


def markdown_tables(section):
    tables, current_table = [], []
    for line in section.splitlines():
        if line.startswith('|'):
            current_table.append(line)
        elif current_table:
            tables.append(current_table)
            current_table = []
    if current_table:
        tables.append(current_table)
    return tables


def source_preservation_rows(section, table_index=0):
    tables = markdown_tables(section)
    if len(tables) <= table_index:
        raise AssertionError(f'Source preservation section has no table {table_index}')
    header = markdown_table_cells(tables[table_index][0])
    rows = []
    for line in tables[table_index][2:]:
        cells = markdown_table_cells(line)
        if len(cells) != len(header):
            raise AssertionError(f'Source preservation row has {len(cells)} cells, header has {len(header)}: {line}')
        rows.append({name: strip_one_backtick_pair(cell) for name, cell in zip(header, cells)})
    return rows


def skip_json_whitespace(text, position):
    return JSON_WHITESPACE_PATTERN.match(text, position).end()


def require_json_character(text, position, expected):
    if position >= len(text) or text[position] not in expected:
        raise ValueError(f'Expected one of {expected!r} at offset {position}')
    return text[position]


def acceptance_member_value_texts(text):
    decoder = json.JSONDecoder()
    position = skip_json_whitespace(text, 0)
    require_json_character(text, position, '{')
    position = skip_json_whitespace(text, position + 1)
    members, keys = [], set()
    if position < len(text) and text[position] == '}':
        position += 1
    else:
        while True:
            require_json_character(text, position, '"')
            key, position = decoder.raw_decode(text, position)
            if key in keys:
                raise ValueError(f'Duplicate top-level key: {key}')
            keys.add(key)
            position = skip_json_whitespace(text, position)
            require_json_character(text, position, ':')
            value_start = skip_json_whitespace(text, position + 1)
            _, value_end = decoder.raw_decode(text, value_start)
            members.append((key, text[value_start:value_end]))
            position = skip_json_whitespace(text, value_end)
            if require_json_character(text, position, ',}') == '}':
                position += 1
                break
            position = skip_json_whitespace(text, position + 1)
    if text[position:].strip(' \t\n\r'):
        raise ValueError(f'Trailing data after the top-level object at offset {position}')
    return members


def acceptance_member_sha256s(text):
    return tuple((key, hashlib.sha256(value_text.encode('utf-8')).hexdigest()) for key, value_text in acceptance_member_value_texts(text))


def acceptance_text_from_members(members):
    return '{\n' + ',\n'.join(f'  {json.dumps(key)}: {value_text}' for key, value_text in members) + '\n}\n'
