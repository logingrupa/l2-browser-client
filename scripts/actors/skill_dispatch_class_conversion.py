from actors.effect_bundle_packing import native_class_closure
from actors.skill_binding_table import BINDING_GAP_STATUS, NO_EXACT_SKILLSOUND_ROW_REASON, skill_binding_key
from actors.skill_bundle_step_names import SKILL_DISPATCH_CLASS_STEP
from actors.skill_dispatch_candidates import candidate_class_records, candidate_rows_by_class, skill_dispatch_class_key
from native_store.unit_ledger import UnitLedger

SKILL_DISPATCH_CLASS_ALGORITHM_VERSION = 1
SKILL_DISPATCH_CLASS_BUNDLE_ID_PREFIX = 'interlude:skill-dispatch-class:'
CLASS_OUTCOME_RECORD_NAME = 'class-outcome.json'


class SkillDispatchClassConversionError(ValueError):
    pass


def skill_dispatch_class_bundle_id(effect_object):
    return SKILL_DISPATCH_CLASS_BUNDLE_ID_PREFIX + effect_object


def representative_candidate_binding(candidate_rows, bindings_by_key):
    for skill_id, level in candidate_rows:
        binding = bindings_by_key.get(skill_binding_key(skill_id, level))
        if binding is not None and binding['status'] != BINDING_GAP_STATUS and binding['soundRowOrdinal'] is not None:
            return binding
    return None


class SkillDispatchClassUnits:
    def __init__(self, run, document, binding_rows):
        self.run = run
        self.ledger = UnitLedger(run.ledger.work_root, SKILL_DISPATCH_CLASS_STEP, SKILL_DISPATCH_CLASS_ALGORITHM_VERSION)
        self.classes = {record['effectObject']: record for record in candidate_class_records(document)}
        self.rows_by_class = candidate_rows_by_class(document)
        if set(self.rows_by_class) != set(self.classes):
            raise SkillDispatchClassConversionError('every candidate class needs at least one candidate row, and every candidate row a listed class')
        bindings_by_key = {row['key']: row for row in binding_rows}
        self.representatives = {effect_object: representative_candidate_binding(rows, bindings_by_key)
                                for effect_object, rows in self.rows_by_class.items()}

    def classes_in_first_row_order(self):
        return sorted(self.rows_by_class, key=lambda effect_object: (self.rows_by_class[effect_object][0], effect_object))

    def class_work(self, effect_object):
        representative = self.representatives[effect_object]
        config = {'effectObject': effect_object, 'packageSha256': self.classes[effect_object]['packageSha256'],
                  'representativeKey': representative['key'] if representative else None, 'tools': self.run.tool_identity}
        fingerprint = self.ledger.unit_fingerprint([record['sha256'] for record in self.run.input_records], config)
        return skill_dispatch_class_key(effect_object), representative, config, fingerprint

    def is_sealed(self, effect_object):
        unit_key, _, _, fingerprint = self.class_work(effect_object)
        return self.ledger.is_sealed(unit_key, fingerprint)

    def convert_class(self, effect_object):
        unit_key, representative, config, fingerprint = self.class_work(effect_object)
        return self.run.convert_bundle_unit(self.ledger, unit_key, config, fingerprint, CLASS_OUTCOME_RECORD_NAME,
                                            lambda step_directory: self.class_conversion_outcome(effect_object, representative, step_directory))

    def class_conversion_outcome(self, effect_object, representative, step_directory):
        if representative is None:
            return self.run.gap_outcome(NO_EXACT_SKILLSOUND_ROW_REASON)
        recipe = {'schemaVersion': 1, 'id': skill_dispatch_class_bundle_id(effect_object), 'skillId': representative['skillId'],
                  'level': representative['level'],
                  'effectClasses': [{'object': effect_object, 'packageSha256': self.classes[effect_object]['packageSha256']}]}
        return self.run.migrated_bundle_outcome(recipe, effect_object, lambda name: native_class_closure(self.run.packages, name),
                                                step_directory)

    def class_outcomes(self):
        outcomes = {}
        for effect_object in sorted(self.classes):
            unit_key, _, _, fingerprint = self.class_work(effect_object)
            sealed = self.run.sealed_bundle_outcome(self.ledger, unit_key, fingerprint, CLASS_OUTCOME_RECORD_NAME)
            if sealed is not None:
                outcomes[effect_object] = self.run.published_bundle_outcome(self.ledger.unit_step_directory(unit_key), sealed)
        return outcomes
