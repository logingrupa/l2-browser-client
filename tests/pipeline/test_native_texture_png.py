"""Validate the supplementary PNG audit's lossless channel contract."""
from pathlib import Path
import subprocess
import unittest


class NativeTexturePngTests(unittest.TestCase):
    def test_exact_channels_include_rgb_under_zero_alpha(self):
        script = r'''
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { inspectPNG } from './scripts/native_texture_png.mjs';
const require = createRequire(import.meta.url);
const { PNG } = require('./node_modules/.pnpm/pngjs@7.0.0/node_modules/pngjs');
const data = Buffer.from([17,33,65,0,200,100,50,123]);
const result = inspectPNG(PNG.sync.write({width:2,height:1,data}, {colorType:6,inputColorType:6,inputHasAlpha:true}));
const sha = values => createHash('sha256').update(Buffer.from(values)).digest('hex');
assert.equal(result.rgbaSha256,sha(data));
for(const [i,name] of ['R','G','B','A'].entries()) assert.equal(result.channels[name].sha256,sha([data[i],data[4+i]]));
assert.equal(result.transparentNonzeroRGBPixels,1);
assert.equal(result.rgbDifferentPixels,2);
assert.equal(result.decoding.gammaCorrectionApplied,false);
assert.equal(result.decoding.channelSelected,null);
assert.throws(()=>inspectPNG(Buffer.alloc(33)),/signature/);
'''
        result = subprocess.run(['node', '--input-type=module'], input=script,
                                cwd=Path(__file__).resolve().parents[2], text=True,
                                capture_output=True, timeout=30, check=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
