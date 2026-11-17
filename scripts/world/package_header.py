from pathlib import PurePosixPath

from native_catalog.ue2 import FormatError, summary

PACKAGE_HEADER_PREFIX_BYTES = 128


def read_package_header(client_access, relative_path):
    path = client_access.require_equal_file(relative_path)
    with open(path, 'rb') as stream:
        prefix = stream.read(PACKAGE_HEADER_PREFIX_BYTES)
    try:
        package_summary = summary(prefix, PurePosixPath(relative_path).name)
    except (FormatError, UnicodeError) as error:
        return {'error': str(error)}
    return {'packageVersion': package_summary['version'], 'licensee': package_summary['licenseeVersion'], 'wrapper': package_summary['wrapper']}
