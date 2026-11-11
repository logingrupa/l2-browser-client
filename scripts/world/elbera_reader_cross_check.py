import functools
import hashlib

from data.pinned_elbera_module import ELBERA_COMMIT, load_pinned_elbera_module
from native_catalog.ue2 import unwrap
from reference_client_guard import ReferenceClientAccess

ELBERA_TOOL_NAME = 'Elbera l2lib'
ELBERA_UE2PACKAGE_PATH = 'tools/l2lib/ue2package.py'
ELBERA_L2LIB_PINS = {ELBERA_UE2PACKAGE_PATH: '18fc5bf7b6e5a8758a426a7264b103f34ddbdad6fb9b784319ef7ba6bfe050fe'}
ELBERA_AMBIENT_SOUND_CLASS_NAME = 'AmbientSoundObject'
ELBERA_TERRAIN_INFO_CLASS_NAME = 'TerrainInfo'
ELBERA_TERRAIN_SECTOR_CLASS_NAME = 'TerrainSector'
ELBERA_PACKED_PROPERTY_FORMAT = 'packed'


class ElberaCrossCheckError(ValueError):
    pass


def elbera_tool_record():
    return {'name': ELBERA_TOOL_NAME, 'commit': ELBERA_COMMIT, 'pins': dict(ELBERA_L2LIB_PINS)}


@functools.cache
def elbera_ue2package_module():
    return load_pinned_elbera_module(ELBERA_UE2PACKAGE_PATH, ELBERA_L2LIB_PINS[ELBERA_UE2PACKAGE_PATH])


def elbera_package(reference_access, relative_path):
    if not isinstance(reference_access, ReferenceClientAccess):
        raise ElberaCrossCheckError(f'Elbera reads only through a reference client guard access, not {type(reference_access).__name__}')
    path = reference_access.require_equal_file(relative_path)
    _, package_bytes = unwrap(path.read_bytes(), path.name)
    return elbera_ue2package_module().Package(package_bytes, path=path.name)


def elbera_export_named(package, object_name):
    module = elbera_ue2package_module()
    matches = [export for export in package.exports
               if export.serial_size and module.qualified_ref(package, export.index + 1).casefold() == object_name.casefold()]
    if len(matches) != 1:
        raise ElberaCrossCheckError(f'Elbera finds {len(matches)} exports named {object_name} in {package.path}')
    return matches[0]


def elbera_texture_mip_bytes(reference_access, relative_path, object_name):
    package = elbera_package(reference_access, relative_path)
    module = elbera_ue2package_module()
    texture = module.parse_texture(package, elbera_export_named(package, object_name))
    if not texture.mips:
        raise ElberaCrossCheckError(f'Elbera decodes no mip of {object_name} in {relative_path}')
    return bytes(module.mip_bytes(package, texture.mips[0]))


def property_payload_digest(value):
    return value if isinstance(value, bool) else hashlib.sha256(value).hexdigest()


def elbera_property_projection(package, reader):
    properties = elbera_ue2package_module().read_properties(package, reader, fmt=ELBERA_PACKED_PROPERTY_FORMAT)
    return reader.pos, {name: property_payload_digest(value) for name, value in properties.items()}


def elbera_actor_properties(reference_access, relative_path):
    package = elbera_package(reference_access, relative_path)
    module = elbera_ue2package_module()
    projections = []
    for export in package.exports:
        has_stack = bool(export.object_flags & module.RF_HAS_STACK)
        if not has_stack and package.class_name_of(export) != ELBERA_AMBIENT_SOUND_CLASS_NAME:
            continue
        property_end, properties = elbera_property_projection(package, package.actor_body_reader(export))
        projections.append({'exportIndex': export.index + 1, 'propertyEnd': property_end, 'properties': properties})
    return projections


def elbera_terrain_sector_properties(reference_access, relative_path):
    package = elbera_package(reference_access, relative_path)
    terrain_infos = package.exports_by_class(ELBERA_TERRAIN_INFO_CLASS_NAME)
    if len(terrain_infos) != 1:
        raise ElberaCrossCheckError(f'Elbera finds {len(terrain_infos)} TerrainInfo exports in {relative_path}')
    terrain_info = terrain_infos[0]
    terrain_info_end, _ = elbera_property_projection(package, package.actor_body_reader(terrain_info))
    sectors = []
    for export in package.exports_by_class(ELBERA_TERRAIN_SECTOR_CLASS_NAME):
        if export.package_index != terrain_info.index + 1:
            continue
        property_end, properties = elbera_property_projection(package, package.body_reader(export))
        sectors.append({'exportIndex': export.index + 1, 'propertyEnd': property_end, 'properties': properties})
    return {'terrainInfoExportIndex': terrain_info.index + 1, 'propertyEnd': terrain_info_end, 'sectors': sectors}


def level_model_projection(object_name, model):
    return {'object': object_name, 'nodes': len(model.nodes), 'surfaces': len(model.surfs), 'points': len(model.points),
            'vertices': len(model.verts), 'leaves': len(model.leaves), 'tailBytes': model.lightmap_tail}


def elbera_level_model_projection(reference_access, relative_path):
    package = elbera_package(reference_access, relative_path)
    module = elbera_ue2package_module()
    try:
        model = module.level_model(package)
    except (module.L2Error, ValueError) as error:
        raise ElberaCrossCheckError(f'Elbera cannot read the level model of {relative_path}: {error}') from error
    if model is None:
        raise ElberaCrossCheckError(f'Elbera finds no zoned UModel in {relative_path}')
    return level_model_projection(module.qualified_ref(package, model.export.index + 1), model)
