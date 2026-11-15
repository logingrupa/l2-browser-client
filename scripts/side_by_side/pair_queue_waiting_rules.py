from __future__ import annotations

from typing import Callable, NamedTuple

NO_MATCHING_KEY_REASON = 'no-matching-key'
OFFLINE_DEBUG_STARTUP_TILE_KEY = 'tile:20_20'
STATUS_WINDOW_KEY = 'window:StatusWnd'
TRANSLUCENT_DRAW_STYLE = 3
BRIGHTEN_DRAW_STYLE = 6


def numeric_key_order(key):
    return tuple(int(part) if part.isdigit() else part for part in key.split(':', 1)[1].replace('_', ':').split(':'))


class WaitingRule(NamedTuple):
    name: str
    kind: str
    minimap: bool
    matches: Callable
    order: Callable = numeric_key_order


def is_key(expected_key):
    return lambda facts, key: key == expected_key


def has_draw_style(draw_style):
    return lambda facts, key: draw_style in facts.skill_draw_styles(key)


def any_key(facts, key):
    return True


WAITING_RULES = (
    WaitingRule('npc-texture-slot', 'npc', False, lambda facts, key: len(facts.npc_texture_texts(key)) >= 2),
    WaitingRule('ptds-3', 'skill', False, has_draw_style(TRANSLUCENT_DRAW_STYLE)),
    WaitingRule('ptds-6', 'skill', False, has_draw_style(BRIGHTEN_DRAW_STYLE)),
    WaitingRule('sky-20-20', 'tile', False, is_key(OFFLINE_DEBUG_STARTUP_TILE_KEY)),
    WaitingRule('minimap-projection', 'tile', True, is_key(OFFLINE_DEBUG_STARTUP_TILE_KEY)),
    WaitingRule('hair-4dd2', 'character', False, any_key),
    WaitingRule('statuswnd', 'window', False, is_key(STATUS_WINDOW_KEY)),
)
