import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const skippedDirectoryNames = new Set([".git", "node_modules"]);

function globSegmentHasWildcard(segment) {
  return /[*?{]/.test(segment);
}

function globToRegularExpression(globPattern) {
  let expression = "";
  let index = 0;
  while (index < globPattern.length) {
    const character = globPattern[index];
    if (globPattern.startsWith("**/", index)) {
      expression += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (globPattern.startsWith("**", index)) {
      expression += ".*";
      index += 2;
      continue;
    }
    if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else if (character === "{") expression += "(?:";
    else if (character === "}") expression += ")";
    else if (character === ",") expression += "|";
    else expression += character.replace(/[.+^$()|[\]\\]/g, "\\$&");
    index += 1;
  }
  return new RegExp(`^${expression}$`);
}

function listFilesBelow(rootDirectory, relativeDirectory) {
  return readdirSync(path.join(rootDirectory, relativeDirectory), { withFileTypes: true }).flatMap(entry => {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return skippedDirectoryNames.has(entry.name) ? [] : listFilesBelow(rootDirectory, relativePath);
    return entry.isFile() ? [relativePath] : [];
  });
}

function isDirectory(absolutePath) {
  return existsSync(absolutePath) && statSync(absolutePath).isDirectory();
}

function expandGlob(rootDirectory, globPattern) {
  const segments = globPattern.split("/");
  const firstWildcardIndex = segments.findIndex(globSegmentHasWildcard);
  if (firstWildcardIndex === -1) {
    const absolutePath = path.join(rootDirectory, globPattern);
    return existsSync(absolutePath) && statSync(absolutePath).isFile() ? [globPattern] : [];
  }
  const staticDirectory = segments.slice(0, firstWildcardIndex).join("/") || ".";
  if (!isDirectory(path.join(rootDirectory, staticDirectory))) return [];
  const globExpression = globToRegularExpression(globPattern);
  return listFilesBelow(rootDirectory, staticDirectory).map(filePath => path.posix.normalize(filePath)).filter(filePath => globExpression.test(filePath));
}

export function expandRepositoryGlobs(rootDirectory, globPatterns) {
  return [...new Set(globPatterns.flatMap(globPattern => expandGlob(rootDirectory, globPattern)))].sort();
}
