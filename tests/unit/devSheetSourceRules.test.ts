import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const devSheetFolder = "src/ui/devSheet";
const nativeTablesFolder = "src/ui/nativeTables";
const maximumDevSheetFileLines = 400;
const commentFreeDevSheetFiles = [
  "DevSheet.ts", "devSheetLayout.ts", "devSheetDrag.ts", "devSheetKeyboard.ts", "devSheetTabs.ts", "hoverCards.ts", "devSheetIdEntry.ts", "types.ts",
  "sandboxPickerHost.ts", "sandboxPickerRegistry.ts", "sandboxPickerMatches.ts", "sandboxPickerControls.ts",
  "tilePicker.ts", "spawnPicker.ts", "equipPicker.ts", "castPicker.ts", "windowPicker.ts",
].map(file => `${devSheetFolder}/${file}`);

function typeScriptFilesIn(folder: string): string[] {
  return readdirSync(folder).filter(file => file.endsWith(".ts")).map(file => `${folder}/${file}`);
}

const devSheetSourceFiles = typeScriptFilesIn(devSheetFolder);
const pickerModuleNamePattern = /\/(?:sandboxPicker\w*|tilePicker|spawnPicker|equipPicker|castPicker|windowPicker)\.ts$/;
const unstyledPickerFiles = [...devSheetSourceFiles.filter(file => pickerModuleNamePattern.test(file)), ...typeScriptFilesIn(nativeTablesFolder)];

const stylingRules: readonly (readonly [string, RegExp])[] = [
  ["stylesheet import", /import\s[^;]*["'][^"']*(?:\.css|Styles)["']/],
  ["style property write", /\.style\b|setProperty\(|cssText/],
  ["styling class", /\.className\b|\.classList\b/],
  ["colour literal", /#[0-9a-fA-F]{3,8}\b/],
  ["colour function", /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/],
  ["font value", /\bfont(?:-family|-size|-weight|Family|Size|Weight)?\s*:|\b(?:sans-serif|serif|monospace)\b/],
];

function lineCount(source: string): number {
  return source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
}

function findStylingViolations(source: string): string[] {
  return stylingRules.filter(([, pattern]) => pattern.test(source)).map(([rule]) => rule);
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

  it("covers every picker module and the name-index modules with the styling rule", () => {
    expect(unstyledPickerFiles).toEqual(expect.arrayContaining([
      `${devSheetFolder}/tilePicker.ts`, `${devSheetFolder}/spawnPicker.ts`, `${devSheetFolder}/equipPicker.ts`, `${devSheetFolder}/castPicker.ts`,
      `${devSheetFolder}/windowPicker.ts`, `${devSheetFolder}/sandboxPickerControls.ts`, `${devSheetFolder}/sandboxPickerHost.ts`,
      `${devSheetFolder}/sandboxPickerMatches.ts`, `${devSheetFolder}/sandboxPickerRegistry.ts`, `${nativeTablesFolder}/readNativeTableNameIndex.ts`,
    ]));
  });

  it.each(unstyledPickerFiles)("keeps %s free of stylesheets, style writes, styling classes, colours and fonts", file => {
    expect(findStylingViolations(readFileSync(file, "utf8"))).toEqual([]);
  });

  it("flags every styling rule on a synthetic violating source", () => {
    const source = [
      "import { devSheetStyles } from \"./devSheetStyles\";",
      "note.style.color = \"#ffcc00\";",
      "row.className = \"picker-row\";",
      "const shade = \"rgba(0, 0, 0, .5)\";",
      "const face = { fontFamily: \"serif\" };",
    ].join("\n");
    expect(findStylingViolations(source)).toEqual(["stylesheet import", "style property write", "styling class", "colour literal", "colour function", "font value"]);
    expect(findStylingViolations("import \"./picker.css\";")).toEqual(["stylesheet import"]);
    expect(findStylingViolations("const windowKey = \"window:ShortcutWnd#2\";")).toEqual([]);
  });
});
