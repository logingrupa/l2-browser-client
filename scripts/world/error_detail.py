def first_line_of_error(error):
    message = str(error).strip()
    return message.splitlines()[0] if message else type(error).__name__
