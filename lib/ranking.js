function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitWords(value) {
  return normalizeText(value)
    .split(" ")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getNormalizedText(value) {
  return normalizeText(value);
}

export function scoreTextMatch(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 92;
  const leftWords = new Set(splitWords(a));
  const rightWords = new Set(splitWords(b));
  if (leftWords.size === 0 || rightWords.size === 0) return 0;
  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) overlap += 1;
  }
  const ratio = (2 * overlap) / Math.max(1, leftWords.size + rightWords.size);
  return Math.round(ratio * 100);
}

export function rankScore(query, text, canonicalScore = 0) {
  const textScore = scoreTextMatch(query, text);
  const popularityBoost = Math.min(8, Math.round((canonicalScore || 0) / 15));
  return textScore + popularityBoost;
}
