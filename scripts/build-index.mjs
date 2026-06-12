import fs from "fs";
import path from "path";
import readline from "readline";
import Database from "better-sqlite3";
import { ensureCanonicalFiles, parseCanonicalRow } from "../lib/canonical.js";
import { getDataDir, getDumpsDir, loadEnvFile } from "../lib/paths.js";

loadEnvFile();

const BATCH_SIZE = 5000;
const SCHEMA_VERSION = 1;

function parseArgs(argv) {
  const args = {
    dumpsDir: getDumpsDir(),
    output: path.join(getDataDir(), "staging", "index.db"),
    limit: Number.parseInt(process.env.BUILD_LIMIT || "0", 10) || 0,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dumps-dir" && argv[index + 1]) {
      args.dumpsDir = path.resolve(argv[++index]);
    } else if (token === "--output" && argv[index + 1]) {
      args.output = path.resolve(argv[++index]);
    } else if (token === "--limit" && argv[index + 1]) {
      args.limit = Number.parseInt(argv[++index], 10) || 0;
    }
  }
  return args;
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function createSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE release_redirect (
      release_mbid TEXT PRIMARY KEY,
      release_group_mbid TEXT NOT NULL
    );

    CREATE TABLE track_staging (
      recording_mbid TEXT PRIMARY KEY,
      recording_name TEXT NOT NULL,
      artist_credit_name TEXT,
      release_name TEXT,
      combined_lookup TEXT,
      artist_mbids TEXT,
      release_group_mbid TEXT,
      score INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE artist_staging (
      artist_mbid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_name TEXT,
      score INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE release_staging (
      release_group_mbid TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist_name TEXT,
      artist_mbid TEXT
    );
  `);
}

async function importReleaseRedirects(db, releaseRedirectPath) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO release_redirect(release_mbid, release_group_mbid)
    VALUES (?, ?)
  `);
  const stream = fs.createReadStream(releaseRedirectPath, { encoding: "utf8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = true;
  let imported = 0;
  let batch = [];
  const flush = () => {
    if (batch.length === 0) return;
    const run = db.transaction((rows) => {
      for (const row of rows) insert.run(...row);
    });
    run(batch);
    batch = [];
  };

  for await (const line of reader) {
    if (header) {
      header = false;
      continue;
    }
    if (!line.trim()) continue;
    const parts = line.split(",");
    const releaseMbid = parts[0];
    const releaseGroupMbid = parts[2];
    if (!releaseMbid || !releaseGroupMbid) continue;
    batch.push([releaseMbid, releaseGroupMbid]);
    imported += 1;
    if (batch.length >= BATCH_SIZE) flush();
    if (imported % 1000000 === 0) log(`  redirects: ${imported.toLocaleString()}`);
  }
  flush();
  log(`Imported ${imported.toLocaleString()} release redirects`);
  return imported;
}

async function importCanonicalRows(db, csvPath, limit) {
  const lookupReleaseGroup = db.prepare(`
    SELECT release_group_mbid
    FROM release_redirect
    WHERE release_mbid = ?
  `);
  const upsertTrack = db.prepare(`
    INSERT INTO track_staging(
      recording_mbid,
      recording_name,
      artist_credit_name,
      release_name,
      combined_lookup,
      artist_mbids,
      release_group_mbid,
      score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(recording_mbid) DO UPDATE SET
      recording_name = excluded.recording_name,
      artist_credit_name = excluded.artist_credit_name,
      release_name = excluded.release_name,
      combined_lookup = excluded.combined_lookup,
      artist_mbids = excluded.artist_mbids,
      release_group_mbid = excluded.release_group_mbid,
      score = excluded.score
    WHERE excluded.score > track_staging.score
  `);
  const upsertArtist = db.prepare(`
    INSERT INTO artist_staging(artist_mbid, name, sort_name, score)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(artist_mbid) DO UPDATE SET
      score = MAX(artist_staging.score, excluded.score),
      name = CASE
        WHEN excluded.score > artist_staging.score THEN excluded.name
        ELSE artist_staging.name
      END,
      sort_name = CASE
        WHEN excluded.score > artist_staging.score THEN excluded.sort_name
        ELSE artist_staging.sort_name
      END
  `);
  const upsertRelease = db.prepare(`
    INSERT OR IGNORE INTO release_staging(
      release_group_mbid,
      title,
      artist_name,
      artist_mbid
    ) VALUES (?, ?, ?, ?)
  `);

  const stream = fs.createReadStream(csvPath, { encoding: "utf8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = true;
  let scanned = 0;
  let kept = 0;
  let trackBatch = [];
  let artistBatch = [];
  let releaseBatch = [];

  const flushTracks = () => {
    if (trackBatch.length === 0) return;
    const run = db.transaction((rows) => {
      for (const row of rows) upsertTrack.run(...row);
    });
    run(trackBatch);
    trackBatch = [];
  };

  const flushArtists = () => {
    if (artistBatch.length === 0) return;
    const run = db.transaction((rows) => {
      for (const row of rows) upsertArtist.run(...row);
    });
    run(artistBatch);
    artistBatch = [];
  };

  const flushReleases = () => {
    if (releaseBatch.length === 0) return;
    const run = db.transaction((rows) => {
      for (const row of rows) upsertRelease.run(...row);
    });
    run(releaseBatch);
    releaseBatch = [];
  };

  const flushAll = () => {
    flushTracks();
    flushArtists();
    flushReleases();
  };

  for await (const line of reader) {
    if (header) {
      header = false;
      continue;
    }
    scanned += 1;
    const row = parseCanonicalRow(line);
    if (!row) continue;

    const releaseGroupRow = row.releaseMbid
      ? lookupReleaseGroup.get(row.releaseMbid)
      : null;
    const releaseGroupMbid = releaseGroupRow?.release_group_mbid || "";

    trackBatch.push([
      row.recordingMbid,
      row.recordingName,
      row.artistCreditName,
      row.releaseName,
      row.combinedLookup,
      row.artistMbids,
      releaseGroupMbid,
      row.score,
    ]);
    kept += 1;

    if (row.artistMbid && row.artistCreditName) {
      artistBatch.push([
        row.artistMbid,
        row.artistCreditName,
        row.artistCreditName,
        row.score,
      ]);
    }
    if (releaseGroupMbid && row.releaseName) {
      releaseBatch.push([
        releaseGroupMbid,
        row.releaseName,
        row.artistCreditName || "Unknown Artist",
        row.artistMbid || "",
      ]);
    }

    if (trackBatch.length >= BATCH_SIZE) flushTracks();
    if (artistBatch.length >= BATCH_SIZE) flushArtists();
    if (releaseBatch.length >= BATCH_SIZE) flushReleases();

    if (limit > 0 && kept >= limit) break;
    if (scanned % 500000 === 0) {
      log(`  scanned: ${scanned.toLocaleString()}, kept: ${kept.toLocaleString()}`);
    }
  }

  flushAll();

  const trackCount = db.prepare("SELECT COUNT(*) AS count FROM track_staging").get().count;
  const artistCount = db.prepare("SELECT COUNT(*) AS count FROM artist_staging").get().count;
  const releaseCount = db.prepare("SELECT COUNT(*) AS count FROM release_staging").get().count;
  log(
    `Canonical pass complete: scanned ${scanned.toLocaleString()}, kept ${kept.toLocaleString()}, tracks ${trackCount.toLocaleString()}, artists ${artistCount.toLocaleString()}, releases ${releaseCount.toLocaleString()}`,
  );
  return { scanned, kept, trackCount, artistCount, releaseCount };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { csvPath, releaseRedirectPath } = ensureCanonicalFiles(args.dumpsDir);
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  if (fs.existsSync(args.output)) {
    fs.unlinkSync(args.output);
  }

  log(`Building staging database at ${args.output}`);
  const db = new Database(args.output);
  createSchema(db);

  log("Importing release redirects...");
  const redirectCount = await importReleaseRedirects(db, releaseRedirectPath);

  log("Importing canonical rows...");
  const counts = await importCanonicalRows(db, csvPath, args.limit);

  db.pragma("wal_checkpoint(TRUNCATE)");
  db.pragma("journal_mode = DELETE");

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    builtAt: new Date().toISOString(),
    trackCount: counts.trackCount,
    artistCount: counts.artistCount,
    releaseCount: counts.releaseCount,
    redirectCount,
    scannedRows: counts.scanned,
    keptRows: counts.kept,
  };
  db.prepare("INSERT INTO meta(key, value) VALUES (?, ?)").run(
    "manifest",
    JSON.stringify(manifest),
  );
  db.close();
  fs.writeFileSync(
    path.join(path.dirname(args.output), "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  log("Done.");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
