/**
 * image-generator.js - Gemini / OpenAI 画像生成
 *
 * 元画像の説明 + 周辺テキストからプロンプト生成 → 画像生成 → sharpリサイズ
 * Gemini: 3キーローテーション (GEMINI_API_KEY_1/2/3)
 * OpenAI: OPENAI_API_KEY
 */
import fetch from "node-fetch";
import sharp from "sharp";
import { writeFile, readFile } from "fs/promises";
import path from "path";
import { sleep } from "./utils.js";

// ── 動的モデル発見（ハードコードせず、APIから最新モデルを自動取得） ──
// フォールバック用のみハードコード（API取得が完全失敗した時のみ使用）
const FALLBACK_IMAGE_MODELS = ["gemini-2.5-flash-image", "gemini-3-pro-image-preview"];
const FALLBACK_FLASH_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
const FALLBACK_IMAGEN_MODELS = ["imagen-3.0-generate-002"];

// キャッシュ
let _cachedModels = null;
let _cachedAt = 0;
let _isFallback = false;
const MODEL_CACHE_TTL = 60 * 60 * 1000; // 1時間（成功時）
const FALLBACK_RETRY_TTL = 30 * 1000;   // 30秒（fallback時は早くリトライ）

/**
 * Gemini APIから利用可能なモデル一覧を取得し、用途別に分類
 * → モデル名が変わっても自動追従。期限切れゼロ。
 */
export async function discoverModels(forceRefresh = false) {
  const ttl = _isFallback ? FALLBACK_RETRY_TTL : MODEL_CACHE_TTL;
  if (_cachedModels && !forceRefresh && Date.now() - _cachedAt < ttl) {
    return _cachedModels;
  }

  // グローバルkeyRotatorを使用（envロード後は動く）
  let apiKey;
  try {
    apiKey = keyRotator.getKey();
  } catch {
    console.warn("[model-discovery] No API key available, using fallbacks");
    return _buildFallbackResult();
  }

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!resp.ok) {
      console.warn(`[model-discovery] API returned ${resp.status}, using fallbacks`);
      return _buildFallbackResult();
    }

    const data = await resp.json();
    const allModels = (data.models || []).map(m => m.name.replace("models/", ""));

    // ── 画像生成モデル（"image" を含むgeminiモデル）
    const imageModels = allModels
      .filter(n => n.includes("gemini") && n.includes("image") && !n.includes("tts") && !n.includes("audio"))
      .sort((a, b) => _imageModelPriority(a) - _imageModelPriority(b));

    // ── Flashモデル（テキスト/Vision用、image/tts/audio/lite除外）
    const flashModels = allModels
      .filter(n => n.match(/^gemini-\d.*flash/) && !n.includes("image") && !n.includes("tts") && !n.includes("audio") && !n.includes("lite"))
      .sort((a, b) => _versionScore(b) - _versionScore(a));

    // ── Imagenモデル
    const imagenModels = allModels
      .filter(n => n.startsWith("imagen"))
      .sort((a, b) => _versionScore(b) - _versionScore(a));

    _cachedModels = {
      image: imageModels.length > 0 ? imageModels : FALLBACK_IMAGE_MODELS,
      flash: flashModels.length > 0 ? flashModels.slice(0, 3) : FALLBACK_FLASH_MODELS,
      imagen: imagenModels.length > 0 ? imagenModels.slice(0, 2) : FALLBACK_IMAGEN_MODELS,
      all: allModels,
      discoveredAt: new Date().toISOString(),
    };
    _cachedAt = Date.now();
    _isFallback = false;

    console.log(`[model-discovery] Image models (${imageModels.length}): ${imageModels.join(", ")}`);
    console.log(`[model-discovery] Flash: ${_cachedModels.flash[0]}, Imagen: ${_cachedModels.imagen[0]}`);
    return _cachedModels;
  } catch (err) {
    console.warn(`[model-discovery] Error: ${err.message}, using fallbacks`);
    return _buildFallbackResult();
  }
}

function _buildFallbackResult() {
  _cachedModels = {
    image: FALLBACK_IMAGE_MODELS,
    flash: FALLBACK_FLASH_MODELS,
    imagen: FALLBACK_IMAGEN_MODELS,
    all: [],
    discoveredAt: "fallback",
  };
  _cachedAt = Date.now();
  _isFallback = true; // 30秒後にリトライ
  return _cachedModels;
}

// 画像モデルの優先度（低い方が優先）
function _imageModelPriority(name) {
  let score = 50;
  // 新しいバージョンほど優先
  const ver = name.match(/gemini-(\d+(?:\.\d+)?)/);
  if (ver) score -= parseFloat(ver[1]) * 8;
  // flash-image > pro-image（flashの方が速くて安定）
  if (name.includes("flash")) score -= 5;
  if (name.includes("pro")) score -= 3;
  // preview/exp は少し下げる
  if (name.includes("-exp")) score += 3;
  return score;
}

function _versionScore(name) {
  const m = name.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

// 画像生成モデル一覧を取得
async function getImageModels() {
  const m = await discoverModels();
  return m.image;
}

// Flashモデル名を取得
async function getFlashModel() {
  const m = await discoverModels();
  return m.flash[0];
}

// Imagenモデル名を取得
async function getImagenModel() {
  const m = await discoverModels();
  return m.imagen[0];
}

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
      if (key && key.length >= 10 && !this.disabledKeys.has(key)) this.keys.push(key);
    }
    if (this.keys.length === 0 && process.env.GEMINI_API_KEY) {
      const k = process.env.GEMINI_API_KEY;
      if (!this.disabledKeys.has(k)) this.keys.push(k);
    }
  }

  getKey() {
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

// ── OpenAI helpers ──

function getOpenAIKey() {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("OPENAI_API_KEY が未設定です");
  return k;
}

function openaiAvailable() {
  return !!process.env.OPENAI_API_KEY;
}

// ── PixAI helpers ──

function getPixAIKey() {
  const k = process.env.PIXAI_API_KEY;
  if (!k) throw new Error("PIXAI_API_KEY が未設定です");
  return k;
}

function pixaiAvailable() {
  return !!process.env.PIXAI_API_KEY;
}

// ── Provider router ──

export function getAvailableProviders() {
  const providers = [];
  if (pixaiAvailable()) providers.push("pixai");
  if (keyRotator.available) providers.push("nanobanana");
  if (openaiAvailable()) providers.push("openai");
  return providers;
}

// ── describeImage ──

export async function describeImage(imagePath, context = "", provider = "nanobanana") {
  if (provider === "openai") return describeImageOpenAI(imagePath, context);
  // PixAI/nanobanana has no vision API, use Anthropic if available, then Gemini
  if (provider === "pixai" || provider === "anthropic" || provider === "nanobanana") {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) return describeImageAnthropic(imagePath, context, anthropicKey);
    // fallback to Gemini if no Anthropic key
  }
  return describeImageGemini(imagePath, context);
}

async function describeImageAnthropic(imagePath, context = "", apiKey) {
  const imageData = await readFile(imagePath);
  const base64 = imageData.toString("base64");
  const mimeType = getMimeType(imagePath);
  // Anthropic only supports jpeg, png, gif, webp
  const supportedType = ["image/jpeg","image/png","image/gif","image/webp"].includes(mimeType) ? mimeType : "image/jpeg";

  const prompt = context
    ? `この画像を詳しく説明してください。この画像は以下のテキストの近くに配置されています: "${context}". 画像の内容、構図、色使い、雰囲気を具体的に説明してください。日本語で200文字以内で。`
    : `この画像を詳しく説明してください。内容、構図、色使い、雰囲気を具体的に説明してください。日本語で200文字以内で。`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: supportedType, data: base64 } },
          { type: "text", text: prompt },
        ] }],
      }),
    });
    if (!resp.ok) throw new Error(`Anthropic API error: ${resp.status}`);
    const data = await resp.json();
    return data.content?.[0]?.text || "画像";
  } catch (err) {
    console.warn(`[image-gen] describeImageAnthropic failed: ${err.message}`);
    return "商品関連画像";
  }
}

async function describeImageGemini(imagePath, context = "") {
  const key = keyRotator.getKey();
  const imageData = await readFile(imagePath);
  const base64 = imageData.toString("base64");
  const mimeType = getMimeType(imagePath);

  const prompt = context
    ? `この画像を詳しく説明してください。この画像は以下のテキストの近くに配置されています: "${context}". 画像の内容、構図、色使い、雰囲気を具体的に説明してください。日本語で200文字以内で。`
    : `この画像を詳しく説明してください。内容、構図、色使い、雰囲気を具体的に説明してください。日本語で200文字以内で。`;

  const flashModel = await getFlashModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${flashModel}:generateContent?key=${key}`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
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

async function describeImageOpenAI(imagePath, context = "") {
  const key = getOpenAIKey();
  const imageData = await readFile(imagePath);
  const base64 = imageData.toString("base64");
  const mimeType = getMimeType(imagePath);

  const prompt = context
    ? `この画像を詳しく説明してください。この画像は以下のテキストの近くに配置されています: "${context}". 画像の内容、構図、色使い、雰囲気を具体的に説明してください。日本語で200文字以内で。`
    : `この画像を詳しく説明してください。内容、構図、色使い、雰囲気を具体的に説明してください。日本語で200文字以内で。`;

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
        ] }],
        max_tokens: 300,
      }),
    });

    if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status}`);
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || "画像";
  } catch (err) {
    console.warn(`[image-gen] describeImageOpenAI failed: ${err.message}`);
    return "商品関連画像";
  }
}

// ── buildImagePrompt ──

export function buildImagePrompt(description, context, options = {}) {
  const style = options.style || "photorealistic, high quality, Japanese advertisement style";
  return `Generate an image: ${description}. Context: ${context}. Style: ${style}. The image should look professional and suitable for a Japanese health product advertisement landing page. Do not include any text in the image.`;
}

// ── generateImage ──

export async function generateImage(prompt, options = {}) {
  const provider = options.provider || (pixaiAvailable() ? "pixai" : "nanobanana");
  if (provider === "pixai") return generateImagePixAI(prompt, options);
  if (provider === "openai") return generateImageOpenAI(prompt, options);
  // nanobanana uses Gemini engine
  return generateImageGemini(prompt, options);
}

async function generateImageGemini(prompt, options = {}) {
  const key = keyRotator.getKey();
  const outputPath = options.outputPath || `generated_${Date.now()}.png`;
  const width = options.width || 580;
  const height = options.height || 580;

  // 1) Try Imagen (動的モデル)
  const imagenModel = await getImagenModel();
  const imagenUrl = `https://generativelanguage.googleapis.com/v1beta/models/${imagenModel}:predict?key=${key}`;

  try {
    const resp = await fetch(imagenUrl, {
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
      keyRotator.reportError(key);
      console.warn(`[image-gen] Imagen API failed (${resp.status}), trying Gemini native...`);
      return await generateImageGeminiNative(prompt, { ...options, key: keyRotator.getKey() });
    }

    const data = await resp.json();
    const imageBase64 = data.predictions?.[0]?.bytesBase64Encoded;
    if (!imageBase64) throw new Error("No image data in Imagen response");

    const buffer = Buffer.from(imageBase64, "base64");
    const resized = await sharp(buffer).resize(width, height, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer();
    await writeFile(outputPath, resized);
    console.log(`[image-gen] Generated (Imagen): ${outputPath} (${width}x${height})`);
    return outputPath;
  } catch (err) {
    if (err.message.includes("No image data")) {
      return await generateImageGeminiNative(prompt, { ...options, key: keyRotator.getKey() });
    }
    console.error(`[image-gen] generateImage failed: ${err.message}`);
    throw err;
  }
}

async function generateImageGeminiNative(prompt, options = {}) {
  const key = options.key || keyRotator.getKey();
  const outputPath = options.outputPath || `generated_${Date.now()}.png`;
  const width = options.width || 580;
  const height = options.height || 580;

  // Try multiple models for native image generation
  for (const model of await getImageModels()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      });

      if (!resp.ok) {
        console.warn(`[image-gen] ${model} native failed: ${resp.status}`);
        if (resp.status === 429) return null; // レートリミット → 呼び出し元でリトライ
        continue;
      }

      const data = await resp.json();
      if (data.candidates?.[0]?.finishReason === "SAFETY" || data.promptFeedback?.blockReason) {
        console.warn(`[image-gen] ${model} native blocked: ${data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason}`);
        continue;
      }
      const parts = data.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        const idata = part.inline_data || part.inlineData;
        const imime = idata?.mime_type || idata?.mimeType || "";
        if (imime.startsWith("image/")) {
          const buffer = Buffer.from(idata.data, "base64");
          const resized = await sharp(buffer).resize(width, height, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer();
          await writeFile(outputPath, resized);
          console.log(`[image-gen] Generated (${model} native): ${outputPath}`);
          return outputPath;
        }
      }
    } catch (err) {
      console.warn(`[image-gen] ${model} native error: ${err.message}`);
    }
  }

  keyRotator.reportError(key);
  throw new Error("Gemini image generation failed with all models");
}

async function generateImageOpenAI(prompt, options = {}) {
  const key = getOpenAIKey();
  const outputPath = options.outputPath || `generated_${Date.now()}.png`;
  const width = options.width || 580;
  const height = options.height || 580;

  const size = getDALLESize(width, height);

  try {
    const resp = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt,
        n: 1,
        size,
        quality: "standard",
        response_format: "b64_json",
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`OpenAI DALL-E error: ${resp.status} - ${errText.substring(0, 200)}`);
    }

    const data = await resp.json();
    const imageBase64 = data.data?.[0]?.b64_json;
    if (!imageBase64) throw new Error("No image data in DALL-E response");

    const buffer = Buffer.from(imageBase64, "base64");
    const resized = await sharp(buffer).resize(width, height, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer();
    await writeFile(outputPath, resized);
    console.log(`[image-gen] Generated (DALL-E 3): ${outputPath} (${width}x${height})`);
    return outputPath;
  } catch (err) {
    console.error(`[image-gen] DALL-E generation failed: ${err.message}`);
    throw err;
  }
}

// ── PixAI 画像生成 ──

async function generateImagePixAI(prompt, options = {}) {
  const key = getPixAIKey();
  const outputPath = options.outputPath || `generated_${Date.now()}.png`;
  const width = options.width || 580;
  const height = options.height || 580;

  try {
    // 1) タスク作成
    const createResp = await fetch("https://api.pixai.art/v1/task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        parameters: {
          prompts: prompt,
          modelId: "1648918127446573124",
          width,
          height,
          batchSize: 1,
        },
      }),
    });

    if (!createResp.ok) {
      const errText = await createResp.text();
      throw new Error(`PixAI create task failed: ${createResp.status} - ${errText.substring(0, 200)}`);
    }

    const taskData = await createResp.json();
    const taskId = taskData.id;
    console.log(`[image-gen] PixAI task created: ${taskId}`);

    // 2) ポーリングで完了待ち（最大120秒）
    const maxWait = 120000;
    const interval = 3000;
    let elapsed = 0;

    while (elapsed < maxWait) {
      await sleep(interval);
      elapsed += interval;

      const statusResp = await fetch(`https://api.pixai.art/v1/task/${taskId}`, {
        headers: { Authorization: `Bearer ${key}` },
      });

      if (!statusResp.ok) continue;
      const status = await statusResp.json();

      if (status.status === "failed" || status.status === "cancelled") {
        throw new Error(`PixAI task ${status.status}`);
      }

      if (status.status === "completed") {
        const mediaUrl = status.outputs?.mediaUrls?.[0]?.url;
        if (!mediaUrl) throw new Error("PixAI: No media URL in completed task");

        // 3) 画像ダウンロード → リサイズ → 保存
        const imgResp = await fetch(mediaUrl);
        if (!imgResp.ok) throw new Error(`PixAI image download failed: ${imgResp.status}`);
        const buf = Buffer.from(await imgResp.arrayBuffer());
        const resized = await sharp(buf).resize(width, height, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer();
        await writeFile(outputPath, resized);
        console.log(`[image-gen] Generated (PixAI): ${outputPath} (${width}x${height})`);
        return outputPath;
      }

      console.log(`[image-gen] PixAI task ${taskId}: ${status.status} (${elapsed / 1000}s)`);
    }

    throw new Error("PixAI task timed out after 120s");
  } catch (err) {
    console.error(`[image-gen] PixAI generation failed: ${err.message}`);
    throw err;
  }
}

// ── Veo 3 動画生成 ──

export async function generateVideo(prompt, options = {}) {
  const key = keyRotator.getKey();
  const outputPath = options.outputPath || `generated_${Date.now()}.mp4`;
  const aspectRatio = options.aspectRatio || "16:9";
  const resolution = options.resolution || "720p";
  const duration = options.durationSeconds || "6";

  try {
    // 1) タスク作成
    const url = `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          aspectRatio,
          resolution,
          durationSeconds: duration,
        },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Veo 3 create failed: ${resp.status} - ${errText.substring(0, 300)}`);
    }

    const opData = await resp.json();
    const opName = opData.name;
    console.log(`[video-gen] Veo 3 operation: ${opName}`);

    // 2) ポーリングで完了待ち（最大180秒）
    const baseUrl = "https://generativelanguage.googleapis.com/v1beta";
    const maxWait = 180000;
    const interval = 5000;
    let elapsed = 0;

    while (elapsed < maxWait) {
      await sleep(interval);
      elapsed += interval;

      const statusResp = await fetch(`${baseUrl}/${opName}`, {
        headers: { "x-goog-api-key": key },
      });

      if (!statusResp.ok) continue;
      const statusData = await statusResp.json();

      if (statusData.error) {
        throw new Error(`Veo 3 error: ${statusData.error.message || JSON.stringify(statusData.error)}`);
      }

      if (statusData.done) {
        const videoUri = statusData.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!videoUri) throw new Error("Veo 3: No video URI in response");

        // 3) 動画ダウンロード → 保存
        const dlUrl = `${videoUri}&key=${key}`;
        const vidResp = await fetch(dlUrl);
        if (!vidResp.ok) throw new Error(`Veo 3 download failed: ${vidResp.status}`);
        const buf = Buffer.from(await vidResp.arrayBuffer());
        await writeFile(outputPath, buf);
        console.log(`[video-gen] Generated (Veo 3): ${outputPath}`);
        return outputPath;
      }

      console.log(`[video-gen] Veo 3 operation pending (${elapsed / 1000}s)`);
    }

    throw new Error("Veo 3 task timed out after 180s");
  } catch (err) {
    console.error(`[video-gen] Veo 3 generation failed: ${err.message}`);
    throw err;
  }
}

// ── generateImageFromReference ──

export async function generateImageFromReference(imagePath, options = {}) {
  const provider = options.provider || (pixaiAvailable() ? "pixai" : "nanobanana");
  if (provider === "pixai") {
    // PixAI: 画像説明を取得してプロンプトベースで生成
    let description = "商品関連画像";
    try { description = await describeImage(imagePath); } catch {}
    return generateImagePixAI(description, options);
  }
  if (provider === "openai") return generateImageFromReferenceOpenAI(imagePath, options);
  return generateImageFromReferenceGemini(imagePath, options);
}

async function generateImageFromReferenceGemini(imagePath, options = {}) {
  const outputPath = options.outputPath || `generated_${Date.now()}.jpg`;
  const width = options.width || 580;
  const height = options.height || 580;
  const nuance = options.nuance || "same";
  const style = options.style || "photo";
  const designRequirements = options.designRequirements || "";

  const imageData = await readFile(imagePath);
  const base64 = imageData.toString("base64");
  const mimeType = getMimeType(imagePath);

  const prompt = buildReferencePrompt(nuance, style, options, designRequirements);

  // Try multiple keys × multiple models for reference-based generation
  const triedKeys = new Set();
  for (let attempt = 0; attempt < 3; attempt++) {
    let key;
    try { key = keyRotator.getKey(); } catch { break; }
    if (triedKeys.has(key)) break;
    triedKeys.add(key);

    for (const model of await getImageModels()) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ] }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
          }),
        });

        if (!resp.ok) {
          console.warn(`[image-gen] ${model} reference failed (key ${attempt + 1}): ${resp.status}`);
          if (resp.status === 403 || resp.status === 401) {
            keyRotator.reportError(key);
            break;
          }
          if (resp.status === 429) break; // レートリミット → 次のキー
          continue;
        }

        const data = await resp.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.inline_data?.mime_type?.startsWith("image/")) {
            const buffer = Buffer.from(part.inline_data.data, "base64");
            const resized = await sharp(buffer).resize(width, height, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer();
            await writeFile(outputPath, resized);
            console.log(`[image-gen] Reference-based (${model}): ${outputPath} (${width}x${height}, ${nuance}/${style})`);
            return outputPath;
          }
        }
      } catch (err) {
        console.warn(`[image-gen] ${model} reference error: ${err.message}`);
      }
    }
  }

  throw new Error("Gemini reference-based image generation failed with all models");
}

async function generateImageFromReferenceOpenAI(imagePath, options = {}) {
  const key = getOpenAIKey();
  const outputPath = options.outputPath || `generated_${Date.now()}.jpg`;
  const width = options.width || 580;
  const height = options.height || 580;
  const nuance = options.nuance || "same";
  const style = options.style || "photo";
  const designRequirements = options.designRequirements || "";

  // OpenAI DALL-E 3 does not accept reference images directly,
  // so we first describe the image with GPT-4o, then generate from description
  const imageData = await readFile(imagePath);
  const base64 = imageData.toString("base64");
  const mimeType = getMimeType(imagePath);

  // Step 1: Describe reference image
  const descResp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: [
        { type: "text", text: "この画像を非常に詳しく説明してください。構図、色使い、被写体、背景、雰囲気、スタイルを全て含めて。日本語で500文字以内で。" },
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
      ] }],
      max_tokens: 600,
    }),
  });

  if (!descResp.ok) throw new Error(`OpenAI Vision error: ${descResp.status}`);
  const descData = await descResp.json();
  const description = descData.choices?.[0]?.message?.content || "";

  // Step 2: Build prompt from description + options
  const prompt = buildReferencePrompt(nuance, style, options, designRequirements) + `\n\n参考画像の説明: ${description}`;

  const size = getDALLESize(width, height);

  // Step 3: Generate with DALL-E 3
  const genResp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt: prompt.substring(0, 4000),
      n: 1,
      size,
      quality: "standard",
      response_format: "b64_json",
    }),
  });

  if (!genResp.ok) {
    const errText = await genResp.text();
    throw new Error(`DALL-E error: ${genResp.status} - ${errText.substring(0, 200)}`);
  }

  const genData = await genResp.json();
  const imageBase64 = genData.data?.[0]?.b64_json;
  if (!imageBase64) throw new Error("No image in DALL-E response");

  const buffer = Buffer.from(imageBase64, "base64");
  const resized = await sharp(buffer).resize(width, height, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer();
  await writeFile(outputPath, resized);
  console.log(`[image-gen] Reference-based (DALL-E 3): ${outputPath} (${width}x${height})`);
  return outputPath;
}

// ── AI Text Rewrite ──

export async function aiRewriteText(sourceText, instruction, designRequirements = "", provider = "nanobanana") {
  if (provider === "openai") return aiRewriteTextOpenAI(sourceText, instruction, designRequirements);
  // pixai is image-only, fallback to Gemini for text rewrite
  return aiRewriteTextGemini(sourceText, instruction, designRequirements);
}

async function aiRewriteTextGemini(sourceText, instruction, designRequirements = "") {
  const key = keyRotator.getKey();
  const designContext = designRequirements ? `\nデザイン要件: ${designRequirements}\n上記のトーン・雰囲気に合わせて書き換えてください。` : "";
  const prompt = `以下のテキストを指示に従って書き換えてください。HTMLのインラインスタイル（font-size, color, strong等）は必ず保持してください。書き換え後のテキストのみを返してください。余計な説明は不要です。
${designContext}
指示: ${instruction}

元テキスト:
${sourceText}`;

  const flashModel = await getFlashModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${flashModel}:generateContent?key=${key}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (!resp.ok) {
    keyRotator.reportError(key);
    throw new Error(`Gemini API error: ${resp.status}`);
  }
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function aiRewriteTextOpenAI(sourceText, instruction, designRequirements = "") {
  const key = getOpenAIKey();
  const designContext = designRequirements ? `\nデザイン要件: ${designRequirements}\n上記のトーン・雰囲気に合わせて書き換えてください。` : "";
  const prompt = `以下のテキストを指示に従って書き換えてください。HTMLのインラインスタイル（font-size, color, strong等）は必ず保持してください。書き換え後のテキストのみを返してください。余計な説明は不要です。
${designContext}
指示: ${instruction}

元テキスト:
${sourceText}`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
    }),
  });

  if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

// ── Batch ──

export async function generateBatch(imageList, options = {}) {
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
        provider: item.provider || options.provider || "nanobanana",
      });
      results.push({ ...item, success: true, generatedPath: outputPath });
      console.log(`[image-gen] ${i + 1}/${imageList.length} done`);
    } catch (err) {
      results.push({ ...item, success: false, error: err.message });
      console.warn(`[image-gen] ${i + 1}/${imageList.length} failed: ${err.message}`);
    }

    if (i < imageList.length - 1) await sleep(delayMs);
  }

  const succeeded = results.filter((r) => r.success).length;
  console.log(`[image-gen] Batch done: ${succeeded}/${imageList.length} succeeded`);
  return results;
}

// ── Utility ──

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function getAspectRatio(width, height) {
  const ratio = width / height;
  if (ratio > 1.3) return "16:9";
  if (ratio > 1.1) return "4:3";
  if (ratio < 0.7) return "9:16";
  if (ratio < 0.9) return "3:4";
  return "1:1";
}

function getDALLESize(width, height) {
  const ratio = width / height;
  if (ratio > 1.3) return "1792x1024";
  if (ratio < 0.7) return "1024x1792";
  return "1024x1024";
}

function buildReferencePrompt(nuance, style, options, designRequirements) {
  const nuancePrompts = {
    same: "この画像とほぼ同じ構図・色使い・雰囲気で、細部のみ微細に変更した新しい画像を生成してください。全体的な印象は元画像とほぼ同一にしてください。",
    slight: "この画像のテーマと雰囲気を維持しつつ、構図や色合いに適度な変化を加えた新しい画像を生成してください。元画像の本質は保ちながらも、明確な違いがわかるようにしてください。",
    big: "この画像のコンセプトを参考にしつつ、構図・色使い・表現を大きくリメイクした新しい画像を生成してください。元画像から大胆に変化させてください。",
  };

  const styleModifiers = {
    photo: "写実的な写真スタイルで、高品質な広告写真のように仕上げてください。",
    manga: "日本の漫画風スタイルで、コミック調の表現で仕上げてください。効果線やトーン表現を活用し、漫画LP広告に適した画像にしてください。",
    illustration: "イラスト風のスタイルで、プロのイラストレーターが描いたような仕上がりにしてください。",
    flat: "フラットデザインのスタイルで、シンプルで洗練されたグラフィックに仕上げてください。",
  };

  const customPrompt = options.customPrompt || "";
  const genMode = options.genMode || "similar";
  const designContext = designRequirements ? `\nデザイン要件: ${designRequirements}` : "";
  const customContext = customPrompt ? `\n追加指示: ${customPrompt}` : "";

  let modePrompt;
  if (genMode === "tonmana") {
    modePrompt = "この画像の構図・レイアウト・被写体の配置はそのまま維持してください。色味・トーン・雰囲気（トーン&マナー）だけを変更した画像を生成してください。構図は絶対に変えないでください。";
  } else if (genMode === "new") {
    modePrompt = "この画像のテーマ・用途を参考にしつつ、構図・被写体・背景を全て新しくデザインした、全く新しい画像を生成してください。元画像にとらわれず自由にクリエイティブしてください。";
  } else {
    modePrompt = nuancePrompts[nuance] || nuancePrompts.same;
  }

  return `${modePrompt}\n${styleModifiers[style] || styleModifiers.photo}${designContext}${customContext}\n画像内にテキストや文字は一切含めないでください。日本の商品広告LP用の画像として適切な品質にしてください。`;
}

export function videoToImagePrompt(videoContext) {
  return `Create a still image that represents: ${videoContext}. Style: Japanese advertisement, professional photography, clean layout. No text in the image.`;
}

// ── removeTextFromImage ──

/**
 * 画像からテキストを除去し、背景で埋めたクリーン画像を生成
 * @param {string} imagePath - 元画像のファイルパス
 * @param {object} options - { outputPath, textRegions }
 * @returns {string} クリーン画像のファイルパス
 */
export async function removeTextFromImage(imagePath, options = {}) {
  const outputPath = options.outputPath || `clean_${Date.now()}.jpg`;
  const imageData = await readFile(imagePath);
  const base64 = imageData.toString("base64");
  const mimeType = getMimeType(imagePath);

  // Get original dimensions for output
  const metadata = await sharp(imageData).metadata();
  const width = metadata.width || 580;
  const height = metadata.height || 580;

  const prompt = `この画像に含まれるすべてのテキスト・文字・数字・記号を完全に除去してください。
テキストがあった場所は、周囲の背景パターン・色・テクスチャで自然に埋めてください。
テキスト以外の要素（写真、イラスト、装飾、グラデーション、ロゴマーク等）はそのまま維持してください。
画像の品質・解像度・サイズを維持してください。
文字が一切ない、クリーンな画像を返してください。`;

  const imageModels = await getImageModels();

  // リトライ戦略: 全モデル × 全キー × 最大3ラウンド（429待機あり）
  for (let round = 0; round < 3; round++) {
    if (round > 0) {
      const waitSec = round * 10;
      console.log(`[image-gen] removeText round ${round + 1}: waiting ${waitSec}s for rate limit cooldown...`);
      await sleep(waitSec * 1000);
    }

    for (const model of imageModels) {
      let key;
      try { key = keyRotator.getKey(); } catch { break; }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

      try {
        console.log(`[image-gen] removeText trying ${model} (round ${round + 1})...`);
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ] }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
          }),
        });

        if (!resp.ok) {
          const status = resp.status;
          let errBody = "";
          try { errBody = (await resp.text()).slice(0, 200); } catch {}
          console.warn(`[image-gen] removeText ${model} HTTP ${status}: ${errBody}`);
          if (status === 403 || status === 401) {
            keyRotator.reportError(key);
          }
          // 429/500/503 → 次のモデルを試す（breakしない）
          continue;
        }

        const data = await resp.json();
        // ブロック理由チェック
        if (data.candidates?.[0]?.finishReason === "SAFETY" || data.promptFeedback?.blockReason) {
          console.warn(`[image-gen] removeText ${model} blocked: ${data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason}`);
          continue;
        }
        const parts = data.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.inline_data?.mime_type?.startsWith("image/")) {
            const buffer = Buffer.from(part.inline_data.data, "base64");
            const resized = await sharp(buffer).resize(width, height, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
            await writeFile(outputPath, resized);
            console.log(`[image-gen] Text removed OK (${model}): ${outputPath} (${width}x${height})`);
            return outputPath;
          }
        }
        // 画像なしレスポンス
        const textParts = parts.filter(p => p.text).map(p => p.text.slice(0, 80));
        console.warn(`[image-gen] removeText ${model}: no image in response (${parts.length} parts, text: ${textParts.join("; ") || "none"})`);
      } catch (err) {
        console.warn(`[image-gen] removeText ${model} error: ${err.message}`);
      }
    }
  }

  throw new Error("テキスト除去に失敗（全モデル×全キー）。レートリミットの可能性あり。少し時間をおいて再試行してください。");
}

// ── composeImages ──

/**
 * 2枚の画像をレイアウトに従って1枚に合成
 * @param {string} image1Path - 1枚目の画像パス
 * @param {string} image2Path - 2枚目の画像パス
 * @param {string} layoutId - レイアウトID ("h2", "v2", "l-shape", etc.)
 * @param {object} options - { width, height, outputPath, gap }
 */
export async function composeImages(image1Path, image2Path, layoutId, options = {}) {
  const width = options.width || 580;
  const height = options.height || 580;
  const outputPath = options.outputPath || `composed_${Date.now()}.jpg`;
  const gap = options.gap || 4;

  // Define cell regions based on layout
  const regions = getLayoutRegions(layoutId, width, height, gap);

  // Resize each image to fit its cell, then composite
  const composites = [];
  const images = [image1Path, image2Path];

  for (let i = 0; i < Math.min(regions.length, images.length); i++) {
    const r = regions[i];
    const resized = await sharp(images[i])
      .resize(r.width, r.height, { fit: "cover" })
      .toBuffer();
    composites.push({ input: resized, left: r.left, top: r.top });
  }

  // Create base canvas and composite images
  const canvas = sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  }).jpeg({ quality: 90 });

  const result = await canvas.composite(composites).toBuffer();
  await writeFile(outputPath, result);
  return outputPath;
}

function getLayoutRegions(layoutId, w, h, gap) {
  const halfW = Math.floor((w - gap) / 2);
  const halfH = Math.floor((h - gap) / 2);

  switch (layoutId) {
    case "h2": // 横2分割
      return [
        { left: 0, top: 0, width: halfW, height: h },
        { left: halfW + gap, top: 0, width: w - halfW - gap, height: h },
      ];
    case "v2": // 縦2分割
      return [
        { left: 0, top: 0, width: w, height: halfH },
        { left: 0, top: halfH + gap, width: w, height: h - halfH - gap },
      ];
    case "l-shape": // L字型: 上が大きく、下が2分割
      return [
        { left: 0, top: 0, width: w, height: halfH },
        { left: 0, top: halfH + gap, width: halfW, height: h - halfH - gap },
      ];
    case "l-shape-r": // 逆L字型: 上が2分割、下が大きい
      return [
        { left: 0, top: 0, width: halfW, height: halfH },
        { left: 0, top: halfH + gap, width: w, height: h - halfH - gap },
      ];
    case "big-left": // 大左+小右
      return [
        { left: 0, top: 0, width: Math.floor(w * 2 / 3), height: h },
        { left: Math.floor(w * 2 / 3) + gap, top: 0, width: w - Math.floor(w * 2 / 3) - gap, height: h },
      ];
    case "big-right": // 大右+小左
      return [
        { left: 0, top: 0, width: Math.floor(w / 3), height: h },
        { left: Math.floor(w / 3) + gap, top: 0, width: w - Math.floor(w / 3) - gap, height: h },
      ];
    case "manga3": // 漫画3コマ (2 images: top-left big, bottom strip)
      return [
        { left: 0, top: 0, width: w, height: halfH },
        { left: 0, top: halfH + gap, width: w, height: h - halfH - gap },
      ];
    case "diagonal": // 斜め2分割 (approximate with left/right)
      return [
        { left: 0, top: 0, width: halfW, height: h },
        { left: halfW + gap, top: 0, width: w - halfW - gap, height: h },
      ];
    default: // fallback: 横2分割
      return [
        { left: 0, top: 0, width: halfW, height: h },
        { left: halfW + gap, top: 0, width: w - halfW - gap, height: h },
      ];
  }
}
