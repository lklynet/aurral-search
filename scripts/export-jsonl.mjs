import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { getDataDir, loadEnvFile } from "../lib/paths.js";

loadEnvFile();

function log(message) {
  process.stdout.write(`${message}\n`);
}

function writeJsonl(stream, rows, mapRow) {
  for (const row of rows) {
    stream.write(`${JSON.stringify(mapRow(row))}\n`);
  }
}

function main() {
  const dataDir = getDataDir();
  const stagingPath = path.join(dataDir, "staging", "index.db");
  const outputDir = path.join(dataDir, "jsonl");
  if (!fs.existsSync(stagingPath)) {
    throw new Error(`Staging database not found: ${stagingPath}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const db = new Database(stagingPath, { readonly: true });

  log("Exporting artists...");
  const artistsPath = path.join(outputDir, "artists.jsonl");
  const artistsStream = fs.createWriteStream(artistsPath);
  const artists = db.prepare(`
    SELECT artist_mbid, name, sort_name
    FROM artist_staging
  `).iterate();
  let artistCount = 0;
  for (const row of artists) {
    artistsStream.write(
      `${JSON.stringify({
        id: row.artist_mbid,
        name: row.name,
        sortName: row.sort_name || row.name,
        searchText: row.name,
      })}\n`,
    );
    artistCount += 1;
    if (artistCount % 250000 === 0) log(`  artists: ${artistCount.toLocaleString()}`);
  }
  artistsStream.end();
  log(`Exported ${artistCount.toLocaleString()} artists`);

  log("Exporting releases...");
  const releasesPath = path.join(outputDir, "releases.jsonl");
  const releasesStream = fs.createWriteStream(releasesPath);
  const releases = db.prepare(`
    SELECT release_group_mbid, title, artist_name, artist_mbid
    FROM release_staging
  `).iterate();
  let releaseCount = 0;
  for (const row of releases) {
    const artistName = row.artist_name || "Unknown Artist";
    releasesStream.write(
      `${JSON.stringify({
        id: row.release_group_mbid,
        title: row.title,
        artistName,
        artistMbid: row.artist_mbid || null,
        searchText: `${row.title} ${artistName}`.trim(),
      })}\n`,
    );
    releaseCount += 1;
    if (releaseCount % 250000 === 0) log(`  releases: ${releaseCount.toLocaleString()}`);
  }
  releasesStream.end();
  log(`Exported ${releaseCount.toLocaleString()} releases`);

  log("Exporting recordings...");
  const recordingsPath = path.join(outputDir, "recordings.jsonl");
  const recordingsStream = fs.createWriteStream(recordingsPath);
  const recordings = db.prepare(`
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
  let recordingCount = 0;
  for (const row of recordings) {
    const artistName = row.artist_credit_name || "Unknown Artist";
    recordingsStream.write(
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
    recordingCount += 1;
    if (recordingCount % 500000 === 0) {
      log(`  recordings: ${recordingCount.toLocaleString()}`);
    }
  }
  recordingsStream.end();
  log(`Exported ${recordingCount.toLocaleString()} recordings`);

  db.close();
  log("Done.");
}

main();
