import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Editor 5.5.3 exports fogMode even when its saved fogEnabled is false.
// Babylon 9.27.1 loads fogMode but has no serialized fogEnabled switch.
// Adapt only this native scene's generated file; saved Editor resources stay intact.
const root = fileURLToPath(new URL("../", import.meta.url));
const configPath = process.argv[2] ?? resolve(root, "assets/native-parity.scene/config.json");
const packedPath = process.argv[3] ?? resolve(root, "public/scene/native-parity.babylon");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const packed = JSON.parse(readFileSync(packedPath, "utf8"));
if (typeof config.fog?.fogEnabled !== "boolean" || ![0, 1, 2, 3].includes(config.fog.fogMode)) {
  throw new Error("Native Editor fog configuration is incomplete or unsupported.");
}
const mode = config.fog.fogEnabled ? config.fog.fogMode : 0;
if (packed.fogMode !== mode) {
  packed.fogMode = mode;
  writeFileSync(packedPath, JSON.stringify(packed));
}
