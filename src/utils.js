import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import crypto from "crypto";

export const PROJECT_ROOT = path.resolve(
  new URL(".", import.meta.url).pathname,
  ".."
);
export const OUTPUT_DIR = path.join(PROJECT_ROOT, "output");
export const SCRAPED_DIR = path.join(OUTPUT_DIR, "scraped");
export const ANALYSIS_DIR = path.join(OUTPUT_DIR, "analysis");
export const IMAGES_DIR = path.join(OUTPUT_DIR, "images");
export const FINAL_DIR = path.join(OUTPUT_DIR, "final");

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ランダムなSB互換IDを生成 (例: lzl4c3xplgsrjpr0rhq) */
export function generateSbId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 20; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/** 数値ベースのSBパートID生成 */
export function generateSbPartNumber() {
  return Math.floor(10000 + Math.random() * 90000);
}

/** ディレクトリを確実に作成 */
export async function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true });
  }
}

/** すべての出力ディレクトリを初期化 */
export async function initOutputDirs(projectSlug) {
  const dirs = [
    path.join(SCRAPED_DIR, projectSlug),
    path.join(SCRAPED_DIR, projectSlug, "assets"),
    path.join(ANALYSIS_DIR, projectSlug),
    path.join(IMAGES_DIR, projectSlug),
    path.join(FINAL_DIR, projectSlug),
  ];
  for (const d of dirs) {
    await ensureDir(d);
  }
  return {
    scraped: path.join(SCRAPED_DIR, projectSlug),
    assets: path.join(SCRAPED_DIR, projectSlug, "assets"),
    analysis: path.join(ANALYSIS_DIR, projectSlug),
    images: path.join(IMAGES_DIR, projectSlug),
    final: path.join(FINAL_DIR, projectSlug),
  };
}

/** URLからファイル名を生成 */
export function urlToFilename(url) {
  const u = new URL(url);
  const pathname = u.pathname.replace(/^\//, "").replace(/\//g, "_");
  const ext = path.extname(pathname) || ".bin";
  const hash = crypto.createHash("md5").update(url).digest("hex").slice(0, 8);
  return `${hash}${ext}`;
}

/** JSONを整形して保存 */
export async function saveJson(filePath, data) {
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/** JSONを読み込み */
export async function loadJson(filePath) {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

/** URLからスラッグを生成 */
export function urlToSlug(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/\./g, "-").replace(/[^a-z0-9-]/gi, "");
  } catch {
    return "unknown-" + Date.now();
  }
}

/** バイト数をhuman-readableに変換 */
export function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
