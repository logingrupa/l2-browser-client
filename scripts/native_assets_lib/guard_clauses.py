def require_condition(condition, message):
    if not condition:
        raise ValueError(message)
