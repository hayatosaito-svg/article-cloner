/**
 * text-modifier.js - テキスト差し替えエンジン
 *
 * 3段階の差し替え:
 *   Level 1: 直接置換（商品名、成分名、価格、会社名）
 *   Level 2: フレーズ書き換え（Claude経由でトーン維持）
 *   Level 3: スタイル完全保持（inline style, font-size, color, bold等）
 *
 * Cheerioのテキストノードのみ操作し、HTML構造は不変。
 */
import * as cheerio from "cheerio";

/**
 * replacement-config.json のスキーマ:
 * {
 *   "directReplacements": {
 *     "旧商品名": "新商品名",
 *     "旧会社名": "新会社名",
 *     "旧価格": "新価格"
 *   },
 *   "phraseRewrites": [
 *     { "original": "元のフレーズ", "rewritten": "書き換え後" }
 *   ],
 *   "ctaUrl": "https://new-cta-url.com/...",
 *   "excludeSelectors": [".small", "font[color='#888888']"]
 * }
 */

/**
 * HTMLにテキスト差し替えを適用
 * @param {string} html - 元のHTML文字列
 * @param {object} config - replacement-config
 * @returns {string} 差し替え後のHTML
 */
export function applyTextModifications(html, config) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const directReplacements = config.directReplacements || {};
  const phraseRewrites = config.phraseRewrites || [];
  const excludeSelectors = config.excludeSelectors || [];

  // Level 1: 直接置換 - テキストノードを走査
  walkTextNodes($, $.root(), (textNode) => {
    // 除外セレクタチェック
    const $parent = $(textNode).parent();
    for (const sel of excludeSelectors) {
      if ($parent.closest(sel).length > 0) return;
    }

    let text = $(textNode).text();
    let changed = false;

    for (const [oldText, newText] of Object.entries(directReplacements)) {
      if (text.includes(oldText)) {
        text = text.split(oldText).join(newText);
        changed = true;
      }
    }

    if (changed) {
      $(textNode).replaceWith(text);
    }
  });

  // Level 2: フレーズ書き換え - HTML全体で検索置換
  let resultHtml = $.html();
  for (const { original, rewritten } of phraseRewrites) {
    if (original && rewritten) {
      resultHtml = resultHtml.split(original).join(rewritten);
    }
  }

  // Level 3: CTA URL差し替え
  if (config.ctaUrl) {
    const $2 = cheerio.load(resultHtml, { decodeEntities: false });
    $2("a[href]").each((_, el) => {
      const $a = $2(el);
      const href = $a.attr("href") || "";
      // 外部CTAリンクのみ差し替え（フッターリンク等は除外）
      if (isCtaLink(href, $a, $2)) {
        $a.attr("href", config.ctaUrl);
      }
    });
    resultHtml = $2.html();
  }

  return resultHtml;
}

/**
 * テキストノードを再帰的に走査
 */
function walkTextNodes($, $root, callback) {
  $root.contents().each((_, node) => {
    if (node.type === "text") {
      const text = $(node).text().trim();
      if (text.length > 0) {
        callback(node);
      }
    } else if (node.type === "tag") {
      const tagName = node.tagName?.toLowerCase();
      // style/script内のテキストは触らない
      if (tagName !== "style" && tagName !== "script") {
        walkTextNodes($, $(node), callback);
      }
    }
  });
}

/**
 * CTAリンクかどうかを判定
 */
function isCtaLink(href, $a, $) {
  // フッターの法的リンクは除外
  const footerKeywords = [
    "law_info",
    "privacy",
    "company",
    "aboutus",
    "特定商取引",
    "プライバシー",
    "企業情報",
    "運営者情報",
  ];
  for (const kw of footerKeywords) {
    if (href.includes(kw)) return false;
    if ($a.text().includes(kw)) return false;
  }

  // 画像を含むリンクはCTAの可能性が高い
  if ($a.find("img, picture").length > 0) return true;

  // font-size: 10px 程度の小さいリンクはフッター扱い
  const style = $a.attr("style") || "";
  const sizeMatch = style.match(/font-size:\s*(\d+)px/);
  if (sizeMatch && parseInt(sizeMatch[1], 10) <= 12) return false;

  return true;
}

/**
 * 構造を分析して差し替え候補を自動検出
 * @param {string} html - 元のHTML
 * @returns {object} 検出した要素のサマリー
 */
export function analyzeForReplacement(html) {
  const $ = cheerio.load(html, { decodeEntities: false });

  // テキスト頻度分析
  const textFrequency = {};
  walkTextNodes($, $.root(), (textNode) => {
    const text = $(textNode).text().trim();
    if (text.length >= 2 && text.length <= 30) {
      textFrequency[text] = (textFrequency[text] || 0) + 1;
    }
  });

  // 頻出語（商品名等の候補）
  const frequentTerms = Object.entries(textFrequency)
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([term, count]) => ({ term, count }));

  // CTAリンク抽出
  const ctaLinks = [];
  $("a[href]").each((_, el) => {
    const $a = $(el);
    const href = $a.attr("href") || "";
    if (isCtaLink(href, $a, $)) {
      ctaLinks.push({ href, text: $a.text().trim().slice(0, 50) });
    }
  });

  // 価格パターン検出
  const prices = [];
  const pricePattern = /[\d,]+円|¥[\d,]+|\d+,\d{3}/g;
  const bodyText = $.text();
  let match;
  while ((match = pricePattern.exec(bodyText)) !== null) {
    if (!prices.includes(match[0])) prices.push(match[0]);
  }

  return { frequentTerms, ctaLinks, prices };
}

/**
 * ブロック個別のテキスト差し替えを適用
 * @param {Array} blocks - ブロック配列
 * @param {Array} blockReplacements - [{ index, newText }]
 * @returns {Array} 更新されたブロック配列
 */
export function applyBlockReplacements(blocks, blockReplacements) {
  const replacementMap = new Map();
  for (const r of blockReplacements) {
    replacementMap.set(r.index, r.newText);
  }

  return blocks.map((block) => {
    if (!replacementMap.has(block.index)) return block;
    const newText = replacementMap.get(block.index);
    if (!newText || newText === block.text) return block;

    const $ = cheerio.load(block.html, { decodeEntities: false });

    // Replace text content while preserving HTML structure
    walkTextNodes($, $.root(), (textNode) => {
      const oldText = $(textNode).text().trim();
      if (oldText.length > 0 && block.text && block.text.includes(oldText)) {
        // Find corresponding portion in newText
        const startIdx = block.text.indexOf(oldText);
        if (startIdx >= 0) {
          // Simple approach: if the entire text matches, replace completely
          if (oldText === block.text.trim()) {
            $(textNode).replaceWith(newText.trim());
          }
        }
      }
    });

    // If walking didn't work well, fallback to simple replacement
    let resultHtml = $.html();
    if (block.text && resultHtml.includes(block.text)) {
      resultHtml = resultHtml.split(block.text).join(newText);
    }

    return {
      ...block,
      html: resultHtml,
      text: newText,
    };
  });
}

/**
 * replacement-configのテンプレートを生成
 */
export function generateConfigTemplate(analysis) {
  return {
    directReplacements: Object.fromEntries(
      analysis.frequentTerms.slice(0, 5).map((t) => [t.term, `【${t.term}の差し替え先】`])
    ),
    phraseRewrites: [],
    ctaUrl: analysis.ctaLinks[0]?.href || "https://example.com/lp",
    excludeSelectors: [".small", "font[color='#888888']"],
  };
}
