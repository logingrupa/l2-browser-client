from typing import NamedTuple

from native_catalog.ue2 import FormatError

AMBIGUOUS_QUALIFIED_NAME_MESSAGE = 'Qualified name matches two or more exports ignoring case'
EXACT_SPELLING_MATCH = 'exact-spelling'
CASE_INSENSITIVE_SPELLING_MATCH = 'case-insensitive-spelling'
ACTOR_BASE_CLASS = 'Engine.Actor'
ROOT_OBJECT_CLASS = 'Core.Object'


class QualifiedNameMatch(NamedTuple):
    requested: str
    export: str
    spelling: str


def package_export_objects(packages, reference):
    _, package = packages.get(reference.split('.')[0])
    return [item['object'] for item in package.exports]


def unique_qualified_export_match(export_objects, requested, unmatched_message):
    matching_exports = sorted(export_object for export_object in export_objects if export_object.casefold() == requested.casefold())
    if len(matching_exports) > 1:
        raise FormatError(f'{AMBIGUOUS_QUALIFIED_NAME_MESSAGE}: {requested} matches {" and ".join(matching_exports)}')
    if not matching_exports:
        raise FormatError(unmatched_message)
    export = matching_exports[0]
    return QualifiedNameMatch(requested, export, EXACT_SPELLING_MATCH if export == requested else CASE_INSENSITIVE_SPELLING_MATCH)


def is_actor_class_chain(class_names):
    casefolded_class_names = {class_name.casefold() for class_name in class_names}
    return ACTOR_BASE_CLASS.casefold() in casefolded_class_names and ROOT_OBJECT_CLASS.casefold() in casefolded_class_names
