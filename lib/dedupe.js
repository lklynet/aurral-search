import { getNormalizedText } from "./ranking.js";

export function dedupeArtistsByName(artists) {
  const bestByName = new Map();
  for (const artist of artists) {
    const key = getNormalizedText(artist.name);
    if (!key) continue;
    const existing = bestByName.get(key);
    if (!existing || (artist.score || 0) > (existing.score || 0)) {
      bestByName.set(key, artist);
    }
  }
  return Array.from(bestByName.values()).sort(
    (left, right) => (right.score || 0) - (left.score || 0),
  );
}

export function mergeRankedResults(items, limit) {
  const seenIds = new Set();
  const seenArtistNames = new Set();
  const merged = [];

  for (const item of items.sort(
    (left, right) => (right.score || 0) - (left.score || 0),
  )) {
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
