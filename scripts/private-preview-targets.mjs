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

export function nativeSectionResourcePaths(sectionRecord, sectionManifest) {
  const manifestSha256 = sectionRecord?.manifestSha256;
  if (typeof manifestSha256 !== 'string' || !sha256Pattern.test(manifestSha256)) throw Error('Native catalog section has no valid manifest hash.');
  const sectionBase = `/l2/maps/${manifestSha256}/`;
  if (sectionRecord.manifest !== `${sectionBase}map-section-runtime/manifest.json`) throw Error('Native catalog section manifest path is not hash-addressed.');
  if (!Array.isArray(sectionManifest?.models)) throw Error('Native section manifest has no model list.');
  return [...new Set([
    sectionRecord.manifest,
    `${sectionBase}map-section/${resourceFile(sectionManifest.terrain, 'terrain')}`,
    ...(sectionManifest.terrainPatches ?? []).map(patch => `${sectionBase}map-section/${resourceFile(patch.model, 'terrain patch')}`),
    ...sectionManifest.models.map(model => `${sectionBase}map-section-models/${resourceFile(model.model, 'model')}`),
    ...(sectionManifest.bsp ?? []).map(bsp => `${sectionBase}map-section-bsp/${resourceFile(bsp.model, 'BSP')}`),
  ])];
}
