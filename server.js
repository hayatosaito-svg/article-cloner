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
import { describeImage, generateImage, generateImageFromReference, buildImagePrompt } from "./src/image-generator.js";
import { buildSbHtml, validateSbHtml } from "./src/html-builder.js";
import {
  PROJECT_ROOT, SCRAPED_DIR, ANALYSIS_DIR, IMAGES_DIR, FINAL_DIR,
  initOutputDirs, urlToSlug, saveJson, loadJson, formatBytes,
} from "./src/utils.js";

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
      const result = await scrape(url, { slug: project.slug });
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
    + '<button data-cmd="justifyRight" title="\u53F3\u63C3\u3048">\u2261</button>';
  document.body.appendChild(toolbar);

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

  // Double-click to enter edit mode
  document.addEventListener('dblclick', function(e) {
    var wrapper = e.target.closest('.block-wrapper');
    if (!wrapper) return;
    var blockIdx = parseInt(wrapper.dataset.blockIndex);
    var blockType = types[blockIdx];
    // Only allow text/heading editing
    if (blockType !== 'text' && blockType !== 'heading') return;

    // Exit previous editing
    if (editingWrapper && editingWrapper !== wrapper) exitEditMode(true);

    e.preventDefault();
    e.stopPropagation();

    editingWrapper = wrapper;
    editingContent = wrapper.children[0]; // The actual content element
    originalHtml = editingContent.innerHTML;

    wrapper.classList.add('editing');
    editingContent.contentEditable = 'true';
    editingContent.focus();
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

    const description = await describeImage(assetEntry.localPath, context);
    res.json({ description });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/generate-image/:idx - Generate image
app.post("/api/projects/:id/generate-image/:idx", async (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!project.dirs) return res.status(400).json({ error: "Project not initialized" });

  const idx = parseInt(req.params.idx, 10);
  const block = project.blocks[idx];
  if (!block) return res.status(404).json({ error: "Block not found" });

  const { prompt, description } = req.body;
  const asset = block.assets?.[0];
  const width = asset?.width || 580;
  const height = asset?.height || 580;

  try {
    const finalPrompt = prompt || buildImagePrompt(description || "product image", "", { width, height });
    const outputPath = path.join(
      project.dirs.images,
      `block_${idx}_${Date.now()}.jpg`
    );

    await generateImage(finalPrompt, { width, height, outputPath });

    const generatedUrl = `/api/projects/${project.id}/generated-images/${path.basename(outputPath)}`;
    res.json({ ok: true, imageUrl: generatedUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/one-click-image/:idx - One-click AI image generation
app.post("/api/projects/:id/one-click-image/:idx", async (req, res) => {
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

  const { nuance = "same", style = "photo", designRequirements = "", customPrompt = "", genMode = "similar" } = req.body;
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
        nuance, style, width, height, outputPath, designRequirements, customPrompt, genMode,
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

// POST /api/projects/:id/ai-rewrite/:idx - AI text rewrite
app.post("/api/projects/:id/ai-rewrite/:idx", async (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const idx = parseInt(req.params.idx, 10);
  const block = project.blocks[idx];
  if (!block) return res.status(404).json({ error: "Block not found" });

  const { instruction, text, designRequirements } = req.body;
  if (!instruction) return res.status(400).json({ error: "instruction is required" });

  const sourceText = text || block.text || "";
  if (!sourceText) return res.status(400).json({ error: "No text to rewrite" });

  // Use Gemini API for text rewriting
  const keys = [];
  for (let i = 1; i <= 3; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k) keys.push(k);
  }
  if (keys.length === 0 && process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  if (keys.length === 0) return res.status(400).json({ error: "GEMINI_API_KEY が未設定です。.envファイルに追加してください。" });

  const key = keys[Math.floor(Math.random() * keys.length)];
  const designContext = designRequirements ? `\nデザイン要件: ${designRequirements}\n上記のトーン・雰囲気に合わせて書き換えてください。` : "";
  const prompt = `以下のテキストを指示に従って書き換えてください。HTMLのインラインスタイル（font-size, color, strong等）は必ず保持してください。書き換え後のテキストのみを返してください。余計な説明は不要です。
${designContext}
指示: ${instruction}

元テキスト:
${sourceText}`;

  try {
    const apiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!apiRes.ok) throw new Error(`Gemini API error: ${apiRes.status}`);

    const data = await apiRes.json();
    const rewritten = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    res.json({ ok: true, original: sourceText, rewritten });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  res.json({
    gemini: keys.length > 0,
    geminiKeyCount: keys.length,
    version: "1.1.0",
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

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n  Article Cloner UI`);
  console.log(`  http://localhost:${PORT}\n`);
});
