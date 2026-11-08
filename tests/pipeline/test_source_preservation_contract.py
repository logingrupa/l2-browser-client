import ast
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import native_assets
from native_assets import Converter
from reference_client_lock_fixture import lock_client_as_reference_root

OUTPUT_CONTRACT_PATH = ROOT / 'docs' / 'OUTPUT_CONTRACT.md'
REVIEWED_UMODEL_BUILD1590_SHA256 = '13502e5a4d8f6b5f32252afebd6360f7302ccfaccf6b8dda65beff0be2d364a0'
REPO_OWNED_UMODEL_FOLDER = '/.assets/native-tools/umodel/'


def read_source_preservation_section():
    lines = OUTPUT_CONTRACT_PATH.read_text(encoding='utf-8').splitlines()
    if '## Source preservation' not in lines:
        raise AssertionError('docs/OUTPUT_CONTRACT.md has no Source preservation section')
    start = lines.index('## Source preservation') + 1
    section_lines = []
    for line in lines[start:]:
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


def table_rows(table_lines):
    header = markdown_table_cells(table_lines[0])
    rows = []
    for line in table_lines[2:]:
        cells = markdown_table_cells(line)
        if len(cells) != len(header):
            raise AssertionError(f'Source preservation row has {len(cells)} cells, header has {len(header)}: {line}')
        rows.append({name: strip_one_backtick_pair(cell) for name, cell in zip(header, cells)})
    return rows


def source_preservation_rows(section, table_index=0):
    tables = markdown_tables(section)
    if len(tables) <= table_index:
        raise AssertionError(f'Source preservation section has no table {table_index}')
    return table_rows(tables[table_index])


def umodel_cli_default_expression():
    tree = ast.parse((ROOT / 'scripts' / 'native_assets.py').read_text(encoding='utf-8'))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'add_argument'
                and node.args and isinstance(node.args[0], ast.Constant) and node.args[0].value == '--umodel'):
            return next(ast.unparse(keyword.value) for keyword in node.keywords if keyword.arg == 'default')
    raise AssertionError('scripts/native_assets.py declares no --umodel option')


class UmodelPinContractTests(unittest.TestCase):
    def test_code_pins_reviewed_build1590(self):
        self.assertEqual(native_assets.UMODEL_SHA256, REVIEWED_UMODEL_BUILD1590_SHA256)

    def test_contract_states_the_same_pin(self):
        self.assertIn(native_assets.UMODEL_SHA256, read_source_preservation_section())

    def test_converter_refuses_a_differently_hashed_umodel(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client = root / 'source'
            client.mkdir()
            lock_client_as_reference_root(self, client)
            tool = root / 'umodel.exe'
            tool.write_bytes(b'not the reviewed umodel')
            with self.assertRaisesRegex(ValueError, 'UModel hash differs'):
                Converter(client, root / 'artifacts' / 'output', tool, project_root=root)
            self.assertFalse((root / 'artifacts' / 'output').exists())

    def test_default_umodel_is_the_repo_owned_tool(self):
        self.assertIn(REPO_OWNED_UMODEL_FOLDER, native_assets.UMODEL.as_posix().casefold())
        self.assertEqual(umodel_cli_default_expression(), 'str(UMODEL)')


if __name__ == '__main__':
    unittest.main()
