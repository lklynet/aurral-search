import { getNormalizedText } from "./ranking.js";

export function significantWords(value) {
  return getNormalizedText(value)
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length > 1);
}

export function normalizeComparable(value) {
  return getNormalizedText(value).replace(/^the /, "");
}

export function exactNameMatch(query, name) {
  const queryNorm = getNormalizedText(query);
  const nameNorm = getNormalizedText(name);
  if (!queryNorm || !nameNorm) return false;
  if (queryNorm === nameNorm) return true;
  return normalizeComparable(query) === normalizeComparable(name);
}

export function isWeakAlbumMatch(query, album) {
  const queryWords = significantWords(query);
  const titleWords = significantWords(album.title);
  if (titleWords.length === 0 || queryWords.length <= titleWords.length) {
    return false;
  }
  const titleSubset = titleWords.every((word) => queryWords.includes(word));
  const fullTitleMatch = queryWords.every((word) => titleWords.includes(word));
  if (!titleSubset || fullTitleMatch) return false;
  const artistWords = significantWords(album.artistName);
  return !artistWords.some((word) => queryWords.includes(word));
}

export function isShadowArtist(artist, query, albums) {
  if (!exactNameMatch(query, artist.name)) return false;
  return (albums || []).some((album) => exactNameMatch(query, album.title));
}

export function isNoiseRelease(title, artistName, score) {
  const titleNorm = getNormalizedText(title);
  const artistNorm = getNormalizedText(artistName);
  if (!titleNorm || titleNorm !== artistNorm) return false;
  return (score || 0) < 1000;
}
