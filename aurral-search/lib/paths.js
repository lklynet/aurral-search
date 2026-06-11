import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");

export function loadEnvFile(envPath = path.join(REPO_ROOT, ".env")) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export function getDataDir() {
  const configured = String(process.env.DATA_DIR || "").trim();
  return path.resolve(configured || path.join(REPO_ROOT, "data"));
}

export function getDumpsDir() {
  const configured = String(process.env.DUMPS_DIR || "").trim();
  return path.resolve(configured || path.join(REPO_ROOT, "dumps"));
}
