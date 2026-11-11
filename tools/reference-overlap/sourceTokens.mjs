export const identifierPlaceholder = "<identifier>";
export const stringPlaceholder = "<string>";

const keywords = new Set([
  "abstract", "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger", "declare",
  "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "get", "if",
  "implements", "import", "in", "infer", "instanceof", "interface", "is", "keyof", "let", "namespace", "new", "null",
  "of", "override", "private", "protected", "public", "readonly", "return", "satisfies", "set", "static", "super",
  "switch", "this", "throw", "true", "try", "type", "typeof", "undefined", "var", "void", "while", "with", "yield",
]);

const punctuators = [
  ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
  "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
  "<<", ">>", "**",
];

const statementBoundaryTokens = new Set([";", "{", "}"]);
const importClausePunctuation = new Set(["*", ","]);
const importAttributeValueTokens = new Set([":", ",", stringPlaceholder]);
const importAttributesKeywords = new Set(["with", "assert"]);

const numericLiteralPattern = /0[xX][0-9a-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?[fFuUn]?/y;
const identifierPattern = /[\p{ID_Start}_$][\p{ID_Continue}$‌‍]*/uy;

export function readNumericLiteral(text, index) {
  numericLiteralPattern.lastIndex = index;
  const literalText = numericLiteralPattern.exec(text)[0];
  return { normalised: canonicalNumericLiteral(literalText), endIndex: index + literalText.length };
}

function canonicalNumericLiteral(literalText) {
  const digitsText = literalText.replaceAll("_", "");
  if (digitsText.endsWith("n")) return `${BigInt(digitsText.slice(0, -1)).toString()}n`;
  const isHexadecimal = /^0[xX]/.test(digitsText);
  const unsuffixedText = !isHexadecimal && /[fFuU]$/.test(digitsText) ? digitsText.slice(0, -1) : digitsText;
  return String(Number(unsuffixedText));
}

function quotedStringEnd(text, startIndex) {
  const quote = text[startIndex];
  let index = startIndex + 1;
  while (index < text.length && text[index] !== quote) {
    if (text[index] === "\\") index += 1;
    else if (text[index] === "\n" && quote !== "`") return index;
    index += 1;
  }
  return index + 1;
}

function matchPunctuator(text, index) {
  return punctuators.find(punctuator => text.startsWith(punctuator, index)) ?? text[index];
}

export function countNewlines(text, startIndex, endIndex) {
  let newlineCount = 0;
  for (let index = startIndex; index < endIndex; index += 1) if (text[index] === "\n") newlineCount += 1;
  return newlineCount;
}

function scanSourceTokens(text) {
  const tokens = [];
  let index = 0;
  let line = 1;
  const pushToken = (normalised, endIndex) => {
    tokens.push({ normalised, original: text.slice(index, endIndex), line });
    line += countNewlines(text, index, endIndex);
    index = endIndex;
  };
  while (index < text.length) {
    const character = text[index];
    if (character === "\n") {
      line += 1;
      index += 1;
    } else if (/\s/.test(character)) {
      index += 1;
    } else if (text.startsWith("//", index)) {
      const lineEnd = text.indexOf("\n", index);
      index = lineEnd === -1 ? text.length : lineEnd;
    } else if (text.startsWith("/*", index)) {
      const blockEnd = text.indexOf("*/", index + 2);
      const endIndex = blockEnd === -1 ? text.length : blockEnd + 2;
      line += countNewlines(text, index, endIndex);
      index = endIndex;
    } else if (character === "\"" || character === "'" || character === "`") {
      pushToken(stringPlaceholder, quotedStringEnd(text, index));
    } else if (/\d/.test(character) || (character === "." && /\d/.test(text[index + 1] ?? ""))) {
      const numericLiteral = readNumericLiteral(text, index);
      pushToken(numericLiteral.normalised, numericLiteral.endIndex);
    } else {
      identifierPattern.lastIndex = index;
      const word = identifierPattern.exec(text)?.[0];
      if (word === undefined) pushToken(matchPunctuator(text, index), index + matchPunctuator(text, index).length);
      else pushToken(keywords.has(word) ? word : identifierPlaceholder, index + word.length);
    }
  }
  return tokens;
}

function isNameToken(token) {
  return token !== undefined && (token.normalised === identifierPlaceholder || keywords.has(token.normalised));
}

function startsStatement(previousKeptToken) {
  return previousKeptToken === undefined || statementBoundaryTokens.has(previousKeptToken.normalised);
}

function statementEnd(tokens, index) {
  return tokens[index]?.normalised === ";" ? index + 1 : index;
}

function importAttributesEnd(tokens, openingBraceIndex) {
  for (let index = openingBraceIndex + 1; index < tokens.length; index += 1) {
    const normalised = tokens[index].normalised;
    if (normalised === "}") return index + 1;
    if (!isNameToken(tokens[index]) && !importAttributeValueTokens.has(normalised)) return null;
  }
  return null;
}

function moduleSpecifierEnd(tokens, specifierIndex) {
  const attributesKeyword = tokens[specifierIndex + 1];
  if (attributesKeyword !== undefined && importAttributesKeywords.has(attributesKeyword.original) && tokens[specifierIndex + 2]?.normalised === "{") {
    const attributesEnd = importAttributesEnd(tokens, specifierIndex + 2);
    if (attributesEnd !== null) return statementEnd(tokens, attributesEnd);
  }
  return statementEnd(tokens, specifierIndex + 1);
}

function importEqualsEnd(tokens, importIndex, equalsIndex) {
  const aliasShape = tokens.slice(importIndex + 1, equalsIndex).map(token => token.normalised).join(" ");
  if (aliasShape !== identifierPlaceholder && aliasShape !== `type ${identifierPlaceholder}`) return null;
  const targetIndex = equalsIndex + 1;
  const isRequireCall = tokens[targetIndex]?.original === "require" && tokens[targetIndex + 1]?.normalised === "("
    && tokens[targetIndex + 2]?.normalised === stringPlaceholder && tokens[targetIndex + 3]?.normalised === ")";
  if (isRequireCall) return statementEnd(tokens, targetIndex + 4);
  if (tokens[targetIndex]?.normalised !== identifierPlaceholder) return null;
  let index = targetIndex + 1;
  while (tokens[index]?.normalised === "." && tokens[index + 1]?.normalised === identifierPlaceholder) index += 2;
  return statementEnd(tokens, index);
}

function importClauseEnd(tokens, importIndex) {
  let braceDepth = 0;
  for (let index = importIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (braceDepth === 0 && token.original === "from" && tokens[index + 1]?.normalised === stringPlaceholder) return moduleSpecifierEnd(tokens, index + 1);
    if (braceDepth === 0 && token.normalised === "=") return importEqualsEnd(tokens, importIndex, index);
    if (token.normalised === "{") braceDepth += 1;
    else if (token.normalised === "}") braceDepth -= 1;
    else if (!isNameToken(token) && !importClausePunctuation.has(token.normalised) && !(braceDepth === 1 && token.normalised === stringPlaceholder)) return null;
    if (braceDepth < 0 || braceDepth > 1) return null;
  }
  return null;
}

function importDeclarationEnd(tokens, index, previousKeptToken) {
  if (tokens[index].normalised !== "import" || !startsStatement(previousKeptToken)) return null;
  if (tokens[index + 1]?.normalised === stringPlaceholder) return moduleSpecifierEnd(tokens, index + 1);
  return importClauseEnd(tokens, index);
}

export function normaliseSourceTokens(text) {
  const scannedTokens = scanSourceTokens(text);
  const tokens = [];
  let index = 0;
  while (index < scannedTokens.length) {
    const declarationEnd = importDeclarationEnd(scannedTokens, index, tokens.at(-1));
    if (declarationEnd === null) {
      tokens.push(scannedTokens[index]);
      index += 1;
    } else {
      index = declarationEnd;
    }
  }
  return tokens;
}
