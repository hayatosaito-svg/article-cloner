/**
 * parser.js - HTML構造解析
 *
 * Cheerioでフラットなdiv列をコンテンツブロックに分類し、
 * セクション境界を検出、アセットカタログを生成する。
 *
 * ブロックタイプ:
 *   image / video / text / widget / spacer / cta_link / heading
 *   quiz / review / fv / comparison
 */
import * as cheerio from "cheerio";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { saveJson } from "./utils.js";

/**
 * HTMLを解析してstructure.jsonを生成
 * @param {string} html - 解析対象のHTML文字列
 * @returns {object} { blocks, sections, assets, widgets }
 */
export function parseHtml(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const blocks = [];
  const assets = [];
  const widgets = [];
  let blockIndex = 0;

  // トップレベルのdivを順番に処理
  // Cheerioはhtml/bodyで自動ラップするため、body配下を取得
  const $body = $("body");
  const topElements = $body.length > 0 ? $body.children() : $.root().children();

  topElements.each((_, el) => {
    const $el = $(el);
    const block = classifyBlock($, $el, blockIndex);
    if (block) {
      blocks.push(block);
      blockIndex++;

      // アセット収集
      if (block.type === "image" || block.type === "video") {
        assets.push(...(block.assets || []));
      }

      // ウィジェット収集
      if (block.type === "widget") {
        widgets.push({
          index: block.index,
          widgetType: block.widgetType,
          sbPartId: block.sbPartId,
          sbCustomClass: block.sbCustomClass,
        });
      }
    }
  });

  // セクション境界検出
  const sections = detectSections(blocks);

  return { blocks, sections, assets, widgets };
}

/**
 * ブロックを分類
 */
function classifyBlock($, $el, index) {
  const tagName = $el.prop("tagName")?.toLowerCase() || "";
  const outerHtml = $.html($el);
  const innerText = $el.text().trim();
  const style = $el.attr("style") || "";
  const classes = ($el.attr("class") || "").toLowerCase();

  // CSS抽出（全ブロック共通）
  const $styles = $el.find("style");
  let css = "";
  $styles.each((_, s) => { css += $(s).html() + "\n"; });
  if (style) css += `/* inline */ ${style}`;
  css = css.trim();

  // SBカスタムウィジェット
  if ($el.find(".sb-custom").length > 0 || $el.hasClass("sb-custom")) {
    const w = parseSbWidget($, $el, index);
    w.css = css;
    return w;
  }

  // アンケート/クイズ
  if ($el.find('input[type="radio"], input[type="checkbox"]').length > 0
      || /question|quiz|survey|アンケート/.test(classes)) {
    return { index, type: "quiz", html: outerHtml, text: innerText, style, css };
  }

  // レビュー/口コミ
  if (/review|口コミ|レビュー|体験談|感想/.test(classes + innerText.slice(0, 100))) {
    return { index, type: "review", html: outerHtml, text: innerText, style, css };
  }

  // FV（ファーストビュー）— index===0 かつ画像あり
  if (index === 0 && $el.find('img, picture').length > 0) {
    return { index, type: "fv", html: outerHtml, text: innerText, style, css, assets: extractImageAssets($, $el) };
  }

  // 比較表
  if ($el.find('table').length > 0 || /比較|ランキング|compare/.test(classes + innerText)) {
    return { index, type: "comparison", html: outerHtml, text: innerText, style, css };
  }

  // 動画ブロック
  if ($el.find("video").length > 0 || tagName === "video") {
    const v = parseVideoBlock($, $el, index);
    v.css = css;
    return v;
  }

  // 画像ブロック (picture or img)
  if ($el.find("picture").length > 0 || $el.find("img").length > 0) {
    // CTAリンク付き画像
    if ($el.find("a").length > 0) {
      const $a = $el.find("a").first();
      const href = $a.attr("href") || "";
      return {
        index,
        type: "cta_link",
        href,
        html: outerHtml,
        style,
        css,
        assets: extractImageAssets($, $el),
      };
    }
    const imgBlock = parseImageBlock($, $el, index);
    imgBlock.css = css;
    return imgBlock;
  }

  // 空行/スペーサー
  if (
    innerText === "" &&
    ($el.find("br").length > 0 || outerHtml.trim() === "<div><br></div>")
  ) {
    return { index, type: "spacer", html: outerHtml, css };
  }

  // テキストブロック
  if (innerText.length > 0) {
    // 見出し判定
    const isHeading = detectHeading($, $el);
    return {
      index,
      type: isHeading ? "heading" : "text",
      text: innerText,
      html: outerHtml,
      style,
      css,
      fontSize: extractFontSize($, $el),
      hasStrong: $el.find("strong, b").length > 0,
      hasColor: style.includes("color") || $el.find("[style*='color']").length > 0,
    };
  }

  // その他
  return { index, type: "spacer", html: outerHtml, css };
}

/**
 * SBウィジェットを解析
 */
function parseSbWidget($, $el, index) {
  const $sbCustom = $el.find(".sb-custom").first();
  const $sbPart = $sbCustom.find("[id^='sb-part-']").first();
  const sbPartId = $sbPart.attr("id") || "";
  const sbCustomClass =
    $sbPart
      .attr("class")
      ?.split(" ")
      .find((c) => c.startsWith("sb-custom-part-")) || "";

  // ウィジェットタイプ推定
  let widgetType = "custom";
  const html = $.html($el);
  if (html.includes("class=\"box\"") && html.includes("class=\"in\"")) {
    widgetType = "testimonial";
  } else if (html.includes("class=\"flash\"")) {
    widgetType = "flash_text";
  } else if (html.includes("article-body video")) {
    widgetType = "video_margin_reset";
  } else if ($sbPart.find(".small").length > 0 && $sbPart.children().length <= 2) {
    widgetType = "disclaimer";
  }

  // ウィジェット内のスタイルブロック取得
  const $styles = $el.find("style");
  const styleContent = [];
  $styles.each((_, s) => {
    styleContent.push($(s).html());
  });

  return {
    index,
    type: "widget",
    widgetType,
    sbPartId,
    sbCustomClass,
    html: $.html($el),
    styles: styleContent,
    text: $el.text().trim(),
    assets: extractImageAssets($, $el),
  };
}

/**
 * 画像ブロックを解析
 */
function parseImageBlock($, $el, index) {
  return {
    index,
    type: "image",
    html: $.html($el),
    style: $el.attr("style") || "",
    assets: extractImageAssets($, $el),
  };
}

/**
 * 動画ブロックを解析
 */
function parseVideoBlock($, $el, index) {
  const $video = $el.find("video").first();
  const $source = $video.find("source").first();
  const videoSrc =
    $source.attr("data-src") || $source.attr("src") || $video.attr("src") || "";

  return {
    index,
    type: "video",
    html: $.html($el),
    style: $el.attr("style") || "",
    videoSrc,
    width: parseInt($video.attr("width") || "0", 10),
    height: parseInt($video.attr("height") || "0", 10),
    assets: [
      {
        type: "video",
        src: videoSrc,
        width: parseInt($video.attr("width") || "0", 10),
        height: parseInt($video.attr("height") || "0", 10),
      },
    ],
  };
}

/**
 * 要素内の画像アセットを抽出
 */
function extractImageAssets($, $el) {
  const assets = [];
  $el.find("picture, img").each((_, mediaEl) => {
    const $media = $(mediaEl);
    if ($media.prop("tagName")?.toLowerCase() === "picture") {
      const $img = $media.find("img").first();
      const $webp = $media.find('source[type="image/webp"]').first();
      const $avif = $media.find('source[type="image/avif"]').first();
      assets.push({
        type: "image",
        src: $img.attr("data-src") || $img.attr("src") || "",
        webpSrc: $webp.attr("data-srcset") || "",
        avifSrc: $avif.attr("data-srcset") || "",
        width: parseInt($img.attr("width") || "0", 10),
        height: parseInt($img.attr("height") || "0", 10),
      });
    } else if ($media.prop("tagName")?.toLowerCase() === "img") {
      // picture外の単独img
      if (!$media.closest("picture").length) {
        assets.push({
          type: "image",
          src: $media.attr("data-src") || $media.attr("src") || "",
          width: parseInt($media.attr("width") || "0", 10),
          height: parseInt($media.attr("height") || "0", 10),
        });
      }
    }
  });
  return assets;
}

/**
 * 見出しかどうかを判定
 */
function detectHeading($, $el) {
  const text = $el.text().trim();
  if (text.length > 50) return false;

  // 大きなフォントサイズ + strong/bold
  const fontSize = extractFontSize($, $el);
  const hasStrong = $el.find("strong, b").length > 0;
  const hasHeadingColor =
    $el.find('[style*="color: rgb(161, 0, 0)"]').length > 0 ||
    $el.find('[style*="color: rgb(255, 0, 0)"]').length > 0;

  if (fontSize >= 21 && (hasStrong || hasHeadingColor)) return true;
  if ($el.find("h1, h2, h3, h4").length > 0) return true;

  return false;
}

/**
 * フォントサイズを抽出 (最大値)
 */
function extractFontSize($, $el) {
  let maxSize = 0;
  const match = ($el.attr("style") || "").match(/font-size:\s*(\d+)px/);
  if (match) maxSize = parseInt(match[1], 10);

  $el.find("[style*='font-size']").each((_, child) => {
    const m = ($(child).attr("style") || "").match(/font-size:\s*(\d+)px/);
    if (m) maxSize = Math.max(maxSize, parseInt(m[1], 10));
  });
  return maxSize;
}

/**
 * セクション境界を検出
 */
function detectSections(blocks) {
  const sections = [];
  let currentSection = { startIndex: 0, blocks: [], label: "intro" };
  let sectionCount = 0;

  for (const block of blocks) {
    // セクション区切り条件
    const isBoundary =
      block.type === "heading" ||
      (block.type === "widget" && block.widgetType === "flash_text") ||
      (block.type === "cta_link");

    if (isBoundary && currentSection.blocks.length > 0) {
      sections.push({ ...currentSection });
      sectionCount++;
      currentSection = {
        startIndex: block.index,
        blocks: [],
        label: `section_${sectionCount}`,
      };
    }

    currentSection.blocks.push(block.index);
  }

  // 最後のセクション
  if (currentSection.blocks.length > 0) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * HTMLファイルを読み込んで解析、結果をJSONに保存
 */
export async function parseFromFile(htmlPath, outputDir) {
  const html = await readFile(htmlPath, "utf-8");
  const structure = parseHtml(html);

  if (outputDir) {
    const outPath = path.join(outputDir, "structure.json");
    await saveJson(outPath, structure);
    console.log(`[parser] Structure saved: ${outPath}`);
    console.log(`[parser] Blocks: ${structure.blocks.length}`);
    console.log(`[parser] Sections: ${structure.sections.length}`);
    console.log(`[parser] Assets: ${structure.assets.length}`);
    console.log(`[parser] Widgets: ${structure.widgets.length}`);
  }

  return structure;
}

// CLIから直接実行
if (process.argv[1] && process.argv[1].endsWith("parser.js")) {
  const htmlPath = process.argv[2];
  const outputDir = process.argv[3];
  if (!htmlPath) {
    console.error("Usage: node src/parser.js <html-file> [output-dir]");
    process.exit(1);
  }
  parseFromFile(htmlPath, outputDir || path.dirname(htmlPath));
}
