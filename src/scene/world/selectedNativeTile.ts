import { tileIdPattern } from "../../assets/native/nativeCatalogRecords";

export function selectedNativeTileIdentity(location: Pick<Location, "search"> | undefined): string | null {
  if (!location) return null;
  const parameters = new URLSearchParams(location.search);
  if (!parameters.has("map")) return null;
  const tileId = parameters.get("map");
  if (parameters.getAll("map").length !== 1 || tileId === null || !tileIdPattern.test(tileId)) {
    throw new Error("The map parameter must name one tile as XX_YY.");
  }
  return tileId;
}
