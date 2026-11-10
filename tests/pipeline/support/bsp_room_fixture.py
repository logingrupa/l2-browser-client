from support.level_model_fixture import build_synthetic_level_model, square_points, synthetic_polygon, synthetic_zone
from world.actor_field_values import ActorField
from world.bsp_leaf_membership import INDEX_NONE
from world.level_zones import LevelZone

NOT_CSG_NODE_FLAG = 0x01
PORTAL_SURFACE_FLAG = 0x04000000
ALL_ZONES = (1 << 64) - 1


def ceiling_points(height):
    return [(0.0, 0.0, height), (0.0, 100.0, height), (100.0, 100.0, height), (100.0, 0.0, height)]


def wall_points(x):
    return [(x, 0.0, 0.0), (x, 100.0, 0.0), (x, 100.0, 50.0), (x, 0.0, 50.0)]


def room_model(wall_flags=NOT_CSG_NODE_FLAG, render_bound=INDEX_NONE):
    model = build_synthetic_level_model(
        [synthetic_polygon(square_points(0, 0, 100), front=1, zones=(0, 1), render_bound=render_bound),
         synthetic_polygon(ceiling_points(50.0), front=2, zones=(0, 1)),
         synthetic_polygon(wall_points(50.0), zones=(1, 2), node_flags=wall_flags, surface_flags=PORTAL_SURFACE_FLAG)],
        zones=(synthetic_zone(), synthetic_zone(), synthetic_zone()), leaves=[(1, -1, -1, 0b110), (2, -1, -1, ALL_ZONES)], root_outside=1)
    model.nodes[2].i_leaf = (0, 1)
    return model


def room_zone(zone_index, outdoor=False, sky=False, unresolved=False):
    field = ActorField('bSunAffect', outdoor, 'authored', 'Engine.ZoneInfo')
    return LevelZone(zone_index, None, None, ALL_ZONES, ALL_ZONES, field, (), (), outdoor, sky, unresolved)


ROOM_ZONES = (room_zone(0, outdoor=True), room_zone(1), room_zone(2, sky=True))
