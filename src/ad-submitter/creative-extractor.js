/**
 * creative-extractor.js - プロジェクトブロックからクリエイティブ素材を抽出
 *
 * ブロック構造を解析し、各媒体に必要な見出し/説明文/画像を自動抽出する。
 * 将来的にバナー自動生成との連携を前提としたインターフェースで設計。
 */
import { existsSync } from "fs";
import path from "path";

/**
 * プロジェクトのブロックからクリエイティブ素材を抽出
 * @param {Object} project - プロジェクトオブジェクト
 * @returns {Object} - 媒体別に整形されたクリエイティブデータ
 */
export function extractCreatives(project) {
  const blocks = project.blocks || [];
  const assets = project.assets || [];

  // テキスト抽出
  const headings = [];
  const texts = [];
  const ctaTexts = [];
  const images = [];

  for (const block of blocks) {
    if (block.type === "fv" || block.type === "heading") {
      const clean = stripHtml(block.text || block.html || "").trim();
      if (clean.length > 0 && clean.length <= 90) {
        headings.push(clean);
      }
    }

    if (block.type === "text") {
      const clean = stripHtml(block.text || block.html || "").trim();
      if (clean.length > 10 && clean.length <= 200) {
        texts.push(clean);
      }
    }

    if (block.type === "cta_link") {
      const btnText = extractButtonText(block.html || "");
      if (btnText) ctaTexts.push(btnText);
    }

    if (block.type === "image" || block.type === "fv") {
      const imgPaths = extractImagePaths(block, project);
      images.push(...imgPaths);
    }
  }

  // 重複除去
  const uniqueHeadings = [...new Set(headings)];
  const uniqueTexts = [...new Set(texts)];

  return {
    // 生テキスト
    raw: {
      headings: uniqueHeadings,
      texts: uniqueTexts,
      ctaTexts: [...new Set(ctaTexts)],
      images,
    },
    // Google Ads用
    google: formatForGoogle(uniqueHeadings, uniqueTexts),
    // Meta用
    meta: formatForMeta(uniqueHeadings, uniqueTexts),
    // TikTok用
    tiktok: formatForTikTok(uniqueHeadings, uniqueTexts),
  };
}

/** Google Ads RSA用に見出し(30字)・説明文(90字)を整形 */
function formatForGoogle(headings, texts) {
  // 見出し: 30文字以内に切る、最低3つ
  const headlines = headings
    .map((h) => truncate(h, 30))
    .filter((h) => h.length >= 2)
    .slice(0, 15);

  // 足りない場合はテキストから生成
  if (headlines.length < 3) {
    for (const t of texts) {
      if (headlines.length >= 3) break;
      const short = truncate(t, 30);
      if (short.length >= 2 && !headlines.includes(short)) {
        headlines.push(short);
      }
    }
  }

  // 説明文: 90文字以内、最低2つ
  const descriptions = texts
    .map((t) => truncate(t, 90))
    .filter((d) => d.length >= 10)
    .slice(0, 4);

  return { headlines, descriptions };
}

/** Meta用に見出し(40字)・メインテキスト(125字)・説明文(30字)を整形 */
function formatForMeta(headings, texts) {
  const headline = truncate(headings[0] || "", 40);
  const primaryText = truncate(texts[0] || "", 125);
  const description = truncate(texts[1] || headings[1] || "", 30);

  return { headline, primaryText, description };
}

/** TikTok用に広告文(100字)を整形 */
function formatForTikTok(headings, texts) {
  const adText = truncate(headings[0] || texts[0] || "", 100);
  return { adText };
}

/** HTMLタグ除去 */
function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** 文字列を指定文字数で切り詰め */
function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

/** ボタンテキストを抽出 */
function extractButtonText(html) {
  // <a> or <button> 内テキスト
  const match = html.match(/<(?:a|button)[^>]*>([^<]+)<\/(?:a|button)>/i);
  if (match) return match[1].trim();

  // alt属性
  const altMatch = html.match(/alt=["']([^"']+)["']/i);
  if (altMatch) return altMatch[1].trim();

  return null;
}

/** ブロックから画像パスを抽出 */
function extractImagePaths(block, project) {
  const paths = [];
  const html = block.html || "";

  // data-srcset, data-src, src から画像パスを取得
  const urlPatterns = [
    /data-srcset=["']([^"']+)["']/gi,
    /data-src=["']([^"']+)["']/gi,
    /src=["']([^"']+)["']/gi,
  ];

  for (const pattern of urlPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const url = match[1];
      if (url.match(/\.(jpg|jpeg|png|webp|gif)/i)) {
        // ローカルアセットパスに変換
        if (project.dirs?.assets) {
          const filename = path.basename(url);
          const localPath = path.join(project.dirs.assets, filename);
          if (existsSync(localPath)) {
            paths.push(localPath);
            continue;
          }
        }
        paths.push(url);
      }
    }
  }

  return [...new Set(paths)];
}

/**
 * クリエイティブのプレビューデータを生成（ドライラン用）
 */
export function generatePreview(template, creatives, lpUrl) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const nameVars = { ...template.naming.variables, date: dateStr };
  const preview = { platforms: {} };

  for (const platform of template.platforms) {
    const campaignName = resolveName(template.naming.campaignPattern, { ...nameVars, platform });
    const adGroupName = resolveName(template.naming.adGroupPattern, {
      ...nameVars,
      platform,
      targeting: `${template.targeting.ageMin}-${template.targeting.ageMax}`,
    });

    const platformCreative = creatives[platform] || {};

    preview.platforms[platform] = {
      campaignName,
      adGroupName,
      budget: template.budget[platform],
      targeting: {
        ageRange: `${template.targeting.ageMin}-${template.targeting.ageMax}`,
        gender: template.targeting.gender,
        locations: template.targeting.locations,
      },
      schedule: template.schedule,
      creative: platformCreative,
      lpUrl,
    };
  }

  return preview;
}

function resolveName(pattern, variables) {
  let name = pattern;
  for (const [key, val] of Object.entries(variables)) {
    name = name.replace(new RegExp(`\\{${key}\\}`, "g"), val || "");
  }
  return name;
}
