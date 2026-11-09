import re

MAX_DECLARED_STATIC_MODELS = 1024


def static_model_limit(recipe):
    if 'sourceSpawnReferenceActor' in recipe and type(recipe['sourceSpawnReferenceActor']) is not bool:
        raise ValueError('sourceSpawnReferenceActor must be an explicit boolean')
    limit = recipe.get('maxStaticModels', 16)
    if type(limit) is not int or not 1 <= limit <= MAX_DECLARED_STATIC_MODELS:
        raise ValueError(f'maxStaticModels must be an integer in 1..{MAX_DECLARED_STATIC_MODELS}')
    return limit


def static_model_policies(recipe):
    policies = recipe.get('staticModelPolicies', {})
    if (not isinstance(policies, dict) or len(policies) > MAX_DECLARED_STATIC_MODELS or
            any(not isinstance(name, str) or not re.fullmatch(r'\w+(?:\.\w+)+', name) or policy != 'preserve-native-graph'
                for name, policy in policies.items()) or len({name.casefold() for name in policies}) != len(policies)):
        raise ValueError('Static material policies require unique exact qualified source objects and preserve-native-graph policy')
    return policies


def validate_static_requests(requests, placements, recipe):
    limit = static_model_limit(recipe)
    identities = [row['object'] for row in requests]
    minimum = 0 if 'terrainSectorRectangle' in recipe else 1
    if (not minimum <= len(requests) <= limit or len(set(identities)) != len(identities) or
            set(identities) != {row['resolvedMeshObject'] for row in placements}):
        raise ValueError(f'Runtime conversion requires the exact declared section request set with at most{limit} models')
    policies = static_model_policies(recipe)
    if set(policies)-set(identities) or any(row.get('materialPolicy') != policies.get(row['object']) for row in requests):
        raise ValueError('Declared static material policies must match the exact selected source models/requests')
    return limit
