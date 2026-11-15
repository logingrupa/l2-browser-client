import json
from pathlib import Path

from native_store.store_paths import REPOSITORY_ROOT

STATIC_MESH_ACTOR_CLASS = 'Engine.StaticMeshActor'
PLACEMENT_AUDIO_RECIPE_PATH = REPOSITORY_ROOT / 'recipes' / 'native-20-20-placement-audio.json'


class PlacementAudioError(ValueError):
    pass


def placement_audio_properties(recipe_path=PLACEMENT_AUDIO_RECIPE_PATH):
    properties = json.loads(Path(recipe_path).read_text(encoding='utf-8')).get('properties')
    if not (isinstance(properties, list) and properties and all(isinstance(name, str) and name for name in properties)
            and len(set(properties)) == len(properties)):
        raise PlacementAudioError(f'placement audio recipe {recipe_path} must list distinct property names')
    return tuple(properties)


def property_reference(prop):
    value = prop.get('value')
    if prop.get('status') != 'decoded' or not isinstance(value, dict) or not (value.get('object') is None or isinstance(value['object'], str)):
        raise PlacementAudioError(f'{prop["name"]} is not a decoded object reference')
    return value.get('object')


def inventory_placement_audio(actors, properties):
    placements = []
    for actor in sorted((actor for actor in actors if actor['classObject'] == STATIC_MESH_ACTOR_CLASS), key=lambda actor: actor['exportIndex']):
        declared = {}
        for prop in actor['properties']:
            if prop['name'] not in properties:
                continue
            if prop['name'] in declared or prop['arrayIndex'] is not None:
                raise PlacementAudioError(f'{actor["object"]} serializes {prop["name"]} twice or as an array element')
            declared[prop['name']] = property_reference(prop)
        if declared:
            placements.append({'placementId': actor['id'], 'exportIndex': actor['exportIndex'], 'references': [declared.get(name) for name in properties]})
    return placements
