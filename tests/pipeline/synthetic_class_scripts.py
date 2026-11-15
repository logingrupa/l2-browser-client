from __future__ import annotations

from pathlib import Path
import shutil
import tempfile

TEST_SCRATCH_ROOT = Path(__file__).resolve().parents[2] / 'artifacts' / 'test-scratch'


class SyntheticClassScripts:
    def __init__(self, scripts_by_class):
        self.scripts_by_class = dict(scripts_by_class)
        self.decompiled_classes = []
        self.package_sha256 = 'a' * 64

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
