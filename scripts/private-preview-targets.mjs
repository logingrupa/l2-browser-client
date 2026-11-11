export const privatePreviewHostname = 'l2.kingdom.lv';
export const privatePreviewOrigin = `https://${privatePreviewHostname}`;
export const privatePreviewWorldPath = '/';
export const privatePreviewCatalogPath = '/l2/catalog.json';

const sha256Pattern = /^[a-f0-9]{64}$/;
const safeResourceFilePattern = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function resourceFile(resource, label) {
  const file = resource?.file;
  if (typeof file !== 'string' || !safeResourceFilePattern.test(file) || file.split('/').includes('..')) throw Error(`Native section ${label} has an unsafe resource file.`);
  return file;
}

function nativeSectionBasePath(sectionRecord) {
  const manifestSha256 = sectionRecord?.manifestSha256;
  if (typeof manifestSha256 !== 'string' || !sha256Pattern.test(manifestSha256)) throw Error('Native catalog section has no valid manifest hash.');
  return `/l2/maps/${manifestSha256}/`;
}

export function nativeSectionManifestPath(sectionRecord) {
  const manifestPath = `${nativeSectionBasePath(sectionRecord)}map-section-runtime/manifest.json`;
  if (sectionRecord.manifest !== manifestPath) throw Error('Native catalog section manifest path is not hash-addressed.');
  return manifestPath;
}

export function nativeSectionResourcePaths(sectionRecord, sectionManifest) {
  const manifestPath = nativeSectionManifestPath(sectionRecord);
  const sectionBase = nativeSectionBasePath(sectionRecord);
  if (!Array.isArray(sectionManifest?.models)) throw Error('Native section manifest has no model list.');
  return [...new Set([
    manifestPath,
    `${sectionBase}map-section/${resourceFile(sectionManifest.terrain, 'terrain')}`,
    ...(sectionManifest.terrainPatches ?? []).map(patch => `${sectionBase}map-section/${resourceFile(patch.model, 'terrain patch')}`),
    ...sectionManifest.models.map(model => `${sectionBase}map-section-models/${resourceFile(model.model, 'model')}`),
    ...(sectionManifest.bsp ?? []).map(bsp => `${sectionBase}map-section-bsp/${resourceFile(bsp.model, 'BSP')}`),
  ])];
}
