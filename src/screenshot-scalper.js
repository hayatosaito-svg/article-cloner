import { chromium } from "playwright";
import sharp from "sharp";
import path from "path";
import { writeFile, mkdir } from "fs/promises";
import { PROJECT_ROOT } from "./utils.js";

const MOBILE_VIEWPORT = { width: 412, height: 915 };
const USER_AGENT = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const SLICE_HEIGHT = 800; // px per slice

export async function screenshotScalp(url, options = {}) {
  const sliceHeight = options.sliceHeight || SLICE_HEIGHT;
  const onProgress = options.onProgress || (() => {});
  const projectId = options.projectId || Date.now().toString(36);

  const outputDir = path.join(PROJECT_ROOT, "output", "scalp", projectId);
  await mkdir(outputDir, { recursive: true });

  onProgress("ブラウザ起動中...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({
      viewport: MOBILE_VIEWPORT,
      userAgent: USER_AGENT,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    onProgress("ページ読み込み中...");
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

    // Scroll to trigger lazy load
    onProgress("コンテンツ展開中...");
    const scrollIterations = 10;
    for (let i = 0; i < scrollIterations; i++) {
      await page.evaluate(({ step, total }) => {
        window.scrollTo(0, (document.body.scrollHeight / total) * (step + 1));
      }, { step: i, total: scrollIterations });
      await new Promise(r => setTimeout(r, 300));
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 500));

    // Full page screenshot
    onProgress("フルページスクリーンショット撮影中...");
    const screenshotBuffer = await page.screenshot({ fullPage: true, type: "png" });
    const fullPath = path.join(outputDir, "full.png");
    await writeFile(fullPath, screenshotBuffer);

    // Get image dimensions
    const metadata = await sharp(screenshotBuffer).metadata();
    const totalHeight = metadata.height;
    const width = metadata.width;

    onProgress(`画像サイズ: ${width}x${totalHeight}px - スライス中...`);

    // Slice into sections
    // sliceHeight is in CSS pixels, but screenshot is at 2x deviceScaleFactor
    const actualSliceHeight = sliceHeight * 2; // account for deviceScaleFactor
    const sliceCount = Math.ceil(totalHeight / actualSliceHeight);
    const slices = [];

    for (let i = 0; i < sliceCount; i++) {
      const top = i * actualSliceHeight;
      const height = Math.min(actualSliceHeight, totalHeight - top);

      const sliceBuffer = await sharp(screenshotBuffer)
        .extract({ left: 0, top, width, height })
        .png({ quality: 90 })
        .toBuffer();

      const filename = `slice-${String(i).padStart(3, "0")}.png`;
      const slicePath = path.join(outputDir, filename);
      await writeFile(slicePath, sliceBuffer);

      slices.push({
        index: i,
        filename,
        path: slicePath,
        width,
        height,
        cssWidth: Math.round(width / 2), // back to CSS px
        cssHeight: Math.round(height / 2),
      });

      onProgress(`スライス ${i + 1}/${sliceCount} 完了`);
    }

    onProgress("完了！");

    return {
      projectId,
      url,
      outputDir,
      fullScreenshot: "full.png",
      totalWidth: width,
      totalHeight,
      sliceCount,
      slices,
    };
  } finally {
    await browser.close();
  }
}

// Generate SB-compatible HTML from slices
export function generateSbHtml(projectId, slices, imageBaseUrl) {
  const widgets = slices.map((slice, i) => {
    const partId = `sb-part-${projectId}-${String(i).padStart(3, "0")}`;
    const customPartId = `sb-custom-part-${projectId}-${String(i).padStart(3, "0")}`;
    const imgUrl = `${imageBaseUrl}/${slice.filename}`;

    return `<div id="${partId}" class="${customPartId}">
<style>
#${partId}.${customPartId} { width: 100%; }
#${partId}.${customPartId} img { width: 100%; height: auto; display: block; }
</style>
<picture>
<source type="image/png" data-srcset="${imgUrl}">
<img class="lazyload" data-src="${imgUrl}" alt="" style="width:100%;height:auto;display:block;">
</picture>
</div>`;
  });

  return widgets.join("\n");
}
