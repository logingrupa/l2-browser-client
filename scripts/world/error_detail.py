import re
import subprocess

from native_catalog.ue2 import FormatError

MODEL_CONVERSION_ERRORS = (FormatError, ValueError, subprocess.TimeoutExpired)
CONVERSION_FAILURE_DETAIL_SEPARATOR = re.compile(r'[:;]')


def first_line_of_error(error):
    message = str(error).strip()
    return message.splitlines()[0] if message else type(error).__name__


def conversion_failure_reason(error):
    message = str(error).strip()
    sentence = CONVERSION_FAILURE_DETAIL_SEPARATOR.split(message.splitlines()[0], maxsplit=1)[0].strip() if message else ''
    return f'decode-failed:{type(error).__name__}:{sentence or "no message"}'
