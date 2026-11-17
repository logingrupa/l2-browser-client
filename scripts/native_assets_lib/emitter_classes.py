import json
from pathlib import Path

CONVERTED_EMITTER_CLASSES = frozenset({'Engine.SpriteEmitter', 'Engine.MeshEmitter', 'Engine.BeamEmitter', 'Engine.RibbonEmitter',
    'Engine.VertMeshEmitter'})
EMITTER_CLASS_COVERAGE_RELATIVE_PATH = 'recipes/actors/emitter-class-coverage.json'
EMITTER_CLASS_COVERAGE_FIELDS = frozenset({'schemaVersion', 'listVersion', 'simulated', 'source'})


class EmitterClassCoverageError(ValueError):
    pass


def read_simulated_emitter_classes(project_root):
    path = Path(project_root) / EMITTER_CLASS_COVERAGE_RELATIVE_PATH
    document = json.loads(path.read_text(encoding='utf-8'))
    if not (isinstance(document, dict) and set(document) == EMITTER_CLASS_COVERAGE_FIELDS and document['schemaVersion'] == 1
            and type(document['listVersion']) is int and document['listVersion'] >= 1 and isinstance(document['simulated'], list)
            and all(isinstance(name, str) and name.startswith('Engine.') for name in document['simulated'])
            and len(set(document['simulated'])) == len(document['simulated'])):
        raise EmitterClassCoverageError(f'{EMITTER_CLASS_COVERAGE_RELATIVE_PATH} must be {{schemaVersion 1, listVersion, simulated, source}} '
                                        'with unique Engine emitter class names')
    return frozenset(document['simulated'])
