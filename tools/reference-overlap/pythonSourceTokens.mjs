import { countNewlines, identifierPlaceholder, readNumericLiteral, stringPlaceholder } from "./sourceTokens.mjs";

const pythonKeywords = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
  "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or",
  "pass", "raise", "return", "try", "while", "with", "yield",
]);

const pythonPunctuators = [
  "**=", "//=", ">>=", "<<=", "...",
  "->", ":=", "**", "//", "<<", ">>", "<=", ">=", "==", "!=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "@=",
];

const importStatementKeywords = new Set(["import", "from"]);
const openingBrackets = new Set(["(", "[", "{"]);
const closingBrackets = new Set([")", "]", "}"]);
const stringStartPattern = /(?:[rR][bBfFtT]?|[bBfFtT][rR]?|[uU])?(?:'''|"""|'|")/y;
const pythonIdentifierPattern = /[\p{ID_Start}_][\p{ID_Continue}]*/uy;

function pythonStringEnd(text, quoteIndex) {
  const quote = text[quoteIndex];
  const isTripleQuoted = text.startsWith(quote.repeat(3), quoteIndex);
  const delimiter = isTripleQuoted ? quote.repeat(3) : quote;
  let index = quoteIndex + delimiter.length;
  while (index < text.length && !text.startsWith(delimiter, index)) {
    if (text[index] === "\\") index += 1;
    else if (text[index] === "\n" && !isTripleQuoted) return index;
    index += 1;
  }
  return Math.min(index + delimiter.length, text.length);
}

function matchPythonPunctuator(text, index) {
  return pythonPunctuators.find(punctuator => text.startsWith(punctuator, index)) ?? text[index];
}

function scanPythonStatements(text) {
  const statements = [[]];
  let index = 0;
  let line = 1;
  let bracketDepth = 0;
  const endStatement = () => { if (statements.at(-1).length > 0) statements.push([]); };
  const pushToken = (normalised, endIndex) => {
    statements.at(-1).push({ normalised, original: text.slice(index, endIndex), line });
    line += countNewlines(text, index, endIndex);
    index = endIndex;
  };
  while (index < text.length) {
    const character = text[index];
    if (character === "\n") {
      line += 1;
      index += 1;
      if (bracketDepth === 0) endStatement();
    } else if (character === "\\" && text[index + 1] === "\n") {
      line += 1;
      index += 2;
    } else if (/\s/.test(character)) {
      index += 1;
    } else if (character === "#") {
      const lineEnd = text.indexOf("\n", index);
      index = lineEnd === -1 ? text.length : lineEnd;
    } else if (/\d/.test(character) || (character === "." && /\d/.test(text[index + 1] ?? ""))) {
      const numericLiteral = readNumericLiteral(text, index);
      pushToken(numericLiteral.normalised, numericLiteral.endIndex);
    } else {
      stringStartPattern.lastIndex = index;
      const stringStart = stringStartPattern.exec(text)?.[0];
      if (stringStart !== undefined) {
        const quoteIndex = index + stringStart.length - (stringStart.endsWith("'''") || stringStart.endsWith("\"\"\"") ? 3 : 1);
        pushToken(stringPlaceholder, pythonStringEnd(text, quoteIndex));
        continue;
      }
      pythonIdentifierPattern.lastIndex = index;
      const word = pythonIdentifierPattern.exec(text)?.[0];
      if (word !== undefined) {
        pushToken(pythonKeywords.has(word) ? word : identifierPlaceholder, index + word.length);
        continue;
      }
      const punctuator = matchPythonPunctuator(text, index);
      if (openingBrackets.has(punctuator)) bracketDepth += 1;
      else if (closingBrackets.has(punctuator)) bracketDepth = Math.max(0, bracketDepth - 1);
      pushToken(punctuator, index + punctuator.length);
      if (punctuator === ";" && bracketDepth === 0) endStatement();
    }
  }
  return statements;
}

function isImportStatement(statement) {
  return importStatementKeywords.has(statement[0]?.normalised);
}

function isStringOnlyStatement(statement) {
  return statement.every(token => token.normalised === stringPlaceholder || token.normalised === ";");
}

export function normalisePythonSourceTokens(text) {
  return scanPythonStatements(text).filter(statement => !isImportStatement(statement) && !isStringOnlyStatement(statement)).flat();
}
