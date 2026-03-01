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

const GEMINI_IMAGE_GEN_MODEL = "gemini-3-pro-image-preview";
const GEMINI_FLASH_MODEL = "gemini-2.5-flash";
const GEMINI_IMAGEN_MODEL = "imagen-3.0-generate-002";

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

// ── Provider router ──

export function getAvailableProviders() {
  const providers = [];
  if (keyRotator.available) providers.push("gemini");
  if (openaiAvailable()) providers.push("openai");
  return providers;
}

// ── describeImage ──

export async function describeImage(imagePath, context = "", provider = "gemini") {
  if (provider === "openai") return describeImageOpenAI(imagePath, context);
  return describeImageGemini(imagePath, context);
}

async function describeImageGemini(imagePath, context = "") {
  const key = keyRotator.getKey();
  const imageData = await readFile(imagePath);
  const base64 = imageData.toString("base64");
  const mimeType = getMimeType(imagePath);

  const prompt = context
    ? `この画像を詳しく説明してください。この画像は以下のテキストの近くに配置されています: "${context}". 画像の内容、構図、色使い、雰囲気を具体的に説明してください。日本語で200文字以内で。`
    : `この画像を詳しく説明してください。内容、構図、色使い、雰囲気を具体的に説明してください。日本語で200文字以内で。`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FLASH_MODEL}:generateContent?key=${key}`;

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
  const provider = options.provider || "gemini";
  if (provider === "openai") return generateImageOpenAI(prompt, options);
  return generateImageGemini(prompt, options);
}

async function generateImageGemini(prompt, options = {}) {
  const key = keyRotator.getKey();
  const outputPath = options.outputPath || `generated_${Date.now()}.png`;
  const width = options.width || 580;
  const height = options.height || 580;

  // 1) Try Imagen 3.0
  const imagenUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGEN_MODEL}:predict?key=${key}`;

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

  // Try gemini-2.5-flash-image (native image gen model)
  for (const model of [GEMINI_IMAGE_GEN_MODEL]) {
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
        continue;
      }

      const data = await resp.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inline_data?.mime_type?.startsWith("image/")) {
          const buffer = Buffer.from(part.inline_data.data, "base64");
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

// ── generateImageFromReference ──

export async function generateImageFromReference(imagePath, options = {}) {
  const provider = options.provider || "gemini";
  if (provider === "openai") return generateImageFromReferenceOpenAI(imagePath, options);
  return generateImageFromReferenceGemini(imagePath, options);
}

async function generateImageFromReferenceGemini(imagePath, options = {}) {
  const key = keyRotator.getKey();
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

  // Try gemini-2.5-flash-image for reference-based generation
  for (const model of [GEMINI_IMAGE_GEN_MODEL]) {
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
        console.warn(`[image-gen] ${model} reference failed: ${resp.status}`);
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

  keyRotator.reportError(key);
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

export async function aiRewriteText(sourceText, instruction, designRequirements = "", provider = "gemini") {
  if (provider === "openai") return aiRewriteTextOpenAI(sourceText, instruction, designRequirements);
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FLASH_MODEL}:generateContent?key=${key}`;
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
        provider: item.provider || options.provider || "gemini",
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
