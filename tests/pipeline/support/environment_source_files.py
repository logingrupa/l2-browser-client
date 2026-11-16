import json
import struct
import zlib

from native_environment import HEADER, XOR, build_products

SETUP_FILE_TEXT = ('[EnvSetup]\r\nIsClock=true\r\nStartTime=12\r\nTimeRatio=6\r\nSKYBOX=SkybackgroundColor\r\nHAZERING=HazeRing_Final\r\n'
                   'NumCloudColor=1\r\nCLOUD1=Cloud_Final\r\nShadowTick=0.1\r\nSlopeSunAngle=30\r\nTimeEnvFileNum=1\r\n'
                   'TimeEnvFileName0=TimeEnv0.INT\r\n')


def encoded_environment_file(text):
    body = HEADER + text.encode('latin-1').translate(XOR)
    return body + struct.pack('<5I', 0, 7, 90, zlib.crc32(body), 0)


def time_tables_of(files):
    products = build_products({name: encoded_environment_file(text) for name, text in files.items()})
    return json.loads(products['time-tables.json'])


def time_table_of(document, environment_type, section):
    entry = next(entry for entry in document['environmentTypes'] if entry['environmentType'] == environment_type)
    return next(table for table in entry['tables'] if table['section'] == section)
