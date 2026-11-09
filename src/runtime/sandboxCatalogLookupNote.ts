import { describeNativeCatalogLookup, type NativeCatalogLookup } from "../assets/native/nativeCatalogIndex";

export type SandboxCatalogLookupNote = { readonly tone: "info" | "warning"; readonly text: string };

function sandboxCatalogLookupTone(lookup: NativeCatalogLookup): SandboxCatalogLookupNote["tone"] {
  switch (lookup.status) {
    case "converted": return "info";
    case "gap": return "warning";
    case "not-in-catalog": return "warning";
    default: {
      const unhandledLookup: never = lookup;
      throw new Error(`Unhandled catalog lookup ${JSON.stringify(unhandledLookup)}.`);
    }
  }
}

export function describeSandboxCatalogLookup(lookup: NativeCatalogLookup): SandboxCatalogLookupNote {
  return { tone: sandboxCatalogLookupTone(lookup), text: describeNativeCatalogLookup(lookup) };
}
