import http from "http";
import { URL } from "url";
import { MeiliSearch } from "meilisearch";
import { getNormalizedText, rankScore } from "../lib/ranking.js";
import { dedupeArtistsByName, mergeRankedResults } from "../lib/dedupe.js";
import { loadEnvFile } from "../lib/paths.js";

loadEnvFile();

const SUGGEST_LIMIT = 5;
const FULL_LIMIT = 20;
const EXACT_MATCH_BOOST = 15;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeMode(value) {
  return String(value || "").trim() === "full" ? "full" : "suggest";
}

function bucketLimit(mode, requestedLimit) {
  const fallback = mode === "full" ? FULL_LIMIT : SUGGEST_LIMIT;
  return Math.min(30, parsePositiveInt(requestedLimit, fallback));
}

function getMeiliClient() {
  const host = String(process.env.MEILI_URL || "http://127.0.0.1:7700").trim();
  const apiKey = String(process.env.MEILI_MASTER_KEY || "").trim();
  if (!apiKey) {
    throw new Error("MEILI_MASTER_KEY is required");
  }
  return new MeiliSearch({ host, apiKey });
}

let meiliClient = null;

function client() {
  if (!meiliClient) {
    meiliClient = getMeiliClient();
  }
  return meiliClient;
}

function isAuthorized(req) {
  const configured = String(process.env.AURRAL_SEARCH_API_KEY || "").trim();
  if (!configured) return true;
  const headerKey = String(req.headers["x-aurral-search-key"] || "").trim();
  const url = new URL(req.url, "http://localhost");
  const queryKey = String(url.searchParams.get("key") || "").trim();
  return headerKey === configured || queryKey === configured;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function withScore(query, item, { text, boost = 0, canonicalScore = 0 } = {}) {
  const target = text ?? item.name ?? item.title ?? "";
  let score = rankScore(query, target, canonicalScore);
  if (getNormalizedText(target) === getNormalizedText(query)) {
    score += EXACT_MATCH_BOOST;
  }
  return { ...item, score: score + boost };
}

function mapArtist(hit, query) {
  return withScore(query, {
    type: "artist",
    source: "aurral-search",
    id: hit.id,
    key: hit.id,
    name: hit.name,
    sortName: hit.sortName || hit.name,
    inLibrary: false,
    hasMbid: true,
  }, { text: hit.name, canonicalScore: hit.score || 0 });
}

function mapAlbum(hit, query) {
  const artistName = hit.artistName || "Unknown Artist";
  return withScore(query, {
    type: "album",
    source: "aurral-search",
    id: hit.id,
    key: hit.id,
    title: hit.title,
    artistName,
    artistMbid: hit.artistMbid || null,
    inLibrary: false,
    hasMbid: true,
  }, { text: `${artistName} ${hit.title}` });
}

function mapTrack(hit, query) {
  const artistName = hit.artistName || "Unknown Artist";
  return withScore(query, {
    type: "track",
    source: "aurral-search",
    id: hit.id,
    key: hit.id,
    title: hit.title,
    artistName,
    artistMbid: hit.artistMbid || null,
    albumTitle: hit.albumTitle || null,
    albumMbid: hit.albumMbid || null,
    inLibrary: false,
    hasMbid: true,
  }, {
    text: `${artistName} ${hit.title} ${hit.albumTitle || ""}`,
    canonicalScore: hit.score || 0,
  });
}

async function searchIndex(indexName, query, limit) {
  const index = client().index(indexName);
  const response = await index.search(query, {
    limit: Math.max(limit * 4, limit),
    attributesToRetrieve: ["*"],
  });
  return response.hits || [];
}

async function searchCatalog(query, limit) {
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return { artists: [], albums: [], tracks: [] };
  }

  const [artistHits, releaseHits, recordingHits] = await Promise.all([
    searchIndex("artists", trimmed, limit),
    searchIndex("releases", trimmed, limit),
    searchIndex("recordings", trimmed, limit),
  ]);

  const artists = dedupeArtistsByName(
    artistHits
      .map((hit) => mapArtist(hit, trimmed))
      .sort((left, right) => right.score - left.score),
  ).slice(0, limit);

  const albums = releaseHits
    .map((hit) => mapAlbum(hit, trimmed))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  const tracks = recordingHits
    .map((hit) => mapTrack(hit, trimmed))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  return { artists, albums, tracks };
}

function pickTopResult(catalog) {
  const [top] = mergeRankedResults(
    [
      ...(catalog?.tracks || []),
      ...(catalog?.artists || []),
      ...(catalog?.albums || []),
    ].filter(Boolean),
    1,
  );
  return top || null;
}

async function buildSearchResponse(query, mode, limit) {
  const trimmed = String(query || "").trim();
  const normalizedMode = normalizeMode(mode);
  const perBucketLimit = bucketLimit(normalizedMode, limit);

  if (!trimmed) {
    return {
      query: "",
      mode: normalizedMode,
      top: null,
      library: { artists: [], tracks: [], playlists: [] },
      catalog: { artists: [], albums: [], tracks: [] },
      localSearchConfigured: true,
      filters: ["all", "artists", "albums", "tracks", "library", "playlists"],
    };
  }

  const catalog = await searchCatalog(trimmed, perBucketLimit);
  return {
    query: trimmed,
    mode: normalizedMode,
    top: pickTopResult(catalog),
    library: { artists: [], tracks: [], playlists: [] },
    catalog,
    localSearchConfigured: true,
    filters: ["all", "artists", "albums", "tracks", "library", "playlists"],
  };
}

async function getStatus() {
  const health = await client().health();
  const indexes = await client().getIndexes({ limit: 100 });
  const stats = {};
  for (const entry of indexes.results || []) {
    if (!["artists", "releases", "recordings"].includes(entry.uid)) continue;
    const index = client().index(entry.uid);
    const indexStats = await index.getStats();
    stats[entry.uid] = {
      documents: indexStats.numberOfDocuments,
      isIndexing: indexStats.isIndexing,
    };
  }
  return {
    ok: health.status === "available",
    meilisearch: health,
    indexes: stats,
  };
}

async function handleRequest(req, res) {
  if (!isAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "GET" && pathname === "/health") {
    try {
      const health = await client().health();
      return sendJson(res, 200, { ok: health.status === "available", health });
    } catch (error) {
      return sendJson(res, 503, { ok: false, error: error.message });
    }
  }

  if (req.method === "GET" && pathname === "/status") {
    try {
      return sendJson(res, 200, await getStatus());
    } catch (error) {
      return sendJson(res, 503, { ok: false, error: error.message });
    }
  }

  if (req.method === "GET" && (pathname === "/search" || pathname === "/catalog")) {
    const query = url.searchParams.get("q") || url.searchParams.get("query") || "";
    if (!String(query).trim()) {
      return sendJson(res, 400, { error: "q parameter is required" });
    }
    try {
      const mode = url.searchParams.get("mode") || "suggest";
      const limit = url.searchParams.get("limit");
      if (pathname === "/catalog") {
        const catalog = await searchCatalog(query, bucketLimit(normalizeMode(mode), limit));
        return sendJson(res, 200, { query: String(query).trim(), catalog });
      }
      return sendJson(
        res,
        200,
        await buildSearchResponse(query, mode, limit),
      );
    } catch (error) {
      return sendJson(res, 500, { error: "Search failed", message: error.message });
    }
  }

  return sendJson(res, 404, { error: "Not found" });
}

const port = Number.parseInt(process.env.API_PORT || "3100", 10) || 3100;
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    sendJson(res, 500, { error: "Internal error", message: error.message });
  });
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`aurral-search api listening on :${port}\n`);
});
