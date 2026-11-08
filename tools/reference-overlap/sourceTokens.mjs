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

const numericLiteralPattern = /0[xX][0-9a-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?[fFuUn]?/y;
const identifierPattern = /[\p{ID_Start}_$][\p{ID_Continue}$‌‍]*/uy;

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

function countNewlines(text, startIndex, endIndex) {
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
      numericLiteralPattern.lastIndex = index;
      const literalText = numericLiteralPattern.exec(text)[0];
      pushToken(canonicalNumericLiteral(literalText), index + literalText.length);
    } else {
      identifierPattern.lastIndex = index;
      const word = identifierPattern.exec(text)?.[0];
      if (word === undefined) pushToken(matchPunctuator(text, index), index + matchPunctuator(text, index).length);
      else pushToken(keywords.has(word) ? word : identifierPlaceholder, index + word.length);
    }
  }
  return tokens;
}

function startsImportDeclaration(tokens, index) {
  const nextToken = tokens[index + 1];
  return tokens[index].normalised === "import" && nextToken !== undefined && nextToken.normalised !== "(" && nextToken.normalised !== ".";
}

function importDeclarationEnd(tokens, startIndex) {
  let index = startIndex + 1;
  while (index < tokens.length && tokens[index].normalised !== stringPlaceholder) index += 1;
  index += 1;
  return tokens[index]?.normalised === ";" ? index + 1 : index;
}

export function normaliseSourceTokens(text) {
  const scannedTokens = scanSourceTokens(text);
  const tokens = [];
  let index = 0;
  while (index < scannedTokens.length) {
    if (startsImportDeclaration(scannedTokens, index)) {
      index = importDeclarationEnd(scannedTokens, index);
    } else {
      tokens.push(scannedTokens[index]);
      index += 1;
    }
  }
  return tokens;
}
