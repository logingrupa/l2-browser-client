import type { NativeTableNameEntry } from "../nativeTables/readNativeTableNameIndex";

export const sandboxPickerMatchLimit = 12;

export interface NativeNameMatches {
  readonly entries: readonly NativeTableNameEntry[];
  readonly matchCount: number;
}

const identifierQueryPattern = /^\d+$/;

function compareNameEntries(left: NativeTableNameEntry, right: NativeTableNameEntry): number {
  const identifierCount = Math.max(left.identifiers.length, right.identifiers.length);
  for (let position = 0; position < identifierCount; position += 1) {
    const difference = (left.identifiers[position] ?? -1) - (right.identifiers[position] ?? -1);
    if (difference !== 0) return difference;
  }
  return left.sourceOrder - right.sourceOrder;
}

function entryMatcher(query: string): (entry: NativeTableNameEntry) => boolean {
  if (identifierQueryPattern.test(query)) {
    const identifier = Number(query);
    return entry => entry.identifiers[0] === identifier;
  }
  const lowerCaseQuery = query.toLowerCase();
  return entry => entry.name.toLowerCase().includes(lowerCaseQuery);
}

export function matchNativeNameEntries(entries: readonly NativeTableNameEntry[], rawQuery: string): NativeNameMatches {
  const query = rawQuery.trim();
  if (!query) return { entries: [], matchCount: 0 };
  const matching = entries.filter(entryMatcher(query)).sort(compareNameEntries);
  return { entries: matching.slice(0, sandboxPickerMatchLimit), matchCount: matching.length };
}
