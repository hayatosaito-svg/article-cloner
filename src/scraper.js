/**
 * scraper.js - Playwrightスクレイピング + 画像/動画ダウンロード
 *
 * モバイルVP (412x915) でページ取得、lazy load完全展開、
 * innerHTML抽出 + 全メディアアセットダウンロード
 */
import { chromium } from "playwright";
import fetch from "node-fetch";
import { writeFile } from "fs/promises";
import path from "path";
import {
  sleep,
  initOutputDirs,
  urlToFilename,
  urlToSlug,
  formatBytes,
} from "./utils.js";

const MOBILE_VIEWPORT = { width: 412, height: 915 };
const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

/**
 * ページをスクレイプしてHTML + 全アセットをダウンロード
 * @param {string} url - 対象URL
 * @param {object} [options]
 * @param {string} [options.slug] - プロジェクトスラッグ（省略時はURL由来）
 * @param {number} [options.scrollIterations=15] - スクロール回数
 * @param {number} [options.scrollDelay=800] - スクロール間のms
 * @returns {Promise<{html: string, assets: Array, dirs: object}>}
 */
export async function scrape(url, options = {}) {
  const slug = options.slug || urlToSlug(url);
  const scrollIterations = options.scrollIterations || 15;
  const scrollDelay = options.scrollDelay || 800;

  console.log(`[scraper] Starting scrape: ${url}`);
  console.log(`[scraper] Project slug: ${slug}`);

  const dirs = await initOutputDirs(slug);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({
      viewport: MOBILE_VIEWPORT,
      userAgent: USER_AGENT,
      deviceScaleFactor: 2.625,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    // ページ読み込み
    console.log("[scraper] Loading page...");
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await sleep(2000);

    // スクロールしてlazy loadを完全展開
    console.log(`[scraper] Scrolling to load lazy content (${scrollIterations} iterations)...`);
    for (let i = 0; i < scrollIterations; i++) {
      await page.evaluate((step) => {
        const totalHeight = document.body.scrollHeight;
        const stepSize = totalHeight / 15;
        window.scrollTo(0, stepSize * (step + 1));
      }, i);
      await sleep(scrollDelay);
    }
    // 最後にページ末端まで
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1500);
    // トップに戻す
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);

    // innerHTML取得（body配下 or article-body配下）
    console.log("[scraper] Extracting HTML...");
    const html = await page.evaluate(() => {
      // SB記事本文エリアを優先取得
      const articleBody = document.querySelector(".article-body");
      if (articleBody) return articleBody.innerHTML;
      // フォールバック: body全体
      return document.body.innerHTML;
    });

    // HTML保存
    const htmlPath = path.join(dirs.scraped, "source.html");
    await writeFile(htmlPath, html, "utf-8");
    console.log(`[scraper] HTML saved: ${htmlPath}`);

    // メディアURL抽出
    const mediaUrls = await page.evaluate(() => {
      const urls = new Set();
      // 画像: data-src, data-srcset, src
      document.querySelectorAll("img").forEach((img) => {
        if (img.dataset.src) urls.add(img.dataset.src);
        if (img.src && !img.src.startsWith("data:")) urls.add(img.src);
      });
      // source: data-srcset, data-src, srcset
      document.querySelectorAll("source").forEach((src) => {
        if (src.dataset.srcset) urls.add(src.dataset.srcset);
        if (src.dataset.src) urls.add(src.dataset.src);
        if (src.srcset) urls.add(src.srcset);
      });
      // video直接src
      document.querySelectorAll("video").forEach((v) => {
        if (v.src) urls.add(v.src);
      });
      return [...urls].filter((u) => u.startsWith("http"));
    });

    console.log(`[scraper] Found ${mediaUrls.length} media assets`);

    // アセットダウンロード
    const assets = [];
    let downloaded = 0;
    let failed = 0;

    for (const mediaUrl of mediaUrls) {
      try {
        const filename = urlToFilename(mediaUrl);
        const filePath = path.join(dirs.assets, filename);

        const resp = await fetch(mediaUrl, {
          headers: { "User-Agent": USER_AGENT },
          timeout: 15000,
        });

        if (!resp.ok) {
          failed++;
          continue;
        }

        const buffer = Buffer.from(await resp.arrayBuffer());
        await writeFile(filePath, buffer);

        assets.push({
          originalUrl: mediaUrl,
          localFile: filename,
          localPath: filePath,
          size: buffer.length,
          type: guessMediaType(mediaUrl),
        });
        downloaded++;
      } catch (err) {
        failed++;
        console.warn(`[scraper] Failed to download: ${mediaUrl} - ${err.message}`);
      }
    }

    console.log(
      `[scraper] Downloaded ${downloaded} assets, ${failed} failed`
    );
    console.log(
      `[scraper] Total size: ${formatBytes(assets.reduce((s, a) => s + a.size, 0))}`
    );

    // アセットカタログ保存
    const catalogPath = path.join(dirs.scraped, "assets-catalog.json");
    await writeFile(catalogPath, JSON.stringify(assets, null, 2), "utf-8");

    return { html, assets, dirs, slug };
  } finally {
    await browser.close();
  }
}

function guessMediaType(url) {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  if ([".mp4", ".webm", ".mov"].includes(ext)) return "video";
  if ([".gif"].includes(ext)) return "gif";
  if ([".webp", ".avif", ".jpg", ".jpeg", ".png", ".svg"].includes(ext))
    return "image";
  return "unknown";
}

// CLIから直接実行
if (process.argv[1] && process.argv[1].endsWith("scraper.js")) {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: node src/scraper.js <URL>");
    process.exit(1);
  }
  scrape(url).then((result) => {
    console.log(`[scraper] Done. Assets: ${result.assets.length}`);
  });
}
