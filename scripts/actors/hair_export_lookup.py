CLASS_EXPORT_CLASS_NAME = 'Class'
MAXIMUM_CLASS_CHAIN_LENGTH = 64


class HairExportLookupError(ValueError):
    pass


def class_chain_names(read_package, class_object):
    names, reference = [], class_object
    while reference:
        if len(names) >= MAXIMUM_CLASS_CHAIN_LENGTH:
            raise HairExportLookupError(f'the class chain of {class_object} exceeds {MAXIMUM_CLASS_CHAIN_LENGTH} classes')
        package = read_package(reference.split('.', 1)[0])
        classes = [item for item in package.exports
                   if item['object'].casefold() == reference.casefold() and item['className'] == CLASS_EXPORT_CLASS_NAME]
        if len(classes) > 1:
            raise HairExportLookupError(f'{reference} has {len(classes)} class exports')
        names.append(reference.rsplit('.', 1)[-1])
        reference = package.object_name(classes[0]['superIndex']) if classes else None
    return names


def cached_class_chain_reader(read_package):
    chains = {}

    def class_names_of(class_object):
        if class_object not in chains:
            chains[class_object] = [name.casefold() for name in class_chain_names(read_package, class_object)]
        return chains[class_object]
    return class_names_of


def unique_export_of_class(package, requested, requested_class_name, class_names_of):
    leaf = requested.split('.', 1)[1]
    matches = [item for item in package.exports
               if item['name'].casefold() == leaf.casefold() and requested_class_name.casefold() in class_names_of(item['classObject'])]
    if not matches:
        raise HairExportLookupError(f'{requested} has no {requested_class_name} export')
    if len(matches) > 1:
        raise HairExportLookupError(f'{requested} has {len(matches)} {requested_class_name} exports with that leaf; '
                                    'the native lookup takes the first in live hash order, which is not reproduced')
    return matches[0]
