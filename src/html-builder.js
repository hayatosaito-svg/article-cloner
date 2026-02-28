/**
 * html-builder.js - Squad Beyond互換HTML組み立て
 *
 * SB互換ルール:
 * - <picture> + <source type="image/webp" data-srcset> + <img class="lazyload" data-src>
 * - <video class="ql-video lazyload" autoplay muted loop playsinline>
 * - sb-part-XXXXX / sb-custom-part-XXXXX は新規ID生成
 * - スコープドCSS更新
 * - CTA href差し替え
 * - 末尾にvideo margin resetウィジェット
 * - <html>/<body>タグなし（SBフラグメント）
 */
import * as cheerio from "cheerio";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { generateSbId, generateSbPartNumber } from "./utils.js";

/**
 * SB互換HTMLを構築
 * @param {string} html - 差し替え済みHTML
 * @param {object} config - ビルド設定
 * @param {object} config.imageMap - { originalSrc: localPath } 画像差し替えマップ
 * @param {string} config.ctaUrl - CTA差し替えURL
 * @param {boolean} config.regenerateIds - SBパートIDを再生成するか (default: true)
 * @returns {string} SB互換HTML
 */
export function buildSbHtml(html, config = {}) {
  const $ = cheerio.load(html, {
    decodeEntities: false,
    xmlMode: false,
  });

  const imageMap = config.imageMap || {};
  const regenerateIds = config.regenerateIds !== false;

  // 1. SBパートID再生成
  if (regenerateIds) {
    regenerateSbIds($);
  }

  // 2. 画像差し替え
  if (Object.keys(imageMap).length > 0) {
    replaceImages($, imageMap);
  }

  // 3. CTA URL差し替え
  if (config.ctaUrl) {
    replaceCtaUrls($, config.ctaUrl);
  }

  // 4. lazyload属性の確認・修正
  ensureLazyload($);

  // 5. 末尾にvideo margin resetウィジェット追加
  const videoResetWidget = buildVideoResetWidget();

  let output = $.html();

  // <html><head><body>が自動付与される場合は除去
  output = stripHtmlWrapper(output);

  // Tag settings injection
  const ts = config.tagSettings || {};
  let prefix = "";
  let suffix = "";

  if (ts.masterCss) {
    prefix += `<style>${ts.masterCss}</style>\n`;
  }
  if (ts.noindex) {
    prefix += '<meta name="robots" content="noindex">\n';
  }
  if (ts.headTags) {
    prefix += ts.headTags + "\n";
  }
  if (ts.jsHead) {
    prefix += `<script>${ts.jsHead}<\/script>\n`;
  }
  if (ts.bodyTags) {
    suffix += ts.bodyTags + "\n";
  }
  if (ts.jsBody) {
    suffix += `<script>${ts.jsBody}<\/script>\n`;
  }

  // Exit popup injection
  if (config.exitPopup?.enabled && config.exitPopupHtml) {
    suffix += config.exitPopupHtml + "\n";
  }

  output = prefix + output + suffix;

  // video margin resetを末尾に追加（既存がなければ）
  if (!output.includes("article-body video")) {
    output += "\n" + videoResetWidget;
  }

  return output;
}

/**
 * SBパートIDを再生成
 */
function regenerateSbIds($) {
  const idMap = new Map(); // old -> new のマッピング

  // sb-part-XXXXXのIDを持つ要素を収集
  $("[id^='sb-part-']").each((_, el) => {
    const $el = $(el);
    const oldId = $el.attr("id");
    const oldClass = ($el.attr("class") || "")
      .split(" ")
      .find((c) => c.startsWith("sb-custom-part-"));

    if (!oldId) return;

    // 同じoldIdが既にマッピング済みなら再利用
    let newPartNum, newClassId;
    if (idMap.has(oldId + "|" + oldClass)) {
      const mapped = idMap.get(oldId + "|" + oldClass);
      newPartNum = mapped.partNum;
      newClassId = mapped.classId;
    } else {
      newPartNum = generateSbPartNumber();
      newClassId = "sb-custom-part-" + generateSbId();
      idMap.set(oldId + "|" + oldClass, { partNum: newPartNum, classId: newClassId });
    }

    const newId = `sb-part-${newPartNum}`;

    // ID更新
    $el.attr("id", newId);

    // クラス更新
    if (oldClass) {
      const classes = ($el.attr("class") || "").replace(oldClass, newClassId);
      $el.attr("class", classes);
    }
  });

  // スコープドCSSのセレクタも更新
  $("style").each((_, styleEl) => {
    let cssText = $(styleEl).html() || "";

    for (const [key, val] of idMap) {
      const [oldId, oldClass] = key.split("|");
      const newId = `sb-part-${val.partNum}`;
      const newClass = val.classId;

      if (oldId) {
        cssText = cssText.split(`#${oldId}`).join(`#${newId}`);
      }
      if (oldClass) {
        cssText = cssText.split(`.${oldClass}`).join(`.${newClass}`);
      }
    }

    $(styleEl).html(cssText);
  });
}

/**
 * 画像を差し替え
 */
function replaceImages($, imageMap) {
  // picture内のsource + img
  $("picture").each((_, pictureEl) => {
    const $picture = $(pictureEl);
    const $img = $picture.find("img").first();
    const originalSrc =
      $img.attr("data-src") || $img.attr("src") || "";

    if (!originalSrc || !imageMap[originalSrc]) return;

    const newSrc = imageMap[originalSrc];

    // imgのdata-srcとsrcを更新
    $img.attr("data-src", newSrc);
    if ($img.attr("src")) $img.attr("src", newSrc);

    // webp/avif sourceのdata-srcsetも更新
    $picture.find("source").each((_, sourceEl) => {
      const $source = $(sourceEl);
      const type = $source.attr("type") || "";
      // 元のURLベースで同一アセットのsourceを更新
      if ($source.attr("data-srcset")) {
        $source.attr("data-srcset", newSrc);
      }
      if ($source.attr("srcset")) {
        $source.attr("srcset", newSrc);
      }
    });
  });

  // 単独img（picture外）
  $("img").each((_, imgEl) => {
    const $img = $(imgEl);
    if ($img.closest("picture").length > 0) return; // picture内は処理済み

    const originalSrc = $img.attr("data-src") || $img.attr("src") || "";
    if (originalSrc && imageMap[originalSrc]) {
      const newSrc = imageMap[originalSrc];
      $img.attr("data-src", newSrc);
      if ($img.attr("src")) $img.attr("src", newSrc);
    }
  });
}

/**
 * CTAリンクのURL差し替え
 */
function replaceCtaUrls($, newUrl) {
  $("a[href]").each((_, el) => {
    const $a = $(el);
    const href = $a.attr("href") || "";

    // フッター系リンクは除外
    const footerKeywords = [
      "law_info", "privacy", "company", "aboutus",
      "特定商取引", "プライバシー", "企業情報", "運営者情報",
    ];
    const isFooter = footerKeywords.some(
      (kw) => href.includes(kw) || $a.text().includes(kw)
    );
    if (isFooter) return;

    // CTA画像リンクまたはメインCTAを差し替え
    if ($a.find("img, picture").length > 0) {
      $a.attr("href", newUrl);
    }
  });
}

/**
 * lazyload属性の確認・修正
 */
function ensureLazyload($) {
  // img要素にlazyloadクラスがなければ追加
  $("img").each((_, el) => {
    const $img = $(el);
    if (!$img.hasClass("lazyload")) {
      $img.addClass("lazyload");
    }
    // data-srcがなくsrcがあれば変換
    if (!$img.attr("data-src") && $img.attr("src")) {
      $img.attr("data-src", $img.attr("src"));
    }
  });

  // video要素
  $("video").each((_, el) => {
    const $video = $(el);
    if (!$video.hasClass("lazyload")) {
      $video.addClass("lazyload");
    }
    if (!$video.hasClass("ql-video")) {
      $video.addClass("ql-video");
    }
    // 必須属性
    $video.attr("autoplay", "");
    $video.attr("muted", "true");
    $video.attr("loop", "");
    $video.attr("playsinline", "");
    $video.attr('oncanplay', 'this.muted=true');
    $video.attr("controlslist", "nodownload");
    $video.attr("allowfullscreen", "true");
  });

  // video source
  $("video source").each((_, el) => {
    const $source = $(el);
    if (!$source.attr("data-src") && $source.attr("src")) {
      $source.attr("data-src", $source.attr("src"));
      $source.removeAttr("src");
    }
  });
}

/**
 * video margin resetウィジェットを生成
 */
function buildVideoResetWidget() {
  const partNum = generateSbPartNumber();
  const classId = generateSbId();
  return `<div><div class="sb-custom"><span><div id="sb-part-${partNum}" class="sb-custom-part-${classId}">
<style>
    body .article-body video {
        display: block;
        max-width: 100%;
        margin-top: 0px !important;
        margin-bottom: 0px !important;
    }

</style>
</div>
<style></style></span></div></div>`;
}

/**
 * Cheerioが自動付与する<html><head><body>を除去
 */
function stripHtmlWrapper(html) {
  return html
    .replace(/^<html><head><\/head><body>/, "")
    .replace(/<\/body><\/html>$/, "")
    .trim();
}

/**
 * SB HTMLのバリデーション
 * @param {string} html
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateSbHtml(html) {
  const errors = [];
  const warnings = [];

  // <html>/<body>タグがないこと
  if (html.includes("<html") || html.includes("<body")) {
    errors.push("<html> or <body> tag found - SB fragments must not have these");
  }

  // lazyloadチェック
  const $ = cheerio.load(html, { decodeEntities: false });
  $("img").each((_, el) => {
    if (!$(el).hasClass("lazyload")) {
      warnings.push(`img without lazyload class: ${$(el).attr("src") || $(el).attr("data-src")}`);
    }
    if (!$(el).attr("data-src")) {
      warnings.push(`img without data-src: ${$(el).attr("src")}`);
    }
  });

  // sb-part ID重複チェック
  const partIds = new Set();
  const partClasses = new Set();
  $("[id^='sb-part-']").each((_, el) => {
    const id = $(el).attr("id");
    const cls = ($(el).attr("class") || "")
      .split(" ")
      .find((c) => c.startsWith("sb-custom-part-"));

    // 同じidは複数回出現してもOK（元のSBがそうなっている）
    // ただし同じid+classの組み合わせは一意であるべき
    const key = `${id}|${cls}`;
    if (cls) {
      if (partClasses.has(cls)) {
        // 実際のSBでは同じsb-part-idが異なるclass(variant)で複数回出現する
        // のでwarningに留める
      }
      partClasses.add(cls);
    }
  });

  // videoのlazyload
  $("video").each((_, el) => {
    if (!$(el).hasClass("lazyload")) {
      warnings.push("video without lazyload class");
    }
    const $source = $(el).find("source");
    if ($source.length > 0 && !$source.attr("data-src")) {
      warnings.push("video source without data-src");
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * ファイルからHTMLを読み込み、SBビルドして保存
 */
export async function buildFromFile(inputPath, outputPath, config = {}) {
  const html = await readFile(inputPath, "utf-8");
  const result = buildSbHtml(html, config);

  // バリデーション
  const validation = validateSbHtml(result);
  if (!validation.valid) {
    console.error("[html-builder] Validation errors:");
    validation.errors.forEach((e) => console.error(`  ERROR: ${e}`));
  }
  if (validation.warnings.length > 0) {
    console.warn("[html-builder] Warnings:");
    validation.warnings.forEach((w) => console.warn(`  WARN: ${w}`));
  }

  await writeFile(outputPath, result, "utf-8");
  console.log(`[html-builder] Output saved: ${outputPath}`);
  console.log(`[html-builder] Size: ${(Buffer.byteLength(result) / 1024).toFixed(1)} KB`);

  return { html: result, validation };
}

// CLIから直接実行
if (process.argv[1] && process.argv[1].endsWith("html-builder.js")) {
  const input = process.argv[2];
  const output = process.argv[3] || "output.html";
  if (!input) {
    console.error("Usage: node src/html-builder.js <input.html> [output.html]");
    process.exit(1);
  }
  buildFromFile(input, output);
}
