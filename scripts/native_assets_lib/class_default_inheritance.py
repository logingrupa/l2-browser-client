import copy
import hashlib
import os
from pathlib import Path
import re

from native_catalog.effects import POWERSHELL, UELIB, read_class_defaults
from native_catalog.ue2 import FormatError

MAX_CLASSES = 96


def class_default_tool_paths():
    return Path(os.environ.get('L2_UELIB', str(UELIB))), Path(os.environ.get('L2_POWERSHELL', str(POWERSHELL)))


def merge_typed_defaults_replacing_raw_values_whole(base, override):
    result = copy.deepcopy(base)
    for key, value in override.items():
        previous = result.get(key)
        if (isinstance(value, dict) and isinstance(previous, dict)
                and 'object' not in value
                and 'unparsedHex' not in value and 'unparsedHex' not in previous):
            result[key] = merge_typed_defaults_replacing_raw_values_whole(previous, value)
        else:
            result[key] = copy.deepcopy(value)
    return result


class DefaultReader:
    def __init__(self, client, packages, work, save):
        self.client, self.packages, self.work, self.save = client, packages, work, save
        self.definitions = {}
        self.library, self.powershell = class_default_tool_paths()

    def get(self, reference, trail=()):
        record, package, item = self.packages.resolve(reference, 'Class')
        key = record['object'].casefold()
        if key in trail:
            raise FormatError('Cyclic native class inheritance: ' + record['object'])
        if key in self.definitions:
            return self.definitions[key]
        if len(self.definitions) + len(trail) >= MAX_CLASSES:
            raise FormatError('Native class inheritance/dependency limit exceeded')
        class_work = self.work / 'classes' / hashlib.sha256(key.encode()).hexdigest()[:20]
        definition = read_class_defaults(self.client, record['object'], class_work,
            library=self.library, powershell=self.powershell)
        parent = package.object_name(item['superIndex'])
        declared = definition['superClass']
        if bool(parent) != bool(declared) or (parent and parent.rsplit('.', 1)[-1].casefold() != declared.rsplit('.', 1)[-1].casefold()):
            raise FormatError('Decompiled superclass differs from native export table: ' + record['object'])
        base = self.get(parent, trail + (key,))['effectiveProperties'] if parent else {}
        definition['nativeSuperClass'] = parent
        definition['effectiveProperties'] = merge_typed_defaults_replacing_raw_values_whole(base, definition['properties'])
        name = record['object']
        if not re.fullmatch(r'\w+(?:\.\w+)+', name):
            raise FormatError('Unsafe native class identity')
        script = class_work / definition['sourceScript']
        definition['sourceScript'] = self.save('source/classes/' + name + '.uc', script.read_bytes())
        definition['rawExport'] = self.save('source/classes/' + name + '.bin',
            package.data[item['offset']:item['offset'] + item['size']])
        self.definitions[key] = definition
        return definition
