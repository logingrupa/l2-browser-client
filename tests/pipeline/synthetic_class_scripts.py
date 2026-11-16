from __future__ import annotations

from pathlib import Path
import shutil
import tempfile
from types import SimpleNamespace

from native_catalog.ue2 import FormatError

TEST_SCRATCH_ROOT = Path(__file__).resolve().parents[2] / 'artifacts' / 'test-scratch'


def synthetic_import_table(qualified_imports):
    records, index_by_object = [], {}

    def add_import(object_name, class_package, class_name):
        outer_name, _, leaf_name = object_name.rpartition('.')
        if outer_name and outer_name not in index_by_object:
            add_import(outer_name, 'Core', 'Package')
        records.append({'classPackage': class_package, 'className': class_name, 'outerIndex': index_by_object.get(outer_name, 0),
                        'name': leaf_name, 'object': object_name})
        index_by_object[object_name] = -len(records)

    for object_name, class_package, class_name in qualified_imports:
        add_import(object_name, class_package, class_name)
    return records


class SyntheticSourcePackages:
    def __init__(self, imports_by_package, ambiguous_package_names):
        self.imports_by_package = {name.lower(): imports for name, imports in imports_by_package.items()}
        self.paths = {name: [Path(f'system/{name}.u')] for name in self.imports_by_package}
        self.paths.update({name.lower(): [Path(f'system/{name}.u'), Path(f'textures/{name}.u')] for name in ambiguous_package_names})

    def get(self, package_name):
        paths = self.paths.get(package_name.lower(), [])
        if len(paths) != 1:
            raise FormatError('Native package missing/ambiguous: ' + package_name)
        return paths[0], SimpleNamespace(imports=self.imports_by_package[package_name.lower()])


class SyntheticClassScripts:
    def __init__(self, scripts_by_class, imports_by_package=None, ambiguous_package_names=()):
        self.scripts_by_class = dict(scripts_by_class)
        self.decompiled_classes = []
        self.package_sha256 = 'a' * 64
        self.packages = SyntheticSourcePackages(imports_by_package or {}, ambiguous_package_names)

    def class_identity(self, class_object):
        super_class, _ = self.scripts_by_class[class_object]
        return {'object': class_object, 'superClass': super_class, 'package': 'system/Synthetic.u',
                'packageSha256': self.package_sha256}

    def decompile_class_script(self, class_object, work_directory):
        self.decompiled_classes.append(class_object)
        return self.scripts_by_class[class_object][1]


def scratch_work_root(test_case, prefix):
    TEST_SCRATCH_ROOT.mkdir(parents=True, exist_ok=True)
    work_root = Path(tempfile.mkdtemp(prefix=prefix, dir=TEST_SCRATCH_ROOT))
    test_case.addCleanup(shutil.rmtree, work_root, True)
    return work_root
