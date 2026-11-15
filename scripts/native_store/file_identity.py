import os


def file_identity(path):
    try:
        status = os.stat(path)
    except OSError:
        return None
    return status.st_dev, status.st_ino, status.st_size, status.st_mtime_ns
