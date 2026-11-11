from pathlib import Path
import json

EMITTER_FEATURE_COVERAGE_RELATIVE_PATH = 'recipes/actors/emitter-feature-coverage.json'
EMITTER_FEATURE_UNPORTED_REASON_PREFIX = 'emitter-feature-unported:'
EMITTER_FEATURE_COVERAGE_FIELDS = frozenset({'schemaVersion', 'listVersion', 'source', 'features'})
EMITTER_FEATURE_FIELDS = frozenset({'property', 'emitterClasses', 'when'})
LEAF_CONDITION_BASE_FIELDS = frozenset({'test', 'property', 'classDefault'})
LEAF_CONDITION_EXTRA_FIELDS = {
    'is-true': frozenset(),
    'is-false': frozenset(),
    'is-nonzero': frozenset(),
    'at-least': frozenset({'value'}),
    'equals': frozenset({'value', 'constant'}),
    'not-in': frozenset({'values', 'constant'}),
}
BOOLEAN_CONDITION_TESTS = frozenset({'is-true', 'is-false'})
COMPOSITE_CONDITION_TESTS = frozenset({'all-of', 'any-of'})
COMPOSITE_CONDITION_FIELDS = frozenset({'test', 'conditions'})


class EmitterFeatureCoverageError(ValueError):
    pass


def is_number(value):
    return type(value) in (int, float)


def require_emitter_feature_condition(condition, feature_property):
    if not isinstance(condition, dict) or condition.get('test') not in LEAF_CONDITION_EXTRA_FIELDS.keys() | COMPOSITE_CONDITION_TESTS:
        raise EmitterFeatureCoverageError(f'{EMITTER_FEATURE_COVERAGE_RELATIVE_PATH} feature {feature_property} has a condition '
                                          f'outside {sorted(LEAF_CONDITION_EXTRA_FIELDS.keys() | COMPOSITE_CONDITION_TESTS)}')
    test = condition['test']
    if test in COMPOSITE_CONDITION_TESTS:
        if set(condition) != COMPOSITE_CONDITION_FIELDS or not isinstance(condition['conditions'], list) or not condition['conditions']:
            raise EmitterFeatureCoverageError(f'{EMITTER_FEATURE_COVERAGE_RELATIVE_PATH} feature {feature_property} {test} needs '
                                              'exactly {test, conditions} with a non-empty condition list')
        for inner_condition in condition['conditions']:
            require_emitter_feature_condition(inner_condition, feature_property)
        return
    if set(condition) != LEAF_CONDITION_BASE_FIELDS | LEAF_CONDITION_EXTRA_FIELDS[test]:
        raise EmitterFeatureCoverageError(f'{EMITTER_FEATURE_COVERAGE_RELATIVE_PATH} feature {feature_property} {test} needs exactly '
                                          f'{sorted(LEAF_CONDITION_BASE_FIELDS | LEAF_CONDITION_EXTRA_FIELDS[test])}')
    if not (isinstance(condition['property'], str) and condition['property'] and type(condition['classDefault']) is bool):
        raise EmitterFeatureCoverageError(f'{EMITTER_FEATURE_COVERAGE_RELATIVE_PATH} feature {feature_property} {test} needs a property '
                                          'name and a boolean classDefault')
    if 'value' in condition and not is_number(condition['value']):
        raise EmitterFeatureCoverageError(f'{EMITTER_FEATURE_COVERAGE_RELATIVE_PATH} feature {feature_property} {test} value must be a number')
    if 'values' in condition and not (isinstance(condition['values'], list) and condition['values']
                                      and all(is_number(value) for value in condition['values'])):
        raise EmitterFeatureCoverageError(f'{EMITTER_FEATURE_COVERAGE_RELATIVE_PATH} feature {feature_property} {test} values must be '
                                          'a non-empty number list')
    if 'constant' in condition and not (isinstance(condition['constant'], str) and condition['constant']):
        raise EmitterFeatureCoverageError(f'{EMITTER_FEATURE_COVERAGE_RELATIVE_PATH} feature {feature_property} {test} must name its '
                                          'TypeScript constant')


def require_emitter_feature(feature):
    if not (isinstance(feature, dict) and set(feature) == EMITTER_FEATURE_FIELDS and isinstance(feature['property'], str)
            and feature['property'] and isinstance(feature['emitterClasses'], list) and feature['emitterClasses']
            and all(isinstance(name, str) and name.startswith('Engine.') for name in feature['emitterClasses'])
            and len(set(feature['emitterClasses'])) == len(feature['emitterClasses'])):
        raise EmitterFeatureCoverageError(f'{EMITTER_FEATURE_COVERAGE_RELATIVE_PATH} features must be {{property, emitterClasses, when}} '
                                          'with unique Engine emitter class names')
    require_emitter_feature_condition(feature['when'], feature['property'])


def read_emitter_feature_rules(project_root):
    document = json.loads((Path(project_root) / EMITTER_FEATURE_COVERAGE_RELATIVE_PATH).read_text(encoding='utf-8'))
    if not (isinstance(document, dict) and set(document) == EMITTER_FEATURE_COVERAGE_FIELDS and document['schemaVersion'] == 1
            and type(document['listVersion']) is int and document['listVersion'] >= 1 and isinstance(document['source'], str)
            and isinstance(document['features'], list) and document['features']):
        raise EmitterFeatureCoverageError(f'{EMITTER_FEATURE_COVERAGE_RELATIVE_PATH} must be {{schemaVersion 1, listVersion, source, features}} '
                                          'with a non-empty feature list')
    for feature in document['features']:
        require_emitter_feature(feature)
    properties = [feature['property'] for feature in document['features']]
    if len(set(properties)) != len(properties):
        raise EmitterFeatureCoverageError(f'{EMITTER_FEATURE_COVERAGE_RELATIVE_PATH} lists a feature property twice')
    return tuple(document['features'])


def condition_property_value(component, condition):
    effective_properties = component['effectiveProperties']
    name = condition['property']
    if name not in effective_properties:
        if condition['classDefault']:
            raise EmitterFeatureCoverageError(f'{component["object"]} has no Interlude class default {name} in effectiveProperties')
        return False if condition['test'] in BOOLEAN_CONDITION_TESTS else 0
    value = effective_properties[name]
    expected_boolean = condition['test'] in BOOLEAN_CONDITION_TESTS
    if (type(value) is not bool) if expected_boolean else not is_number(value):
        raise EmitterFeatureCoverageError(f'{component["object"]} effectiveProperties {name} is not a '
                                          f'{"boolean" if expected_boolean else "number"}: {value!r}')
    return value


def condition_holds(component, condition):
    test = condition['test']
    if test == 'all-of':
        return all(condition_holds(component, inner_condition) for inner_condition in condition['conditions'])
    if test == 'any-of':
        return any(condition_holds(component, inner_condition) for inner_condition in condition['conditions'])
    value = condition_property_value(component, condition)
    if test == 'is-true':
        return value is True
    if test == 'is-false':
        return value is False
    if test == 'is-nonzero':
        return value != 0
    if test == 'at-least':
        return value >= condition['value']
    if test == 'equals':
        return value == condition['value']
    return value not in condition['values']


def unported_emitter_feature_reasons(component, feature_rules):
    if not (isinstance(component, dict) and isinstance(component.get('object'), str) and isinstance(component.get('class'), str)
            and isinstance(component.get('effectiveProperties'), dict)):
        raise EmitterFeatureCoverageError('a staged component needs an object name, a class and effectiveProperties')
    return [EMITTER_FEATURE_UNPORTED_REASON_PREFIX + feature['property'] for feature in feature_rules
            if component['class'] in feature['emitterClasses'] and condition_holds(component, feature['when'])]
