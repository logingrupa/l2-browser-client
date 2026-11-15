import { describe, expect, it } from "vitest";
import { listTypeScriptModules, readSourceModuleText } from "../support/sourceImportSpecifiers";
import { moduleStringLiterals } from "../support/sourceStringLiterals";

const nativeWindowsFolder = "src/ui/nativeWindows";
const nativeResourcePrefix = "/l2/";
const objectUrlPrefix = "blob:";

const hexColourPattern = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-zA-Z_])/;
const colourFunctionPattern = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const cssColourOrFontDeclarationPattern =
  /(?:^|[\s;{"'])(?:color|background(?:-color|-image)?|border(?:-[a-z]+)?-color|outline-color|fill|stroke|box-shadow|text-shadow|filter|font(?:-[a-z]+)?)\s*:/i;
const styleColourOrFontPropertyPattern =
  /\.style\.(?:color|background\w*|border\w*Color|outlineColor|fill|stroke|boxShadow|textShadow|filter|font\w*|cssText)\b|\.style\[\s*["'`](?:color|background[\w-]*|border[\w-]*color|fill|stroke|box-shadow|text-shadow|filter|font[\w-]*)/;
const setPropertyColourOrFontPattern = /setProperty\(\s*["'`](?:color|background[\w-]*|border[\w-]*color|outline-color|fill|stroke|box-shadow|text-shadow|filter|font[\w-]*)["'`]/i;
const styleAttributePattern = /setAttribute\(\s*["'`]style["'`]/;
const fontFamilyPattern = /font-?family/i;
const cssUrlPattern = /url\(\s*["']?([^"')\s]*)/gi;
const sourceAttributeLiteralPattern = /(?:setAttribute\(\s*["'`](?:src|srcset|href|poster)["'`]\s*,\s*|\.(?:src|srcset|poster)\s*=\s*)["'`]([^"'`]*)["'`]/g;
const imageFileLiteralPattern = /^(?:https?:|data:image|\/\/|\.{0,2}\/(?!l2\/)[^\s]*\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico|dds|tga)(?:[?#][^\s]*)?$)/i;

function allowedImageSource(source: string): boolean {
  return source.startsWith(nativeResourcePrefix) || source.startsWith(objectUrlPrefix);
}

function nativeWindowStyleViolations(sourceText: string): string[] {
  const violations: string[] = [];
  const literals = moduleStringLiterals(sourceText);
  for (const literal of literals) {
    if (hexColourPattern.test(literal)) violations.push(`hex colour in "${literal}"`);
    if (colourFunctionPattern.test(literal)) violations.push(`colour function in "${literal}"`);
    if (cssColourOrFontDeclarationPattern.test(literal)) violations.push(`colour or font declaration in "${literal}"`);
    if (imageFileLiteralPattern.test(literal)) violations.push(`image outside ${nativeResourcePrefix} in "${literal}"`);
    for (const match of literal.matchAll(cssUrlPattern)) {
      if (!allowedImageSource(match[1] ?? "")) violations.push(`url() outside ${nativeResourcePrefix} in "${literal}"`);
    }
  }
  if (fontFamilyPattern.test(sourceText)) violations.push("font-family");
  if (styleColourOrFontPropertyPattern.test(sourceText)) violations.push("colour or font style property");
  if (setPropertyColourOrFontPattern.test(sourceText)) violations.push("colour or font style setProperty");
  if (styleAttributePattern.test(sourceText)) violations.push("style attribute");
  for (const match of sourceText.matchAll(sourceAttributeLiteralPattern)) {
    if (!allowedImageSource(match[1] ?? "")) violations.push(`image source outside ${nativeResourcePrefix}: "${match[1]}"`);
  }
  return violations;
}

const violatingSources: readonly (readonly [string, string])[] = [
  ["hex colour", "const plate = \"#1a2b3c\";"],
  ["short hex colour", "element.style.borderTop = \"1px solid #fff\";"],
  ["rgb call", "const shade = `rgb(${red}, 0, 0)`;"],
  ["rgba call", "const shade = \"rgba(0,0,0,.5)\";"],
  ["oklch call", "const shade = \"oklch(70% 0.1 200)\";"],
  ["colour property", "element.style.color = tone;"],
  ["background colour property", "element.style.backgroundColor = tone;"],
  ["border colour property", "element.style.borderLeftColor = tone;"],
  ["fill property", "element.style.fill = tone;"],
  ["shadow property", "element.style.boxShadow = shadow;"],
  ["font property", "element.style.fontSize = size;"],
  ["font-family", "element.style.setProperty(\"font-family\", family);"],
  ["fontFamily", "element.style.fontFamily = family;"],
  ["css text", "element.style.cssText = rules;"],
  ["css declaration text", "const rules = \"color: red\";"],
  ["style attribute", "element.setAttribute(\"style\", rules);"],
  ["url outside /l2/", "element.style.backgroundImage = \"url(/assets/skin.png)\";"],
  ["image src outside /l2/", "image.setAttribute(\"src\", \"/assets/skin.png\");"],
  ["image src remote", "image.src = \"https://example.invalid/skin.png\";"],
];

const cleanSource = [
  "element.style.position = \"absolute\";",
  "element.style.left = `${left}px`;",
  "element.style.top = `${top}px`;",
  "element.style.width = `${width}px`;",
  "element.style.height = `${height}px`;",
  "container.style.overflow = \"hidden\";",
  "image.setAttribute(\"src\", \"/l2/0f17e4d5/texture.png\");",
  "image.setAttribute(\"src\", url);",
  "image.src = \"blob:synthetic/plate\";",
  "const background = \"url(/l2/0f17e4d5/texture.png)\";",
  "const windowOrdinalSeparator = \"#\";",
  "const blob = new Blob([bytes], { type: \"image/png\" });",
].join("\n");

describe("DEC-OWN-10 source scan of src/ui/nativeWindows", () => {
  it.each(violatingSources)("flags a synthetic source with a %s", (_, source) => {
    expect(nativeWindowStyleViolations(source)).not.toEqual([]);
  });

  it("passes a synthetic source using only position, size, overflow and /l2/ or object URL images", () => {
    expect(nativeWindowStyleViolations(cleanSource)).toEqual([]);
  });

  it("finds no custom styling in any module of the folder", () => {
    const modules = listTypeScriptModules(nativeWindowsFolder);
    expect(modules).toContain(`${nativeWindowsFolder}/nativeWindowRenderer.ts`);
    expect(modules).toContain(`${nativeWindowsFolder}/nativeWindowLayer.ts`);
    expect(modules.flatMap(modulePath => nativeWindowStyleViolations(readSourceModuleText(modulePath)).map(violation => `${modulePath}: ${violation}`)))
      .toEqual([]);
  });
});
