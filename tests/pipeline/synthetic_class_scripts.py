from __future__ import annotations

from pathlib import Path
import shutil
import tempfile
from types import SimpleNamespace

from native_catalog.ue2 import FormatError

TEST_SCRATCH_ROOT = Path(__file__).resolve().parents[2] / 'artifacts' / 'test-scratch'


class SyntheticSourcePackages:
    def __init__(self, imports_by_package):
        self.imports_by_package = {name.casefold(): imports for name, imports in imports_by_package.items()}

    def get(self, package_name):
        if package_name.casefold() not in self.imports_by_package:
            raise FormatError('Native package missing/ambiguous: ' + package_name)
        return None, SimpleNamespace(imports=self.imports_by_package[package_name.casefold()])


class SyntheticClassScripts:
    def __init__(self, scripts_by_class, imports_by_package=None):
        self.scripts_by_class = dict(scripts_by_class)
        self.decompiled_classes = []
        self.package_sha256 = 'a' * 64
        self.packages = SyntheticSourcePackages(imports_by_package or {})

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
