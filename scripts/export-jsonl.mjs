import fs from "fs";
import path from "path";
import { once } from "events";
import Database from "better-sqlite3";
import { getDataDir, loadEnvFile } from "../lib/paths.js";

loadEnvFile();

const EXPORT_TARGETS = ["artists", "releases", "recordings"];

function log(message) {
  process.stdout.write(`${message}\n`);
}

function parseArgs(argv) {
  const args = { only: null, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--only" && argv[index + 1]) {
      args.only = argv[++index];
    } else if (token === "--force") {
      args.force = true;
    }
  }
  if (args.only && !EXPORT_TARGETS.includes(args.only)) {
    throw new Error(`--only must be one of: ${EXPORT_TARGETS.join(", ")}`);
  }
  return args;
}

async function writeLine(stream, line) {
  if (!stream.write(line)) {
    await once(stream, "drain");
  }
}

async function closeStream(stream) {
  stream.end();
  await once(stream, "finish");
}

function shouldSkip(outputPath, force, only) {
  if (force || only) return false;
  return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
}

async function exportArtists(db, outputPath, force, only) {
  if (shouldSkip(outputPath, force, only)) {
    log(`Skipping artists (already exists): ${outputPath}`);
    return;
  }

  log("Exporting artists...");
  const stream = fs.createWriteStream(outputPath);
  const rows = db.prepare(`
    SELECT artist_mbid, name, sort_name
    FROM artist_staging
  `).iterate();
  let count = 0;
  for (const row of rows) {
    await writeLine(
      stream,
      `${JSON.stringify({
        id: row.artist_mbid,
        name: row.name,
        sortName: row.sort_name || row.name,
        searchText: row.name,
      })}\n`,
    );
    count += 1;
    if (count % 250000 === 0) log(`  artists: ${count.toLocaleString()}`);
  }
  await closeStream(stream);
  log(`Exported ${count.toLocaleString()} artists`);
}

async function exportReleases(db, outputPath, force, only) {
  if (shouldSkip(outputPath, force, only)) {
    log(`Skipping releases (already exists): ${outputPath}`);
    return;
  }

  log("Exporting releases...");
  const stream = fs.createWriteStream(outputPath);
  const rows = db.prepare(`
    SELECT release_group_mbid, title, artist_name, artist_mbid
    FROM release_staging
  `).iterate();
  let count = 0;
  for (const row of rows) {
    const artistName = row.artist_name || "Unknown Artist";
    await writeLine(
      stream,
      `${JSON.stringify({
        id: row.release_group_mbid,
        title: row.title,
        artistName,
        artistMbid: row.artist_mbid || null,
        searchText: `${row.title} ${artistName}`.trim(),
      })}\n`,
    );
    count += 1;
    if (count % 250000 === 0) log(`  releases: ${count.toLocaleString()}`);
  }
  await closeStream(stream);
  log(`Exported ${count.toLocaleString()} releases`);
}

async function exportRecordings(db, outputPath, force, only) {
  if (shouldSkip(outputPath, force, only)) {
    log(`Skipping recordings (already exists): ${outputPath}`);
    return;
  }

  log("Exporting recordings...");
  const stream = fs.createWriteStream(outputPath);
  const rows = db.prepare(`
    SELECT
      recording_mbid,
      recording_name,
      artist_credit_name,
      release_name,
      combined_lookup,
      artist_mbids,
      release_group_mbid,
      score
    FROM track_staging
  `).iterate();
  let count = 0;
  for (const row of rows) {
    const artistName = row.artist_credit_name || "Unknown Artist";
    await writeLine(
      stream,
      `${JSON.stringify({
        id: row.recording_mbid,
        title: row.recording_name,
        artistName,
        artistMbid: String(row.artist_mbids || "").split(/[;,]/)[0]?.trim() || null,
        albumTitle: row.release_name || null,
        albumMbid: row.release_group_mbid || null,
        combinedLookup: row.combined_lookup || "",
        score: row.score || 0,
        searchText: `${artistName} ${row.recording_name} ${row.release_name || ""}`.trim(),
      })}\n`,
    );
    count += 1;
    if (count % 500000 === 0) {
      log(`  recordings: ${count.toLocaleString()}`);
    }
  }
  await closeStream(stream);
  log(`Exported ${count.toLocaleString()} recordings`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = getDataDir();
  const stagingPath = path.join(dataDir, "staging", "index.db");
  const outputDir = path.join(dataDir, "jsonl");
  if (!fs.existsSync(stagingPath)) {
    throw new Error(`Staging database not found: ${stagingPath}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const db = new Database(stagingPath, { readonly: true });
  const targets = args.only ? [args.only] : EXPORT_TARGETS;

  if (targets.includes("artists")) {
    await exportArtists(
      db,
      path.join(outputDir, "artists.jsonl"),
      args.force,
      args.only,
    );
  }
  if (targets.includes("releases")) {
    await exportReleases(
      db,
      path.join(outputDir, "releases.jsonl"),
      args.force,
      args.only,
    );
  }
  if (targets.includes("recordings")) {
    await exportRecordings(
      db,
      path.join(outputDir, "recordings.jsonl"),
      args.force,
      args.only,
    );
  }

  db.close();
  log("Done.");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
