from unittest.mock import patch

from native_assets_lib.class_defaults import ClassDefaultValue
from world import bsp_material_mapping_size

SYNTHETIC_DEFAULT_MATERIAL = 'SyntheticEngine.DefaultTexture'
SYNTHETIC_SET_CLASS_DEFAULTS = {('Engine.Material', 'DefaultMaterial'): {'class': 'Texture', 'object': SYNTHETIC_DEFAULT_MATERIAL}}


def synthetic_class_default_values(class_name, fields, work_root, class_scripts):
    values = []
    for field in fields:
        value = SYNTHETIC_SET_CLASS_DEFAULTS.get((class_name, field))
        values.append(ClassDefaultValue(field, value, 'ue-zero' if value is None else 'class-default', class_name))
    return values


def use_synthetic_mapping_class_defaults(test_case):
    patcher = patch.object(bsp_material_mapping_size, 'kept_class_default_values', side_effect=synthetic_class_default_values)
    patcher.start()
    test_case.addCleanup(patcher.stop)
