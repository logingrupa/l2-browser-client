import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const devSheetFolder = "src/ui/devSheet";
const maximumDevSheetFileLines = 400;
const commentFreeDevSheetFiles = [
  "DevSheet.ts", "devSheetLayout.ts", "devSheetDrag.ts", "devSheetKeyboard.ts", "devSheetTabs.ts", "hoverCards.ts", "devSheetIdEntry.ts", "types.ts",
  "sandboxPickerHost.ts", "sandboxPickerRegistry.ts", "sandboxPickerMatches.ts", "sandboxPickerControls.ts", "spawnPicker.ts",
].map(file => `${devSheetFolder}/${file}`);

const devSheetSourceFiles = readdirSync(devSheetFolder).filter(file => file.endsWith(".ts")).map(file => `${devSheetFolder}/${file}`);

function lineCount(source: string): number {
  return source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
}

function commentEndPosition(source: string, start: number, opener: string): number {
  if (opener === "//") {
    const lineEnd = source.indexOf("\n", start);
    return lineEnd === -1 ? source.length : lineEnd;
  }
  const blockEnd = source.indexOf("*/", start + 2);
  return blockEnd === -1 ? source.length : blockEnd + 2;
}

function findComments(source: string): string[] {
  const comments: string[] = [];
  let quote: string | null = null;
  for (let position = 0; position < source.length; position += 1) {
    const character = source[position]!;
    if (quote !== null) {
      if (character === "\\") position += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") { quote = character; continue; }
    const pair = source.slice(position, position + 2);
    if (pair !== "//" && pair !== "/*") continue;
    const commentEnd = commentEndPosition(source, position, pair);
    comments.push(source.slice(position, commentEnd).trim());
    position = commentEnd;
  }
  return comments;
}

describe("developer sheet source rules", () => {
  it("scans every developer sheet module", () => {
    expect(devSheetSourceFiles).toContain(`${devSheetFolder}/DevSheet.ts`);
    expect(devSheetSourceFiles).toContain(`${devSheetFolder}/devSheetLayout.ts`);
  });

  it.each(devSheetSourceFiles)("keeps %s under 400 lines", file => {
    expect(lineCount(readFileSync(file, "utf8"))).toBeLessThan(maximumDevSheetFileLines);
  });

  it.each(commentFreeDevSheetFiles)("keeps %s free of line and block comments", file => {
    expect(findComments(readFileSync(file, "utf8"))).toEqual([]);
  });

  it("finds line and block comments but not comment markers inside strings", () => {
    const source = [
      "const url = \"https://example.invalid/path\";",
      "const template = `/* not a comment */ ${url}`;",
      "const quoted = 'a // b';",
      "// line comment",
      "/* block",
      "   comment */",
      "const after = 1;",
    ].join("\n");
    expect(findComments(source)).toEqual(["// line comment", "/* block\n   comment */"]);
  });
});
