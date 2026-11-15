from pathlib import Path

from reference_client_guard import ReferenceClientLockError

UMODEL_PACKAGE_SUFFIXES = ('.ukx', '.utx', '.usx', '.uax', '.u', '.unr')


class UModelImportClosureError(ValueError):
    pass


def index_package_files_by_casefolded_stem(client):
    package_files_by_casefolded_stem = {}
    for path in client.rglob('*'):
        if path.is_file() and path.suffix.lower() in UMODEL_PACKAGE_SUFFIXES:
            package_files_by_casefolded_stem.setdefault(path.stem.casefold(), []).append(path)
    return package_files_by_casefolded_stem


def resolve_package_path(client, package_files_by_casefolded_stem, name):
    exact = (client / name).resolve()
    if exact.is_file():
        return exact
    matches = package_files_by_casefolded_stem.get(Path(name).stem.casefold(), [])
    if len(matches) != 1:
        raise ValueError(f'Package name missing or ambiguous: {name}')
    return matches[0]


def top_level_import_package_names(package):
    names_by_casefold = {}
    for item in package.imports:
        if item['outerIndex'] == 0:
            names_by_casefold.setdefault(item['name'].casefold(), item['name'])
    return [names_by_casefold[key] for key in sorted(names_by_casefold)]


def require_lock_equal_import_closure(root_package_name, load_lock_equal_package):
    pending_package_names = [root_package_name]
    checked_package_names = set()
    while pending_package_names:
        package_name = pending_package_names.pop()
        if package_name.casefold() in checked_package_names:
            continue
        checked_package_names.add(package_name.casefold())
        try:
            _, package = load_lock_equal_package(package_name)
        except ReferenceClientLockError as error:
            raise ReferenceClientLockError(f'UModel would read {package_name} while converting {root_package_name}: {error}') from error
        except ValueError as error:
            raise UModelImportClosureError(f'UModel would read {package_name} while converting {root_package_name}: {error}') from error
        pending_package_names.extend(top_level_import_package_names(package))
    return sorted(checked_package_names)
