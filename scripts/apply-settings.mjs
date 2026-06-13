import { MeiliSearch } from "meilisearch";
import { loadEnvFile } from "../lib/paths.js";

loadEnvFile();

const RANKING_RULES = [
  "words",
  "typo",
  "proximity",
  "attribute",
  "sort",
  "exactness",
  "score:desc",
];

const INDEX_SETTINGS = {
  artists: {
    searchableAttributes: ["name", "sortName"],
    displayedAttributes: ["id", "name", "sortName", "score"],
    sortableAttributes: ["score", "name"],
    rankingRules: RANKING_RULES,
  },
  releases: {
    searchableAttributes: ["title", "artistName"],
    displayedAttributes: ["id", "title", "artistName", "artistMbid", "score"],
    sortableAttributes: ["score", "title"],
    rankingRules: RANKING_RULES,
  },
  recordings: {
    searchableAttributes: ["artistName", "title", "albumTitle", "combinedLookup"],
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
    rankingRules: RANKING_RULES,
  },
};

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
    timeOutMs: 1000 * 60 * 60,
    intervalMs: 500,
  });
  if (task.status !== "succeeded") {
    throw new Error(`Meilisearch task ${taskUid} failed: ${task.error?.message || task.status}`);
  }
}

async function main() {
  const client = getMeiliClient();
  for (const [uid, settings] of Object.entries(INDEX_SETTINGS)) {
    const index = client.index(uid);
    const task = await index.updateSettings(settings);
    await waitForTask(client, task.taskUid);
    process.stdout.write(`Updated settings for ${uid}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
