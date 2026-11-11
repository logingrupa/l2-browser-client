from contextlib import contextmanager
from pathlib import Path
import struct
import tempfile
from unittest.mock import patch

from material_graph_fixture import PROPERTY_SIZE_CODES, SyntheticPackageTables, compact
from reference_client_guard import require_reference_client
from reference_client_lock_fixture import lock_client_as_checked_conversion_root
from world import tile_census
from world.map_actor_properties import HAS_STACK
from world.tile_census import build_tile_census, declared_terrain_map_package, terrain_height_gate_from_declared_package

UNREAL_PACKAGE_SIGNATURE = 0x9E2A83C1
LINEAGE_VERSION_111_WRAPPER = 'Lineage2Ver111'.encode('utf-16le')
LINEAGE_VERSION_111_XOR_KEY = 0xAC
SYNTHETIC_NAME_TABLE_OFFSET = 64
SYNTHETIC_IMPORT_TABLE_OFFSET = 1024
SYNTHETIC_EXPORT_TABLE_OFFSET = 2048
SYNTHETIC_PAYLOAD_OFFSET = 4096
OBJECT_PROPERTY_TYPE = 5
BASELINE_MAP_LICENSEE = 28
EMPTY_ACTOR_STATE_FRAME = compact(0) + compact(0) + struct.pack('<QI', 0, 0)
NO_TERRAIN_MAP_PROPERTY = object()


def plain_package_header(package_version, licensee):
    return struct.pack('<IHHIIIIIII', UNREAL_PACKAGE_SIGNATURE, package_version, licensee, 0, 1, 0, 1, 0, 1, 0).ljust(128, b'\0')


def lineage_version_111_package_header(package_version, licensee):
    return LINEAGE_VERSION_111_WRAPPER + bytes(value ^ LINEAGE_VERSION_111_XOR_KEY for value in plain_package_header(package_version, licensee))


UNREADABLE_PACKAGE_HEADER = b'not an unreal package header'.ljust(128, b'\0')


def imported_texture_index(tables, qualified_texture_object):
    package_name, *group_names, texture_name = qualified_texture_object.split('.')
    outer_index = tables.package_import(package_name)
    for group_name in group_names:
        outer_index = tables.import_index('Core', 'Package', outer_index, group_name)
    return tables.import_index('Engine', 'Texture', outer_index, texture_name)


def object_reference_property(tables, property_name, object_index):
    payload = compact(object_index)
    return compact(tables.name_index(property_name)) + bytes([OBJECT_PROPERTY_TYPE | (PROPERTY_SIZE_CODES[len(payload)] << 4)]) + payload


def terrain_info_body(tables, terrain_map_object):
    body = EMPTY_ACTOR_STATE_FRAME
    if terrain_map_object is not NO_TERRAIN_MAP_PROPERTY:
        object_index = 0 if terrain_map_object is None else imported_texture_index(tables, terrain_map_object)
        body += object_reference_property(tables, 'TerrainMap', object_index)
    return body + compact(tables.name_index('None'))


def synthetic_terrain_map_package(terrain_map_objects, map_licensee=BASELINE_MAP_LICENSEE):
    tables = SyntheticPackageTables()
    export_rows = [(tables.class_import('Engine.LevelInfo'), 'LevelInfo0', HAS_STACK, EMPTY_ACTOR_STATE_FRAME + compact(tables.name_index('None')))]
    export_rows += [(tables.class_import('Engine.TerrainInfo'), f'TerrainInfo{index}', HAS_STACK, terrain_info_body(tables, terrain_map_object))
                    for index, terrain_map_object in enumerate(terrain_map_objects)]
    for _, export_name, _, _ in export_rows:
        tables.name_index(export_name)
    name_table = b''.join(compact(len(name) + 1) + name.encode('ascii') + b'\0' + struct.pack('<I', 0) for name in tables.names)
    import_table = b''.join(compact(tables.name_index(row['classPackage'])) + compact(tables.name_index(row['className']))
                            + struct.pack('<i', row['outerIndex']) + compact(tables.name_index(row['name'])) for row in tables.imports)
    export_table, payloads = b'', b''
    for class_index, export_name, flags, body in export_rows:
        export_table += (compact(class_index) + compact(0) + struct.pack('<i', 0) + compact(tables.name_index(export_name)) + struct.pack('<I', flags)
                         + compact(len(body)) + compact(SYNTHETIC_PAYLOAD_OFFSET + len(payloads)))
        payloads += body
    if not (len(name_table) < SYNTHETIC_IMPORT_TABLE_OFFSET - SYNTHETIC_NAME_TABLE_OFFSET
            and len(import_table) < SYNTHETIC_EXPORT_TABLE_OFFSET - SYNTHETIC_IMPORT_TABLE_OFFSET
            and len(export_table) < SYNTHETIC_PAYLOAD_OFFSET - SYNTHETIC_EXPORT_TABLE_OFFSET):
        raise ValueError('synthetic terrain map tables outgrow their fixed regions')
    data = bytearray(SYNTHETIC_PAYLOAD_OFFSET)
    struct.pack_into('<IHHIIIIIII', data, 0, UNREAL_PACKAGE_SIGNATURE, 123, map_licensee, 0, len(tables.names), SYNTHETIC_NAME_TABLE_OFFSET,
                     len(export_rows), SYNTHETIC_EXPORT_TABLE_OFFSET, len(tables.imports), SYNTHETIC_IMPORT_TABLE_OFFSET)
    data[SYNTHETIC_NAME_TABLE_OFFSET:SYNTHETIC_NAME_TABLE_OFFSET + len(name_table)] = name_table
    data[SYNTHETIC_IMPORT_TABLE_OFFSET:SYNTHETIC_IMPORT_TABLE_OFFSET + len(import_table)] = import_table
    data[SYNTHETIC_EXPORT_TABLE_OFFSET:SYNTHETIC_EXPORT_TABLE_OFFSET + len(export_table)] = export_table
    return bytes(data) + payloads


@contextmanager
def census_reviewed_reader_pairs(pairs_by_reader):
    real_reviewed_reader_pairs = tile_census.reviewed_reader_pairs

    def reviewed_reader_pairs_with_overrides(reader):
        return sorted(pairs_by_reader[reader]) if reader in pairs_by_reader else real_reviewed_reader_pairs(reader)

    with patch.object(tile_census, 'reviewed_reader_pairs', reviewed_reader_pairs_with_overrides):
        yield


class SyntheticMapClient:
    def __init__(self, test_case, packages):
        temporary_directory = tempfile.TemporaryDirectory()
        test_case.addCleanup(temporary_directory.cleanup)
        self.root = Path(temporary_directory.name) / 'client'
        for relative_path, payload in packages.items():
            path = self.root / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
        lock_client_as_checked_conversion_root(test_case, self.root, Path(temporary_directory.name) / 'reference-root', sorted(packages))
        self.access = require_reference_client(self.root)

    def census(self):
        return build_tile_census(self.access, self.access.lock.document, self.access.lock.records_by_path)

    def declared_gate(self, map_relative_path):
        declaration = declared_terrain_map_package(self.access, self.access.lock.records_by_path, map_relative_path)
        return terrain_height_gate_from_declared_package(self.access, declaration)
