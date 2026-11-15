/** Native catalog paths stay rooted at /l2 in the browser. Editor 5 Play
 * overrides fetch to resolve relative paths under the project's public folder;
 * a leading slash would instead address the filesystem root in its file page.
 * Keep catalog identities unchanged and adapt only at the fetch boundary. */
export function nativeResourceUrl(path: string): string {
  if (!/^\/l2\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(path)) {
    throw new Error("Native resource must be a bounded /l2 path.");
  }
  return typeof location !== "undefined" && location.protocol === "file:" ? path.slice(1) : path;
}
