import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fixtureCatalogPath = resolve("tests/fixtures/lane-store/l2/catalog.json");
const nativeStoreSourceHeader = "X-Native-Store-Source";

interface FixtureModelRecord {
  readonly archive: string;
  readonly archiveSha256: string;
}

function fixtureModelRecord(): FixtureModelRecord {
  const catalog = JSON.parse(readFileSync(fixtureCatalogPath, "utf8")) as { models: FixtureModelRecord[] };
  const [record] = catalog.models;
  if (record === undefined) throw new Error(`fixture lane catalog ${fixtureCatalogPath} lists no model`);
  return record;
}

test.skip(process.env.NATIVE_STORE_ROOT !== "fixture", "run with NATIVE_STORE_ROOT=fixture DEV_PORT=5175");

test("serves the fixture lane store through the native store root switch", async ({ page, request }) => {
  const record = fixtureModelRecord();
  const catalogAnswer = await request.get("/l2/catalog.json");
  expect(catalogAnswer.status()).toBe(200);
  expect(catalogAnswer.headers()[nativeStoreSourceHeader.toLowerCase()]).toBe("lane");
  expect(Buffer.from(await catalogAnswer.body()).equals(readFileSync(fixtureCatalogPath))).toBe(true);

  const archiveAnswer = await request.get(record.archive);
  expect(archiveAnswer.status()).toBe(200);
  expect(archiveAnswer.headers()["content-type"]).toBe("application/zip");
  expect(archiveAnswer.headers()[nativeStoreSourceHeader.toLowerCase()]).toBe("lane");
  expect(createHash("sha256").update(await archiveAnswer.body()).digest("hex")).toBe(record.archiveSha256);

  expect((await request.get("/l2/coverage.json")).status()).toBe(404);

  await page.goto("/l2/catalog.json");
  const pageHashes = await page.evaluate(async () => {
    const hexOf = (digest: ArrayBuffer) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const catalogBytes = await (await fetch("/l2/catalog.json")).arrayBuffer();
    const catalog = JSON.parse(new TextDecoder().decode(catalogBytes)) as { models: { archive: string }[] };
    const archivePath = catalog.models[0]?.archive;
    if (archivePath === undefined) throw new Error("served catalog lists no model");
    const archiveBytes = await (await fetch(archivePath)).arrayBuffer();
    return { catalogSha256: hexOf(await crypto.subtle.digest("SHA-256", catalogBytes)), archiveSha256: hexOf(await crypto.subtle.digest("SHA-256", archiveBytes)) };
  });
  expect(pageHashes).toEqual({
    catalogSha256: createHash("sha256").update(readFileSync(fixtureCatalogPath)).digest("hex"),
    archiveSha256: record.archiveSha256,
  });
});
