from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORLD_SCRIPTS = ROOT / 'scripts' / 'world'
TILE_IDENTITY_MODULES_ALLOWED = (
    'copy_world07_fixtures.py',
    'freeze_world_oracle.py',
    'reader_licensee_layouts.py',
    'terrain_layers.py',
    'tile_census.py',
)
TILE_IDENTITY_PATTERN = re.compile(r'(?<![0-9A-Za-z])\d{2}_\d{2}(?![0-9])')
ORACLE_MAP_SHA256_PREFIX = '1beddad2'


def tile_identity_literals(source):
    return [(number, line) for number, line in enumerate(source.splitlines(), 1)
            if TILE_IDENTITY_PATTERN.search(line) or ORACLE_MAP_SHA256_PREFIX in line]


class TileGeneralWorldStepTests(unittest.TestCase):
    def test_every_allowed_module_still_exists(self):
        self.assertEqual([name for name in TILE_IDENTITY_MODULES_ALLOWED if not (WORLD_SCRIPTS / name).is_file()], [])

    def test_no_world_step_module_names_a_tile_identity_or_the_20_20_map_hash(self):
        modules = sorted(path for path in WORLD_SCRIPTS.glob('*.py') if path.name not in TILE_IDENTITY_MODULES_ALLOWED)
        self.assertGreater(len(modules), 10)
        hits = [f'{path.relative_to(ROOT).as_posix()}:{number}: {line.strip()}'
                for path in modules for number, line in tile_identity_literals(path.read_text(encoding='utf-8'))]
        self.assertEqual(hits, [])

    def test_the_scan_finds_a_tile_identity_and_the_map_hash_prefix(self):
        self.assertEqual([number for number, _ in tile_identity_literals("a = 'maps/20_21.unr'\nb = 2\nc = '1beddad24c10'\nd = 'chunk-0-1'\n")], [1, 3])
        self.assertEqual(tile_identity_literals("value = 120_210\nother = 'x20_21'\n"), [])


if __name__ == '__main__':
    unittest.main()
