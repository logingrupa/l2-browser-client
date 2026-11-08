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
        except ValueError as error:
            raise type(error)(f'UModel would read {package_name} while converting {root_package_name}: {error}') from error
        pending_package_names.extend(top_level_import_package_names(package))
    return sorted(checked_package_names)
