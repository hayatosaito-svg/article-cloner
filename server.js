/**
 * server.js - Express API + SSE + Project State Management
 *
 * 既存モジュール(scraper, parser, text-modifier, image-generator, html-builder)を
 * REST API で公開。プロジェクト状態は in-memory Map で管理。
 */
import express from "express";
import path from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import fetch from "node-fetch";
import { scrape } from "./src/scraper.js";
import { parseHtml } from "./src/parser.js";
import { applyTextModifications, analyzeForReplacement, applyBlockReplacements } from "./src/text-modifier.js";
import { describeImage, generateImage, generateImageFromReference, generateVideo, buildImagePrompt, aiRewriteText, getAvailableProviders, composeImages } from "./src/image-generator.js";
import { buildSbHtml, validateSbHtml } from "./src/html-builder.js";
import {
  PROJECT_ROOT, SCRAPED_DIR, ANALYSIS_DIR, IMAGES_DIR, FINAL_DIR,
  initOutputDirs, urlToSlug, saveJson, loadJson, formatBytes,
} from "./src/utils.js";
import { createAdRoutes } from "./src/ad-submitter/ad-routes.js";

// API key is set via .env or UI (no hardcoded default)

// Load .env if present
try {
  const envPath = path.join(PROJECT_ROOT, ".env");
  if (existsSync(envPath)) {
    const envContent = await readFile(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
} catch {}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(PROJECT_ROOT, "public")));

// ── AI Usage Counter ──────────────────────────────────────
const apiUsage = {};
function trackAiUsage(endpoint) {
  apiUsage[endpoint] = (apiUsage[endpoint] || 0) + 1;
}

// ── Project Store ──────────────────────────────────────────
const projects = new Map();
const PROJECT_TTL = 24 * 60 * 60 * 1000; // 24h
const PROJECTS_DB = path.join(PROJECT_ROOT, "output", "projects.json");

// プロジェクト永続化: 起動時にロード
async function loadProjectsFromDisk() {
  try {
    if (existsSync(PROJECTS_DB)) {
      const data = JSON.parse(await readFile(PROJECTS_DB, "utf-8"));
      for (const [id, p] of Object.entries(data)) {
        // SSEクライアントとlogはメモリのみ
        p.sseClients = [];
        p.log = p.log || [];
        // 未完了のスクレイピングは復帰不可
        if (p.status === "scraping" || p.status === "parsing") {
          p.status = "error";
          p.error = "サーバー再起動により中断されました";
        }
        projects.set(id, p);
      }
      console.log(`[server] ${projects.size} プロジェクトを復元しました`);
    }
  } catch (err) {
    console.error("[server] プロジェクト復元エラー:", err.message);
  }
}

// プロジェクト永続化: ディスクに保存
let _saveTimer = null;
function saveProjectsToDisk() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      const data = {};
      for (const [id, p] of projects) {
        // sseClientsはシリアライズ不可、除外
        const { sseClients, ...serializable } = p;
        data[id] = serializable;
      }
      await mkdir(path.dirname(PROJECTS_DB), { recursive: true });
      await writeFile(PROJECTS_DB, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("[server] プロジェクト保存エラー:", err.message);
    }
  }, 1000); // 1秒デバウンス
}

await loadProjectsFromDisk();

function createProject(id, url) {
  const project = {
    id,
    url,
    slug: urlToSlug(url),
    status: "scraping",
    html: null,
    modifiedHtml: null,
    blocks: [],
    sections: [],
    assets: [],
    widgets: [],
    analysis: null,
    dirs: null,
    buildResult: null,
    validation: null,
    error: null,
    sseClients: [],
    log: [],
    createdAt: Date.now(),
    tagSettings: {
      headTags: "",
      bodyTags: "",
      noindex: false,
      jsHead: "",
      jsBody: "",
      masterCss: 'body {\n  font-size: 16px;\n  font-family: "ヒラギノ角ゴ Pro", "Hiragino Kaku Gothic Pro", "メイリオ", Meiryo, sans-serif;\n  color: #333;\n  line-height: 1.8;\n  margin: 0;\n  padding: 0;\n}',
    },
    exitPopup: {
      enabled: false,
      trigger: "mouseout",
      mobileScrollUp: true,
      showOnce: true,
      minDelaySec: 5,
      template: "simple",
      content: { title: "ちょっと待ってください！", body: "今だけの特別オファーをご用意しています。", imageUrl: "", ctaText: "オファーを見る", ctaLink: "", declineText: "いいえ、結構です" },
      style: { bgColor: "#ffffff", buttonColor: "#ec4899", overlayColor: "rgba(0,0,0,0.6)", borderRadius: "12", animation: "fadeIn" },
      customHtml: "",
      customCss: "",
    },
  };
  projects.set(id, project);
  saveProjectsToDisk();
  return project;
}

function sendSSE(project, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  project.log.push({ event, data, time: Date.now() });
  const alive = [];
  for (const res of project.sseClients) {
    try { res.write(msg); alive.push(res); } catch { /* dead client */ }
  }
  project.sseClients = alive;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Cleanup expired projects every hour
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of projects) {
    if (now - p.createdAt > PROJECT_TTL) {
      p.sseClients.forEach((c) => { try { c.end(); } catch {} });
      projects.delete(id);
    }
  }
}, 60 * 60 * 1000);

// Path traversal guard
function safePath(base, file) {
  const resolved = path.resolve(base, file);
  if (!resolved.startsWith(path.resolve(base))) return null;
  return resolved;
}

// Build asset URL map: originalUrl -> /api/projects/:id/assets/:localFile
function buildAssetUrlMap(project) {
  const map = {};
  for (const a of project.assets) {
    map[a.originalUrl] = `/api/projects/${project.id}/assets/${a.localFile}`;
  }
  return map;
}

// Rewrite asset URLs in HTML for preview
function rewriteAssetsForPreview(html, project) {
  let result = html;
  for (const a of project.assets) {
    if (a.originalUrl) {
      result = result.split(a.originalUrl).join(`/api/projects/${project.id}/assets/${a.localFile}`);
    }
  }
  return result;
}

// ── API Routes ─────────────────────────────────────────────

// GET /api/projects - List all projects (for restore)
app.get("/api/projects", (req, res) => {
  const list = [];
  for (const [id, p] of projects) {
    list.push({
      id,
      url: p.url,
      slug: p.slug,
      status: p.status,
      blockCount: p.blocks?.length || 0,
      createdAt: p.createdAt,
    });
  }
  list.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ projects: list });
});

// POST /api/projects - Start scraping
app.post("/api/projects", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: "Invalid URL format" });
  }

  const id = genId();
  const project = createProject(id, url);
  res.json({ id, status: project.status });

  // Async pipeline
  (async () => {
    try {
      // Phase 1: Scrape
      sendSSE(project, "progress", { phase: "scrape", message: "ブラウザ起動中..." });
      const result = await scrape(url, {
        slug: project.slug,
        onProgress: (msg) => sendSSE(project, "progress", { phase: "scrape", message: msg }),
      });
      project.html = result.html;
      project.modifiedHtml = result.html;
      project.assets = result.assets;
      project.dirs = result.dirs;
      sendSSE(project, "progress", {
        phase: "scrape",
        message: `スクレイピング完了 - ${result.assets.length}アセット取得`,
        assetCount: result.assets.length,
      });

      // Phase 2: Parse
      project.status = "parsing";
      sendSSE(project, "progress", { phase: "parse", message: "HTML構造解析中..." });
      const structure = parseHtml(result.html);
      project.blocks = structure.blocks;
      project.sections = structure.sections;
      project.widgets = structure.widgets;

      // Analyze for replacement
      project.analysis = analyzeForReplacement(result.html);

      // Save structure
      if (project.dirs) {
        await saveJson(path.join(project.dirs.analysis, "structure.json"), structure);
      }

      sendSSE(project, "progress", {
        phase: "parse",
        message: `解析完了 - ${structure.blocks.length}ブロック, ${structure.sections.length}セクション`,
        blockCount: structure.blocks.length,
        sectionCount: structure.sections.length,
      });

      // Ready
      project.status = "ready";
      sendSSE(project, "ready", {
        blockCount: structure.blocks.length,
        assetCount: result.assets.length,
      });
    } catch (err) {
      project.status = "error";
      project.error = err.message;
      sendSSE(project, "error", { message: err.message });
    }
  })();
});

// GET /api/projects/:id/sse - SSE progress stream
app.get("/api/projects/:id/sse", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(":\n\n"); // keep-alive comment

  // Replay existing log
  for (const entry of project.log) {
    res.write(`event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`);
  }

  project.sseClients.push(res);
  req.on("close", () => {
    project.sseClients = project.sseClients.filter((c) => c !== res);
  });
});

// GET /api/projects/:id - Project state
app.get("/api/projects/:id", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  res.json({
    id: project.id,
    url: project.url,
    slug: project.slug,
    status: project.status,
    blockCount: project.blocks.length,
    assetCount: project.assets.length,
    sectionCount: project.sections.length,
    widgetCount: project.widgets.length,
    blocks: project.blocks.map((b) => ({
      index: b.index,
      type: b.type,
      text: b.text?.slice(0, 100),
      widgetType: b.widgetType,
      href: b.href,
      assets: b.assets,
      fontSize: b.fontSize,
      hasStrong: b.hasStrong,
      hasColor: b.hasColor,
    })),
    analysis: project.analysis,
    error: project.error,
  });
});

// GET /api/projects/:id/blocks/:idx - Get single block full detail
app.get("/api/projects/:id/blocks/:idx", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  const idx = parseInt(req.params.idx, 10);
  const block = project.blocks[idx];
  if (!block) return res.status(404).json({ error: "Block not found" });

  // Add projectId for panel asset URL resolution
  res.json({ ...block, projectId: project.id });
});

// PUT /api/projects/:id/blocks/:idx - Update block
app.put("/api/projects/:id/blocks/:idx", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const idx = parseInt(req.params.idx, 10);
  if (idx < 0 || idx >= project.blocks.length) {
    return res.status(404).json({ error: "Block not found" });
  }

  const { html, text, href } = req.body;
  const block = project.blocks[idx];

  if (html !== undefined) block.html = html;
  if (text !== undefined) block.text = text;
  if (href !== undefined) block.href = href;

  // Rebuild modifiedHtml from blocks
  project.modifiedHtml = project.blocks.map((b) => b.html).join("\n");
  saveProjectsToDisk();

  res.json({ ok: true, block: { index: block.index, type: block.type } });
});

// POST /api/projects/:id/blocks/insert - Insert a new block
app.post("/api/projects/:id/blocks/insert", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const { afterIndex, html, type, widgetType } = req.body;
  if (!html) return res.status(400).json({ error: "html is required" });

  const insertAt = (afterIndex != null && afterIndex >= 0)
    ? Math.min(afterIndex + 1, project.blocks.length)
    : project.blocks.length;

  const newBlock = {
    index: insertAt,
    type: type || "widget",
    widgetType: widgetType || null,
    html,
    text: null,
    assets: [],
  };

  project.blocks.splice(insertAt, 0, newBlock);

  // Re-index all blocks
  project.blocks.forEach((b, i) => { b.index = i; });

  // Rebuild modifiedHtml
  project.modifiedHtml = project.blocks.map((b) => b.html).join("\n");
  saveProjectsToDisk();

  res.json({ ok: true, insertedIndex: insertAt, blockCount: project.blocks.length });
});

// DELETE /api/projects/:id/blocks/:idx - Delete a block
app.delete("/api/projects/:id/blocks/:idx", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const idx = parseInt(req.params.idx, 10);
  if (idx < 0 || idx >= project.blocks.length) {
    return res.status(404).json({ error: "Block not found" });
  }

  project.blocks.splice(idx, 1);

  // Re-index all blocks
  project.blocks.forEach((b, i) => { b.index = i; });

  // Rebuild modifiedHtml
  project.modifiedHtml = project.blocks.map((b) => b.html).join("\n");
  saveProjectsToDisk();

  res.json({ ok: true, blockCount: project.blocks.length });
});

// POST /api/projects/:id/blocks/reorder - Reorder blocks
app.post("/api/projects/:id/blocks/reorder", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const { fromIndex, toIndex } = req.body;
  if (fromIndex == null || toIndex == null) {
    return res.status(400).json({ error: "fromIndex and toIndex are required" });
  }
  if (fromIndex < 0 || fromIndex >= project.blocks.length || toIndex < 0 || toIndex >= project.blocks.length) {
    return res.status(400).json({ error: "Index out of range" });
  }

  const [moved] = project.blocks.splice(fromIndex, 1);
  project.blocks.splice(toIndex, 0, moved);

  // Re-index all blocks
  project.blocks.forEach((b, i) => { b.index = i; });

  // Rebuild modifiedHtml
  project.modifiedHtml = project.blocks.map((b) => b.html).join("\n");
  saveProjectsToDisk();

  res.json({ ok: true, blockCount: project.blocks.length });
});

// GET /api/projects/:id/tag-settings
app.get("/api/projects/:id/tag-settings", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  // Ensure defaults for projects restored from disk without tagSettings
  if (!project.tagSettings) {
    project.tagSettings = { headTags: "", bodyTags: "", noindex: false, jsHead: "", jsBody: "", masterCss: "" };
  }
  res.json(project.tagSettings);
});

// PUT /api/projects/:id/tag-settings
app.put("/api/projects/:id/tag-settings", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  Object.assign(project.tagSettings, req.body);
  saveProjectsToDisk();
  res.json({ ok: true });
});

// GET /api/projects/:id/exit-popup
app.get("/api/projects/:id/exit-popup", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json(project.exitPopup);
});

// PUT /api/projects/:id/exit-popup
app.put("/api/projects/:id/exit-popup", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  Object.assign(project.exitPopup, req.body);
  saveProjectsToDisk();
  res.json({ ok: true });
});

// GET /api/projects/:id/snapshot - Get current state snapshot for undo/redo
app.get("/api/projects/:id/snapshot", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  res.json({
    modifiedHtml: project.modifiedHtml || project.html || "",
    blocks: JSON.stringify(project.blocks),
  });
});

// PUT /api/projects/:id/restore - Restore from snapshot
app.put("/api/projects/:id/restore", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const { modifiedHtml, blocks } = req.body;
  if (!blocks) return res.status(400).json({ error: "blocks is required" });

  try {
    project.blocks = JSON.parse(blocks);
    project.modifiedHtml = modifiedHtml || project.blocks.map((b) => b.html).join("\n");
    res.json({ ok: true, blockCount: project.blocks.length });
  } catch (err) {
    res.status(400).json({ error: "Invalid blocks data" });
  }
});

// GET /api/projects/:id/preview - Preview HTML for iframe
app.get("/api/projects/:id/preview", async (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const rawHtml = project.modifiedHtml || project.html || "";

  // Rewrite all asset URLs to serve through our API
  const html = rewriteAssetsForPreview(rawHtml, project);

  // Tag settings injection
  const ts = project.tagSettings || {};
  const masterCssBlock = ts.masterCss ? `<style id="master-css">${ts.masterCss}</style>` : "";
  const noindexTag = ts.noindex ? '<meta name="robots" content="noindex">' : "";
  const headTagsBlock = (ts.headTags || "") + (ts.jsHead ? `<script>${ts.jsHead}<\/script>` : "");
  let bodyEndBlock = (ts.bodyTags || "") + (ts.jsBody ? `<script>${ts.jsBody}<\/script>` : "");

  // Exit popup injection for preview
  if (project.exitPopup?.enabled) {
    try {
      const { generateExitPopupHtml } = await import("./src/exit-popup-builder.js");
      const popupHtml = generateExitPopupHtml(project.exitPopup);
      bodyEndBlock += popupHtml;
      // Add test trigger button for preview
      bodyEndBlock += `<div style="position:fixed;bottom:12px;right:12px;z-index:100000">
        <button onclick="document.querySelector('[id$=-overlay]')?.classList.add('active')" style="padding:8px 16px;background:#ec4899;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,0.2)">離脱POPテスト</button>
      </div>`;
    } catch {}
  }

  const previewHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${noindexTag}
${masterCssBlock}
${headTagsBlock}
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font-family: -apple-system, "Hiragino Sans", sans-serif;
    overflow-x: hidden;
    background: #fff;
  }
  img, video { max-width: 100%; height: auto; display: block; }

  /* ── Animation Keyframes for Live Preview ── */
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @keyframes slideInUp{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}}
  @keyframes slideInLeft{from{opacity:0;transform:translateX(-40px)}to{opacity:1;transform:translateX(0)}}
  @keyframes slideInRight{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:translateX(0)}}
  @keyframes bounceIn{0%{opacity:0;transform:scale(0.3)}50%{opacity:1;transform:scale(1.05)}70%{transform:scale(0.9)}100%{transform:scale(1)}}
  @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
  @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
  @keyframes zoomIn{from{opacity:0;transform:scale(0.5)}to{opacity:1;transform:scale(1)}}
  @keyframes flipIn{from{opacity:0;transform:rotateY(-90deg)}to{opacity:1;transform:rotateY(0)}}
  @keyframes scrollFadeIn{from{opacity:0}to{opacity:1}}
  @keyframes scrollSlideUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
  @keyframes scrollZoom{from{opacity:0;transform:scale(0.8)}to{opacity:1;transform:scale(1)}}
  @keyframes scrollBlur{from{opacity:0;filter:blur(10px)}to{opacity:1;filter:blur(0)}}

  /* Hover effect classes */
  .hoverScale{transition:transform 0.3s ease}.hoverScale:hover{transform:scale(1.05)}
  .hoverBright{transition:filter 0.3s ease}.hoverBright:hover{filter:brightness(1.15)}
  .hoverShadow{transition:box-shadow 0.3s ease}.hoverShadow:hover{box-shadow:0 8px 25px rgba(0,0,0,0.2)}
  .hoverLift{transition:all 0.3s ease}.hoverLift:hover{transform:translateY(-4px);box-shadow:0 6px 20px rgba(0,0,0,0.15)}
  .hoverGray{filter:grayscale(100%);transition:filter 0.3s ease}.hoverGray:hover{filter:grayscale(0%)}

  /* ── Comic Preview Styles ── */
  .comic-container { position:relative; width:100%; }
  .comic-base-img { width:100%; display:block; }
  .comic-grid { position:absolute; top:0; left:0; right:0; bottom:0; display:grid; gap:3px; }
  .comic-cell { border:2px solid #000; position:relative; overflow:hidden; }
  .comic-bubble { position:absolute; padding:8px 12px; max-width:70%; bottom:10%; left:50%; transform:translateX(-50%); text-align:center; z-index:2; }
  .bubble-round { background:#fff; border:2px solid #000; border-radius:50%; }
  .bubble-rect { background:#fff; border:2px solid #000; border-radius:12px; }
  .bubble-spike { background:#fff; border:2px solid #000; clip-path:polygon(0% 20%,8% 0%,16% 18%,30% 4%,40% 16%,50% 0%,60% 16%,70% 4%,84% 18%,92% 0%,100% 20%,100% 80%,92% 100%,84% 82%,70% 96%,60% 84%,50% 100%,40% 84%,30% 96%,16% 82%,8% 100%,0% 80%); padding:16px; }
  .bubble-cloud { background:#fff; border:2px solid #000; border-radius:50% 50% 50% 50% / 60% 60% 40% 40%; }
  .bubble-shout { background:#ff0; border:2px solid #000; clip-path:polygon(0% 20%,15% 0%,25% 25%,50% 0%,75% 25%,85% 0%,100% 20%,100% 80%,85% 100%,75% 75%,50% 100%,25% 75%,15% 100%,0% 80%); padding:16px; }
  .bubble-think { background:#fff; border:2px dashed #666; border-radius:50%; }
  .bubble-narration { background:rgba(0,0,0,0.7); color:#fff; border:none; border-radius:4px; }

  .block-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    transition: background 0.15s, box-shadow 0.15s;
    z-index: 1000;
  }
  .block-wrapper {
    position: relative;
    cursor: pointer;
  }
  .block-wrapper:hover .block-overlay {
    background: rgba(236, 72, 153, 0.06);
    box-shadow: inset 0 0 0 2px rgba(236, 72, 153, 0.4);
  }
  .block-wrapper.active .block-overlay {
    background: rgba(236, 72, 153, 0.10);
    box-shadow: inset 0 0 0 2px rgba(236, 72, 153, 0.7);
  }
  .block-type-badge {
    position: absolute;
    top: 4px; right: 4px;
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 4px;
    background: rgba(236, 72, 153, 0.85);
    color: #fff;
    font-weight: 600;
    font-family: -apple-system, sans-serif;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
    z-index: 1001;
    line-height: 1.4;
  }
  .block-wrapper:hover .block-type-badge,
  .block-wrapper.active .block-type-badge { opacity: 1; }

  /* Inline editing */
  .block-wrapper.editing .block-overlay { display: none; }
  .block-wrapper.editing .block-type-badge { display: none; }
  .block-wrapper.editing {
    outline: 2px solid rgba(236, 72, 153, 0.6);
    outline-offset: 2px;
    cursor: text;
  }
  [contenteditable="true"] { outline: none; }

  /* Floating toolbar */
  .inline-toolbar {
    position: fixed;
    display: none;
    align-items: center;
    gap: 2px;
    padding: 4px 6px;
    background: #1e293b;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    z-index: 9999;
    font-family: -apple-system, sans-serif;
  }
  .inline-toolbar.visible { display: flex; }
  .inline-toolbar button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: none;
    border: none;
    border-radius: 4px;
    color: #cbd5e1;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    font-family: -apple-system, sans-serif;
  }
  .inline-toolbar button:hover { background: rgba(255,255,255,0.1); color: #fff; }
  .inline-toolbar .tb-sep {
    width: 1px;
    height: 18px;
    background: rgba(255,255,255,0.12);
    margin: 0 3px;
  }
  .inline-toolbar select {
    background: #334155;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    color: #cbd5e1;
    font-size: 11px;
    padding: 3px 4px;
    cursor: pointer;
  }
  .inline-toolbar .tb-color-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    padding: 0;
  }
  .inline-toolbar .tb-color-btn:hover { background: rgba(255,255,255,0.1); }
  .inline-toolbar .tb-color-dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.4);
  }
</style>
</head>
<body>
${html}
<script>
(function() {
  var children = Array.from(document.body.children);
  var idx = 0;
  var types = ${JSON.stringify(project.blocks.map(b => b.type))};

  children.forEach(function(child) {
    if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') return;

    var wrapper = document.createElement('div');
    wrapper.className = 'block-wrapper';
    wrapper.dataset.blockIndex = idx;

    var overlay = document.createElement('div');
    overlay.className = 'block-overlay';

    var badge = document.createElement('span');
    badge.className = 'block-type-badge';
    badge.textContent = types[idx] || 'block';

    child.parentNode.insertBefore(wrapper, child);
    wrapper.appendChild(child);
    wrapper.appendChild(overlay);
    wrapper.appendChild(badge);

    wrapper.addEventListener('click', function(ev) {
      document.querySelectorAll('.block-wrapper.active').forEach(function(w) { w.classList.remove('active'); });
      wrapper.classList.add('active');
      var bi = parseInt(wrapper.dataset.blockIndex);
      var bt = types[bi] || 'block';
      window.parent.postMessage({ type: 'blockClick', blockIndex: bi, blockType: bt, clientX: ev.clientX, clientY: ev.clientY }, '*');
    });

    idx++;
  });

  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.type) return;
    if (e.data.type === 'scrollToBlock') {
      var el = document.querySelector('[data-block-index="' + e.data.blockIndex + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (e.data.type === 'highlightBlock') {
      document.querySelectorAll('.block-wrapper.active').forEach(function(w) { w.classList.remove('active'); });
      var el = document.querySelector('[data-block-index="' + e.data.blockIndex + '"]');
      if (el) el.classList.add('active');
    }

    // ── Live Animation Preview ──
    if (e.data.type === 'previewAnimation') {
      var el = document.querySelector('[data-block-index="' + e.data.blockIndex + '"]');
      if (!el) return;
      var content = el.children[0];
      if (!content) content = el;
      // Clear existing animation state
      content.style.animation = '';
      content.style.transition = '';
      content.style.transform = '';
      content.style.opacity = '';
      content.style.filter = '';
      content.className = content.className.replace(/\\bhover\\w+\\b/g, '').trim();
      void content.offsetWidth; // force reflow

      var speed = e.data.speed || '0.6s';

      // CSS animation
      if (e.data.anim) {
        content.style.animation = e.data.anim + ' ' + speed + ' ease forwards';
      }
      // Scroll-linked (instant fire for preview)
      if (e.data.scroll) {
        content.style.animation = e.data.scroll + ' ' + speed + ' ease forwards';
      }
      // Hover effect (add class)
      if (e.data.hover) {
        content.classList.add(e.data.hover);
      }
      // Scroll into view
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (e.data.type === 'clearAnimationPreview') {
      var el = document.querySelector('[data-block-index="' + e.data.blockIndex + '"]');
      if (el) {
        var content = el.children[0] || el;
        content.style.animation = '';
        content.style.transition = '';
        content.style.transform = '';
        content.style.opacity = '';
        content.style.filter = '';
        content.className = content.className.replace(/\\bhover\\w+\\b/g, '').trim();
      }
    }

    // ── Comic Editor: Grid Overlay ──
    if (e.data.type === 'comicOverlay') {
      var wrapper = document.querySelector('[data-block-index="' + e.data.blockIndex + '"]');
      if (!wrapper) return;
      var content = wrapper.children[0];
      if (!content) content = wrapper;
      // 既存のオーバーレイを削除
      var existing = content.querySelector('.comic-grid-preview');
      if (existing) existing.remove();
      if (!e.data.layout) return;

      var grid = document.createElement('div');
      grid.className = 'comic-grid-preview';
      grid.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;display:grid;gap:3px;pointer-events:none;z-index:10;';
      grid.style.gridTemplate = e.data.layout.grid || '1fr / 1fr';
      if (e.data.layout.areas) grid.style.gridTemplateAreas = e.data.layout.areas;

      var areaLetters = 'abcdefghij';
      for (var ci = 0; ci < e.data.layout.cells; ci++) {
        var cell = document.createElement('div');
        cell.className = 'comic-preview-cell';
        cell.dataset.cellIndex = ci;
        cell.style.cssText = 'border:2px solid rgba(236,72,153,0.8);background:rgba(236,72,153,0.05);border-radius:2px;display:flex;align-items:center;justify-content:center;color:#ec4899;font-weight:bold;font-size:24px;position:relative;';
        if (e.data.layout.areas) cell.style.gridArea = areaLetters[ci];
        cell.textContent = (ci + 1);
        grid.appendChild(cell);
      }
      content.style.position = 'relative';
      content.appendChild(grid);
      wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // ── Comic Editor: Bubble Preview ──
    if (e.data.type === 'comicBubble') {
      var wrapper = document.querySelector('[data-block-index="' + e.data.blockIndex + '"]');
      if (!wrapper) return;
      var grid = wrapper.querySelector('.comic-grid-preview');
      if (!grid) return;
      var cell = grid.querySelector('[data-cell-index="' + e.data.cellIndex + '"]');
      if (!cell) return;
      // 既存の吹き出しを削除
      var oldBubble = cell.querySelector('.comic-preview-bubble');
      if (oldBubble) oldBubble.remove();
      if (e.data.bubbleType === 'none') return;

      var bubble = document.createElement('div');
      bubble.className = 'comic-preview-bubble';
      var styles = 'position:absolute;bottom:8px;left:50%;transform:translateX(-50%);padding:6px 10px;max-width:70%;font-size:11px;text-align:center;pointer-events:none;z-index:2;';
      var bt = e.data.bubbleType;
      if (bt === 'round') styles += 'background:#fff;border:2px solid #000;border-radius:50%;';
      else if (bt === 'rect') styles += 'background:#fff;border:2px solid #000;border-radius:12px;';
      else if (bt === 'spike') styles += 'background:#fff;border:2px solid #000;clip-path:polygon(0% 20%,8% 0%,16% 18%,30% 4%,40% 16%,50% 0%,60% 16%,70% 4%,84% 18%,92% 0%,100% 20%,100% 80%,92% 100%,84% 82%,70% 96%,60% 84%,50% 100%,40% 84%,30% 96%,16% 82%,8% 100%,0% 80%);padding:12px;';
      else if (bt === 'cloud') styles += 'background:#fff;border:2px solid #000;border-radius:50% 50% 50% 50% / 60% 60% 40% 40%;';
      else if (bt === 'shout') styles += 'background:#ff0;border:2px solid #000;clip-path:polygon(0% 20%,15% 0%,25% 25%,50% 0%,75% 25%,85% 0%,100% 20%,100% 80%,85% 100%,75% 75%,50% 100%,25% 75%,15% 100%,0% 80%);padding:12px;';
      else if (bt === 'think') styles += 'background:#fff;border:2px dashed #666;border-radius:50%;';
      else if (bt === 'narration') styles += 'background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:4px;';
      bubble.style.cssText = styles;
      bubble.textContent = bt;
      cell.appendChild(bubble);
    }

    // ── Comic Editor: Text Preview ──
    if (e.data.type === 'comicText') {
      var wrapper = document.querySelector('[data-block-index="' + e.data.blockIndex + '"]');
      if (!wrapper) return;
      var grid = wrapper.querySelector('.comic-grid-preview');
      if (!grid) return;
      var cell = grid.querySelector('[data-cell-index="' + e.data.cellIndex + '"]');
      if (!cell) return;
      var bubble = cell.querySelector('.comic-preview-bubble');
      if (!bubble) {
        bubble = document.createElement('div');
        bubble.className = 'comic-preview-bubble';
        var bt = e.data.bubbleType || 'rect';
        var styles = 'position:absolute;bottom:8px;left:50%;transform:translateX(-50%);padding:6px 10px;max-width:70%;text-align:center;pointer-events:none;z-index:2;';
        if (bt === 'round') styles += 'background:#fff;border:2px solid #000;border-radius:50%;';
        else if (bt === 'rect') styles += 'background:#fff;border:2px solid #000;border-radius:12px;';
        else if (bt === 'narration') styles += 'background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:4px;';
        else styles += 'background:#fff;border:2px solid #000;border-radius:12px;';
        bubble.style.cssText = styles;
        cell.appendChild(bubble);
      }
      bubble.textContent = e.data.text || '';
      bubble.style.fontSize = (e.data.fontSize || 16) + 'px';
      if (e.data.bold) bubble.style.fontWeight = 'bold';
      else bubble.style.fontWeight = '';
    }

    // ── Comic Editor: Animation Preview ──
    if (e.data.type === 'comicAnimation') {
      var wrapper = document.querySelector('[data-block-index="' + e.data.blockIndex + '"]');
      if (!wrapper) return;
      var grid = wrapper.querySelector('.comic-grid-preview');
      if (!grid) return;
      var targetParts = (e.data.target || '').split('-');
      var targetType = targetParts[0];
      var targetIdx = parseInt(targetParts[1]) || 0;
      var targetEl = null;
      if (targetType === 'cell') {
        targetEl = grid.querySelector('[data-cell-index="' + targetIdx + '"]');
      } else if (targetType === 'bubble') {
        var bCell = grid.querySelector('[data-cell-index="' + targetIdx + '"]');
        if (bCell) targetEl = bCell.querySelector('.comic-preview-bubble');
      }
      if (!targetEl) return;
      targetEl.style.animation = '';
      void targetEl.offsetWidth;
      if (e.data.anim) {
        targetEl.style.animation = e.data.anim + ' ' + (e.data.speed || '0.6s') + ' ease forwards';
      }
    }
  });

  // Resolve lazyload
  document.querySelectorAll('img[data-src]').forEach(function(img) {
    if (!img.src || img.src === 'about:blank' || img.src.endsWith('/')) img.src = img.dataset.src;
  });
  document.querySelectorAll('source[data-srcset]').forEach(function(s) {
    s.srcset = s.dataset.srcset;
  });
  document.querySelectorAll('video source[data-src]').forEach(function(s) {
    s.src = s.dataset.src;
    try { s.parentElement.load(); } catch(e) {}
  });

  // ── Inline Editing ──
  var editingWrapper = null;
  var editingContent = null;
  var originalHtml = '';

  // Create floating toolbar
  var toolbar = document.createElement('div');
  toolbar.className = 'inline-toolbar';
  toolbar.innerHTML = '<button data-cmd="bold" title="太字"><b>B</b></button>'
    + '<button data-cmd="underline" title="下線"><u>U</u></button>'
    + '<button data-cmd="italic" title="斜体"><i>I</i></button>'
    + '<button data-cmd="strikeThrough" title="打消し"><s>S</s></button>'
    + '<div class="tb-sep"></div>'
    + '<button data-cmd="superscript" title="上付">X\u00B2</button>'
    + '<button data-cmd="subscript" title="下付">X\u2082</button>'
    + '<div class="tb-sep"></div>'
    + '<select data-action="fontSize" title="\u30B5\u30A4\u30BA"><option value="">size</option><option value="1">10px</option><option value="2">13px</option><option value="3">16px</option><option value="4">18px</option><option value="5">24px</option><option value="6">32px</option></select>'
    + '<button class="tb-color-btn" data-color-action="foreColor" title="\u6587\u5B57\u8272"><span class="tb-color-dot" style="background:#ffffff"></span></button>'
    + '<button class="tb-color-btn" data-color-action="backColor" title="\u80CC\u666F\u8272"><span class="tb-color-dot" style="background:#000000"></span></button>'
    + '<div class="tb-sep"></div>'
    + '<button data-cmd="justifyLeft" title="\u5DE6\u63C3\u3048">\u2261</button>'
    + '<button data-cmd="justifyCenter" title="\u4E2D\u592E">\u2550</button>'
    + '<button data-cmd="justifyRight" title="\u53F3\u63C3\u3048">\u2261</button>'
    + '<div class="tb-sep"></div>'
    + '<button data-action="insertImage" title="\u753B\u50CF\u633F\u5165">\uD83D\uDDBC</button>';
  document.body.appendChild(toolbar);

  // Image insert button
  var imgBtn = toolbar.querySelector('[data-action="insertImage"]');
  if (imgBtn) {
    imgBtn.addEventListener('click', function(e) {
      e.preventDefault();
      var blockIdx = editingWrapper ? parseInt(editingWrapper.dataset.blockIndex) : -1;
      window.parent.postMessage({ type: 'openImagePicker', blockIndex: blockIdx }, '*');
    });
  }

  // Toolbar commands
  toolbar.addEventListener('mousedown', function(e) { e.preventDefault(); });
  toolbar.querySelectorAll('button[data-cmd]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      document.execCommand(btn.dataset.cmd, false, null);
    });
  });
  toolbar.querySelector('select[data-action="fontSize"]').addEventListener('change', function(e) {
    if (e.target.value) document.execCommand('fontSize', false, e.target.value);
    e.target.value = '';
  });
  // Color picker buttons - send to parent
  toolbar.querySelectorAll('.tb-color-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      var action = btn.dataset.colorAction;
      var dot = btn.querySelector('.tb-color-dot');
      var currentColor = dot ? dot.style.background : '#ffffff';
      var rect = btn.getBoundingClientRect();
      window.parent.postMessage({
        type: 'openColorPicker',
        action: action,
        currentColor: currentColor,
        anchorRect: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right, width: rect.width, height: rect.height }
      }, '*');
    });
  });
  // Listen for color response from parent
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'applyColor' && e.data.action && e.data.color) {
      document.execCommand(e.data.action, false, e.data.color);
      var btn = toolbar.querySelector('.tb-color-btn[data-color-action="' + e.data.action + '"]');
      if (btn) {
        var dot = btn.querySelector('.tb-color-dot');
        if (dot) dot.style.background = e.data.color;
      }
    }
  });

  // Show toolbar on text selection
  document.addEventListener('selectionchange', function() {
    if (!editingWrapper) { toolbar.classList.remove('visible'); return; }
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { toolbar.classList.remove('visible'); return; }
    var range = sel.getRangeAt(0);
    var rect = range.getBoundingClientRect();
    if (rect.width === 0) { toolbar.classList.remove('visible'); return; }
    toolbar.style.left = Math.max(4, rect.left + rect.width / 2 - 160) + 'px';
    toolbar.style.top = Math.max(4, rect.top - 44) + 'px';
    toolbar.classList.add('visible');
  });

  // Single-click to enter edit mode (text/heading blocks)
  // Click on text/heading block = select + immediately enter edit mode
  document.addEventListener('click', function(e) {
    var wrapper = e.target.closest('.block-wrapper');
    if (!wrapper) return;
    // If already in editing mode on this wrapper, don't re-enter
    if (editingWrapper === wrapper) return;
    var blockIdx = parseInt(wrapper.dataset.blockIndex);
    var blockType = types[blockIdx];
    // Only allow text/heading editing
    if (blockType !== 'text' && blockType !== 'heading') return;

    // Exit previous editing if different wrapper
    if (editingWrapper && editingWrapper !== wrapper) exitEditMode(true);

    // Enter edit mode immediately on single click (no need to wait for active state)
    // Short delay to let blockClick handler fire first for selection
    setTimeout(function() {
      if (editingWrapper === wrapper) return; // already entered
      editingWrapper = wrapper;
      editingContent = wrapper.children[0]; // The actual content element
      originalHtml = editingContent.innerHTML;

      wrapper.classList.add('editing');
      editingContent.contentEditable = 'true';
      editingContent.focus();

      // Show toolbar immediately above the block
      var rect = wrapper.getBoundingClientRect();
      toolbar.style.left = Math.max(4, rect.left + rect.width / 2 - 160) + 'px';
      toolbar.style.top = Math.max(4, rect.top - 44) + 'px';
      toolbar.classList.add('visible');
    }, 50);
  });

  function exitEditMode(save) {
    if (!editingWrapper || !editingContent) return;
    toolbar.classList.remove('visible');
    editingContent.contentEditable = 'false';
    editingWrapper.classList.remove('editing');

    if (save) {
      var newHtml = editingContent.innerHTML;
      var newText = editingContent.textContent;
      if (newHtml !== originalHtml) {
        var blockIdx = parseInt(editingWrapper.dataset.blockIndex);
        window.parent.postMessage({
          type: 'inlineEditSave',
          blockIndex: blockIdx,
          html: newHtml,
          text: newText
        }, '*');
      }
    }

    editingWrapper = null;
    editingContent = null;
    originalHtml = '';
  }

  // Click outside to save and exit
  document.addEventListener('click', function(e) {
    if (!editingWrapper) return;
    if (editingWrapper.contains(e.target)) return;
    if (toolbar.contains(e.target)) return;
    exitEditMode(true);
  });

  // Handle messages from parent
  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.type) return;
    if (e.data.type === 'exitInlineEdit') {
      exitEditMode(false);
    }
    // Quick edit support for widgets
    if (e.data.type === 'enableQuickEdit') {
      var bi = e.data.blockIndex;
      var w = document.querySelector('[data-block-index="' + bi + '"]');
      if (w) {
        var content = w.children[0];
        if (content) {
          // Make text nodes editable (skip style/script)
          var elems = content.querySelectorAll('*');
          elems.forEach(function(el) {
            if (el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT' && el.children.length === 0 && el.textContent.trim()) {
              el.contentEditable = 'true';
              el.style.outline = '1px dashed rgba(236,72,153,0.4)';
              el.style.outlineOffset = '2px';
            }
          });
          w.classList.add('editing');
        }
      }
    }
    if (e.data.type === 'disableQuickEdit') {
      var bi2 = e.data.blockIndex;
      var w2 = document.querySelector('[data-block-index="' + bi2 + '"]');
      if (w2) {
        w2.classList.remove('editing');
        w2.querySelectorAll('[contenteditable]').forEach(function(el) {
          el.contentEditable = 'false';
          el.style.outline = '';
          el.style.outlineOffset = '';
        });
      }
    }
    if (e.data.type === 'getQuickEditHtml') {
      var bi3 = e.data.blockIndex;
      var w3 = document.querySelector('[data-block-index="' + bi3 + '"]');
      if (w3) {
        // Remove editing state first
        w3.classList.remove('editing');
        w3.querySelectorAll('[contenteditable]').forEach(function(el) {
          el.contentEditable = 'false';
          el.style.outline = '';
          el.style.outlineOffset = '';
        });
        var content3 = w3.children[0];
        if (content3) {
          window.parent.postMessage({
            type: 'quickEditHtml',
            blockIndex: bi3,
            html: content3.outerHTML
          }, '*');
        }
      }
    }
  });

  // Escape key to cancel
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && editingWrapper) {
      editingContent.innerHTML = originalHtml;
      exitEditMode(false);
    }
  });

  // ── Element Overlay (AI Vision) ──
  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.type) return;

    if (e.data.type === 'elementOverlay') {
      // Remove existing overlays
      document.querySelectorAll('.ai-element-overlay').forEach(function(o) { o.remove(); });
      var wrapper = document.querySelector('[data-block-index="' + e.data.blockIndex + '"]');
      if (!wrapper) return;
      var content = wrapper.children[0] || wrapper;
      var rect = content.getBoundingClientRect();

      // Show all elements as semi-transparent overlays, highlight selected
      var elements = e.data.elements || [];
      if (e.data.elementIndex < 0) return;

      elements.forEach(function(el, idx) {
        var bb = el.boundingBox;
        if (!bb) return;
        var div = document.createElement('div');
        div.className = 'ai-element-overlay';
        div.style.cssText = 'position:absolute;pointer-events:none;z-index:2000;transition:all 0.2s;';
        div.style.left = (bb.x) + '%';
        div.style.top = (bb.y) + '%';
        div.style.width = (bb.width) + '%';
        div.style.height = (bb.height) + '%';
        if (idx === e.data.elementIndex) {
          div.style.border = '2px solid #ec4899';
          div.style.background = 'rgba(236,72,153,0.15)';
          div.style.borderRadius = '3px';
        } else {
          div.style.border = '1px dashed rgba(236,72,153,0.3)';
          div.style.background = 'rgba(236,72,153,0.03)';
        }
        content.style.position = 'relative';
        content.appendChild(div);
      });
      wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (e.data.type === 'elementUpdate') {
      // Update overlay position/style + real-time text/animation preview
      document.querySelectorAll('.ai-element-overlay').forEach(function(o) { o.remove(); });
      var wrapper = document.querySelector('[data-block-index="' + e.data.blockIndex + '"]');
      if (!wrapper) return;
      var content = wrapper.children[0] || wrapper;
      var bb = e.data.boundingBox;
      if (!bb) return;

      var div = document.createElement('div');
      div.className = 'ai-element-overlay';
      div.style.cssText = 'position:absolute;pointer-events:none;z-index:2000;display:flex;align-items:center;justify-content:center;overflow:hidden;';
      div.style.left = bb.x + '%';
      div.style.top = bb.y + '%';
      div.style.width = bb.width + '%';
      div.style.height = bb.height + '%';
      div.style.border = '2px solid #ec4899';
      div.style.background = 'rgba(236,72,153,0.08)';
      div.style.borderRadius = '3px';
      if (!e.data.visible) div.style.display = 'none';
      div.style.zIndex = 2000 + (e.data.zIndex || 0);
      content.style.position = 'relative';

      // Apply styles
      var fontSizes = { small: '10px', medium: '14px', large: '20px', xlarge: '28px' };
      if (e.data.style) {
        div.style.fontSize = fontSizes[e.data.style.fontSize] || '14px';
        div.style.fontWeight = e.data.style.fontWeight || 'normal';
        if (e.data.style.color) div.style.color = e.data.style.color;
        if (e.data.style.backgroundColor) div.style.background = e.data.style.backgroundColor + '33';
      }

      // Show text content inside overlay
      if (e.data.content) {
        div.textContent = e.data.content;
        div.style.pointerEvents = 'none';
        div.style.textShadow = '0 0 3px rgba(255,255,255,0.8)';
        div.style.padding = '2px 4px';
        div.style.wordBreak = 'break-word';
      }
      content.appendChild(div);

      // Also update actual text in the block DOM
      if (e.data.content) {
        var textNodes = [];
        var treeWalker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null, false);
        var tn;
        while (tn = treeWalker.nextNode()) {
          if (tn.textContent.trim() && !tn.parentElement.closest('.ai-element-overlay') && !tn.parentElement.closest('style') && !tn.parentElement.closest('script')) {
            textNodes.push(tn);
          }
        }
        // Try to find matching text node and update it
        var elIdx = e.data.elementIndex || 0;
        if (textNodes[elIdx]) {
          textNodes[elIdx].textContent = e.data.content;
        }
      }

      wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
})();
</script>
${bodyEndBlock}
</body>
</html>`;

  res.type("html").send(previewHtml);
});

// GET /api/projects/:id/assets/:file - Serve scraped assets
app.get("/api/projects/:id/assets/:file", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project || !project.dirs) return res.status(404).send("Not found");

  const filePath = safePath(project.dirs.assets, req.params.file);
  if (!filePath || !existsSync(filePath)) return res.status(404).send("Asset not found");

  res.sendFile(filePath);
});

// POST /api/projects/:id/describe-image/:idx - AI describe image
app.post("/api/projects/:id/describe-image/:idx", async (req, res) => {
  trackAiUsage("describe-image");
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const idx = parseInt(req.params.idx, 10);
  const block = project.blocks[idx];
  if (!block) return res.status(404).json({ error: "Block not found" });

  const asset = block.assets?.[0];
  if (!asset) return res.status(400).json({ error: "Block has no image asset" });

  // Find local file - try multiple URL fields
  const assetEntry = project.assets.find((a) =>
    a.originalUrl === asset.src ||
    a.originalUrl === asset.webpSrc ||
    a.originalUrl === asset.avifSrc
  );

  if (!assetEntry || !existsSync(assetEntry.localPath)) {
    return res.status(400).json({ error: "Asset file not found on disk" });
  }

  try {
    const context = block.text || project.blocks.slice(Math.max(0, idx - 2), idx + 3)
      .filter((b) => b.text)
      .map((b) => b.text)
      .join(" ")
      .slice(0, 200);

    const provider = req.body?.provider || "nanobanana";
    const description = await describeImage(assetEntry.localPath, context, provider);
    res.json({ description });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/generate-image/:idx - Generate image
app.post("/api/projects/:id/generate-image/:idx", async (req, res) => {
  trackAiUsage("generate-image");
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!project.dirs) return res.status(400).json({ error: "Project not initialized" });

  const idx = parseInt(req.params.idx, 10);
  const block = project.blocks[idx];
  if (!block) return res.status(404).json({ error: "Block not found" });

  const { prompt, description, provider } = req.body;
  const asset = block.assets?.[0];
  const width = asset?.width || 580;
  const height = asset?.height || 580;

  try {
    const finalPrompt = prompt || buildImagePrompt(description || "product image", "", { width, height });
    const outputPath = path.join(
      project.dirs.images,
      `block_${idx}_${Date.now()}.jpg`
    );

    await generateImage(finalPrompt, { width, height, outputPath, provider: provider || "nanobanana" });

    const generatedUrl = `/api/projects/${project.id}/generated-images/${path.basename(outputPath)}`;
    res.json({ ok: true, imageUrl: generatedUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/one-click-image/:idx - One-click AI image generation
app.post("/api/projects/:id/one-click-image/:idx", async (req, res) => {
  trackAiUsage("one-click-image");
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!project.dirs) return res.status(400).json({ error: "Project not initialized" });

  const idx = parseInt(req.params.idx, 10);
  const block = project.blocks[idx];
  if (!block) return res.status(404).json({ error: "Block not found" });

  const asset = block.assets?.[0];
  if (!asset) return res.status(400).json({ error: "Block has no image asset" });

  // Find local file
  const assetEntry = project.assets.find((a) =>
    a.originalUrl === asset.src ||
    a.originalUrl === asset.webpSrc ||
    a.originalUrl === asset.avifSrc
  );

  if (!assetEntry || !existsSync(assetEntry.localPath)) {
    return res.status(400).json({ error: "Asset file not found on disk" });
  }

  const { nuance = "same", style = "photo", designRequirements = "", customPrompt = "", genMode = "similar", provider = "pixai" } = req.body;
  const width = asset.width || 580;
  const height = asset.height || 580;

  try {
    const results = [];
    for (let i = 0; i < 2; i++) {
      const outputPath = path.join(
        project.dirs.images,
        `block_${idx}_oneclick_${i}_${Date.now()}.jpg`
      );
      await generateImageFromReference(assetEntry.localPath, {
        nuance, style, width, height, outputPath, designRequirements, customPrompt, genMode, provider,
      });
      results.push(`/api/projects/${project.id}/generated-images/${path.basename(outputPath)}`);
      // Delay between generations for rate limiting
      if (i < 1) await new Promise(r => setTimeout(r, 2000));
    }
    res.json({ ok: true, images: results, width, height });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/projects/:id/apply-image/:idx - Apply selected image to block HTML
app.put("/api/projects/:id/apply-image/:idx", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const idx = parseInt(req.params.idx, 10);
  const block = project.blocks[idx];
  if (!block) return res.status(404).json({ error: "Block not found" });

  const { imageUrl } = req.body;
  if (!imageUrl) return res.status(400).json({ error: "imageUrl is required" });

  // Replace image sources in block HTML (src, data-src, data-srcset)
  let html = block.html;
  const asset = block.assets?.[0];
  if (asset) {
    // Replace all image source attributes
    const oldSrcs = [asset.src, asset.webpSrc, asset.avifSrc, asset.dataSrc].filter(Boolean);
    // Also find asset-rewritten URLs
    const assetEntry = project.assets.find((a) =>
      a.originalUrl === asset.src ||
      a.originalUrl === asset.webpSrc ||
      a.originalUrl === asset.avifSrc
    );
    if (assetEntry) {
      oldSrcs.push(`/api/projects/${project.id}/assets/${assetEntry.localFile}`);
    }

    for (const oldSrc of oldSrcs) {
      if (oldSrc) html = html.split(oldSrc).join(imageUrl);
    }
  }

  block.html = html;
  // Update asset reference
  if (block.assets?.[0]) {
    block.assets[0].src = imageUrl;
    block.assets[0].webpSrc = null;
    block.assets[0].avifSrc = null;
  }

  // Rebuild modifiedHtml
  project.modifiedHtml = project.blocks.map((b) => b.html).join("\n");
  saveProjectsToDisk();

  res.json({ ok: true });
});

// POST /api/projects/:id/upload-image/:idx - Upload local image and apply to block
app.post("/api/projects/:id/upload-image/:idx", async (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!project.dirs) return res.status(400).json({ error: "Project not initialized" });

  const idx = parseInt(req.params.idx, 10);
  const block = project.blocks[idx];
  if (!block) return res.status(404).json({ error: "Block not found" });

  const { imageData, fileName } = req.body;
  if (!imageData) return res.status(400).json({ error: "imageData is required" });

  try {
    // imageData is base64 data URL: "data:image/jpeg;base64,/9j/..."
    const matches = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: "Invalid image data format" });

    const ext = matches[1] === "jpeg" ? "jpg" : matches[1];
    const buffer = Buffer.from(matches[2], "base64");

    // Resize with sharp (maintain aspect, max quality)
    const asset = block.assets?.[0];
    const width = asset?.width || 580;
    const height = asset?.height || 580;

    const { default: sharp } = await import("sharp");
    const resized = await sharp(buffer)
      .resize(width, height, { fit: "cover" })
      .jpeg({ quality: 90 })
      .toBuffer();

    const outFile = `block_${idx}_upload_${Date.now()}.jpg`;
    const outputPath = path.join(project.dirs.images, outFile);
    await writeFile(outputPath, resized);

    const imageUrl = `/api/projects/${project.id}/generated-images/${outFile}`;
    res.json({ ok: true, imageUrl, width, height });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/upload-free - Upload image (no block required) for insert or reference
app.post("/api/projects/:id/upload-free", async (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!project.dirs) return res.status(400).json({ error: "Project not initialized" });

  const { imageData, fileName } = req.body;
  if (!imageData) return res.status(400).json({ error: "imageData is required" });

  try {
    const matches = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: "Invalid image data format" });

    const ext = matches[1] === "jpeg" ? "jpg" : matches[1];
    const buffer = Buffer.from(matches[2], "base64");

    const outFile = `upload_free_${Date.now()}.${ext}`;
    const outputPath = path.join(project.dirs.images, outFile);
    await writeFile(outputPath, buffer);

    const imageUrl = `/api/projects/${project.id}/generated-images/${outFile}`;
    res.json({ ok: true, imageUrl, localPath: outputPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/ai-from-reference - Generate AI image from uploaded reference
app.post("/api/projects/:id/ai-from-reference", async (req, res) => {
  trackAiUsage("ai-from-reference");
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!project.dirs) return res.status(400).json({ error: "Project not initialized" });

  const { localPath, style = "photo", genMode = "similar", designRequirements = "", customPrompt = "", width = 580, height = 580, provider = "pixai" } = req.body;
  if (!localPath || !existsSync(localPath)) return res.status(400).json({ error: "Reference image not found" });

  try {
    const results = [];
    for (let i = 0; i < 2; i++) {
      const outputPath = path.join(project.dirs.images, `ref_gen_${i}_${Date.now()}.jpg`);
      await generateImageFromReference(localPath, {
        nuance: "same", style, width, height, outputPath, designRequirements, customPrompt, genMode, provider,
      });
      results.push(`/api/projects/${project.id}/generated-images/${path.basename(outputPath)}`);
      if (i < 1) await new Promise(r => setTimeout(r, 2000));
    }
    res.json({ ok: true, images: results, width, height });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/describe-uploaded - Describe uploaded reference image
app.post("/api/projects/:id/describe-uploaded", async (req, res) => {
  trackAiUsage("describe-uploaded");
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const { localPath, provider } = req.body;
  if (!localPath || !existsSync(localPath)) {
    return res.status(400).json({ error: "Image file not found" });
  }

  try {
    const description = await describeImage(localPath, "", provider || "nanobanana");
    res.json({ description });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/compose-images - Compose two images into one
app.post("/api/projects/:id/compose-images", async (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!project.dirs) return res.status(400).json({ error: "Project not initialized" });

  const { image1Path, image2Path, layout, width, height } = req.body;

  // Resolve paths: could be URLs (/api/projects/.../generated-images/xxx) or absolute paths
  const resolve = (p) => {
    if (p && p.startsWith("/api/projects/")) {
      const file = p.split("/").pop();
      return path.join(project.dirs.images, file);
    }
    return p;
  };

  const abs1 = resolve(image1Path);
  const abs2 = resolve(image2Path);

  if (!abs1 || !existsSync(abs1)) return res.status(400).json({ error: "image1 not found" });
  if (!abs2 || !existsSync(abs2)) return res.status(400).json({ error: "image2 not found" });

  try {
    const outFile = `composed_${Date.now()}.jpg`;
    const outputPath = path.join(project.dirs.images, outFile);

    await composeImages(abs1, abs2, layout || "h2", {
      width: width || 580,
      height: height || 580,
      outputPath,
    });

    const imageUrl = `/api/projects/${project.id}/generated-images/${outFile}`;
    res.json({ ok: true, imageUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/generate-video/:idx - Generate video with VEO3
app.post("/api/projects/:id/generate-video/:idx", async (req, res) => {
  trackAiUsage("generate-video");
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!project.dirs) return res.status(400).json({ error: "Project not initialized" });

  const idx = parseInt(req.params.idx, 10);
  const { prompt, resolution = "720p", duration = "6", format = "mp4" } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  try {
    const ext = format === "gif" ? "gif" : "mp4";
    const outFile = `block_${idx}_video_${Date.now()}.${ext}`;
    const outputPath = path.join(project.dirs.images, outFile);

    await generateVideo(prompt, { outputPath, resolution, durationSeconds: duration });

    // GIF変換が必要な場合
    if (format === "gif") {
      // ffmpegが利用可能な場合のみ（なければmp4のまま）
      try {
        const { execSync } = await import("child_process");
        const gifFile = `block_${idx}_video_${Date.now()}.gif`;
        const gifPath = path.join(project.dirs.images, gifFile);
        execSync(`ffmpeg -i "${outputPath}" -vf "fps=10,scale=480:-1:flags=lanczos" -y "${gifPath}"`, { timeout: 30000 });
        const videoUrl = `/api/projects/${project.id}/generated-images/${gifFile}`;
        return res.json({ ok: true, videoUrl, format: "gif" });
      } catch {
        // ffmpeg not available, return mp4
      }
    }

    const videoUrl = `/api/projects/${project.id}/generated-images/${outFile}`;
    res.json({ ok: true, videoUrl, format: "mp4" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/describe-video/:idx - Describe existing video for prompt
app.post("/api/projects/:id/describe-video/:idx", async (req, res) => {
  trackAiUsage("describe-video");
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const idx = parseInt(req.params.idx, 10);
  const block = project.blocks[idx];
  if (!block) return res.status(404).json({ error: "Block not found" });

  const { localPath } = req.body;

  // Use localPath if provided (uploaded video), otherwise try block's video asset
  let filePath = localPath;
  if (!filePath) {
    const videoAsset = block.assets?.find(a => a.type === "video");
    const assetEntry = videoAsset && project.assets?.find(a => a.originalUrl === videoAsset.src);
    filePath = assetEntry?.localPath;
  }

  if (!filePath || !existsSync(filePath)) {
    return res.status(400).json({ error: "Video file not found" });
  }

  try {
    // For video, extract a frame and describe it
    const context = block.text || project.blocks.slice(Math.max(0, idx - 2), idx + 3)
      .filter(b => b.text).map(b => b.text).join(" ").slice(0, 200);

    // Try to extract a frame with ffmpeg, if not available describe text context
    let description = "";
    try {
      const { execSync } = await import("child_process");
      const framePath = path.join(project.dirs.images, `frame_tmp_${Date.now()}.jpg`);
      execSync(`ffmpeg -i "${filePath}" -ss 1 -vframes 1 -y "${framePath}"`, { timeout: 10000 });
      if (existsSync(framePath)) {
        description = await describeImage(framePath, context);
        // Clean up temp frame
        await import("fs/promises").then(fs => fs.unlink(framePath)).catch(() => {});
      }
    } catch {
      description = context ? `動画コンテンツ: ${context}` : "商品紹介動画";
    }

    res.json({ description });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/upload-video/:idx - Upload video file
app.post("/api/projects/:id/upload-video/:idx", async (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!project.dirs) return res.status(400).json({ error: "Project not initialized" });

  const idx = parseInt(req.params.idx, 10);
  const { videoData, fileName } = req.body;
  if (!videoData) return res.status(400).json({ error: "videoData is required" });

  try {
    const matches = videoData.match(/^data:(video\/\w+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: "Invalid video data format" });

    const buffer = Buffer.from(matches[2], "base64");
    const ext = fileName?.split(".").pop() || "mp4";
    const outFile = `block_${idx}_upload_${Date.now()}.${ext}`;
    const outputPath = path.join(project.dirs.images, outFile);
    await writeFile(outputPath, buffer);

    const videoUrl = `/api/projects/${project.id}/generated-images/${outFile}`;
    res.json({ ok: true, videoUrl, localPath: outputPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve generated images
app.get("/api/projects/:id/generated-images/:file", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project || !project.dirs) return res.status(404).send("Not found");

  const filePath = safePath(project.dirs.images, req.params.file);
  if (!filePath || !existsSync(filePath)) return res.status(404).send("Not found");

  res.sendFile(filePath);
});

// GET /api/projects/:id/text-blocks - Get text blocks for editing
app.get("/api/projects/:id/text-blocks", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const textBlocks = project.blocks
    .filter((b) => (b.type === "text" || b.type === "heading") && b.text)
    .map((b) => ({
      index: b.index,
      type: b.type,
      text: b.text,
      fontSize: b.fontSize,
      hasStrong: b.hasStrong,
      hasColor: b.hasColor,
    }));

  res.json({ textBlocks });
});

// POST /api/projects/:id/text-modify - Bulk text replacement
app.post("/api/projects/:id/text-modify", (req, res) => {
  trackAiUsage("text-modify");
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const config = req.body;
  try {
    // Block-level replacements (from block-by-block tab)
    if (config.blockReplacements && config.blockReplacements.length > 0) {
      const updatedBlocks = applyBlockReplacements(project.blocks, config.blockReplacements);
      project.blocks = updatedBlocks;
      project.modifiedHtml = updatedBlocks.map((b) => b.html).join("\n");

      return res.json({ ok: true, blockCount: project.blocks.length });
    }

    const sourceHtml = project.modifiedHtml || project.html;
    if (!sourceHtml) return res.status(400).json({ error: "No HTML to modify" });

    const modified = applyTextModifications(sourceHtml, config);
    project.modifiedHtml = modified;

    // Re-parse blocks
    const structure = parseHtml(modified);
    project.blocks = structure.blocks;
    project.sections = structure.sections;

    res.json({ ok: true, blockCount: structure.blocks.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/build - Build SB HTML
app.post("/api/projects/:id/build", async (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  try {
    project.status = "building";
    const config = req.body || {};
    config.tagSettings = project.tagSettings;
    config.exitPopup = project.exitPopup;
    if (project.exitPopup?.enabled) {
      const { generateExitPopupHtml } = await import("./src/exit-popup-builder.js");
      config.exitPopupHtml = generateExitPopupHtml(project.exitPopup);
    }
    const sourceHtml = project.modifiedHtml || project.html;
    if (!sourceHtml) {
      project.status = "ready";
      return res.status(400).json({ error: "No HTML to build" });
    }

    const result = buildSbHtml(sourceHtml, config);
    const validation = validateSbHtml(result);

    project.buildResult = result;
    project.validation = validation;
    project.status = "done";
    saveProjectsToDisk();

    const sizeBytes = Buffer.byteLength(result, "utf-8");

    // Save to disk
    if (project.dirs) {
      writeFile(
        path.join(project.dirs.final, `cloned-lp-${project.slug}.html`),
        result,
        "utf-8"
      ).catch(() => {});
    }

    res.json({
      ok: true,
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      sizeBytes,
      sizeFormatted: formatBytes(sizeBytes),
      blockCount: project.blocks.length,
    });
  } catch (err) {
    project.status = "ready";
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id/export - Download final HTML
app.get("/api/projects/:id/export", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const html = project.buildResult || project.modifiedHtml || project.html;
  if (!html) return res.status(400).json({ error: "No HTML to export" });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="cloned-lp-${project.slug}.html"`);
  res.send(html);
});

// GET /api/projects/:id/editor-html - Get current editor HTML (modifiedHtml, not built)
app.get("/api/projects/:id/editor-html", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  const html = project.modifiedHtml || project.blocks.map(b => b.html).join("\n") || project.html || "";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// POST /api/projects/:id/ai-rewrite/:idx - AI text rewrite
app.post("/api/projects/:id/ai-rewrite/:idx", async (req, res) => {
  trackAiUsage("ai-rewrite");
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const idx = parseInt(req.params.idx, 10);
  const block = project.blocks[idx];
  if (!block) return res.status(404).json({ error: "Block not found" });

  const { instruction, text, html: reqHtml, designRequirements, provider = "nanobanana" } = req.body;
  if (!instruction) return res.status(400).json({ error: "instruction is required" });

  let sourceText = text || block.text || "";
  // HTMLからテキスト抽出のフォールバック
  if (!sourceText) {
    const htmlSource = reqHtml || block.html || "";
    if (htmlSource) {
      const cheerio = await import("cheerio");
      const $ = cheerio.load(htmlSource);
      $("style, script").remove();
      sourceText = ($.text() || "").replace(/\s+/g, " ").trim();
    }
  }
  if (!sourceText) return res.status(400).json({ error: "No text to rewrite" });

  try {
    const rewritten = await aiRewriteText(sourceText, instruction, designRequirements || "", provider);
    res.json({ ok: true, original: sourceText, rewritten });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/ocr - OCR text extraction using extract-elements API
app.post("/api/projects/:id/ocr", async (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const idx = parseInt(req.body.blockIndex, 10);
  const block = project.blocks[idx];
  if (!block) return res.status(404).json({ error: "Block not found" });

  try {
    // Check if extract-elements has been called already (cached)
    let elements = project._extractedElements?.[idx];

    if (!elements) {
      // Call extract-elements internally
      const internalUrl = `http://localhost:${PORT}/api/projects/${req.params.id}/extract-elements/${idx}`;
      const extractResp = await fetch(internalUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (extractResp.ok) {
        const extractData = await extractResp.json();
        elements = extractData.elements || [];
      } else {
        elements = [];
      }
    }

    // Filter text-type elements
    const texts = elements
      .filter(el => el.type === "text")
      .map(el => el.content)
      .filter(t => t && t.trim());

    res.json({ texts, count: texts.length });
  } catch (err) {
    console.error(`[ocr] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/extract-elements/:idx - AI Vision element extraction
app.post("/api/projects/:id/extract-elements/:idx", async (req, res) => {
  trackAiUsage("extract-elements");
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const idx = parseInt(req.params.idx, 10);
  const block = project.blocks[idx];
  if (!block) return res.status(404).json({ error: "Block not found" });

  // Collect image sources from block HTML (reuse OCR pattern)
  const cheerio = await import("cheerio");
  const $ = cheerio.load(block.html || "");
  const imgSrcs = [];
  $("img").each((_, el) => {
    const src = $(el).attr("data-src") || $(el).attr("src") || "";
    if (src) imgSrcs.push(src);
  });
  $("source[data-srcset]").each((_, el) => {
    const src = $(el).attr("data-srcset") || "";
    if (src) imgSrcs.push(src);
  });

  if (imgSrcs.length === 0) {
    return res.json({ elements: [] });
  }

  // Get the first image and convert to base64
  let imgSrc = imgSrcs[0];
  let base64, mimeType;
  try {
    if (imgSrc.startsWith("/projects/") || imgSrc.startsWith("projects/")) {
      const localPath = path.join(PROJECT_ROOT, "data", imgSrc.replace(/^\//, ""));
      if (!existsSync(localPath)) return res.json({ elements: [] });
      const buf = await readFile(localPath);
      base64 = buf.toString("base64");
      mimeType = imgSrc.endsWith(".webp") ? "image/webp" : imgSrc.endsWith(".png") ? "image/png" : "image/jpeg";
    } else if (imgSrc.startsWith("http")) {
      const imgResp = await fetch(imgSrc);
      if (!imgResp.ok) return res.json({ elements: [] });
      const buf = Buffer.from(await imgResp.arrayBuffer());
      base64 = buf.toString("base64");
      mimeType = imgResp.headers.get("content-type") || "image/jpeg";
    } else {
      return res.json({ elements: [] });
    }
  } catch (err) {
    return res.status(500).json({ error: `画像取得エラー: ${err.message}` });
  }

  // Try Anthropic Claude Vision first, then Gemini fallback
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  let geminiKey;
  for (let k = 1; k <= 3; k++) {
    const kk = process.env[`GEMINI_API_KEY_${k}`];
    if (kk) { geminiKey = kk; break; }
  }
  if (!geminiKey) geminiKey = process.env.GEMINI_API_KEY;

  const visionPrompt = `この広告画像を分析し、含まれるすべての視覚要素を抽出してください。

各要素について以下の情報をJSON配列で返してください：
- type: "text" | "decoration" | "badge" | "photo" | "background" | "button" | "icon" | "logo" | "separator"
- content: 要素の内容（テキストの場合はテキスト内容、画像の場合は説明）
- boundingBox: { x: 数値(%), y: 数値(%), width: 数値(%), height: 数値(%) } - 画像内での位置（パーセント）
- style: { fontSize: "small"|"medium"|"large"|"xlarge", fontWeight: "normal"|"bold", color: "#hexcolor", backgroundColor: "#hexcolor" または null }
- zIndex: レイヤー順序（0が最背面、大きいほど前面）

重要：
- JSON配列のみを返し、他のテキストは含めないでください
- boundingBoxの値は画像全体に対するパーセンテージで指定
- テキスト要素は文字内容を正確に読み取ってください
- 背景、装飾、バッジ、ボタン、アイコンなども含めてください`;

  try {
    let elements = [];

    if (anthropicKey) {
      // Use Anthropic Claude Vision
      const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
              { type: "text", text: visionPrompt },
            ],
          }],
        }),
      });

      if (!anthropicResp.ok) {
        const errText = await anthropicResp.text();
        console.warn(`[extract-elements] Anthropic API error: ${anthropicResp.status} ${errText}`);
        throw new Error("Anthropic API failed");
      }

      const anthropicData = await anthropicResp.json();
      const responseText = anthropicData.content?.[0]?.text || "";
      elements = parseElementsJson(responseText);
    } else if (geminiKey) {
      // Fallback to Gemini
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
      const geminiResp = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: visionPrompt },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ],
          }],
        }),
      });

      if (!geminiResp.ok) throw new Error("Gemini API failed");
      const geminiData = await geminiResp.json();
      const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
      elements = parseElementsJson(responseText);
    } else {
      return res.status(400).json({ error: "ANTHROPIC_API_KEY または GEMINI_API_KEY を .env に設定してください" });
    }

    // Cache in project
    if (!project._extractedElements) project._extractedElements = {};
    project._extractedElements[idx] = elements;

    res.json({ elements, count: elements.length });
  } catch (err) {
    console.error(`[extract-elements] Error: ${err.message}`);
    res.status(500).json({ error: `要素抽出エラー: ${err.message}` });
  }
});

// Helper: parse JSON array from AI response text
function parseElementsJson(text) {
  // Try to extract JSON array from response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const arr = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(arr)) return [];
    // Normalize elements
    return arr.map((el, i) => ({
      type: el.type || "text",
      content: el.content || "",
      boundingBox: {
        x: el.boundingBox?.x ?? 0,
        y: el.boundingBox?.y ?? 0,
        width: el.boundingBox?.width ?? 100,
        height: el.boundingBox?.height ?? 10,
      },
      style: {
        fontSize: el.style?.fontSize || "medium",
        fontWeight: el.style?.fontWeight || "normal",
        color: el.style?.color || "#000000",
        backgroundColor: el.style?.backgroundColor || null,
      },
      zIndex: el.zIndex ?? i,
    }));
  } catch {
    return [];
  }
}

// GET /api/projects/:id/images - List all project images
app.get("/api/projects/:id/images", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const images = [];
  // From assets
  if (project.assets) {
    project.assets.forEach((a) => {
      if (a.type === "image" || a.src?.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
        images.push({ src: a.src || a.webpSrc, type: "asset", width: a.width, height: a.height });
      }
    });
  }
  // From blocks
  if (project.blocks) {
    project.blocks.forEach((b, i) => {
      if (b.assets) {
        b.assets.forEach(a => {
          if (a.type === "image" || a.src?.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
            images.push({ src: a.src || a.webpSrc, type: "block", blockIndex: i, width: a.width, height: a.height });
          }
        });
      }
    });
  }
  res.json({ images });
});

// POST /api/search-images - Image search proxy
app.post("/api/search-images", async (req, res) => {
  const { query, source = "google" } = req.body;
  if (!query) return res.status(400).json({ error: "query is required" });

  const results = [];
  const providers = [];

  // Google Custom Search
  const googleKey = process.env.GOOGLE_API_KEY;
  const googleCx = process.env.GOOGLE_CX;
  if (source === "google" && googleKey && googleCx) {
    providers.push("google");
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${googleCx}&searchType=image&q=${encodeURIComponent(query)}&num=9`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        (data.items || []).forEach(item => {
          results.push({
            src: item.link,
            thumbnail: item.image?.thumbnailLink || item.link,
            title: item.title,
            width: item.image?.width,
            height: item.image?.height,
            source: "google",
          });
        });
      }
    } catch (err) {
      console.warn(`[search-images] Google error: ${err.message}`);
    }
  }

  // Unsplash
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
  if (source === "unsplash" && unsplashKey) {
    providers.push("unsplash");
    try {
      const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=9&client_id=${unsplashKey}`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        (data.results || []).forEach(photo => {
          results.push({
            src: photo.urls?.regular || photo.urls?.full,
            thumbnail: photo.urls?.thumb || photo.urls?.small,
            title: photo.description || photo.alt_description || "",
            width: photo.width,
            height: photo.height,
            source: "unsplash",
            credit: photo.user?.name,
          });
        });
      }
    } catch (err) {
      console.warn(`[search-images] Unsplash error: ${err.message}`);
    }
  }

  if (!googleKey && !googleCx && !unsplashKey) {
    return res.json({ error: "APIキーを設定してください（GOOGLE_API_KEY + GOOGLE_CX または UNSPLASH_ACCESS_KEY）", providers: [], results: [] });
  }

  if (providers.length === 0) {
    return res.json({ error: `${source} のAPIキーが未設定です`, providers: [], results: [] });
  }

  res.json({ results, providers });
});

// POST /api/projects/:id/auto-keywords/:idx - AI generates search keywords from image
app.post("/api/projects/:id/auto-keywords/:idx", async (req, res) => {
  trackAiUsage("auto-keywords");
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  const idx = parseInt(req.params.idx, 10);
  const block = project.blocks[idx];
  if (!block) return res.status(404).json({ error: "Block not found" });

  // Find first image in block
  const cheerio = await import("cheerio");
  const $ = cheerio.load(block.html || "");
  const imgSrc = $("img").first().attr("data-src") || $("img").first().attr("src") || $("source[data-srcset]").first().attr("data-srcset") || "";
  if (!imgSrc) return res.json({ keywords: "", redKeywords: [] });

  let base64, mimeType;
  try {
    if (imgSrc.startsWith("/projects/") || imgSrc.startsWith("projects/")) {
      const localPath = path.join(PROJECT_ROOT, "data", imgSrc.replace(/^\//, ""));
      if (!existsSync(localPath)) return res.json({ keywords: "", redKeywords: [] });
      const buf = await readFile(localPath);
      base64 = buf.toString("base64");
      mimeType = imgSrc.endsWith(".webp") ? "image/webp" : imgSrc.endsWith(".png") ? "image/png" : "image/jpeg";
    } else if (imgSrc.startsWith("http")) {
      const imgResp = await fetch(imgSrc);
      if (!imgResp.ok) return res.json({ keywords: "", redKeywords: [] });
      const buf = Buffer.from(await imgResp.arrayBuffer());
      base64 = buf.toString("base64");
      mimeType = imgResp.headers.get("content-type") || "image/jpeg";
    } else {
      return res.json({ keywords: "", redKeywords: [] });
    }
  } catch { return res.json({ keywords: "", redKeywords: [] }); }

  // Use Anthropic or Gemini to generate keywords
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  let geminiKey;
  for (let k = 1; k <= 3; k++) { const kk = process.env[`GEMINI_API_KEY_${k}`]; if (kk) { geminiKey = kk; break; } }
  if (!geminiKey) geminiKey = process.env.GEMINI_API_KEY;

  const prompt = `この広告画像の類似画像を検索するための検索キーワードを生成してください。

以下の2つを返してください：
1. 日本語の検索キーワード（半角スペース区切り、3〜5語）
2. 中国語（簡体字）のREDで検索するためのキーワード（3パターン、1行に1パターン）

以下のJSON形式で返してください：
{"keywords": "日本語キーワード", "redKeywords": ["中国語1", "中国語2", "中国語3"]}

JSONのみを返してください。`;

  try {
    let resultText = "";
    if (anthropicKey) {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 500,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
            { type: "text", text: prompt }
          ] }],
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        resultText = data.content?.[0]?.text || "";
      }
    } else if (geminiKey) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
      const resp = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }] }] }),
      });
      if (resp.ok) {
        const data = await resp.json();
        resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
    }

    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      res.json({ keywords: parsed.keywords || "", redKeywords: parsed.redKeywords || [] });
    } else {
      res.json({ keywords: resultText.trim().split("\n")[0] || "", redKeywords: [] });
    }
  } catch (err) {
    console.warn(`[auto-keywords] Error: ${err.message}`);
    res.json({ keywords: "", redKeywords: [] });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, projects: projects.size, uptime: process.uptime() });
});

// Status check - API key configuration
app.get("/api/status", (req, res) => {
  const keys = [];
  for (let i = 1; i <= 3; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k) keys.push(i);
  }
  if (keys.length === 0 && process.env.GEMINI_API_KEY) keys.push(0);
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasPixAI = !!process.env.PIXAI_API_KEY;
  res.json({
    gemini: keys.length > 0,
    geminiKeyCount: keys.length,
    openai: hasOpenAI,
    pixai: hasPixAI,
    providers: getAvailableProviders(),
    version: "1.3.0",
  });
});

// POST /api/set-key - Save Gemini API key at runtime
app.post("/api/set-key", async (req, res) => {
  const { key } = req.body;
  if (!key || typeof key !== "string" || key.trim().length < 10) {
    return res.status(400).json({ error: "有効なAPIキーを入力してください" });
  }

  const trimmedKey = key.trim();

  // Quick validation: try a simple API call
  try {
    const testRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${trimmedKey}`
    );
    if (!testRes.ok) {
      return res.status(400).json({ error: "APIキーが無効です。Google AI Studioで正しいキーを確認してください。" });
    }
  } catch {
    return res.status(400).json({ error: "APIキーの検証に失敗しました。ネットワークを確認してください。" });
  }

  // Set in process.env (runtime)
  // Find first empty slot or use GEMINI_API_KEY
  let saved = false;
  for (let i = 1; i <= 3; i++) {
    if (!process.env[`GEMINI_API_KEY_${i}`]) {
      process.env[`GEMINI_API_KEY_${i}`] = trimmedKey;
      saved = true;
      break;
    }
  }
  if (!saved) {
    process.env.GEMINI_API_KEY = trimmedKey;
  }

  // Also persist to .env file if possible
  try {
    const envPath = path.join(PROJECT_ROOT, ".env");
    let envContent = "";
    if (existsSync(envPath)) {
      envContent = await readFile(envPath, "utf-8");
    }
    // Add or update key
    if (envContent.includes("GEMINI_API_KEY_1=")) {
      // Already has keys, check if this specific key is already there
      if (!envContent.includes(trimmedKey)) {
        // Find empty slot
        for (let i = 1; i <= 3; i++) {
          const pattern = `GEMINI_API_KEY_${i}=`;
          if (!envContent.includes(pattern) || envContent.match(new RegExp(`${pattern}\\s*$`, 'm'))) {
            envContent += `\nGEMINI_API_KEY_${i}=${trimmedKey}`;
            break;
          }
        }
      }
    } else {
      envContent += `\nGEMINI_API_KEY_1=${trimmedKey}`;
    }
    await writeFile(envPath, envContent.trim() + "\n", "utf-8");
  } catch {
    // File write failed - that's ok, runtime env is already set
  }

  res.json({ ok: true, message: "APIキーを保存しました" });
});

// POST /api/set-openai-key - Save OpenAI API key at runtime
app.post("/api/set-openai-key", async (req, res) => {
  const { key } = req.body;
  if (!key || typeof key !== "string" || !key.trim().startsWith("sk-")) {
    return res.status(400).json({ error: "有効なOpenAI APIキーを入力してください（sk-で始まる）" });
  }

  const trimmedKey = key.trim();

  // Quick validation
  try {
    const testRes = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${trimmedKey}` },
    });
    if (!testRes.ok) {
      return res.status(400).json({ error: "OpenAI APIキーが無効です" });
    }
  } catch {
    return res.status(400).json({ error: "APIキーの検証に失敗しました" });
  }

  process.env.OPENAI_API_KEY = trimmedKey;

  // Persist to .env
  try {
    const envPath = path.join(PROJECT_ROOT, ".env");
    let envContent = "";
    if (existsSync(envPath)) envContent = await readFile(envPath, "utf-8");
    if (envContent.includes("OPENAI_API_KEY=")) {
      envContent = envContent.replace(/OPENAI_API_KEY=.*/, `OPENAI_API_KEY=${trimmedKey}`);
    } else {
      envContent += `\nOPENAI_API_KEY=${trimmedKey}`;
    }
    await writeFile(envPath, envContent.trim() + "\n", "utf-8");
  } catch {}

  res.json({ ok: true, message: "OpenAI APIキーを保存しました" });
});

// ── Cloudflare Pages 公開 ─────────────────────────────────

// POST /api/set-cloudflare - Save Cloudflare credentials
app.post("/api/set-cloudflare", async (req, res) => {
  const { apiToken, accountId } = req.body;
  if (!apiToken || !accountId) {
    return res.status(400).json({ error: "APIトークンとアカウントIDが必要です" });
  }

  // Validate token
  try {
    const testRes = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const testData = await testRes.json();
    if (!testData.success) {
      return res.status(400).json({ error: "Cloudflare APIトークンが無効です" });
    }
  } catch {
    return res.status(400).json({ error: "Cloudflare API接続に失敗しました" });
  }

  process.env.CLOUDFLARE_API_TOKEN = apiToken;
  process.env.CLOUDFLARE_ACCOUNT_ID = accountId;

  // Persist to .env
  try {
    const envPath = path.join(PROJECT_ROOT, ".env");
    let envContent = existsSync(envPath) ? await readFile(envPath, "utf-8") : "";
    // Remove old entries
    envContent = envContent.replace(/^CLOUDFLARE_API_TOKEN=.*$/m, "").replace(/^CLOUDFLARE_ACCOUNT_ID=.*$/m, "");
    envContent = envContent.trim() + `\nCLOUDFLARE_API_TOKEN=${apiToken}\nCLOUDFLARE_ACCOUNT_ID=${accountId}\n`;
    await writeFile(envPath, envContent, "utf-8");
  } catch {}

  res.json({ ok: true, message: "Cloudflare設定を保存しました" });
});

// GET /api/cloudflare-status
app.get("/api/cloudflare-status", (req, res) => {
  res.json({
    configured: !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID),
  });
});

// POST /api/projects/:id/publish - Deploy to Cloudflare Pages
app.post("/api/projects/:id/publish", async (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!cfToken || !cfAccountId) {
    return res.status(400).json({ error: "Cloudflare APIトークンが未設定です。先に設定してください。" });
  }

  // Build if not already built
  let html = project.buildResult;
  if (!html) {
    const sourceHtml = project.modifiedHtml || project.html;
    if (!sourceHtml) return res.status(400).json({ error: "公開するHTMLがありません" });
    html = buildSbHtml(sourceHtml, {});
    project.buildResult = html;
  }

  // Wrap in a full HTML page for standalone viewing
  const fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${project.slug || "LP"}</title>
<style>body{margin:0;padding:0;}</style>
</head>
<body>
${html}
</body>
</html>`;

  const projectName = `lp-${project.slug || project.id}`.replace(/[^a-z0-9-]/g, "-").slice(0, 50);

  try {
    // 1. Ensure Pages project exists (create if needed)
    const listRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/pages/projects/${projectName}`,
      { headers: { Authorization: `Bearer ${cfToken}` } }
    );

    if (!listRes.ok) {
      // Create project
      const createRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/pages/projects`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: projectName,
            production_branch: "main",
          }),
        }
      );
      const createData = await createRes.json();
      if (!createData.success) {
        const errMsg = createData.errors?.[0]?.message || "プロジェクト作成失敗";
        // If project already exists with different casing, that's fine
        if (!errMsg.includes("already exists")) {
          return res.status(500).json({ error: errMsg });
        }
      }
    }

    // 2. Direct Upload deployment using form data
    // Create a deployment with the HTML file
    const FormData = (await import("form-data")).default;
    const form = new FormData();
    form.append("index.html", Buffer.from(fullHtml, "utf-8"), {
      filename: "index.html",
      contentType: "text/html",
    });

    const deployRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/pages/projects/${projectName}/deployments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfToken}`,
          ...form.getHeaders(),
        },
        body: form,
      }
    );

    const deployData = await deployRes.json();

    if (!deployData.success) {
      const errMsg = deployData.errors?.[0]?.message || "デプロイ失敗";
      return res.status(500).json({ error: errMsg });
    }

    const deployment = deployData.result;
    const liveUrl = deployment.url || `https://${projectName}.pages.dev`;

    // Store publish info on project
    project.publishedUrl = liveUrl;
    project.publishedAt = new Date().toISOString();
    project.cfProjectName = projectName;

    res.json({
      ok: true,
      url: liveUrl,
      pagesDevUrl: `https://${projectName}.pages.dev`,
      projectName,
      deploymentId: deployment.id,
    });
  } catch (err) {
    res.status(500).json({ error: `公開エラー: ${err.message}` });
  }
});

// ── Widget Template CRUD ────────────────────────────────

const WIDGET_TEMPLATES_PATH = path.join(PROJECT_ROOT, "data", "widget-templates.json");

async function loadWidgetTemplates() {
  try {
    if (existsSync(WIDGET_TEMPLATES_PATH)) {
      const raw = await readFile(WIDGET_TEMPLATES_PATH, "utf-8");
      return JSON.parse(raw);
    }
  } catch {}
  return [];
}

async function saveWidgetTemplates(templates) {
  const dir = path.dirname(WIDGET_TEMPLATES_PATH);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(WIDGET_TEMPLATES_PATH, JSON.stringify(templates, null, 2), "utf-8");
}

app.get("/api/widget-templates", async (req, res) => {
  const templates = await loadWidgetTemplates();
  res.json({ templates });
});

app.post("/api/widget-templates", async (req, res) => {
  const { name, icon, category, description, html, css, isFavorite } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });

  const templates = await loadWidgetTemplates();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const newTemplate = { id, name, icon: icon || "W", category: category || "その他", description: description || "", html: html || "", css: css || "", isFavorite: !!isFavorite, createdAt: new Date().toISOString() };
  templates.push(newTemplate);
  await saveWidgetTemplates(templates);
  res.json({ ok: true, template: newTemplate });
});

app.put("/api/widget-templates/:id", async (req, res) => {
  const templates = await loadWidgetTemplates();
  const idx = templates.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Template not found" });

  Object.assign(templates[idx], req.body, { id: req.params.id });
  await saveWidgetTemplates(templates);
  res.json({ ok: true, template: templates[idx] });
});

app.delete("/api/widget-templates/:id", async (req, res) => {
  let templates = await loadWidgetTemplates();
  templates = templates.filter((t) => t.id !== req.params.id);
  await saveWidgetTemplates(templates);
  res.json({ ok: true });
});

// GET /api/usage-stats - AI usage statistics
app.get("/api/usage-stats", (req, res) => {
  const total = Object.values(apiUsage).reduce((s, n) => s + n, 0);
  res.json({ usage: apiUsage, total });
});

// ── 広告入稿ルート ────────────────────────────────
app.use(createAdRoutes((id) => projects.get(id)));

// 広告マネージャー スタンドアロンページ
app.get("/ad-manager", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "public", "ad-manager.html"));
});

// APP_MODE=ad-manager → ルートで広告マネージャーを表示
const AD_MODE = process.env.APP_MODE === "ad-manager";

// SPA fallback
app.get("*", (req, res) => {
  if (AD_MODE) {
    res.sendFile(path.join(PROJECT_ROOT, "public", "ad-manager.html"));
  } else {
    res.sendFile(path.join(PROJECT_ROOT, "public", "index.html"));
  }
});

app.listen(PORT, () => {
  if (AD_MODE) {
    console.log(`\n  広告入稿マネージャー（スタンドアロン）`);
    console.log(`  http://localhost:${PORT}\n`);
  } else {
    console.log(`\n  Article Cloner UI`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`  広告入稿マネージャー`);
    console.log(`  http://localhost:${PORT}/ad-manager\n`);
  }
});
