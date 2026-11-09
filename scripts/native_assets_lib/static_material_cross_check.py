import hashlib

from native_assets_lib.static_materials import STATIC_MESH_CLASS_OBJECT, package_static_material_version, read_static_material_slots
from native_catalog.ue2 import Package
from native_store.canonical_json import canonical_json_bytes
from world.elbera_reader_cross_check import (ELBERA_PACKED_PROPERTY_FORMAT, elbera_package, elbera_tool_record,
                                             elbera_ue2package_module)

ELBERA_AUTOMATIC_PROPERTY_FORMAT = 'auto'
ELBERA_STATIC_MESH_CLASS_NAME = 'StaticMesh'
MATERIALS_PROPERTY_NAME = 'Materials'
MATERIAL_PROPERTY_NAME = 'Material'


class StaticMaterialCrossCheckError(ValueError):
    pass


def static_mesh_exports(package):
    return [item for item in package.exports if item['classObject'] == STATIC_MESH_CLASS_OBJECT and item['size']]


def our_static_mesh_material_references(package):
    return {item['object']: [slot['sourceReference'] for slot in read_static_material_slots(package, item)['slots']]
            for item in static_mesh_exports(package)}


def elbera_material_reference(package, module, material_bytes):
    if material_bytes is None:
        return None
    reader = module.Reader(material_bytes)
    object_index = reader.compact()
    if reader.pos != len(material_bytes):
        raise StaticMaterialCrossCheckError(f'Elbera Material property of {package.path} holds {len(material_bytes)} bytes, '
                                            f'not one compact object index')
    return module.qualified_ref(package, object_index) if object_index else None


def elbera_material_array_references(package, module, materials_bytes):
    reader = module.Reader(materials_bytes)
    references = []
    for _ in range(reader.compact()):
        slot_properties = module.read_properties(package, reader, fmt=ELBERA_PACKED_PROPERTY_FORMAT)
        references.append(elbera_material_reference(package, module, slot_properties.get(MATERIAL_PROPERTY_NAME)))
    if reader.pos != len(materials_bytes):
        raise StaticMaterialCrossCheckError(f'Elbera Materials array of {package.path} stops at {reader.pos} of {len(materials_bytes)} bytes')
    return references


def elbera_static_mesh_material_references(reference_access, relative_path):
    package = elbera_package(reference_access, relative_path)
    module = elbera_ue2package_module()
    references_by_object = {}
    for export in package.exports_by_class(ELBERA_STATIC_MESH_CLASS_NAME):
        object_name = module.qualified_ref(package, export.index + 1)
        if object_name in references_by_object:
            raise StaticMaterialCrossCheckError(f'Elbera names two StaticMesh exports {object_name} in {relative_path}')
        materials_bytes = module.read_properties(package, package.body_reader(export),
                                                 fmt=ELBERA_AUTOMATIC_PROPERTY_FORMAT).get(MATERIALS_PROPERTY_NAME)
        references_by_object[object_name] = elbera_material_array_references(package, module, materials_bytes) if materials_bytes else []
    return references_by_object


def unreal_name_folded_references(references_by_object):
    folded = {}
    for object_name, references in references_by_object.items():
        key = object_name.casefold()
        if key in folded:
            raise StaticMaterialCrossCheckError(f'two StaticMesh exports fold to the Unreal name {key}')
        folded[key] = [None if reference is None else reference.casefold() for reference in references]
    return dict(sorted(folded.items()))


def references_sha256(folded_references):
    return hashlib.sha256(canonical_json_bytes(folded_references)).hexdigest()


def first_differing_export(our_references, cross_check_references):
    for object_name in sorted(set(our_references) | set(cross_check_references)):
        if our_references.get(object_name) != cross_check_references.get(object_name):
            return object_name
    return None


def static_material_cross_check_row(reference_access, relative_path):
    path = reference_access.require_equal_file(relative_path)
    data = path.read_bytes()
    package = Package(data, path.name)
    our_references = unreal_name_folded_references(our_static_mesh_material_references(package))
    cross_check_references = unreal_name_folded_references(elbera_static_mesh_material_references(reference_access, relative_path))
    return {'version': list(package_static_material_version(package)), 'package': relative_path,
            'lockSha256': hashlib.sha256(data).hexdigest(), 'comparedExports': len(our_references),
            'ourReferencesSha256': references_sha256(our_references),
            'crossCheckReferencesSha256': references_sha256(cross_check_references), 'tool': elbera_tool_record(),
            'equal': our_references == cross_check_references,
            'firstDifferingExport': first_differing_export(our_references, cross_check_references)}
