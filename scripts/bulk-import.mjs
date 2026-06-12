import fs from "fs";
import path from "path";
import readline from "readline";
import { MeiliSearch } from "meilisearch";
import { getDataDir, loadEnvFile } from "../lib/paths.js";

loadEnvFile();

const BATCH_SIZE = 50000;
const INDEX_SETTINGS = {
  artists: {
    searchableAttributes: ["name", "sortName", "searchText"],
    displayedAttributes: ["id", "name", "sortName", "score"],
    sortableAttributes: ["score", "name"],
  },
  releases: {
    searchableAttributes: ["title", "artistName", "searchText"],
    displayedAttributes: ["id", "title", "artistName", "artistMbid"],
    sortableAttributes: ["title"],
  },
  recordings: {
    searchableAttributes: [
      "title",
      "artistName",
      "albumTitle",
      "combinedLookup",
      "searchText",
    ],
    displayedAttributes: [
      "id",
      "title",
      "artistName",
      "artistMbid",
      "albumTitle",
      "albumMbid",
      "score",
    ],
    sortableAttributes: ["score", "title"],
  },
};

function log(message) {
  process.stdout.write(`${message}\n`);
}

function getMeiliClient() {
  const host = String(process.env.MEILI_URL || "http://127.0.0.1:7700").trim();
  const apiKey = String(process.env.MEILI_MASTER_KEY || "").trim();
  if (!apiKey) {
    throw new Error("MEILI_MASTER_KEY is required");
  }
  return new MeiliSearch({ host, apiKey });
}

async function waitForTask(client, taskUid) {
  const task = await client.waitForTask(taskUid, {
    timeOutMs: 1000 * 60 * 60 * 6,
    intervalMs: 1000,
  });
  if (task.status !== "succeeded") {
    throw new Error(`Meilisearch task ${taskUid} failed: ${task.error?.message || task.status}`);
  }
  return task;
}

async function readJsonlBatches(filePath, batchSize, onBatch) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let batch = [];
  let total = 0;
  for await (const line of reader) {
    if (!line.trim()) continue;
    batch.push(JSON.parse(line));
    if (batch.length >= batchSize) {
      await onBatch(batch);
      total += batch.length;
      batch = [];
    }
  }
  if (batch.length > 0) {
    await onBatch(batch);
    total += batch.length;
  }
  return total;
}

async function deleteIndexIfExists(client, uid) {
  try {
    await waitForTask(client, (await client.deleteIndex(uid)).taskUid);
  } catch {}
}

async function importIndex(client, baseName, filePath) {
  const liveUid = baseName;
  const nextUid = `${baseName}_next`;
  const indexes = await client.getIndexes({ limit: 1000 });
  const liveExists = indexes.results.some((entry) => entry.uid === liveUid);
  const targetUid = liveExists ? nextUid : liveUid;
  log(`Importing ${baseName} into ${targetUid}...`);

  await deleteIndexIfExists(client, targetUid);
  await client.createIndex(targetUid, { primaryKey: "id" });
  const index = client.index(targetUid);
  await waitForTask(
    client,
    (await index.updateSettings(INDEX_SETTINGS[baseName])).taskUid,
  );

  let imported = 0;
  await readJsonlBatches(filePath, BATCH_SIZE, async (documents) => {
    const task = await index.addDocuments(documents);
    await waitForTask(client, task.taskUid);
    imported += documents.length;
    if (imported % 500000 === 0 || imported < BATCH_SIZE) {
      log(`  ${baseName}: ${imported.toLocaleString()}`);
    }
  });
  log(`Imported ${imported.toLocaleString()} ${baseName}`);

  if (liveExists) {
    log(`Swapping ${nextUid} -> ${liveUid}`);
    await waitForTask(
      client,
      (await client.swapIndexes([{ indexes: [nextUid, liveUid] }])).taskUid,
    );
    await deleteIndexIfExists(client, nextUid);
  }
}

async function main() {
  const dataDir = getDataDir();
  const jsonlDir = path.join(dataDir, "jsonl");
  const client = getMeiliClient();

  const health = await client.health();
  if (health.status !== "available") {
    throw new Error("Meilisearch is not available");
  }

  await importIndex(client, "artists", path.join(jsonlDir, "artists.jsonl"));
  await importIndex(client, "releases", path.join(jsonlDir, "releases.jsonl"));
  await importIndex(client, "recordings", path.join(jsonlDir, "recordings.jsonl"));

  log("All indexes imported.");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
