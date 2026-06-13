import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const STOP_WORDS = new Set(
  JSON.parse(
    fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "stop-words.json"),
      "utf8",
    ),
  ),
);

export function prepareSearchQuery(query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) return "";

  const words = trimmed
    .replace(/[&/\\#,+()$~%.':*?<>{}]/g, "")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  const filtered = words.filter((word) => !STOP_WORDS.has(word.toLowerCase()));
  return (filtered.length > 0 ? filtered : words).join(" ").trim();
}
