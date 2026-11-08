import { describe, expect, it } from "vitest";
import { findSharedTokenRuns, normaliseSourceTokens } from "../../tools/reference-overlap/referenceOverlap.mjs";
import { alternatingCoreText, sharedRunLengths, sourceAndReferenceWithSharedCore } from "../support/sharedTokenCore";

describe("normaliseSourceTokens", () => {
  it("replaces identifiers and strings with placeholders, strips comments and imports, and keeps canonical numbers", () => {
    const tokens = normaliseSourceTokens('import { thing } from "./thing";\nconst label = "a"; // trailing\n/* block\n */ let count = 0x10 + 1_000;\nconst lazy = import("./lazy");');
    expect(tokens.map(token => token.normalised)).toEqual([
      "const", "<identifier>", "=", "<string>", ";",
      "let", "<identifier>", "=", "16", "+", "1000", ";",
      "const", "<identifier>", "=", "import", "(", "<string>", ")", ";",
    ]);
    expect(tokens.map(token => token.line)).toEqual([2, 2, 2, 2, 2, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5]);
  });

  it("reads multi-character operators as one token", () => {
    expect(normaliseSourceTokens("a >>>= b ?? c?.d === e").map(token => token.normalised))
      .toEqual(["<identifier>", ">>>=", "<identifier>", "??", "<identifier>", "?.", "<identifier>", "===", "<identifier>"]);
  });

  it.each([
    ["an import property key", "const options = { import: true };", ["const", "options", "=", "{", "import", ":", "true", "}", ";"]],
    ["an import member", "settings.import = enabled;", ["settings", ".", "import", "=", "enabled", ";"]],
    ["a dynamic import call", "const lazy = import(\"./lazy\");", ["const", "lazy", "=", "import", "(", "\"./lazy\"", ")", ";"]],
    ["import.meta", "const address = import.meta.url;", ["const", "address", "=", "import", ".", "meta", ".", "url", ";"]],
  ])("keeps %s and every token after it", (_caseName, importUseText, importUseTokens) => {
    expect(normaliseSourceTokens(`${importUseText} const kept = 1;`).map(token => token.original)).toEqual([...importUseTokens, "const", "kept", "=", "1", ";"]);
  });

  it("drops an import alias declaration up to its own end and keeps the code after it", () => {
    expect(normaliseSourceTokens("import Alias = Namespace.Member; const kept = 1;").map(token => token.original)).toEqual(["const", "kept", "=", "1", ";"]);
    expect(normaliseSourceTokens("import Alias = Namespace.Member\nconst kept = 1").map(token => token.original)).toEqual(["const", "kept", "=", "1"]);
  });

  it("drops every normal import form up to its own statement end", () => {
    const importForms = [
      "import { first, second as renamed } from \"./named\";",
      "import defaultBinding from \"./default\"",
      "import * as namespaceBinding from \"./namespace\";",
      "import \"./side-effect\";",
      "import type { TypeOnly } from \"./types\";",
      "import combined, { \"quoted-name\" as quoted } from \"./data.json\" with { type: \"json\" };",
      "import required = require(\"./required\");",
      "import type RequiredType = require(\"./required-type\")",
      "import from from \"./named-from\";",
    ];
    expect(normaliseSourceTokens(`${importForms.join("\n")}\nconst kept = 1;`).map(token => token.original)).toEqual(["const", "kept", "=", "1", ";"]);
  });

  it("finds a 20 token copy that follows an import property key", () => {
    const { sourceText, referenceText } = sourceAndReferenceWithSharedCore(20);
    expect(sharedRunLengths(`const options = { import: true };\n${sourceText}`, referenceText, 12)).toEqual([20]);
  });
});

describe("findSharedTokenRuns thresholds", () => {
  it("gives no finding for 11 shared tokens and one finding for 12", () => {
    const eleven = sourceAndReferenceWithSharedCore(11);
    const twelve = sourceAndReferenceWithSharedCore(12);
    expect(sharedRunLengths(eleven.sourceText, eleven.referenceText, 12)).toEqual([]);
    expect(sharedRunLengths(twelve.sourceText, twelve.referenceText, 12)).toEqual([12]);
  });

  it("reports one maximal run for 20 shared tokens, not its sub-runs", () => {
    const twenty = sourceAndReferenceWithSharedCore(20);
    expect(sharedRunLengths(twenty.sourceText, twenty.referenceText, 12)).toEqual([20]);
  });

  it("is not hidden by renaming every identifier consistently", () => {
    const sourceText = "const total = first + second * first ; return total - second ;";
    const renamedText = "const sum = left + right * left ; return sum - right ;";
    expect(sharedRunLengths(sourceText, renamedText, 12)).toEqual([14]);
  });

  it("separates identifiers that the reference keeps apart", () => {
    const sourceText = "const total = first + second * first ; return total - second ;";
    const differentlyBoundText = "const sum = left + right * right ; return sum - left ;";
    expect(sharedRunLengths(sourceText, differentlyBoundText, 12)).toEqual([]);
  });

  it("is broken by changing one numeric literal", () => {
    const changedSourceText = `7001 ${alternatingCoreText(20, "alpha", 9)} 7002`;
    const referenceText = `8001 ${alternatingCoreText(20, "beta")} 8002`;
    expect(sharedRunLengths(changedSourceText, referenceText, 12)).toEqual([]);
  });

  it("is not hidden by comments inside the run", () => {
    const sourceCore = alternatingCoreText(12, "alpha").split(" ");
    const commentedSourceText = `7001 ${sourceCore.slice(0, 6).join(" ")} /* note */ ${sourceCore.slice(6, 9).join(" ")} // note\n${sourceCore.slice(9).join(" ")} 7002`;
    expect(sharedRunLengths(commentedSourceText, sourceAndReferenceWithSharedCore(12).referenceText, 12)).toEqual([12]);
  });

  it("refuses a minimum run that is not a positive integer", () => {
    expect(() => findSharedTokenRuns([], [], 0)).toThrow(RangeError);
  });
});
