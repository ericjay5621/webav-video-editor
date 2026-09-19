import { DraftItem, StoredMediaAsset } from './types';

// Older drafts have no source id. Compare bytes in bounded chunks: names and
// sizes alone cannot distinguish different files. Ambiguous imports stay unbound.
export async function sameBlob(left: Blob, right: Blob) {
  if (left === right) return true;
  if (left.size !== right.size || left.type !== right.type) return false;
  for (let offset = 0; offset < left.size; offset += 1024 * 1024) {
    const [a, b] = await Promise.all([
      left.slice(offset, offset + 1024 * 1024).arrayBuffer(),
      right.slice(offset, offset + 1024 * 1024).arrayBuffer(),
    ]);
    const bytes = new Uint8Array(a);
    const other = new Uint8Array(b);
    if (bytes.some((value, index) => value !== other[index])) return false;
  }
  return true;
}

export async function resolveAssetReferences(
  items: DraftItem[],
  assets: StoredMediaAsset[],
  recoverMissing?: (item: DraftItem, blob: Blob) => Promise<StoredMediaAsset>,
) {
  const resolved = new Map<Blob, Promise<string | undefined>>();
  // Process in order so recovery can reuse a source restored for an earlier clip.
  const ids: Array<string | undefined> = [];
  for (const item of items) {
    ids.push(await (async () => {
    if (item.sourceAssetId) return item.sourceAssetId;
    if (item.source.type !== 'file') return undefined;
    const blob = item.source.blob;
    if (resolved.has(blob)) return resolved.get(blob);
    const pending = (async () => {
      const matches: StoredMediaAsset[] = [];
      for (const asset of assets) {
        if (await sameBlob(blob, asset.blob)) matches.push(asset);
      }
      if (!matches.length && recoverMissing) {
        const recovered = await recoverMissing(item, blob);
        assets.push(recovered);
        return recovered.id;
      }
      return matches.length === 1 ? matches[0].id : undefined;
    })();
    resolved.set(blob, pending);
    return pending;
    })());
  }
  return ids;
}
