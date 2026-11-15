from typing import NamedTuple

from native_catalog.ue2 import FormatError

NATIVE_CLASS_EXPORT_KIND = 'Class'


class ClassClosurePack(NamedTuple):
    items: tuple
    class_closure: tuple


class ClassClosurePacking(NamedTuple):
    packs: tuple
    over_limit_items: tuple


def native_class_closure(packages, class_reference):
    closure, visited, reference = [], set(), class_reference
    while reference:
        record, package, item = packages.resolve(reference, NATIVE_CLASS_EXPORT_KIND)
        qualified_name = record['object']
        if qualified_name.casefold() in visited:
            raise FormatError('Cyclic native class inheritance: ' + qualified_name)
        visited.add(qualified_name.casefold())
        closure.append(qualified_name)
        reference = package.object_name(item['superIndex'])
    return tuple(sorted(closure))


def pack_items_by_class_closure(items, closure_of, maximum_closure_size, maximum_items):
    if type(maximum_closure_size) is not int or maximum_closure_size < 1 or type(maximum_items) is not int or maximum_items < 1:
        raise ValueError(f'pack limits must be positive integers: {maximum_closure_size!r}, {maximum_items!r}')
    packs, over_limit_items = [], []
    pack_items, pack_closure = [], set()
    for item in items:
        item_closure = set(closure_of(item))
        if len(item_closure) >= maximum_closure_size:
            over_limit_items.append(item)
            continue
        if pack_items and (len(pack_closure | item_closure) >= maximum_closure_size or len(pack_items) + 1 > maximum_items):
            packs.append(ClassClosurePack(tuple(pack_items), tuple(sorted(pack_closure))))
            pack_items, pack_closure = [], set()
        pack_items.append(item)
        pack_closure |= item_closure
    if pack_items:
        packs.append(ClassClosurePack(tuple(pack_items), tuple(sorted(pack_closure))))
    return ClassClosurePacking(tuple(packs), tuple(over_limit_items))
