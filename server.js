/**
 * server.js - Express API + SSE + Project State Management
 *
 * 既存モジュール(scraper, parser, text-modifier, image-generator, html-builder)を
 * REST API で公開。プロジェクト状態は in-memory Map で管理。
 */
import express from "express";
import path from "path";
import { readFile, writeFile } from "fs/promises";
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
  };
  projects.set(id, project);
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
      sendSSE(project, "progress", { phase: "scrape", message: "スクレイピング開始..." });
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

  res.json({ ok: true, block: { index: block.index, type: block.type } });
});

// GET /api/projects/:id/preview - Preview HTML for iframe
app.get("/api/projects/:id/preview", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const rawHtml = project.modifiedHtml || project.html || "";

  // Rewrite all asset URLs to serve through our API
  const html = rewriteAssetsForPreview(rawHtml, project);

  const previewHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
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
    background: rgba(59, 130, 246, 0.06);
    box-shadow: inset 0 0 0 2px rgba(59, 130, 246, 0.4);
  }
  .block-wrapper.active .block-overlay {
    background: rgba(59, 130, 246, 0.10);
    box-shadow: inset 0 0 0 2px rgba(59, 130, 246, 0.7);
  }
  .block-type-badge {
    position: absolute;
    top: 4px; right: 4px;
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 4px;
    background: rgba(59, 130, 246, 0.85);
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
    outline: 2px solid rgba(59, 130, 246, 0.6);
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
  .inline-toolbar input[type="color"] {
    width: 24px;
    height: 24px;
    border: none;
    background: none;
    cursor: pointer;
    padding: 0;
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

    wrapper.addEventListener('click', function() {
      document.querySelectorAll('.block-wrapper.active').forEach(function(w) { w.classList.remove('active'); });
      wrapper.classList.add('active');
      window.parent.postMessage({ type: 'blockClick', blockIndex: parseInt(wrapper.dataset.blockIndex) }, '*');
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
    + '<input type="color" data-action="foreColor" value="#ffffff" title="\u6587\u5B57\u8272">'
    + '<input type="color" data-action="backColor" value="#000000" title="\u80CC\u666F\u8272">'
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
  toolbar.querySelector('input[data-action="foreColor"]').addEventListener('input', function(e) {
    document.execCommand('foreColor', false, e.target.value);
  });
  toolbar.querySelector('input[data-action="backColor"]').addEventListener('input', function(e) {
    document.execCommand('backColor', false, e.target.value);
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

  // Handle exit message from parent
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'exitInlineEdit') {
      exitEditMode(false);
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

  const { nuance = "same", style = "photo" } = req.body;
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
        nuance, style, width, height, outputPath,
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

  res.json({ ok: true });
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
app.post("/api/projects/:id/build", (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  try {
    project.status = "building";
    const config = req.body || {};
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

  const { instruction, text } = req.body;
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
  const prompt = `以下のテキストを指示に従って書き換えてください。HTMLのインラインスタイル（font-size, color, strong等）は必ず保持してください。書き換え後のテキストのみを返してください。余計な説明は不要です。

指示: ${instruction}

元テキスト:
${sourceText}`;

  try {
    const apiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${key}`,
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
    version: "1.0.0",
  });
});

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n  Article Cloner UI`);
  console.log(`  http://localhost:${PORT}\n`);
});
