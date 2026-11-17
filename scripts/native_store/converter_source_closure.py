import ast
from functools import cache
import hashlib
from pathlib import Path
import re

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
PYTHON_SOURCE_SUFFIX = '.py'
REFERENCED_SOURCE_SUFFIXES = frozenset({'.py', '.ps1', '.psm1', '.mjs', '.cjs', '.js', '.json'})
SKIPPED_FOLDER_NAMES = frozenset({'__pycache__'})
REFERENCED_FILE_NAME_PATTERN = re.compile(r'[A-Za-z0-9_.-]+\.(?:py|ps1|psm1|mjs|cjs|js|json)(?![A-Za-z0-9_])')
DOTTED_MODULE_NAME_PATTERN = re.compile(r'[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*')
PYTHON_IMPORT_TEXT_PATTERN = re.compile(r'(?<![A-Za-z0-9_.])(?:from|import)\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)')
DYNAMIC_CODE_LOADER_NAMES = frozenset({'import_module', '__import__', 'spec_from_file_location', 'SourceFileLoader', 'load_source',
                                       'run_path', 'run_module', 'exec', 'eval'})
PINNED_EXTERNAL_SOURCE_LOADERS = frozenset({'data/pinned_elbera_module.py'})


class ConverterSourceClosureError(ValueError):
    pass


def lf_normalized_sha256(path):
    return hashlib.sha256(Path(path).read_bytes().replace(b'\r\n', b'\n')).hexdigest()


def module_source_path(scripts_root, module_name):
    parts = module_name.split('.')
    for candidate in (scripts_root.joinpath(*parts[:-1], parts[-1] + PYTHON_SOURCE_SUFFIX), scripts_root.joinpath(*parts, '__init__.py')):
        if candidate.is_file():
            return candidate
    return None


def module_and_package_source_paths(scripts_root, module_name):
    parts = module_name.split('.')
    found = (module_source_path(scripts_root, '.'.join(parts[:length])) for length in range(1, len(parts) + 1))
    return [path for path in found if path is not None]


def string_constants(tree):
    return [node.value for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str)]


def called_name(call):
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return None


class ScriptsSourceIndex:
    def __init__(self, scripts_root):
        self.scripts_root = Path(scripts_root).resolve()
        self.source_paths_by_file_name = {}
        for path in sorted(self.scripts_root.rglob('*')):
            if path.is_file() and path.suffix in REFERENCED_SOURCE_SUFFIXES and not SKIPPED_FOLDER_NAMES.intersection(path.parts):
                self.source_paths_by_file_name.setdefault(path.name, []).append(path)
        self.referenced_paths_by_source_path = {}
        self.content_sha256_by_source_path = {}

    def relative_path(self, source_path):
        return source_path.relative_to(self.scripts_root).as_posix()

    def package_parts(self, source_path):
        return list(source_path.relative_to(self.scripts_root).parts[:-1])

    def paths_named_in_text(self, text):
        paths = []
        for file_name in REFERENCED_FILE_NAME_PATTERN.findall(text):
            paths.extend(self.source_paths_by_file_name.get(Path(file_name).name, ()))
        for module_name in PYTHON_IMPORT_TEXT_PATTERN.findall(text):
            paths.extend(module_and_package_source_paths(self.scripts_root, module_name))
        return paths

    def absolute_imported_module_name(self, source_path, node):
        if not node.level:
            return node.module
        parts = self.package_parts(source_path)
        if node.level - 1 > len(parts):
            raise ConverterSourceClosureError(f'{self.relative_path(source_path)}:{node.lineno} imports above the scripts root')
        return '.'.join(parts[:len(parts) - (node.level - 1)] + ([node.module] if node.module else []))

    def imported_module_names(self, source_path, tree):
        names = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                base_name = self.absolute_imported_module_name(source_path, node)
                if base_name:
                    names.append(base_name)
                names.extend(f'{base_name}.{alias.name}' if base_name else alias.name for alias in node.names if alias.name != '*')
        return names

    def paths_named_by_loader_argument(self, text):
        module_paths = module_and_package_source_paths(self.scripts_root, text) if DOTTED_MODULE_NAME_PATTERN.fullmatch(text) else []
        return module_paths + self.paths_named_in_text(text)

    def dynamically_loaded_paths(self, source_path, tree):
        if self.relative_path(source_path) in PINNED_EXTERNAL_SOURCE_LOADERS:
            return []
        paths = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and called_name(node) in DYNAMIC_CODE_LOADER_NAMES:
                loaded_paths = [path for text in string_constants(node) for path in self.paths_named_by_loader_argument(text)]
                if not loaded_paths:
                    raise ConverterSourceClosureError(
                        f'{self.relative_path(source_path)}:{node.lineno} loads code through {called_name(node)} by a name that names no '
                        f'file or module under the scripts root; write the loaded module or file name as a literal so the step '
                        f'fingerprint covers it')
                paths.extend(loaded_paths)
        return paths

    def imported_source_paths(self, source_path, module_name):
        import_roots = (self.scripts_root,) if source_path.parent == self.scripts_root else (self.scripts_root, source_path.parent)
        return [path for import_root in import_roots for path in module_and_package_source_paths(import_root, module_name)]

    def python_referenced_paths(self, source_path):
        tree = ast.parse(source_path.read_bytes(), filename=source_path.as_posix())
        paths = self.dynamically_loaded_paths(source_path, tree)
        paths.extend(path for name in self.imported_module_names(source_path, tree) for path in self.imported_source_paths(source_path, name))
        for text in string_constants(tree):
            paths.extend(self.paths_named_in_text(text))
        parts = self.package_parts(source_path)
        paths.extend(path for length in range(1, len(parts) + 1)
                     if (path := self.scripts_root.joinpath(*parts[:length], '__init__.py')).is_file())
        return paths

    def referenced_paths(self, source_path):
        if source_path not in self.referenced_paths_by_source_path:
            self.referenced_paths_by_source_path[source_path] = (
                self.python_referenced_paths(source_path) if source_path.suffix == PYTHON_SOURCE_SUFFIX
                else self.paths_named_in_text(source_path.read_bytes().decode('utf-8', errors='replace')))
        return self.referenced_paths_by_source_path[source_path]

    def content_sha256(self, source_path):
        if source_path not in self.content_sha256_by_source_path:
            self.content_sha256_by_source_path[source_path] = lf_normalized_sha256(source_path)
        return self.content_sha256_by_source_path[source_path]

    def closure(self, entry_module_names):
        pending = []
        for module_name in entry_module_names:
            entry_path = module_source_path(self.scripts_root, module_name)
            if entry_path is None:
                raise ConverterSourceClosureError(f'entry module {module_name} has no source under {self.scripts_root.as_posix()}')
            pending.append(entry_path)
        closure = set()
        while pending:
            source_path = pending.pop()
            if source_path in closure:
                continue
            closure.add(source_path)
            pending.extend(path for path in self.referenced_paths(source_path) if path not in closure)
        return sorted(closure, key=self.relative_path)

    def closure_relative_paths(self, entry_module_names):
        return [self.relative_path(path) for path in self.closure(entry_module_names)]

    def sources_sha256(self, entry_module_names):
        digest = hashlib.sha256()
        for source_path in self.closure(entry_module_names):
            digest.update(self.relative_path(source_path).encode('utf-8') + b'\0' + self.content_sha256(source_path).encode('ascii') + b'\n')
        return digest.hexdigest()


@cache
def process_scripts_source_index():
    return ScriptsSourceIndex(SCRIPTS_ROOT)


@cache
def process_converter_sources_sha256(entry_module_names):
    return process_scripts_source_index().sources_sha256(entry_module_names)
