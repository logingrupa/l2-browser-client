from __future__ import annotations

from pathlib import Path

from native_store.canonical_json import canonical_json_bytes
from native_store.catalog_writer import replace_file
from native_store.store_paths import SHA256_PATTERN
from side_by_side.pair_queue_key_facts import PairQueueKeyFacts
from side_by_side.pair_queue_union import PairQueueError, PairQueueUnion
from side_by_side.pair_queue_waiting_rules import NO_MATCHING_KEY_REASON, OFFLINE_DEBUG_STARTUP_TILE_KEY, WAITING_RULES

PAIR_QUEUE_SCHEMA_VERSION = 1
CENSUS_KEYS_PER_KIND = 25
PAIR_QUEUE_FOLDER = Path('artifacts/side-by-side/queue')
PART_BY_KIND = {'tile': 'world', 'window': 'ui', 'npc': 'npcs', 'item': 'items', 'skill': 'skills-effects', 'character': 'player-characters'}
QUEUE_KINDS = ('tile', 'window', 'npc', 'item', 'skill')
MINIMAP_PART = 'minimap'
IMAGE_PARTS = tuple(sorted({PART_BY_KIND[kind] for kind in QUEUE_KINDS} | {MINIMAP_PART}))
OFFLINE_DEBUG_SESSION_KIND, SERVER_SESSION_KIND = 'offline-debug', 'server'
STORED_REASON_BY_SESSION_KIND = {OFFLINE_DEBUG_SESSION_KIND: 'native-session-needs-owner', SERVER_SESSION_KIND: 'native-needs-server',
                                 'listen': 'listen-needs-owner'}
OFFLINE_DEBUG_STARTUP_ROUTE, SERVER_WORLD_ROUTE = 'offline-debug-startup', 'server-world'
NPC_VIEWER, ITEM_VIEWER, SKILL_VIEWER = 'nv', 'pv', 'sv'
DEBUG_PAWN_ARMOR_COLUMN = 'm_HumnFigh'
WAITING_STEP, CLASS_STEP, CENSUS_STEP = 'waiting', 'class', 'census'
NOT_CONVERTED_REASON = 'not-converted'
CENSUS_GAP_REASON = 'census-gap'
LOADS_UNRECORDED_REASON = 'loads-unrecorded'
LOADS_FAILED_REASON = 'loads-failed'


def key_kind(key):
    return key.split(':', 1)[0]


def key_suffix(key):
    return key.split(':', 1)[1]


def queue_file_path(project_root, catalog_sha256):
    if not (isinstance(catalog_sha256, str) and SHA256_PATTERN.fullmatch(catalog_sha256)):
        raise PairQueueError(f'pair queue catalog SHA-256 must be 64 lowercase hex characters: {catalog_sha256!r}')
    return Path(project_root) / PAIR_QUEUE_FOLDER / f'{catalog_sha256}.json'


def require_part_of_key(part, key):
    kind = key_kind(key)
    if not (PART_BY_KIND.get(kind) == part or (part == MINIMAP_PART and kind == 'tile')):
        raise PairQueueError(f'key {key} does not belong to part {part}')
    return kind


def require_debug_pawn_armor_column(facts):
    if DEBUG_PAWN_ARMOR_COLUMN not in facts.armor_columns:
        raise PairQueueError(f'the armor-mesh units of the actor unit census hold no {DEBUG_PAWN_ARMOR_COLUMN} race column')
    return DEBUG_PAWN_ARMOR_COLUMN


def debug_pawn_item_units(facts, key):
    column = require_debug_pawn_armor_column(facts)
    return [unit for unit in facts.item_record_units(key)
            if unit['unitKind'] == 'weapon-mesh' or unit['selection'].get('column') == column]


def session_kind_for_key(facts, part, key):
    kind = require_part_of_key(part, key)
    if part == MINIMAP_PART or kind == 'window':
        return SERVER_SESSION_KIND
    if kind == 'tile':
        return OFFLINE_DEBUG_SESSION_KIND if key == OFFLINE_DEBUG_STARTUP_TILE_KEY else SERVER_SESSION_KIND
    if kind in ('npc', 'skill'):
        return OFFLINE_DEBUG_SESSION_KIND
    if kind == 'item':
        return OFFLINE_DEBUG_SESSION_KIND if debug_pawn_item_units(facts, key) else SERVER_SESSION_KIND
    raise PairQueueError(f'no session kind rule covers {kind} keys')


def unit_mesh_texts(units):
    return sorted({mesh for unit in units for mesh in unit['selection'].get('meshes', []) if mesh})


def native_selection_for_key(facts, part, key):
    kind = require_part_of_key(part, key)
    if part == MINIMAP_PART:
        return {'route': SERVER_WORLD_ROUTE, 'window': facts.minimap_window_id(key), 'map': key_suffix(key)}
    if kind == 'tile':
        route = OFFLINE_DEBUG_STARTUP_ROUTE if key == OFFLINE_DEBUG_STARTUP_TILE_KEY else SERVER_WORLD_ROUTE
        return {'route': route, 'map': key_suffix(key)}
    if kind == 'window':
        return {'route': SERVER_WORLD_ROUTE, 'window': key_suffix(key)}
    if kind == 'npc':
        selection = facts.npc_selection(key)
        return {'viewer': NPC_VIEWER, 'searchText': facts.npc_name(key), 'expectedMeshText': selection['mesh'],
                'expectedTextureTexts': facts.npc_texture_texts(key)}
    if kind == 'item':
        pawn_units = debug_pawn_item_units(facts, key)
        return {'viewer': ITEM_VIEWER if pawn_units else SERVER_WORLD_ROUTE, 'itemId': int(key_suffix(key)),
                'expectedMeshTexts': unit_mesh_texts(pawn_units or facts.item_record_units(key))}
    if kind == 'skill':
        skill_id, level = key_suffix(key).split(':')
        return {'viewer': SKILL_VIEWER, 'skillId': int(skill_id), 'level': int(level)}
    raise PairQueueError(f'no native selection rule covers {kind} keys')


def stored_reason_for_session_kind(session_kind):
    return STORED_REASON_BY_SESSION_KIND[session_kind]


def class_value_for_key(facts, key):
    kind = key_kind(key)
    if kind == 'npc':
        return facts.npc_packages(key)
    if kind == 'item':
        return facts.item_packages(key)
    if kind == 'tile':
        return facts.tile_licensee(key)
    if kind == 'skill':
        return facts.skill_component_classes(key)
    return facts.window_type(key)


def ineligibility_reason(union, part, key):
    if key not in union.converted_keys:
        return NOT_CONVERTED_REASON
    if union.is_census_gap(part, key):
        return CENSUS_GAP_REASON
    load_status = union.load_status_by_key.get(key)
    if load_status is None:
        return LOADS_UNRECORDED_REASON
    return None if load_status == 'pass' else LOADS_FAILED_REASON


class PairQueueBuilder:
    def __init__(self, union):
        self.union = union
        self.facts = PairQueueKeyFacts(union)
        self.entries = []
        self.queued = set()
        self.waiting_rules = []

    def eligible_census_keys(self, kind):
        part = PART_BY_KIND[kind]
        return [key for key in self.union.census_ordered_keys(part, kind) if ineligibility_reason(self.union, part, key) is None]

    def add_entry(self, key, part, step, label):
        if (part, key) in self.queued:
            return
        self.queued.add((part, key))
        self.entries.append({'order': len(self.entries) + 1, 'key': key, 'part': part, 'step': step, **label,
                             'keyContentSha256': self.union.key_content_sha256_by_key[key],
                             'nativeSelection': native_selection_for_key(self.facts, part, key),
                             'sessionKind': session_kind_for_key(self.facts, part, key)})
        if part == PART_BY_KIND['tile'] and self.facts.tile_minimap_resource(key) is not None:
            self.add_entry(key, MINIMAP_PART, step, self.minimap_follower_label(key, step, label))

    def minimap_follower_label(self, key, step, tile_label):
        minimap_rule = next((rule for rule in WAITING_RULES if rule.minimap and rule.matches(self.facts, key)), None)
        return {'rule': minimap_rule.name} if step == WAITING_STEP and minimap_rule is not None else tile_label

    def first_matching_key(self, rule, keys):
        return next((key for key in sorted(keys, key=rule.order) if rule.matches(self.facts, key)), None)

    def add_waiting_rule(self, rule):
        census_part, part = PART_BY_KIND[rule.kind], MINIMAP_PART if rule.minimap else PART_BY_KIND[rule.kind]
        kind_keys = [key for key in self.union.converted_keys if key_kind(key) == rule.kind]
        key = self.first_matching_key(rule, [key for key in kind_keys if ineligibility_reason(self.union, census_part, key) is None])
        if key is not None:
            self.add_entry(key, part, WAITING_STEP, {'rule': rule.name})
            self.waiting_rules.append({'rule': rule.name, 'part': part, 'key': key, 'candidateKey': key, 'reason': None})
            return
        candidate_key = self.first_matching_key(rule, kind_keys)
        reason = NO_MATCHING_KEY_REASON if candidate_key is None else ineligibility_reason(self.union, census_part, candidate_key)
        self.waiting_rules.append({'rule': rule.name, 'part': part, 'key': None, 'candidateKey': candidate_key, 'reason': reason})

    def add_waiting_rules(self, kind):
        for rule in WAITING_RULES:
            if rule.kind == kind:
                self.add_waiting_rule(rule)

    def add_class_keys(self, kind):
        part = PART_BY_KIND[kind]
        class_values_seen = [class_value_for_key(self.facts, entry['key']) for entry in self.entries if entry['part'] == part]
        for key in self.eligible_census_keys(kind):
            class_value = class_value_for_key(self.facts, key)
            if (part, key) not in self.queued and class_value not in class_values_seen:
                class_values_seen.append(class_value)
                self.add_entry(key, PART_BY_KIND[kind], CLASS_STEP, {'classValue': class_value})

    def add_census_keys(self, kind):
        remaining = [key for key in self.eligible_census_keys(kind) if (PART_BY_KIND[kind], key) not in self.queued]
        for key in remaining[:CENSUS_KEYS_PER_KIND]:
            self.add_entry(key, PART_BY_KIND[kind], CENSUS_STEP, {})

    def build(self):
        for kind in QUEUE_KINDS:
            self.add_waiting_rules(kind)
            self.add_class_keys(kind)
            self.add_census_keys(kind)
        self.add_waiting_rules('character')
        self.waiting_rules.sort(key=lambda waiting_rule: [rule.name for rule in WAITING_RULES].index(waiting_rule['rule']))
        return {'schemaVersion': PAIR_QUEUE_SCHEMA_VERSION, 'catalogSha256': self.union.catalog_sha256,
                'censusKeysPerKind': CENSUS_KEYS_PER_KIND, 'debugPawnArmorColumn': require_debug_pawn_armor_column(self.facts),
                'waitingRules': self.waiting_rules, 'entries': self.entries}


def build_pair_queue(project_root, store_root):
    return PairQueueBuilder(PairQueueUnion(project_root, store_root)).build()


def write_pair_queue(project_root, store_root):
    document = build_pair_queue(project_root, store_root)
    path = queue_file_path(project_root, document['catalogSha256'])
    replace_file(path, canonical_json_bytes(document))
    return path, document


def queue_entry_counts(document):
    counts = {}
    for entry in document['entries']:
        steps = counts.setdefault(entry['part'], {})
        steps[entry['step']] = steps.get(entry['step'], 0) + 1
    return counts
