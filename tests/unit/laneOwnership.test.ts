import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  foreignPathsForLane,
  laneOfPart,
  ownerLaneOfPath,
  pathMatchesOwnershipPattern,
  readLaneOwnership,
  validateLaneOwnership,
  type LaneOwnership,
} from "../../scripts/check-lane-ownership.mjs";

const laneOwnershipFilePath = ".planning/lanes.json";
const evidenceDocumentByteLimit = 30_720;
const portScopePartSlugsInOrder = [
  "data",
  "sandbox",
  "world",
  "player-characters",
  "ui",
  "npcs",
  "items",
  "skills-effects",
  "audio",
  "minimap",
  "movement-geodata",
  "adapter-login",
  "adapter-dispatch",
  "combat-display",
  "npc-dialogs",
  "shops-trade",
  "social",
  "quests",
  "late-systems",
];

function bulletLinesOf(filePath: string): string[] {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("- "));
}

function sampleLaneOwnership(): LaneOwnership {
  return {
    schemaVersion: 1,
    rules: {
      maximumParallelLanes: 3,
      branchPattern: "<part>/<slug>",
      unclaimedPathOwner: "integration",
      sharedByAllLanes: ["tests/unit/**"],
    },
    lanes: {
      world: { title: "L1 world", parts: ["world"], owns: ["src/scene/world/**"] },
      "data-ui": { title: "L3 data and UI", parts: ["ui"], owns: ["src/ui/**"] },
      integration: { title: "Integration", parts: ["adapter-login"], owns: ["package.json"] },
    },
  };
}

function nativeStoreWriterScriptPaths(): string[] {
  const trackedScriptPaths = execFileSync("git", ["ls-files", "scripts"], { encoding: "utf8" }).split("\n");
  const writerFileNamePattern = /^scripts\/(stage|derive-|migrate-)[^/]*$/;
  const packageScripts = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
  const writerCommandPaths = Object.entries(packageScripts)
    .filter(([name]) => name.startsWith("assets:") || name === "world:stage")
    .flatMap(([, command]) => command.match(/scripts\/[A-Za-z0-9._/-]+/g) ?? []);
  return [...trackedScriptPaths.filter((path) => writerFileNamePattern.test(path)), ...writerCommandPaths];
}

describe("lane ownership check", () => {
  it("lists every changed path outside the world lane as foreign, sorted", () => {
    const changedPaths = ["src/scene/world/a.ts", "tests/unit/a.test.ts", "src/ui/b.ts", "package.json"];
    expect(foreignPathsForLane(sampleLaneOwnership(), laneOfPart(sampleLaneOwnership(), "world"), changedPaths)).toEqual([
      "package.json",
      "src/ui/b.ts",
    ]);
  });

  it("rejects a pattern claimed by two lanes", () => {
    const ownership = sampleLaneOwnership();
    ownership.lanes.world?.owns.push("src/ui/**");
    expect(() => validateLaneOwnership(ownership)).toThrow("pattern src/ui/** claimed by two lanes");
  });

  it("rejects a pattern that is neither an exact path nor <dir>/**", () => {
    const ownership = sampleLaneOwnership();
    ownership.lanes.world?.owns.push("src/*.ts");
    expect(() => validateLaneOwnership(ownership)).toThrow("invalid pattern src/*.ts");
  });

  it("reports a path matched by two lanes as an error", () => {
    const ownership = sampleLaneOwnership();
    ownership.lanes["data-ui"]?.owns.push("src/scene/world/shared.ts");
    expect(() => ownerLaneOfPath(ownership, "src/scene/world/shared.ts")).toThrow("path claimed by two lanes");
  });

  it("passes an empty diff and accepts a lane with no owned paths", () => {
    const ownership = sampleLaneOwnership();
    ownership.lanes["data-ui"] = { title: "L3 data and UI", parts: ["ui"], owns: [] };
    expect(validateLaneOwnership(ownership)).toBe(ownership);
    expect(foreignPathsForLane(ownership, "world", [])).toEqual([]);
  });

  it("gives a path no lane claims to the integration lane", () => {
    expect(ownerLaneOfPath(sampleLaneOwnership(), "docs/ARCHITECTURE.md")).toBe("integration");
  });

  it("matches git paths case-sensitively", () => {
    expect(pathMatchesOwnershipPattern("SRC/UI/b.ts", "src/ui/**")).toBe(false);
    expect(pathMatchesOwnershipPattern("src/ui/b.ts", "src/ui/**")).toBe(true);
    expect(pathMatchesOwnershipPattern("src/uiextra/b.ts", "src/ui/**")).toBe(false);
  });

  it("returns the same foreign paths on a repeated run", () => {
    const changedPaths = ["src/ui/b.ts", "package.json", "src/scene/world/a.ts"];
    expect(foreignPathsForLane(sampleLaneOwnership(), "world", changedPaths)).toEqual(
      foreignPathsForLane(sampleLaneOwnership(), "world", changedPaths),
    );
  });

  it("names the file when lanes.json is missing", () => {
    expect(() => readLaneOwnership("missing-directory/lanes.json")).toThrow("missing-directory/lanes.json");
  });

  it("names the file when lanes.json is not valid JSON", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "lane-ownership-test-"));
    const unparsableFilePath = join(temporaryDirectory, "lanes.json");
    writeFileSync(unparsableFilePath, "{ not json");
    try {
      expect(() => readLaneOwnership(unparsableFilePath)).toThrow(`${unparsableFilePath} is not valid JSON`);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

describe("lane ownership command line", () => {
  function runGit(repositoryDirectory: string, gitArguments: string[]): string {
    return execFileSync("git", ["-c", "user.name=Lane Test", "-c", "user.email=lane@test.invalid", "-c", "core.autocrlf=false", ...gitArguments], {
      cwd: repositoryDirectory,
      encoding: "utf8",
    });
  }

  function writeRepositoryFile(repositoryDirectory: string, relativePath: string, content: string): void {
    mkdirSync(dirname(join(repositoryDirectory, relativePath)), { recursive: true });
    writeFileSync(join(repositoryDirectory, relativePath), content);
  }

  function runLaneCheck(repositoryDirectory: string, checkArguments: string[]): { exitCode: number; output: string } {
    const result = spawnSync(process.execPath, ["scripts/check-lane-ownership.mjs", ...checkArguments], { cwd: repositoryDirectory, encoding: "utf8" });
    return { exitCode: result.status ?? -1, output: result.stdout + result.stderr };
  }

  it("flags every path outside the world lane on branch world/batch-tiles", () => {
    const repositoryDirectory = mkdtempSync(join(tmpdir(), "lane-ownership-repository-"));
    try {
      runGit(repositoryDirectory, ["init", "--quiet", "--initial-branch=main"]);
      writeRepositoryFile(repositoryDirectory, "scripts/check-lane-ownership.mjs", readFileSync("scripts/check-lane-ownership.mjs", "utf8"));
      writeRepositoryFile(repositoryDirectory, ".planning/lanes.json", JSON.stringify(sampleLaneOwnership()));
      runGit(repositoryDirectory, ["add", "."]);
      runGit(repositoryDirectory, ["commit", "--quiet", "-m", "base"]);
      runGit(repositoryDirectory, ["checkout", "--quiet", "-b", "world/batch-tiles"]);
      expect(runLaneCheck(repositoryDirectory, ["--base", "main"])).toEqual({ exitCode: 0, output: "lane world: 0 foreign paths\n" });
      for (const changedPath of ["src/scene/world/a.ts", "tests/unit/a.test.ts", "src/ui/b.ts", "package.json"]) {
        writeRepositoryFile(repositoryDirectory, changedPath, "changed\n");
      }
      runGit(repositoryDirectory, ["add", "."]);
      runGit(repositoryDirectory, ["commit", "--quiet", "-m", "lane work"]);
      const firstRun = runLaneCheck(repositoryDirectory, ["--base", "main"]);
      expect(firstRun).toEqual({ exitCode: 1, output: "lane world: 2 foreign paths\npackage.json\nsrc/ui/b.ts\n" });
      expect(runLaneCheck(repositoryDirectory, ["--base", "main"])).toEqual(firstRun);
      expect(runLaneCheck(repositoryDirectory, ["--base", "main;echo"]).exitCode).toBe(2);
    } finally {
      rmSync(repositoryDirectory, { recursive: true, force: true });
    }
  });
});

describe("repository lanes.json", () => {
  const ownership = readLaneOwnership(laneOwnershipFilePath);
  const partSlugs = Object.values(ownership.lanes).flatMap((lane) => lane.parts);

  it("has four lanes and 19 distinct parts", () => {
    expect(Object.keys(ownership.lanes).sort()).toEqual(["actors", "data-ui", "integration", "world"]);
    expect(new Set(partSlugs).size).toBe(19);
    expect(partSlugs).toHaveLength(19);
  });

  it("assigns exactly the PORT_SCOPE parts", () => {
    expect([...partSlugs].sort()).toEqual([...portScopePartSlugsInOrder].sort());
  });

  it("keeps every native-store writer script in the integration lane", () => {
    const writerPaths = nativeStoreWriterScriptPaths();
    expect(writerPaths.length).toBeGreaterThan(0);
    for (const writerPath of writerPaths) {
      expect({ writerPath, lane: ownerLaneOfPath(ownership, writerPath) }).toEqual({ writerPath, lane: "integration" });
    }
  });
});

describe("shared process files", () => {
  const ownership = readLaneOwnership(laneOwnershipFilePath);

  it("has one STATUS.md line per part in PORT_SCOPE order, with the owning lane and evidence doc", () => {
    const statusFields = bulletLinesOf("STATUS.md").map((line) => line.slice(2).split(" | "));
    expect(statusFields.map((fields) => fields[0])).toEqual(portScopePartSlugsInOrder);
    for (const [part, lane, state, evidenceDocument, ...extraFields] of statusFields) {
      expect(extraFields).toEqual([]);
      expect(lane).toBe(laneOfPart(ownership, part ?? ""));
      expect(state?.length).toBeGreaterThan(0);
      expect(evidenceDocument).toBe(`docs/parts/${part}/EVIDENCE.md`);
    }
  });

  it.each(portScopePartSlugsInOrder)("has an evidence doc for %s under 30 KB with the three sections", (part) => {
    const evidenceDocument = readFileSync(`docs/parts/${part}/EVIDENCE.md`, "utf8");
    expect(Buffer.byteLength(evidenceDocument, "utf8")).toBeLessThan(evidenceDocumentByteLimit);
    for (const heading of ["## Passes now", "## Open", "## Evidence"]) {
      expect(evidenceDocument.split(/\r?\n/)).toContain(heading);
    }
  });

  it("has one dated DECISIONS.md line per unique decision ID pointing at PROJECT.md", () => {
    const decisionLinePattern = /^- \d{4}-\d{2}-\d{2} (DEC-[A-Z]+-\d+): .+ Full text: \.planning\/PROJECT\.md$/;
    const decisionIdentifiers = bulletLinesOf("DECISIONS.md").map((line) => {
      const match = decisionLinePattern.exec(line);
      expect(match, line).not.toBeNull();
      return match?.[1] ?? "";
    });
    expect(new Set(decisionIdentifiers).size).toBe(decisionIdentifiers.length);
    const requiredIdentifiers = [
      ...Array.from({ length: 9 }, (_, index) => `DEC-OWN-${index + 1}`),
      ...Array.from({ length: 3 }, (_, index) => `DEC-PORT-${index + 1}`),
    ];
    expect(decisionIdentifiers).toEqual(expect.arrayContaining(requiredIdentifiers));
  });
});
