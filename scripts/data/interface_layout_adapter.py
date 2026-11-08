from __future__ import annotations

from collections import Counter
import hashlib
from typing import NamedTuple

from native_store.catalog_writer import WINDOW_ID_PATTERN

INTERFACE_XDAT_PATH = 'system/interface.xdat'
INTERFACE_XDAT_SHA256 = 'b5b37678674162f3a19380e86fa357a44e330f99607504c927c41e3dcd31b641'
ELBERA_PARSE_XDAT_PATH = 'tools/xdat/parse_xdat.py'
ELBERA_PARSE_XDAT_SHA256 = 'aeb7ebed22d68fdca8f8a9828c32620c01be4ca03623c4a020dc0fcbf2ea5409'
WINDOW_ANCHOR_PROOF = 'Elbera NWindow af6c3437 proof, unverified on IMPORTA 7c12fb6b'
NATIVE_WINDOW_LAYOUT_KIND = 'native-window-layout'
NATIVE_WINDOW_LAYOUT_SCHEMA_VERSION = 1
NODE_CHILDREN_FIELD = 'children'
NODE_TEXTURES_FIELD = 'textures'


class InterfaceLayoutError(ValueError):
    pass


class InterfaceLayout(NamedTuple):
    source_sha256: str
    declared_window_count: int
    records: list
    roots: list
    record_by_node_identity: dict

    def record_of_node(self, node):
        record = self.record_by_node_identity.get(id(node))
        if record is None:
            raise InterfaceLayoutError(f'tree node {node.get("name")!r} has no paired scan record')
        return record


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


def tree_nodes(roots):
    pending = list(reversed(roots))
    while pending:
        node = pending.pop()
        yield node
        pending.extend(reversed(node[NODE_CHILDREN_FIELD]))


def paired_node_records(records, roots):
    record_by_texture_list_identity = {id(record[NODE_TEXTURES_FIELD]): record for record in records}
    if len(record_by_texture_list_identity) != len(records):
        raise InterfaceLayoutError('scan records share a textures list; nodes cannot be paired one to one')
    record_by_node_identity = {}
    paired_record_identities = set()
    for node in tree_nodes(roots):
        record = record_by_texture_list_identity.get(id(node[NODE_TEXTURES_FIELD]))
        if record is None or id(record) in paired_record_identities or id(node) in record_by_node_identity:
            raise InterfaceLayoutError(f'tree node {node["name"]!r} does not pair with exactly one scan record')
        paired_record_identities.add(id(record))
        record_by_node_identity[id(node)] = record
    if len(record_by_node_identity) != len(records):
        raise InterfaceLayoutError(f'tree holds {len(record_by_node_identity)} nodes for {len(records)} scan records')
    return record_by_node_identity


def decode_interface_layout(data, parse_xdat_module):
    source_sha256 = sha256_hex(data)
    if source_sha256 != INTERFACE_XDAT_SHA256:
        raise InterfaceLayoutError(f'{INTERFACE_XDAT_PATH} SHA-256 {source_sha256} differs from its pin {INTERFACE_XDAT_SHA256}')
    parse_xdat_module.data_g = data
    declared_window_count, records = parse_xdat_module.scan(data)
    roots = parse_xdat_module.build_tree(records)
    return InterfaceLayout(source_sha256, declared_window_count, records, roots, paired_node_records(records, roots))


def window_identifiers(roots):
    occurrences = Counter(root['name'] for root in roots)
    ordinals = Counter()
    identifiers = []
    for root in roots:
        name = root['name']
        if occurrences[name] > 1:
            ordinals[name] += 1
            name = f'{name}#{ordinals[name]}'
        if not WINDOW_ID_PATTERN.fullmatch(name):
            raise InterfaceLayoutError(f'root window id {name!r} does not match {WINDOW_ID_PATTERN.pattern}')
        identifiers.append(name)
    return identifiers


def manifest_node(node, record_of_node, data):
    record = record_of_node(node)
    tail_offset, tail_end = record['body'], record['end']
    if not 0 <= tail_offset <= tail_end <= len(data):
        raise InterfaceLayoutError(f'record {node["name"]!r} tail [{tail_offset}, {tail_end}) lies outside the source bytes')
    fields = {name: value for name, value in node.items() if name != NODE_CHILDREN_FIELD}
    fields['sourceOffset'] = record['off']
    fields['tail'] = {'offset': tail_offset, 'end': tail_end, 'sha256': sha256_hex(data[tail_offset:tail_end])}
    fields[NODE_CHILDREN_FIELD] = [manifest_node(child, record_of_node, data) for child in node[NODE_CHILDREN_FIELD]]
    return fields


def window_layout_manifest(window_id, root_node, record_of_node, data):
    root = manifest_node(root_node, record_of_node, data)
    texture_references = dict.fromkeys(texture for node in tree_nodes([root_node]) for texture in node[NODE_TEXTURES_FIELD])
    return {'kind': NATIVE_WINDOW_LAYOUT_KIND, 'schemaVersion': NATIVE_WINDOW_LAYOUT_SCHEMA_VERSION, 'windowId': window_id,
            'name': root_node['name'], 'sourceSha256': sha256_hex(data), 'sourceOffset': root['sourceOffset'], 'root': root,
            'textureRefs': list(texture_references), 'anchorProof': WINDOW_ANCHOR_PROOF}

