import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import config, { buildExcludedPublicPaths, isBuildExcludedPublicPath } from "../../vite.config";

describe("deployable build public copy", () => {
  const publicDir = resolve("public");

  it("skips the lineagen-derived character GLBs and Talking Island world, keeps native data", () => {
    expect(buildExcludedPublicPaths).toEqual(["assets/characters", "assets/world"]);
    for (const path of ["assets/characters", "assets/characters/MFighter.glb", "assets/world", "assets/world/manifest.json", "assets/world/world-models/a.glb"])
      expect(isBuildExcludedPublicPath(publicDir, resolve(publicDir, path)), path).toBe(true);
    for (const path of ["", "assets", "l2/catalog.json", "scene/native-world.babylon", "vendor/babylon", "assets/worldmap.png", "assets/characters-note.txt"])
      expect(isBuildExcludedPublicPath(publicDir, resolve(publicDir, path)), path).toBe(false);
  });

  it("replaces Vite's whole-folder public copy with the filtered one", () => {
    const resolved = typeof config === "function" ? config({ command: "build", mode: "production" }) : config;
    const settings = resolved as { build?: { copyPublicDir?: boolean }; plugins?: { name?: string; apply?: string }[] };
    expect(settings.build?.copyPublicDir).toBe(false);
    expect(settings.plugins?.find(plugin => plugin.name === "public-without-lineagen-media")?.apply).toBe("build");
  });

  it("copies public files into the output, skips lineagen media and never overwrites bundle output", () => {
    const scratch = mkdtempSync(join(tmpdir(), "l2-public-copy-")), publicDir = join(scratch, "public"), outDir = join(scratch, "dist");
    try {
      const write = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
      write(join(publicDir, "l2/catalog.json"), "{}");
      write(join(publicDir, "scene/native-world.babylon"), "scene");
      write(join(publicDir, "assets/characters/MFighter.glb"), "lineagen");
      write(join(publicDir, "assets/world/manifest.json"), "lineagen");
      write(join(publicDir, "index.html"), "public copy");
      write(join(outDir, "index.html"), "bundle output");
      const resolved = (typeof config === "function" ? config({ command: "build", mode: "production" }) : config) as { plugins?: unknown[] };
      const plugin = resolved.plugins?.find(item => (item as { name?: string }).name === "public-without-lineagen-media") as
        { configResolved(config: unknown): void; writeBundle(): void };
      plugin.configResolved({ publicDir, root: scratch, build: { outDir: "dist" } });
      plugin.writeBundle();
      expect(readFileSync(join(outDir, "l2/catalog.json"), "utf8")).toBe("{}");
      expect(existsSync(join(outDir, "scene/native-world.babylon"))).toBe(true);
      expect(existsSync(join(outDir, "assets/characters"))).toBe(false);
      expect(existsSync(join(outDir, "assets/world"))).toBe(false);
      expect(readFileSync(join(outDir, "index.html"), "utf8")).toBe("bundle output");
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });
});
