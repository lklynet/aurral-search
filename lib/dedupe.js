import { getNormalizedText } from "./ranking.js";

export function dedupeArtistsByName(artists) {
  const seen = new Set();
  const result = [];
  for (const artist of artists) {
    const key = getNormalizedText(artist.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(artist);
  }
  return result;
}

export function mergeRankedResults(items, limit) {
  const seenIds = new Set();
  const seenArtistNames = new Set();
  const merged = [];

  for (const item of items) {
    if (item.type === "artist") {
      const nameKey = getNormalizedText(item.name);
      if (nameKey && seenArtistNames.has(nameKey)) continue;
      if (nameKey) seenArtistNames.add(nameKey);
    }

    const identity = item.id ? `${item.type}:${item.id}` : null;
    if (identity) {
      if (seenIds.has(identity)) continue;
      seenIds.add(identity);
    }

    merged.push(item);
    if (merged.length >= limit) break;
  }

  return merged;
}
