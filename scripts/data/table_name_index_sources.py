from typing import NamedTuple


class NameIndexSource(NamedTuple):
    rows_field: str
    identifier_fields: tuple
    name_field: str


NAME_INDEX_SOURCES = {
    'itemname-e': NameIndexSource('item_name', ('id',), 'name'),
    'npcname-e': NameIndexSource('npc', ('id',), 'name'),
    'skillname-e': NameIndexSource('skill', ('skill_id', 'skill_level'), 'name'),
}
