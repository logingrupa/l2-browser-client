import hashlib
import re

SHA256_HEX_PATTERN = re.compile(r'[a-f0-9]{64}')


def sha256_hex_digest(data):
    return hashlib.sha256(data).hexdigest()
