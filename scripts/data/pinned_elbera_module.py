from __future__ import annotations

import ast
import hashlib
import importlib.util
from pathlib import Path
import sys

ELBERA_ROOT = Path('E:/Lineage2Elbera')
ELBERA_COMMIT = '12c9656'
MODULE_NAME_HASH_PREFIX_LENGTH = 12
SIDE_EFFECT_FREE_STATEMENT_TYPES = (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.ClassDef, ast.Assign, ast.AnnAssign)


class PinnedElberaModuleError(ValueError):
    pass


def resolve_elbera_path(relative_path, elbera_root=ELBERA_ROOT):
    if not isinstance(relative_path, str) or not relative_path or Path(relative_path).is_absolute() or '\\' in relative_path:
        raise PinnedElberaModuleError(f'Elbera path must be a relative forward-slash path: {relative_path!r}')
    root = Path(elbera_root).resolve()
    path = (root / relative_path).resolve()
    if not path.is_relative_to(root) or path == root:
        raise PinnedElberaModuleError(f'Elbera path escapes the Elbera root {root.as_posix()}: {relative_path}')
    if not path.is_file():
        raise PinnedElberaModuleError(f'Elbera file is missing: {path.as_posix()}')
    return path


def require_pinned_elbera_bytes(relative_path, expected_sha256, elbera_root):
    path = resolve_elbera_path(relative_path, elbera_root)
    payload = path.read_bytes()
    actual_sha256 = hashlib.sha256(payload).hexdigest()
    if actual_sha256 != expected_sha256:
        raise PinnedElberaModuleError(
            f'Elbera {relative_path} SHA-256 {actual_sha256} differs from its pin {expected_sha256} (commit {ELBERA_COMMIT})')
    return path, payload


def require_pinned_elbera_script(relative_path, expected_sha256, elbera_root=ELBERA_ROOT):
    return require_pinned_elbera_bytes(relative_path, expected_sha256, elbera_root)[0]


def is_main_guard(statement):
    test = statement.test
    return (isinstance(test, ast.Compare) and isinstance(test.left, ast.Name) and test.left.id == '__name__'
            and len(test.ops) == 1 and isinstance(test.ops[0], ast.Eq) and len(test.comparators) == 1
            and isinstance(test.comparators[0], ast.Constant) and test.comparators[0].value == '__main__')


def is_docstring(statement, index):
    return index == 0 and isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Constant) and isinstance(
        statement.value.value, str)


def require_side_effect_free_top_level(source_tree, relative_path):
    for index, statement in enumerate(source_tree.body):
        if isinstance(statement, SIDE_EFFECT_FREE_STATEMENT_TYPES) or is_docstring(statement, index):
            continue
        if isinstance(statement, ast.If) and is_main_guard(statement) and not statement.orelse:
            continue
        raise PinnedElberaModuleError(
            f'Elbera {relative_path} line {statement.lineno} holds a top-level {type(statement).__name__} statement; refused')


def load_pinned_elbera_module(relative_path, expected_sha256, elbera_root=ELBERA_ROOT):
    sys.dont_write_bytecode = True
    path, payload = require_pinned_elbera_bytes(relative_path, expected_sha256, elbera_root)
    try:
        source_tree = ast.parse(payload, filename=path.as_posix())
    except SyntaxError as error:
        raise PinnedElberaModuleError(f'Elbera {relative_path} does not parse: {error}') from error
    require_side_effect_free_top_level(source_tree, relative_path)
    module_name = f'pinned_elbera_{path.stem}_{expected_sha256[:MODULE_NAME_HASH_PREFIX_LENGTH]}'
    specification = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(specification)
    exec(compile(source_tree, path.as_posix(), 'exec', dont_inherit=True), module.__dict__)
    return module
