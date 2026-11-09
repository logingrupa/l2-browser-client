const stringLiteralPattern = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
const templateSubstitutionPattern = /\$\{[^}]*\}/;

export function moduleStringLiterals(sourceText: string): string[] {
  return [...sourceText.matchAll(stringLiteralPattern)].flatMap(match =>
    match[3] !== undefined ? match[3].split(templateSubstitutionPattern) : [match[1] ?? match[2]!]);
}
