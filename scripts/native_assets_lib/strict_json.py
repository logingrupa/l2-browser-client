import json

from native_assets_lib.guard_clauses import require_condition


def decode_strict_json(data, max_bytes=8_000_000):
    require_condition(0 < len(data) <= max_bytes, 'Missing/oversized player staging JSON')

    def object_without_duplicate_keys(pairs):
        result = {}
        for key, value in pairs:
            require_condition(key not in result, 'Duplicate JSON key: ' + key)
            result[key] = value
        return result

    def refuse_nonfinite_constant(value):
        raise ValueError('Nonfinite JSON: ' + value)

    return json.loads(data, object_pairs_hook=object_without_duplicate_keys, parse_constant=refuse_nonfinite_constant)
