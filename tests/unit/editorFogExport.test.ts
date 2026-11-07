import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("preserves a saved disabled fog setting through packing and subsequent enabled edits", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "l2-editor-fog-"));
  try {
    const configPath = resolve(directory, "config.json"), packedPath = resolve(directory, "scene.babylon");
    const fog = { fogEnabled: false, fogMode: 3, fogStart: 32, fogEnd: 85, fogDensity: .006, fogColor: [.49, .59, .56] };
    const packed = { fogMode: 3, fogStart: 32, fogEnd: 85, fogDensity: .006, fogColor: fog.fogColor, meshes: [{ id: "preserved" }] };
    writeFileSync(configPath, JSON.stringify({ fog })); writeFileSync(packedPath, JSON.stringify(packed));
    const source = readFileSync(configPath);
    const apply = () => execFileSync(process.execPath, [resolve("scripts/preserve-native-editor-fog.mjs"), configPath, packedPath]);
    apply();
    expect(JSON.parse(readFileSync(packedPath, "utf8"))).toEqual({ ...packed, fogMode: 0 });
    expect(readFileSync(configPath)).toEqual(source);
    const disabled = readFileSync(packedPath); apply(); expect(readFileSync(packedPath)).toEqual(disabled);
    writeFileSync(configPath, JSON.stringify({ fog: { ...fog, fogEnabled: true } }));
    apply(); expect(JSON.parse(readFileSync(packedPath, "utf8"))).toEqual(packed);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
