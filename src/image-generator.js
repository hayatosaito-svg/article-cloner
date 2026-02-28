/**
 * image-generator.js - Gemini API画像生成
 *
 * 元画像の説明 + 周辺テキストからプロンプト生成 → Gemini画像生成 → sharpリサイズ
 * 3キーローテーション (GEMINI_API_KEY_1/2/3)
 * 動画 → 静止画代替
 */
import fetch from "node-fetch";
import sharp from "sharp";
import { writeFile, readFile } from "fs/promises";
import path from "path";
import { sleep } from "./utils.js";

const GEMINI_MODEL = "gemini-2.0-flash-exp";
const GEMINI_IMAGE_MODEL = "imagen-3.0-generate-002";

/**
 * Gemini APIキーをローテーション（遅延読み込み対応）
 */
class KeyRotator {
  constructor() {
    this.keys = [];
    this.index = 0;
    this.errorCounts = new Map();
    this.disabledKeys = new Set();
  }

  _loadKeys() {
    this.keys = [];
    for (let i = 1; i <= 3; i++) {
      const key = process.env[`GEMINI_API_KEY_${i}`];
      if (key && !this.disabledKeys.has(key)) this.keys.push(key);
    }
    if (this.keys.length === 0 && process.env.GEMINI_API_KEY) {
      const k = process.env.GEMINI_API_KEY;
      if (!this.disabledKeys.has(k)) this.keys.push(k);
    }
  }

  getKey() {
    // 毎回envから再読み込み（起動後にキーが追加されるケースに対応）
    this._loadKeys();
    if (this.keys.length === 0) {
      throw new Error(
        "No GEMINI_API_KEY set. Set GEMINI_API_KEY_1, GEMINI_API_KEY_2, GEMINI_API_KEY_3"
      );
    }
    const key = this.keys[this.index % this.keys.length];
    this.index++;
    return key;
  }

  reportError(key) {
    const count = (this.errorCounts.get(key) || 0) + 1;
    this.errorCounts.set(key, count);
    if (count >= 3) {
      this.disabledKeys.add(key);
      this.keys = this.keys.filter((k) => k !== key);
      console.warn(`[image-gen] Key removed due to errors. Remaining: ${this.keys.length}`);
    }
  }

  get available() {
    this._loadKeys();
    return this.keys.length > 0;
  }
}

const keyRotator = new KeyRotator();

/**
 * Gemini APIで画像の説明を生成（元画像解析用）
 * @param {string} imagePath - ローカル画像パス
 * @param {string} context - 周辺テキスト
 * @returns {Promise<string>} 画像説明文
 */
export async function describeImage(imagePath, context = "") {
  const key = keyRotator.getKey();
  const imageData = await readFile(imagePath);
  const base64 = imageData.toString("base64");
  const ext = path.extname(imagePath).toLowerCase().replace(".", "");
  const mimeType =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : "image/jpeg";

  const prompt = context
    ? `この画像を詳しく説明してください。この画像は以下のテキストの近くに配置されています: "${context}". 画像の内容、構図、色使い、雰囲気を具体的に説明してください。日本語で200文字以内で。`
    : `この画像を詳しく説明してください。内容、構図、色使い、雰囲気を具体的に説明してください。日本語で200文字以内で。`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      keyRotator.reportError(key);
      throw new Error(`Gemini API error: ${resp.status}`);
    }

    const data = await resp.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "画像";
  } catch (err) {
    console.warn(`[image-gen] describeImage failed: ${err.message}`);
    return "商品関連画像";
  }
}

/**
 * 画像生成プロンプトを作成
 * @param {string} description - 元画像の説明
 * @param {string} context - 周辺テキスト
 * @param {object} options - { width, height, style }
 * @returns {string} 生成用プロンプト
 */
export function buildImagePrompt(description, context, options = {}) {
  const style = options.style || "photorealistic, high quality, Japanese advertisement style";
  return `Generate an image: ${description}. Context: ${context}. Style: ${style}. The image should look professional and suitable for a Japanese health product advertisement landing page. Do not include any text in the image.`;
}

/**
 * Gemini Imagen APIで画像を生成
 * @param {string} prompt - 生成プロンプト
 * @param {object} options - { width, height, outputPath }
 * @returns {Promise<string>} 保存先パス
 */
export async function generateImage(prompt, options = {}) {
  const key = keyRotator.getKey();
  const outputPath = options.outputPath || `generated_${Date.now()}.png`;
  const width = options.width || 580;
  const height = options.height || 580;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:predict?key=${key}`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: getAspectRatio(width, height),
          safetyFilterLevel: "block_few",
        },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      keyRotator.reportError(key);

      // Imagen APIが利用できない場合、Gemini 2.0のネイティブ画像生成にフォールバック
      console.warn(`[image-gen] Imagen API failed (${resp.status}), trying Gemini native...`);
      return await generateImageNative(prompt, { ...options, key: keyRotator.getKey() });
    }

    const data = await resp.json();
    const imageBase64 = data.predictions?.[0]?.bytesBase64Encoded;

    if (!imageBase64) {
      throw new Error("No image data in response");
    }

    // sharpでリサイズ
    const buffer = Buffer.from(imageBase64, "base64");
    const resized = await sharp(buffer)
      .resize(width, height, { fit: "cover" })
      .jpeg({ quality: 85 })
      .toBuffer();

    await writeFile(outputPath, resized);
    console.log(`[image-gen] Generated: ${outputPath} (${width}x${height})`);
    return outputPath;
  } catch (err) {
    console.error(`[image-gen] generateImage failed: ${err.message}`);
    throw err;
  }
}

/**
 * Gemini 2.0ネイティブ画像生成（フォールバック）
 */
async function generateImageNative(prompt, options = {}) {
  const key = options.key || keyRotator.getKey();
  const outputPath = options.outputPath || `generated_${Date.now()}.png`;
  const width = options.width || 580;
  const height = options.height || 580;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    }),
  });

  if (!resp.ok) {
    keyRotator.reportError(key);
    throw new Error(`Gemini native image gen failed: ${resp.status}`);
  }

  const data = await resp.json();

  // レスポンスから画像データを探す
  const parts = data.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inline_data?.mime_type?.startsWith("image/")) {
      const buffer = Buffer.from(part.inline_data.data, "base64");
      const resized = await sharp(buffer)
        .resize(width, height, { fit: "cover" })
        .jpeg({ quality: 85 })
        .toBuffer();

      await writeFile(outputPath, resized);
      console.log(`[image-gen] Generated (native): ${outputPath}`);
      return outputPath;
    }
  }

  throw new Error("No image data in Gemini native response");
}

/**
 * アスペクト比を計算
 */
function getAspectRatio(width, height) {
  const ratio = width / height;
  if (ratio > 1.3) return "16:9";
  if (ratio > 1.1) return "4:3";
  if (ratio < 0.7) return "9:16";
  if (ratio < 0.9) return "3:4";
  return "1:1";
}

/**
 * 一括画像生成
 * @param {Array} imageList - [{ prompt, width, height, outputPath, originalSrc }]
 * @param {object} options - { concurrency, delayMs }
 * @returns {Promise<Array>} 生成結果
 */
export async function generateBatch(imageList, options = {}) {
  const concurrency = options.concurrency || 1;
  const delayMs = options.delayMs || 2000;
  const results = [];

  console.log(`[image-gen] Generating ${imageList.length} images...`);

  for (let i = 0; i < imageList.length; i++) {
    const item = imageList[i];
    try {
      const outputPath = await generateImage(item.prompt, {
        width: item.width,
        height: item.height,
        outputPath: item.outputPath,
      });
      results.push({
        ...item,
        success: true,
        generatedPath: outputPath,
      });
      console.log(`[image-gen] ${i + 1}/${imageList.length} done`);
    } catch (err) {
      results.push({
        ...item,
        success: false,
        error: err.message,
      });
      console.warn(`[image-gen] ${i + 1}/${imageList.length} failed: ${err.message}`);
    }

    // レート制限回避
    if (i < imageList.length - 1) {
      await sleep(delayMs);
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  console.log(
    `[image-gen] Batch done: ${succeeded}/${imageList.length} succeeded`
  );

  return results;
}

/**
 * 元画像を参照してGeminiで類似画像を生成（ワンクリック画像差し替え）
 * @param {string} imagePath - 元画像のローカルパス
 * @param {object} options - { nuance, style, width, height, outputPath }
 * @returns {Promise<string>} 保存先パス
 */
export async function generateImageFromReference(imagePath, options = {}) {
  const key = keyRotator.getKey();
  const outputPath = options.outputPath || `generated_${Date.now()}.jpg`;
  const width = options.width || 580;
  const height = options.height || 580;
  const nuance = options.nuance || "same";
  const style = options.style || "photo";

  // 元画像をbase64エンコード
  const imageData = await readFile(imagePath);
  const base64 = imageData.toString("base64");
  const ext = path.extname(imagePath).toLowerCase().replace(".", "");
  const mimeType =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : "image/jpeg";

  // ニュアンス別プロンプト
  const nuancePrompts = {
    same: "この画像とほぼ同じ構図・色使い・雰囲気で、細部のみ微細に変更した新しい画像を生成してください。全体的な印象は元画像とほぼ同一にしてください。",
    slight: "この画像のテーマと雰囲気を維持しつつ、構図や色合いに適度な変化を加えた新しい画像を生成してください。元画像の本質は保ちながらも、明確な違いがわかるようにしてください。",
    big: "この画像のコンセプトを参考にしつつ、構図・色使い・表現を大きくリメイクした新しい画像を生成してください。元画像から大胆に変化させてください。",
  };

  // スタイル修飾子
  const styleModifiers = {
    photo: "写実的な写真スタイルで、高品質な広告写真のように仕上げてください。",
    illustration: "イラスト風のスタイルで、プロのイラストレーターが描いたような仕上がりにしてください。",
    flat: "フラットデザインのスタイルで、シンプルで洗練されたグラフィックに仕上げてください。",
  };

  const prompt = `${nuancePrompts[nuance] || nuancePrompts.same}\n${styleModifiers[style] || styleModifiers.photo}\n画像内にテキストや文字は一切含めないでください。日本の商品広告LP用の画像として適切な品質にしてください。`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["IMAGE"],
        },
      }),
    });

    if (!resp.ok) {
      keyRotator.reportError(key);
      throw new Error(`Gemini API error: ${resp.status}`);
    }

    const data = await resp.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inline_data?.mime_type?.startsWith("image/")) {
        const buffer = Buffer.from(part.inline_data.data, "base64");
        const resized = await sharp(buffer)
          .resize(width, height, { fit: "cover" })
          .jpeg({ quality: 85 })
          .toBuffer();

        await writeFile(outputPath, resized);
        console.log(`[image-gen] Reference-based: ${outputPath} (${width}x${height}, ${nuance}/${style})`);
        return outputPath;
      }
    }

    throw new Error("No image data in Gemini response");
  } catch (err) {
    console.error(`[image-gen] generateImageFromReference failed: ${err.message}`);
    throw err;
  }
}

/**
 * 動画→静止画代替のプロンプト生成
 */
export function videoToImagePrompt(videoContext) {
  return `Create a still image that represents: ${videoContext}. Style: Japanese advertisement, professional photography, clean layout. No text in the image.`;
}
