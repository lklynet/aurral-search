import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { parseCsvLine, primaryArtistMbid } from "./csv.js";

export function findCanonicalArchive(dumpsDir) {
  const entries = fs.readdirSync(dumpsDir);
  const match = entries.find((name) =>
    /^musicbrainz-canonical-dump-.*\.tar\.zst$/i.test(name),
  );
  if (!match) {
    throw new Error(`No musicbrainz-canonical-dump-*.tar.zst found in ${dumpsDir}`);
  }
  return path.join(dumpsDir, match);
}

export function ensureCanonicalFiles(dumpsDir) {
  const extractedDir = path.join(dumpsDir, "extracted", "canonical");
  const csvPath = path.join(extractedDir, "canonical_musicbrainz_data.csv");
  const releaseRedirectPath = path.join(extractedDir, "canonical_release_redirect.csv");
  if (fs.existsSync(csvPath) && fs.existsSync(releaseRedirectPath)) {
    return { csvPath, releaseRedirectPath };
  }

  fs.mkdirSync(extractedDir, { recursive: true });
  const archive = findCanonicalArchive(dumpsDir);
  const prefix = path.basename(archive).replace(/\.tar\.zst$/i, "");

  const extract = spawnSync(
    "sh",
    [
      "-c",
      `zstd -d "${archive}" -c | tar -x -C "${extractedDir}" --strip-components=2 "${prefix}/canonical"`,
    ],
    { stdio: "inherit" },
  );
  if (extract.status !== 0) {
    throw new Error("Failed to extract canonical CSV bundle");
  }

  return { csvPath, releaseRedirectPath };
}

export function parseCanonicalRow(line) {
  if (!line.trim()) return null;
  const columns = parseCsvLine(line);
  if (columns.length < 10) return null;
  const [
    ,
    ,
    artistMbids,
    artistCreditName,
    releaseMbid,
    releaseName,
    recordingMbid,
    recordingName,
    combinedLookup,
    scoreRaw,
  ] = columns;
  if (!recordingMbid || !recordingName) return null;
  return {
    artistMbids,
    artistCreditName: String(artistCreditName || "").trim(),
    releaseMbid,
    releaseName: String(releaseName || "").trim(),
    recordingMbid,
    recordingName: String(recordingName || "").trim(),
    combinedLookup: String(combinedLookup || "").trim(),
    score: Number.parseInt(scoreRaw, 10) || 0,
    artistMbid: primaryArtistMbid(artistMbids),
  };
}
