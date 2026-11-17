from native_catalog.effects import tagged_values
from native_catalog.ue2 import FormatError


def object_values(package, tags):
    indexed = {tag['name'] for tag in tags if tag.get('arrayIndex') is not None}
    normalized, seen = [], set()
    for tag in tags:
        value = dict(tag)
        if value['name'] in indexed and value.get('arrayIndex') is None:
            value['arrayIndex'] = 0
        identity = (value['name'], value.get('arrayIndex'))
        if identity in seen:
            raise FormatError('Duplicate native property path cannot be collapsed; original tags retained: ' + value['name'])
        seen.add(identity)
        normalized.append(value)
    return tagged_values(package, normalized)
