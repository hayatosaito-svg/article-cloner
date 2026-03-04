/**
 * panels.js - ブロック編集パネル（手動モード / AIモード対応）
 */

let currentMode = "manual"; // "manual" | "ai"

// ── コミックエディター定数 ─────────────────────────────────
const COMIC_LAYOUTS = [
  { id:"full", name:"1コマ", grid:"1fr / 1fr", cells:1 },
  { id:"h2", name:"2コマ横", grid:"1fr / 1fr 1fr", cells:2 },
  { id:"v2", name:"2コマ縦", grid:"1fr 1fr / 1fr", cells:2 },
  { id:"h3", name:"3コマ横", grid:"1fr / 1fr 1fr 1fr", cells:3 },
  { id:"v3", name:"3コマ縦", grid:"1fr 1fr 1fr / 1fr", cells:3 },
  { id:"grid4", name:"4コマ (2×2)", grid:"1fr 1fr / 1fr 1fr", cells:4 },
  { id:"v4", name:"4コマ縦", grid:"1fr 1fr 1fr 1fr / 1fr", cells:4 },
  { id:"l-shape", name:"L字型", grid:"2fr 1fr / 1fr 1fr", cells:3, areas:"'a a' 'b c'" },
  { id:"l-shape-r", name:"逆L字型", grid:"1fr 2fr / 1fr 1fr", cells:3, areas:"'a b' 'c c'" },
  { id:"t-shape", name:"T字型", grid:"1fr 1fr / 1fr 1fr 1fr", cells:4, areas:"'a a a' 'b c d'" },
  { id:"t-shape-r", name:"逆T字型", grid:"1fr 1fr / 1fr 1fr 1fr", cells:4, areas:"'a b c' 'd d d'" },
  { id:"big-left", name:"大左+小右2", grid:"1fr 1fr / 2fr 1fr", cells:3, areas:"'a b' 'a c'" },
  { id:"big-right", name:"大右+小左2", grid:"1fr 1fr / 1fr 2fr", cells:3, areas:"'a b' 'c b'" },
  { id:"center-4", name:"中央大+周辺4", grid:"1fr 2fr 1fr / 1fr 2fr 1fr", cells:5, areas:"'a b b' 'c d e' 'c f f'" },
  { id:"grid6-2x3", name:"6コマ (2×3)", grid:"1fr 1fr / 1fr 1fr 1fr", cells:6 },
  { id:"grid6-3x2", name:"6コマ (3×2)", grid:"1fr 1fr 1fr / 1fr 1fr", cells:6 },
  { id:"manga3", name:"漫画3コマ", grid:"2fr 1fr / 1fr 1fr", cells:3, areas:"'a b' 'c c'" },
  { id:"manga5", name:"漫画5コマ", grid:"2fr 1fr 1fr / 1fr 1fr", cells:5, areas:"'a a' 'b c' 'd e'" },
  { id:"diagonal", name:"斜め2分割", cells:2, diagonal:true, grid:"1fr / 1fr" },
  { id:"strip3", name:"3段ストリップ", grid:"1fr 1fr 1fr / 1fr", cells:3 },
];

const BUBBLE_TYPES = [
  { id:"none", name:"なし" },
  { id:"round", name:"丸吹き出し", borderRadius:"50%", bg:"#fff", border:"2px solid #000" },
  { id:"rect", name:"角丸四角", borderRadius:"12px", bg:"#fff", border:"2px solid #000" },
  { id:"spike", name:"トゲトゲ", svgPath:true, bg:"#fff" },
  { id:"cloud", name:"もくもく", svgPath:true, bg:"#fff" },
  { id:"shout", name:"叫び", svgPath:true, bg:"#ff0" },
  { id:"think", name:"考え中", borderRadius:"50%", bg:"#fff", border:"2px dashed #666" },
  { id:"narration", name:"ナレーション", borderRadius:"4px", bg:"rgba(0,0,0,0.7)", color:"#fff", border:"none" },
];

// ── 画像テキスト編集 ─ Canvas直接描画方式 ─────────────────
// 元画像をCanvasに描画 → テキスト領域をブラーで消去 → 新テキストを描画
const _textOverlayState = {};
const _canvasEditors = {};

function getOverlayKey(projectId, blockIndex) { return `${projectId}_${blockIndex}`; }

function initTextOverlayState(projectId, blockIndex, originalHtml, elements) {
  const key = getOverlayKey(projectId, blockIndex);
  _textOverlayState[key] = {
    originalHtml,
    elements: elements.map(el => ({
      content: el.content,
      originalContent: el.content,
      boundingBox: el.boundingBox || { x: 0, y: 0, width: 50, height: 10 },
      style: el.style || {},
      type: el.type,
    })),
  };
  return _textOverlayState[key];
}

// ── ブラーベースのテキスト消去（Canvas ctx.filter 使用） ──
function _blurInpaintRegion(baseCtx, bx, by, bw, bh, canvasW, canvasH) {
  // テキスト領域周辺のマージンを含めてキャプチャ（ブラー端のデータ源）
  const margin = Math.max(10, Math.round(Math.max(bw, bh) * 0.25));
  const ex = Math.max(0, bx - margin);
  const ey = Math.max(0, by - margin);
  const ew = Math.min(canvasW - ex, bw + margin * 2);
  const eh = Math.min(canvasH - ey, bh + margin * 2);

  // 拡張領域をtempキャンバスにコピー
  const temp = document.createElement("canvas");
  temp.width = ew; temp.height = eh;
  const tctx = temp.getContext("2d");
  tctx.drawImage(baseCtx.canvas, ex, ey, ew, eh, 0, 0, ew, eh);

  // 2パスの重ブラーでテキストを完全に消去
  const blurRadius = Math.max(10, Math.round(Math.max(bw, bh) * 0.45));
  for (let pass = 0; pass < 2; pass++) {
    const prev = document.createElement("canvas");
    prev.width = ew; prev.height = eh;
    prev.getContext("2d").drawImage(temp, 0, 0);
    tctx.clearRect(0, 0, ew, eh);
    tctx.filter = `blur(${blurRadius}px)`;
    tctx.drawImage(prev, 0, 0);
    tctx.filter = "none";
  }

  // ブラー結果をテキスト領域にだけクリップして描画
  baseCtx.save();
  baseCtx.beginPath();
  baseCtx.rect(bx, by, bw, bh);
  baseCtx.clip();
  baseCtx.drawImage(temp, 0, 0, ew, eh, ex, ey, ew, eh);
  baseCtx.restore();
}

// ctx.filterが使えない環境用フォールバック: 単色塗りつぶし
function _flatFillRegion(baseCtx, bx, by, bw, bh, canvasW, canvasH) {
  const samples = [];
  const m = 3;
  const step = n => Math.max(1, Math.floor(n / 8));
  for (let i = 0; i <= bw; i += step(bw)) {
    const px = Math.min(canvasW - 1, Math.max(0, bx + i));
    samples.push(baseCtx.getImageData(px, Math.max(0, by - m), 1, 1).data);
    samples.push(baseCtx.getImageData(px, Math.min(canvasH - 1, by + bh + m), 1, 1).data);
  }
  for (let j = 0; j <= bh; j += step(bh)) {
    const py = Math.min(canvasH - 1, Math.max(0, by + j));
    samples.push(baseCtx.getImageData(Math.max(0, bx - m), py, 1, 1).data);
    samples.push(baseCtx.getImageData(Math.min(canvasW - 1, bx + bw + m), py, 1, 1).data);
  }
  if (!samples.length) { baseCtx.fillStyle = "#fff"; baseCtx.fillRect(bx, by, bw, bh); return; }
  const s = [0, 0, 0];
  samples.forEach(d => { s[0] += d[0]; s[1] += d[1]; s[2] += d[2]; });
  const n = samples.length;
  baseCtx.fillStyle = `rgb(${Math.round(s[0] / n)},${Math.round(s[1] / n)},${Math.round(s[2] / n)})`;
  baseCtx.fillRect(bx, by, bw, bh);
}

// ── Canvas Editor 初期化 ──
async function initCanvasEditor(imageSrc, elements, projectId, blockIndex) {
  const key = getOverlayKey(projectId, blockIndex);

  // 画像URLが外部の場合、プロキシ経由に変換
  let loadUrl = imageSrc;
  if (imageSrc && /^https?:\/\//.test(imageSrc) && !imageSrc.startsWith(location.origin)) {
    loadUrl = `/api/proxy-image?url=${encodeURIComponent(imageSrc)}`;
  }

  function _buildBase(img) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return false;

    const baseCanvas = document.createElement("canvas");
    baseCanvas.width = w;
    baseCanvas.height = h;
    const baseCtx = baseCanvas.getContext("2d");
    baseCtx.drawImage(img, 0, 0);

    // Canvas taintチェック
    try { baseCtx.getImageData(0, 0, 1, 1); } catch { return false; }

    // ctx.filter サポート判定
    const supportsFilter = typeof baseCtx.filter === "string";

    // 各テキスト領域を消去
    elements.filter(el => el.type === "text").forEach(el => {
      const bb = el.boundingBox;
      const bx = Math.round(bb.x / 100 * w);
      const by = Math.round(bb.y / 100 * h);
      const bw = Math.round(bb.width / 100 * w);
      const bh = Math.round(bb.height / 100 * h);
      if (bw < 2 || bh < 2) return;

      if (supportsFilter) {
        _blurInpaintRegion(baseCtx, bx, by, bw, bh, w, h);
      } else {
        _flatFillRegion(baseCtx, bx, by, bw, bh, w, h);
      }
    });

    _canvasEditors[key] = { baseCanvas, w, h, imageSrc };
    redrawCanvasPreview(projectId, blockIndex);
    return true;
  }

  function _tryLoad(url, useCors) {
    return new Promise((resolve) => {
      const img = new Image();
      if (useCors) img.crossOrigin = "anonymous";
      img.onload = () => {
        try { resolve(_buildBase(img)); }
        catch (e) { console.warn("[canvas] error:", e); resolve(false); }
      };
      img.onerror = () => { console.warn("[canvas] load fail:", url); resolve(false); };
      img.src = url;
    });
  }

  let ok = await _tryLoad(loadUrl, false);
  if (!ok) ok = await _tryLoad(loadUrl, true);
  if (!ok && loadUrl !== imageSrc) ok = await _tryLoad(imageSrc, false);
  return ok;
}

// ── AIクリーン画像でベース差し替え（バックグラウンド） ──
async function upgradeToCleanImage(cleanImageUrl, elements, projectId, blockIndex) {
  const key = getOverlayKey(projectId, blockIndex);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) { resolve(false); return; }
      const baseCanvas = document.createElement("canvas");
      baseCanvas.width = w;
      baseCanvas.height = h;
      baseCanvas.getContext("2d").drawImage(img, 0, 0);
      _canvasEditors[key] = { baseCanvas, w, h, imageSrc: cleanImageUrl };
      redrawCanvasPreview(projectId, blockIndex);
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = cleanImageUrl;
  });
}

function _isLightColor(color) {
  if (!color) return false;
  const m = color.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (m) return (parseInt(m[1], 16) * 0.299 + parseInt(m[2], 16) * 0.587 + parseInt(m[3], 16) * 0.114) > 150;
  const m2 = color.match(/(\d+)/g);
  if (m2 && m2.length >= 3) return (m2[0] * 0.299 + m2[1] * 0.587 + m2[2] * 0.114) > 150;
  return color === "#fff" || color === "white" || color === "#ffffff";
}

// Canvas描画共通: ベース画像 + 全テキスト描画 → Canvasを返す
function _renderCanvasOutput(projectId, blockIndex) {
  const key = getOverlayKey(projectId, blockIndex);
  const editor = _canvasEditors[key];
  const state = _textOverlayState[key];
  if (!editor || !state) return null;

  const { baseCanvas, w, h } = editor;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  ctx.drawImage(baseCanvas, 0, 0);

  const sizeMap = { small: 0.45, medium: 0.6, large: 0.78, xlarge: 0.92 };
  state.elements.forEach(el => {
    if (el.type !== "text") return;
    const bb = el.boundingBox;
    const bx = bb.x / 100 * w, by = bb.y / 100 * h;
    const bw = bb.width / 100 * w, bh = bb.height / 100 * h;

    const ratio = sizeMap[el.style?.fontSize] || 0.6;
    const fontSize = Math.max(10, Math.round(bh * ratio));
    const fontWeight = el.style?.fontWeight || "bold";
    const color = el.style?.color || "#000";

    ctx.save();
    ctx.font = `${fontWeight} ${fontSize}px "Hiragino Kaku Gothic Pro","Yu Gothic","Meiryo",sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const text = el.content || "";
    const maxW = bw - 4;
    const lines = _canvasWrapText(ctx, text, maxW);
    const lh = fontSize * 1.25;
    const startY = by + (bh - lines.length * lh) / 2 + lh / 2;

    // テキストストローク（縁取り）でコントラスト確保
    const strokeW = Math.max(1, Math.round(fontSize * 0.06));
    const isLight = _isLightColor(color);
    ctx.strokeStyle = isLight ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.4)";
    ctx.lineWidth = strokeW;
    ctx.lineJoin = "round";
    lines.forEach((line, i) => {
      ctx.strokeText(line, bx + bw / 2, startY + i * lh, maxW);
    });

    // テキスト本体
    ctx.fillStyle = color;
    lines.forEach((line, i) => {
      ctx.fillText(line, bx + bw / 2, startY + i * lh, maxW);
    });
    ctx.restore();
  });

  return out;
}

// Canvas再描画: iframeへ即時送信（リアルタイムプレビュー）
function redrawCanvasPreview(projectId, blockIndex) {
  const out = _renderCanvasOutput(projectId, blockIndex);
  if (!out) return;
  const dataUrl = out.toDataURL("image/jpeg", 0.88);
  const iframe = document.getElementById("preview-iframe");
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage({
      type: "replaceBlockImage", blockIndex, dataUrl,
    }, "*");
  }
}

function _canvasWrapText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return [text];
  const lines = [];
  let cur = "";
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}

// ★ 分解を解除して元画像に戻す
function sendRestoreBlock(blockIndex) {
  const iframe = document.getElementById("preview-iframe");
  if (!iframe?.contentWindow) return;
  iframe.contentWindow.postMessage({ type: "restoreBlock", blockIndex }, "*");
}

// ★ Canvas編集結果をサーバーに保存（debounced）
let _canvasSaveTimer = null;
function saveCanvasEdit(projectId, blockIndex) {
  if (_canvasSaveTimer) clearTimeout(_canvasSaveTimer);
  _canvasSaveTimer = setTimeout(async () => {
    const out = _renderCanvasOutput(projectId, blockIndex);
    if (!out) return;

    const statusEl = document.getElementById(`canvas-edit-status-${blockIndex}`);
    if (statusEl) statusEl.innerHTML = '<span style="color:#3b82f6">⏳</span> 保存中...';

    const dataUrl = out.toDataURL("image/jpeg", 0.92);
    try {
      const uploadRes = await window.API.uploadImage(projectId, blockIndex, {
        imageData: dataUrl,
        fileName: `canvas_edit_${blockIndex}.jpg`,
      });
      if (uploadRes?.ok && uploadRes.imageUrl) {
        await window.API.applyImage(projectId, blockIndex, {
          imageUrl: uploadRes.imageUrl,
        });
        if (statusEl) statusEl.innerHTML = '<span style="color:#10b981">✓</span> 保存完了';
      }
    } catch (err) {
      console.warn("[canvas-save] Failed:", err.message);
      if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444">✗</span> 保存失敗';
    }
  }, 1500);
}

// ── Debounce付き自動保存 ─────────────────────────────────
let _autoSaveTimer = null;
let _historyPushTimer = null;
function autoSave(projectId, blockIndex, getData, delay = 600) {
  if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(async () => {
    try {
      await window.API.updateBlock(projectId, blockIndex, getData());
      window.loadPreview(true);
      // Debounced history push (group rapid edits into one entry)
      if (_historyPushTimer) clearTimeout(_historyPushTimer);
      _historyPushTimer = setTimeout(() => {
        window.pushHistory?.("edit_block", `ブロック ${blockIndex} を編集`);
      }, 2000);
    } catch (err) {
      window.showToast(`自動保存エラー: ${err.message}`, "error");
    }
  }, delay);
}

// モード切替ボタン
document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode;
    // Re-render current panel if open
    const panel = document.getElementById("edit-panel");
    if (panel.classList.contains("open") && window._currentPanelData) {
      const { projectId, blockIndex, blockType } = window._currentPanelData;
      openEditPanel(projectId, blockIndex, blockType);
    }
  });
});

// ── ライブアニメーションプレビュー ──────────────────────────
function triggerAnimationPreview(blockIndex, animConfig) {
  const iframe = document.getElementById("preview-iframe");
  if (!iframe || !iframe.contentWindow) return;
  iframe.contentWindow.postMessage({
    type: "previewAnimation",
    blockIndex,
    anim: animConfig.anim,
    scroll: animConfig.scroll,
    hover: animConfig.hover,
    speed: animConfig.speed,
  }, "*");
}

function clearAnimationPreview(blockIndex) {
  const iframe = document.getElementById("preview-iframe");
  if (!iframe || !iframe.contentWindow) return;
  iframe.contentWindow.postMessage({
    type: "clearAnimationPreview",
    blockIndex,
  }, "*");
}

// ── 共通アニメーションセクション ──────────────────────────────
function buildAnimationSection(blockIndex) {
  const section = document.createElement("div");
  section.className = "panel-section";
  const titleEl = document.createElement("div");
  titleEl.className = "panel-section-title";
  titleEl.textContent = "アニメーション";
  section.appendChild(titleEl);

  let selectedAnim = "";
  let selectedScroll = "";
  let selectedHover = "";
  let selectedSpeed = "0.6s";

  function firePreview() {
    triggerAnimationPreview(blockIndex, {
      anim: selectedAnim,
      scroll: selectedScroll,
      hover: selectedHover,
      speed: selectedSpeed,
    });
  }

  // CSSアニメーション
  const animLabel = document.createElement("div");
  animLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin-bottom:4px";
  animLabel.textContent = "CSSアニメーション";
  section.appendChild(animLabel);
  const animRow = document.createElement("div");
  animRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px";
  const animations = [
    { value: "", label: "なし" },
    { value: "fadeIn", label: "フェードイン" },
    { value: "slideInUp", label: "スライドアップ" },
    { value: "slideInLeft", label: "スライド左" },
    { value: "slideInRight", label: "スライド右" },
    { value: "bounceIn", label: "バウンス" },
    { value: "pulse", label: "パルス" },
    { value: "shake", label: "シェイク" },
    { value: "zoomIn", label: "ズームイン" },
    { value: "flipIn", label: "フリップ" },
  ];
  animations.forEach(a => {
    const btn = document.createElement("button");
    btn.className = a.value === "" ? "anim-chip active" : "anim-chip";
    btn.textContent = a.label;
    btn.addEventListener("click", () => {
      selectedAnim = a.value;
      animRow.querySelectorAll(".anim-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      firePreview();
    });
    animRow.appendChild(btn);
  });
  section.appendChild(animRow);

  // スクロール連動
  const scrollLabel = document.createElement("div");
  scrollLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin-bottom:4px";
  scrollLabel.textContent = "スクロール連動（表示時に発動）";
  section.appendChild(scrollLabel);
  const scrollRow = document.createElement("div");
  scrollRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px";
  const scrollEffects = [
    { value: "", label: "なし" },
    { value: "scrollFadeIn", label: "フェードイン" },
    { value: "scrollSlideUp", label: "スライドアップ" },
    { value: "scrollZoom", label: "ズーム" },
    { value: "scrollBlur", label: "ブラー解除" },
  ];
  scrollEffects.forEach(s => {
    const btn = document.createElement("button");
    btn.className = s.value === "" ? "anim-chip active" : "anim-chip";
    btn.textContent = s.label;
    btn.addEventListener("click", () => {
      selectedScroll = s.value;
      scrollRow.querySelectorAll(".anim-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      firePreview();
    });
    scrollRow.appendChild(btn);
  });
  section.appendChild(scrollRow);

  // ホバーエフェクト
  const hoverLabel = document.createElement("div");
  hoverLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin-bottom:4px";
  hoverLabel.textContent = "ホバーエフェクト";
  section.appendChild(hoverLabel);
  const hoverRow = document.createElement("div");
  hoverRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px";
  const hoverEffects = [
    { value: "", label: "なし" },
    { value: "hoverScale", label: "拡大" },
    { value: "hoverBright", label: "明るく" },
    { value: "hoverShadow", label: "影追加" },
    { value: "hoverLift", label: "浮かせる" },
    { value: "hoverGray", label: "グレー→カラー" },
  ];
  hoverEffects.forEach(h => {
    const btn = document.createElement("button");
    btn.className = h.value === "" ? "anim-chip active" : "anim-chip";
    btn.textContent = h.label;
    btn.addEventListener("click", () => {
      selectedHover = h.value;
      hoverRow.querySelectorAll(".anim-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      firePreview();
    });
    hoverRow.appendChild(btn);
  });
  section.appendChild(hoverRow);

  // 速度
  const speedRow = document.createElement("div");
  speedRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px";
  const speedLabel = document.createElement("span");
  speedLabel.style.cssText = "font-size:11px;color:var(--text-muted)";
  speedLabel.textContent = "速度:";
  const speedSelect = document.createElement("select");
  speedSelect.className = "form-input";
  speedSelect.style.cssText = "font-size:11px;padding:4px 6px;width:auto";
  [{ v: "0.3s", l: "速い" }, { v: "0.6s", l: "普通" }, { v: "1s", l: "遅い" }, { v: "1.5s", l: "とても遅い" }].forEach(o => {
    const opt = document.createElement("option");
    opt.value = o.v;
    opt.textContent = o.l;
    if (o.v === "0.6s") opt.selected = true;
    speedSelect.appendChild(opt);
  });
  speedSelect.addEventListener("change", () => {
    selectedSpeed = speedSelect.value;
    firePreview();
  });
  speedRow.appendChild(speedLabel);
  speedRow.appendChild(speedSelect);
  section.appendChild(speedRow);

  // プレビューボタン
  const previewBtn = document.createElement("button");
  previewBtn.className = "anim-preview-btn";
  previewBtn.textContent = "プレビュー再生";
  previewBtn.addEventListener("click", firePreview);
  section.appendChild(previewBtn);

  return {
    section,
    getValues: () => ({ anim: selectedAnim, scroll: selectedScroll, hover: selectedHover, speed: selectedSpeed }),
  };
}

// ── 折りたたみ3パネルビュー ──────────────────────────────────
function buildCollapsible3Pane(projectId, blockIndex, block) {
  const wrapper = document.createElement("div");
  wrapper.className = "collapsible-3pane";

  const header = document.createElement("div");
  header.className = "collapsible-3pane-header";
  header.innerHTML = '<span>▶</span><span>CSS / テキスト / HTMLソース</span>';
  wrapper.appendChild(header);

  const body = document.createElement("div");
  body.className = "collapsible-3pane-body";

  header.addEventListener("click", () => {
    wrapper.classList.toggle("open");
    header.querySelector("span").textContent = wrapper.classList.contains("open") ? "▼" : "▶";
    // 初回展開時にコンテンツをビルド
    if (wrapper.classList.contains("open") && body.children.length === 0) {
      body.appendChild(build3PanePanel(projectId, blockIndex, block));
    }
  });

  wrapper.appendChild(body);
  return wrapper;
}

async function openEditPanel(projectId, blockIndex, blockType) {
  const panel = document.getElementById("edit-panel");
  const body = document.getElementById("edit-panel-body");
  const typeEl = document.getElementById("edit-panel-type");
  const indexEl = document.getElementById("edit-panel-index");

  typeEl.textContent = blockType;
  indexEl.textContent = blockIndex;

  window._currentPanelData = { projectId, blockIndex, blockType };

  let block;
  try {
    block = await window.API.getBlock(projectId, blockIndex);
  } catch (err) {
    body.innerHTML = `<p style="color:var(--red)">読み込みエラー: ${err.message}</p>`;
    panel.classList.add("open");
    return;
  }

  body.innerHTML = "";

  // モードボタンのアクティブ状態を更新（ユーザー選択をそのまま尊重）
  document.querySelectorAll(".mode-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === currentMode);
  });

  // widgetでも画像を含んでいれば画像ブロックとして扱う
  const blockHtmlLower = (block.html || "").toLowerCase();
  const widgetHasImage = blockType === "widget" && (blockHtmlLower.includes("<img") || blockHtmlLower.includes("<picture"));
  const widgetHasVideo = blockType === "widget" && !widgetHasImage && blockHtmlLower.includes("<video");

  if (currentMode === "ai") {
    // ── AI利用カウント表示 ──
    const usageBadgeContainer = document.createElement("div");
    usageBadgeContainer.style.cssText = "display:flex;justify-content:flex-end;padding:4px 0 8px";
    const usageBadge = document.createElement("span");
    usageBadge.className = "ai-usage-badge";
    usageBadge.textContent = "AI: ...";
    usageBadgeContainer.appendChild(usageBadge);
    body.appendChild(usageBadgeContainer);
    window.API.getUsageStats().then(data => {
      usageBadge.textContent = `AI: ${data.total || 0}回`;
    }).catch(() => { usageBadge.textContent = "AI: -"; });

    // ── AI編集モード: 全体編集 / 要素編集 の分岐 ──
    body.appendChild(buildAiModeSwitcher(projectId, blockIndex, block, blockType, widgetHasImage, widgetHasVideo));
  } else {
    // ── 手動編集モード（プレビュー→要素抽出→詳細編集→3パネル） ──
    body.appendChild(buildBlockEditContent(projectId, blockIndex, block, blockType, widgetHasImage, widgetHasVideo));
  }

  panel.classList.add("open");
}

// 手動モード: プレビュー画像 → 要素抽出 → 各要素にアニメーション設定
function buildManualPanelContent(projectId, blockIndex, block, blockType) {
  const frag = document.createDocumentFragment();
  const blockHtml = block.html || "";

  // ─── Step 1: ブロックプレビュー画像 ───
  const previewSec = document.createElement("div");
  previewSec.style.cssText = "padding:12px 14px;border-bottom:1px solid var(--border)";

  // プレビュー画像（HTMLからキャプチャ的に表示）
  const previewBox = document.createElement("div");
  previewBox.style.cssText = "background:#fff;border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:300px;overflow-y:auto";
  const previewContent = document.createElement("div");
  previewContent.style.cssText = "padding:8px;font-size:12px;line-height:1.6";
  // ブロックタイプに応じたプレビュー
  const parsedDoc = new DOMParser().parseFromString(blockHtml, "text/html");
  const imgEls = parsedDoc.querySelectorAll("img");
  const videoEls = parsedDoc.querySelectorAll("video, source[type*=video]");
  if (imgEls.length > 0) {
    imgEls.forEach(img => {
      const src = img.getAttribute("data-src") || img.getAttribute("src") || "";
      if (src) {
        const previewImg = document.createElement("img");
        previewImg.src = src;
        previewImg.style.cssText = "width:100%;height:auto;display:block;border-radius:4px;margin-bottom:4px";
        previewImg.onerror = () => { previewImg.style.display = "none"; };
        previewContent.appendChild(previewImg);
      }
    });
  } else if (videoEls.length > 0) {
    const videoIcon = document.createElement("div");
    videoIcon.style.cssText = "text-align:center;padding:32px;color:var(--text-muted);font-size:14px";
    videoIcon.innerHTML = "🎬 動画ブロック";
    previewContent.appendChild(videoIcon);
  } else {
    // テキストやウィジェットはHTMLレンダリング
    previewContent.innerHTML = blockHtml;
  }
  previewBox.appendChild(previewContent);
  previewSec.appendChild(previewBox);

  // ブロック情報バッジ
  const infoBadge = document.createElement("div");
  infoBadge.style.cssText = "display:flex;gap:6px;margin-top:8px;flex-wrap:wrap";
  const typeLabel = { text: "テキスト", heading: "見出し", image: "画像", video: "動画", cta_link: "CTAリンク", widget: "ウィジェット", spacer: "スペーサー" };
  infoBadge.innerHTML = `<span style="font-size:10px;padding:2px 8px;background:rgba(236,72,153,0.1);color:#ec4899;border-radius:8px;font-weight:600">${typeLabel[blockType] || blockType}</span><span style="font-size:10px;padding:2px 8px;background:var(--bg-tertiary);color:var(--text-muted);border-radius:8px">Block #${blockIndex}</span>`;
  previewSec.appendChild(infoBadge);

  frag.appendChild(previewSec);

  // ─── Step 2: 「要素を抽出」ボタン → 各要素リスト ───
  const extractSec = document.createElement("div");
  extractSec.style.cssText = "padding:12px 14px;border-bottom:1px solid var(--border)";

  const extractBtn = document.createElement("button");
  extractBtn.className = "bp-action-btn bp-action-ai";
  extractBtn.style.cssText = "width:100%;margin-bottom:10px";
  extractBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z" stroke="currentColor" stroke-width="1.2"/></svg> 要素を抽出する';

  const elementsContainer = document.createElement("div");
  elementsContainer.style.display = "none";

  extractBtn.addEventListener("click", () => {
    extractBtn.style.display = "none";
    elementsContainer.style.display = "";
    buildExtractedElements(elementsContainer, projectId, blockIndex, block, blockType, blockHtml);
  });

  extractSec.appendChild(extractBtn);
  extractSec.appendChild(elementsContainer);
  frag.appendChild(extractSec);

  // ─── Step 3: ブロックタイプ別の詳細編集（折りたたみ） ───
  const detailSec = createCollapsibleSection("✏️", "詳細編集", null, false);
  // widgetでも画像/動画を含むか判定
  const _bHtml = (block.html || "").toLowerCase();
  const _wHasImg = blockType === "widget" && (_bHtml.includes("<img") || _bHtml.includes("<picture"));
  const _wHasVid = blockType === "widget" && !_wHasImg && _bHtml.includes("<video");

  if (blockType === "text" || blockType === "heading") {
    detailSec.body.appendChild(buildTextPanel(projectId, blockIndex, block));
  } else if (blockType === "image" || _wHasImg) {
    detailSec.body.appendChild(buildImageQuickPanel(projectId, blockIndex, block));
  } else if (blockType === "video" || _wHasVid) {
    detailSec.body.appendChild(buildVideoQuickPanel(projectId, blockIndex, block));
  } else if (blockType === "cta_link") {
    detailSec.body.appendChild(buildCtaPanel(projectId, blockIndex, block));
  } else if (blockType === "widget") {
    detailSec.body.appendChild(buildWidgetPanel(projectId, blockIndex, block));
  } else if (blockType === "spacer") {
    detailSec.body.appendChild(buildSpacerPanel(block));
  } else {
    detailSec.body.innerHTML = `<p style="color:var(--text-muted)">タイプ: ${blockType}</p>`;
  }
  frag.appendChild(detailSec.wrapper);

  // ─── 折りたたみ3パネルビュー（CSS/テキスト/HTMLソース） ───
  frag.appendChild(buildCollapsible3Pane(projectId, blockIndex, block));

  return frag;
}

// AI編集モード: 全体編集 / 要素編集 の切替UI
function buildAiModeSwitcher(projectId, blockIndex, block, blockType, widgetHasImage, widgetHasVideo) {
  const frag = document.createDocumentFragment();
  const blockHtml = block.html || "";

  // ── サブモード切替ボタン ──
  const switchBar = document.createElement("div");
  switchBar.style.cssText = "display:flex;gap:6px;margin-bottom:14px";

  const btnGlobal = document.createElement("button");
  btnGlobal.className = "ai-sub-mode-btn active";
  btnGlobal.dataset.submode = "global";
  btnGlobal.textContent = "全体編集";

  const btnElement = document.createElement("button");
  btnElement.className = "ai-sub-mode-btn";
  btnElement.dataset.submode = "element";
  btnElement.textContent = "要素編集";

  switchBar.appendChild(btnGlobal);
  switchBar.appendChild(btnElement);
  frag.appendChild(switchBar);

  // ── コンテンツ領域 ──
  const contentArea = document.createElement("div");
  frag.appendChild(contentArea);

  function renderSubMode(mode) {
    contentArea.innerHTML = "";
    switchBar.querySelectorAll(".ai-sub-mode-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.submode === mode);
    });

    if (mode === "global") {
      // ── 全体編集 ──
      if (blockType === "video" || widgetHasVideo) {
        // 動画 → VEO3ウィザード
        contentArea.appendChild(buildVideoWizard(projectId, blockIndex, block));
      } else {
        // 動画以外は全てウィザード統一
        contentArea.appendChild(buildAiImageWizard(projectId, blockIndex, block));
        // CTA リンクブロックにはURL編集も追加
        if (blockType === "cta_link") {
          contentArea.appendChild(buildCtaUrlEditor(projectId, blockIndex, block));
        }
      }
    } else {
      // ── 要素編集: 要素抽出 → 各要素AI編集 ──
      const extractSec = document.createElement("div");
      const elementsContainer = document.createElement("div");
      extractSec.appendChild(elementsContainer);
      contentArea.appendChild(extractSec);
      buildExtractedElements(elementsContainer, projectId, blockIndex, block, blockType, blockHtml);
    }
  }

  // 初期表示
  renderSubMode("global");

  // クリックイベント
  [btnGlobal, btnElement].forEach(btn => {
    btn.addEventListener("click", () => {
      renderSubMode(btn.dataset.submode);
    });
  });

  return frag;
}

// 手動編集モード: プレビュー→要素自動抽出→詳細編集→3パネル
function buildBlockEditContent(projectId, blockIndex, block, blockType, widgetHasImage, widgetHasVideo) {
  const frag = document.createDocumentFragment();
  const blockHtml = block.html || "";

  // ─── Step 1: ブロックプレビュー画像 ───
  const previewSec = document.createElement("div");
  previewSec.style.cssText = "padding:12px 14px;border-bottom:1px solid var(--border)";

  const previewBox = document.createElement("div");
  previewBox.style.cssText = "background:#fff;border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:300px;overflow-y:auto";
  const previewContent = document.createElement("div");
  previewContent.style.cssText = "padding:8px;font-size:12px;line-height:1.6";
  const parsedDoc = new DOMParser().parseFromString(blockHtml, "text/html");
  const imgEls = parsedDoc.querySelectorAll("img");
  const videoEls = parsedDoc.querySelectorAll("video, source[type*=video]");
  if (imgEls.length > 0) {
    imgEls.forEach(img => {
      const src = img.getAttribute("data-src") || img.getAttribute("src") || "";
      if (src) {
        const previewImg = document.createElement("img");
        previewImg.src = src;
        previewImg.style.cssText = "width:100%;height:auto;display:block;border-radius:4px;margin-bottom:4px";
        previewImg.onerror = () => { previewImg.style.display = "none"; };
        previewContent.appendChild(previewImg);
      }
    });
  } else if (videoEls.length > 0) {
    const videoIcon = document.createElement("div");
    videoIcon.style.cssText = "text-align:center;padding:32px;color:var(--text-muted);font-size:14px";
    videoIcon.innerHTML = "🎬 動画ブロック";
    previewContent.appendChild(videoIcon);
  } else {
    previewContent.innerHTML = blockHtml;
  }
  previewBox.appendChild(previewContent);
  previewSec.appendChild(previewBox);

  const infoBadge = document.createElement("div");
  infoBadge.style.cssText = "display:flex;gap:6px;margin-top:8px;flex-wrap:wrap";
  const typeLabel = { text: "テキスト", heading: "見出し", image: "画像", video: "動画", cta_link: "CTAリンク", widget: "ウィジェット", spacer: "スペーサー" };
  infoBadge.innerHTML = `<span style="font-size:10px;padding:2px 8px;background:rgba(236,72,153,0.1);color:#ec4899;border-radius:8px;font-weight:600">${typeLabel[blockType] || blockType}</span><span style="font-size:10px;padding:2px 8px;background:var(--bg-tertiary);color:var(--text-muted);border-radius:8px">Block #${blockIndex}</span>`;
  previewSec.appendChild(infoBadge);
  frag.appendChild(previewSec);

  // ─── Step 2: 要素抽出（自動実行、ボタンなし） ───
  const extractSec = document.createElement("div");
  extractSec.style.cssText = "padding:12px 14px;border-bottom:1px solid var(--border)";
  const elementsContainer = document.createElement("div");
  extractSec.appendChild(elementsContainer);
  frag.appendChild(extractSec);
  // 自動で要素抽出を実行
  buildExtractedElements(elementsContainer, projectId, blockIndex, block, blockType, blockHtml);

  // ─── Step 3: ブロックタイプ別の詳細編集（折りたたみ） ───
  const detailSec = createCollapsibleSection("✏️", "詳細編集", null, false);
  const _bHtml = (block.html || "").toLowerCase();
  const _wHasImg = blockType === "widget" && (_bHtml.includes("<img") || _bHtml.includes("<picture"));
  const _wHasVid = blockType === "widget" && !_wHasImg && _bHtml.includes("<video");

  if (blockType === "text" || blockType === "heading") {
    detailSec.body.appendChild(buildTextPanel(projectId, blockIndex, block));
  } else if (blockType === "image" || _wHasImg) {
    detailSec.body.appendChild(buildImageQuickPanel(projectId, blockIndex, block));
  } else if (blockType === "video" || _wHasVid) {
    detailSec.body.appendChild(buildVideoQuickPanel(projectId, blockIndex, block));
  } else if (blockType === "cta_link") {
    detailSec.body.appendChild(buildCtaPanel(projectId, blockIndex, block));
  } else if (blockType === "widget") {
    detailSec.body.appendChild(buildWidgetPanel(projectId, blockIndex, block));
  } else if (blockType === "spacer") {
    detailSec.body.appendChild(buildSpacerPanel(block));
  } else {
    detailSec.body.innerHTML = `<p style="color:var(--text-muted)">タイプ: ${blockType}</p>`;
  }
  frag.appendChild(detailSec.wrapper);

  // ─── Step 4: 折りたたみ3パネルビュー（CSS/テキスト/HTMLソース） ───
  frag.appendChild(buildCollapsible3Pane(projectId, blockIndex, block));

  return frag;
}

// 要素抽出 → AI Vision or fal.ai RGBA分解
function buildExtractedElements(container, projectId, blockIndex, block, blockType, blockHtml) {
  const TYPE_ICONS = { text: "✏️", decoration: "🏷️", badge: "🏷️", photo: "🖼️", background: "🎨", button: "🔘", icon: "⭐", logo: "⭐", separator: "➖", image: "🖼️", shape: "◆" };
  const cacheKey = `extract_${projectId}_${blockIndex}`;
  const falCacheKey = `fal_layers_${projectId}_${blockIndex}`;

  // Check fal.ai cache first (RGBA layers)
  const falCached = localStorage.getItem(falCacheKey);
  if (falCached) {
    try {
      const data = JSON.parse(falCached);
      renderFalLayerEditor(container, data.elements, projectId, blockIndex, blockHtml, TYPE_ICONS);
      return;
    } catch {}
  }

  // Check AI Vision cache
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const elements = JSON.parse(cached);
      renderElementsList(container, elements, projectId, blockIndex, blockHtml, TYPE_ICONS);
      return;
    } catch {}
  }

  // Show method selection
  const selector = document.createElement("div");
  selector.style.cssText = "padding:12px;text-align:center";
  selector.innerHTML = `
    <div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:12px">レイヤー分解方式を選択</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button id="fal-decompose" class="panel-btn" style="padding:12px 16px;font-size:12px;font-weight:700;background:linear-gradient(135deg,#8b5cf6,#06b6d4);color:#fff;border:none;border-radius:8px;cursor:pointer;box-shadow:0 2px 8px rgba(139,92,246,0.3)">
        🧠 fal.ai RGBA分解（推奨）<br><span style="font-size:10px;font-weight:400;opacity:0.8">Qwen-Image-Layered / 実レイヤーPNG</span>
      </button>
      <button id="vision-decompose" class="panel-btn" style="padding:10px 16px;font-size:11px;font-weight:600;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;cursor:pointer">
        👁 AI Vision 分解<br><span style="font-size:10px;font-weight:400;color:var(--text-muted)">Anthropic/Gemini / バウンディングボックス</span>
      </button>
    </div>`;
  container.appendChild(selector);

  selector.querySelector("#fal-decompose").addEventListener("click", () => {
    container.innerHTML = '<div style="text-align:center;padding:20px"><span class="spinner"></span><div style="font-size:12px;color:var(--text-muted);margin-top:8px">fal.ai Qwen-Image-Layered で RGBA 分解中...</div><div style="font-size:10px;color:var(--text-muted);margin-top:4px">（初回は30秒〜2分かかります）</div></div>';

    window.API.decomposeLayers(projectId, blockIndex, { numLayers: 6 }).then(result => {
      container.innerHTML = "";
      if (result.elements && result.elements.length > 0) {
        try { localStorage.setItem(falCacheKey, JSON.stringify(result)); } catch {}
        renderFalLayerEditor(container, result.elements, projectId, blockIndex, blockHtml, TYPE_ICONS);
      } else {
        container.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:16px">レイヤーが生成されませんでした</div>';
      }
    }).catch(err => {
      container.innerHTML = `<div style="text-align:center;padding:16px"><div style="color:#ef4444;font-size:12px;margin-bottom:8px">RGBA分解エラー: ${err.message}</div><button class="panel-btn" id="retry-fal" style="font-size:11px">再試行</button><button class="panel-btn" id="fallback-vision" style="font-size:11px;margin-left:8px">AI Vision で代替</button></div>`;
      container.querySelector("#retry-fal")?.addEventListener("click", () => {
        container.innerHTML = "";
        buildExtractedElements(container, projectId, blockIndex, block, blockType, blockHtml);
      });
      container.querySelector("#fallback-vision")?.addEventListener("click", () => {
        container.innerHTML = '<div style="text-align:center;padding:20px"><span class="spinner"></span><div style="font-size:12px;color:var(--text-muted);margin-top:8px">AI Vision でレイヤー階層分解中...</div></div>';
        doVisionDecompose();
      });
    });
  });

  selector.querySelector("#vision-decompose").addEventListener("click", () => {
    container.innerHTML = '<div style="text-align:center;padding:20px"><span class="spinner"></span><div style="font-size:12px;color:var(--text-muted);margin-top:8px">AI Vision でレイヤー階層分解中...</div></div>';
    doVisionDecompose();
  });

  function doVisionDecompose() {
    window.API.extractElements(projectId, blockIndex).then(result => {
      container.innerHTML = "";
      if (result.elements && result.elements.length > 0) {
        try { localStorage.setItem(cacheKey, JSON.stringify(result.elements)); } catch {}
        renderElementsList(container, result.elements, projectId, blockIndex, blockHtml, TYPE_ICONS);
      } else {
        container.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:16px">要素が見つかりませんでした</div>';
      }
    }).catch(err => {
      container.innerHTML = `<div style="text-align:center;padding:16px"><div style="color:#ef4444;font-size:12px;margin-bottom:8px">要素抽出エラー: ${err.message}</div><button class="panel-btn" id="retry-extract" style="font-size:11px">再試行</button></div>`;
      container.querySelector("#retry-extract")?.addEventListener("click", () => {
        container.innerHTML = "";
        buildExtractedElements(container, projectId, blockIndex, block, blockType, blockHtml);
      });
    });
  }
}

// ─── fal.ai RGBA レイヤーエディター（DOM-based Canvas）───
function renderFalLayerEditor(container, elements, projectId, blockIndex, blockHtml, TYPE_ICONS) {
  const TYPE_COLORS = {
    background: { bg: "rgba(107,114,128,0.12)", color: "#6b7280", border: "#6b7280" },
    image:      { bg: "rgba(6,182,212,0.12)", color: "#06b6d4", border: "#06b6d4" },
    text:       { bg: "rgba(59,130,246,0.12)", color: "#3b82f6", border: "#3b82f6" },
    decoration: { bg: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "#f59e0b" },
    shape:      { bg: "rgba(236,72,153,0.12)", color: "#ec4899", border: "#ec4899" },
    icon:       { bg: "rgba(16,185,129,0.12)", color: "#10b981", border: "#10b981" },
    button:     { bg: "rgba(239,68,68,0.12)", color: "#ef4444", border: "#ef4444" },
    separator:  { bg: "rgba(107,114,128,0.12)", color: "#6b7280", border: "#6b7280" },
    badge:      { bg: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "#f59e0b" },
    photo:      { bg: "rgba(16,185,129,0.12)", color: "#10b981", border: "#10b981" },
  };

  // State
  let selectedId = null;
  let editingId = null;
  let canvasW = 412, canvasH = 0;
  let previewScale = 1;
  const originalBlockHtml = blockHtml;

  // ── Header ──
  const header = document.createElement("div");
  header.style.cssText = "font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:8px;display:flex;align-items:center;justify-content:space-between";
  header.innerHTML = `<span>🧠 RGBA レイヤーエディター（${elements.length}層）</span>`;

  const headerBtns = document.createElement("div");
  headerBtns.style.cssText = "display:flex;gap:4px";

  const refreshBtn = document.createElement("button");
  refreshBtn.style.cssText = "font-size:10px;padding:2px 8px;border:1px solid var(--border);border-radius:4px;background:none;color:var(--text-muted);cursor:pointer";
  refreshBtn.textContent = "🔄";
  refreshBtn.title = "再分解（キャッシュクリア）";
  refreshBtn.addEventListener("click", () => {
    localStorage.removeItem(`fal_layers_${projectId}_${blockIndex}`);
    container.innerHTML = "";
    buildExtractedElements(container, projectId, blockIndex, null, null, blockHtml);
  });
  headerBtns.appendChild(refreshBtn);

  const restoreBtn = document.createElement("button");
  restoreBtn.style.cssText = "font-size:10px;padding:2px 8px;border:1px solid var(--border);border-radius:4px;background:none;color:var(--text-muted);cursor:pointer";
  restoreBtn.textContent = "🖼";
  restoreBtn.title = "元画像に戻す";
  restoreBtn.addEventListener("click", () => sendRestoreBlock(blockIndex));
  headerBtns.appendChild(restoreBtn);

  header.appendChild(headerBtns);
  container.appendChild(header);

  // ── DOM-based Canvas Preview ──
  const canvasContainer = document.createElement("div");
  canvasContainer.style.cssText = "border-radius:8px;overflow:hidden;margin-bottom:10px;border:1px solid var(--border);background:#f0f0f0;background-image:repeating-conic-gradient(#e5e5e5 0% 25%, transparent 0% 50%);background-size:12px 12px";

  const canvas = document.createElement("div");
  canvas.style.cssText = "position:relative;width:100%;overflow:hidden;cursor:default;user-select:none";

  // Load first layer to determine canvas height
  const firstLayer = elements[0];
  if (firstLayer?.layerImageUrl) {
    const sizeImg = new Image();
    sizeImg.onload = () => {
      const ratio = sizeImg.naturalHeight / sizeImg.naturalWidth;
      canvasH = Math.round(canvasContainer.offsetWidth * ratio);
      canvas.style.height = canvasH + "px";
      renderAllLayers();
    };
    sizeImg.src = firstLayer.layerImageUrl;
  }

  // Render all visible layers as positioned DIVs
  const layerDivs = new Map();

  function renderAllLayers() {
    canvas.innerHTML = "";
    const sorted = [...elements].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

    for (const el of sorted) {
      if (!el.visible) continue;
      const div = document.createElement("div");
      div.dataset.layerId = el.id;
      div.style.cssText = `position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h || "auto"};opacity:${el.opacity ?? 1};z-index:${el.zIndex || 0};cursor:move;box-sizing:border-box`;

      // Scale to fit container
      if (el.w && canvasContainer.offsetWidth) {
        const containerW = canvasContainer.offsetWidth;
        if (!previewScale || previewScale === 1) {
          previewScale = containerW / (elements[0]?.w || 412);
        }
      }

      // Image layer
      if (el.layerImageUrl) {
        const img = document.createElement("img");
        img.src = el.layerImageUrl;
        img.style.cssText = "width:100%;height:auto;display:block;pointer-events:none;-webkit-user-drag:none";
        img.draggable = false;
        div.appendChild(img);
      }

      // Text overlay (for OCR-detected text)
      if (el.type === "text" && el.textContent) {
        const textDiv = document.createElement("div");
        textDiv.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:${el.textAlign || "center"};font-size:${el.fontSize || 16}px;font-family:${el.fontFamily || "sans-serif"};font-weight:${el.fontWeight || "400"};color:${el.color || "#333"};letter-spacing:${el.letterSpacing || 0}px;line-height:${el.lineHeight || 1.2};pointer-events:none;padding:2px`;
        if (el.textShadow) textDiv.style.textShadow = el.textShadow;
        if (el.strokeColor) textDiv.style.webkitTextStroke = `${el.strokeWidth || 1}px ${el.strokeColor}`;
        textDiv.textContent = el.textContent;
        textDiv.dataset.textOverlay = "true";
        div.appendChild(textDiv);
      }

      // Selection outline
      if (el.id === selectedId) {
        div.style.outline = "2px dashed #0ea5e9";
        div.style.outlineOffset = "2px";
      }

      // Events
      div.addEventListener("mousedown", (e) => {
        if (el.locked) return;
        e.stopPropagation();
        selectLayer(el.id);
        startDragLayer(el, e);
      });

      div.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        if (el.type === "text" || el.textContent) {
          startInlineEdit(el, div);
        }
      });

      layerDivs.set(el.id, div);
      canvas.appendChild(div);
    }

    // Apply preview scale
    if (previewScale && previewScale !== 1) {
      canvas.style.transform = `scale(${previewScale})`;
      canvas.style.transformOrigin = "top left";
      canvasContainer.style.height = (canvasH * previewScale) + "px";
    }
  }

  // ── Drag ──
  let dragEl = null, dragStartX = 0, dragStartY = 0, dragOrigX = 0, dragOrigY = 0;

  function startDragLayer(el, e) {
    dragEl = el;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragOrigX = el.x;
    dragOrigY = el.y;
  }

  document.addEventListener("mousemove", onCanvasMouseMove);
  document.addEventListener("mouseup", onCanvasMouseUp);

  function onCanvasMouseMove(e) {
    if (!dragEl) return;
    const scale = previewScale || 1;
    const dx = (e.clientX - dragStartX) / scale;
    const dy = (e.clientY - dragStartY) / scale;
    dragEl.x = Math.round(dragOrigX + dx);
    dragEl.y = Math.round(dragOrigY + dy);
    const div = layerDivs.get(dragEl.id);
    if (div) {
      div.style.left = dragEl.x + "px";
      div.style.top = dragEl.y + "px";
    }
    updatePropInputs();
  }

  function onCanvasMouseUp() {
    if (dragEl) {
      dragEl = null;
      sendLivePreview();
    }
  }

  // Cleanup listeners
  const cleanupObserver = new MutationObserver(() => {
    if (!container.isConnected) {
      document.removeEventListener("mousemove", onCanvasMouseMove);
      document.removeEventListener("mouseup", onCanvasMouseUp);
      cleanupObserver.disconnect();
    }
  });
  cleanupObserver.observe(container.parentNode || document.body, { childList: true, subtree: true });

  // Click canvas background to deselect
  canvas.addEventListener("mousedown", (e) => {
    if (e.target === canvas) selectLayer(null);
  });

  canvasContainer.appendChild(canvas);
  container.appendChild(canvasContainer);

  // ── Inline text editing ──
  function startInlineEdit(el, div) {
    editingId = el.id;
    const textDiv = div.querySelector("[data-text-overlay]");
    if (!textDiv) return;
    textDiv.style.pointerEvents = "auto";
    textDiv.contentEditable = "true";
    textDiv.style.outline = "none";
    textDiv.style.background = "rgba(255,255,255,0.15)";
    textDiv.style.cursor = "text";
    textDiv.focus();
    // Select all text
    const range = document.createRange();
    range.selectNodeContents(textDiv);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const onBlur = () => {
      el.textContent = textDiv.textContent;
      textDiv.contentEditable = "false";
      textDiv.style.pointerEvents = "none";
      textDiv.style.background = "";
      textDiv.style.cursor = "";
      editingId = null;
      updateTextPanel();
      sendLivePreview();
    };
    textDiv.addEventListener("blur", onBlur, { once: true });
    textDiv.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); textDiv.blur(); }
      if (e.key === "Escape") { textDiv.textContent = el.textContent; textDiv.blur(); }
    });
  }

  // ── Element Type Tag Bar ──
  const typeTagBar = document.createElement("div");
  typeTagBar.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px";

  const typeCounts = {};
  elements.forEach(el => { typeCounts[el.type] = (typeCounts[el.type] || 0) + 1; });

  Object.entries(typeCounts).forEach(([type, count]) => {
    const tc = TYPE_COLORS[type] || { color: "#888", border: "#888" };
    const tag = document.createElement("span");
    tag.style.cssText = `font-size:10px;padding:3px 8px;border-radius:12px;background:${tc.border}15;color:${tc.border};font-weight:600;cursor:default;border:1px solid ${tc.border}33`;
    tag.textContent = `${TYPE_ICONS[type] || "📦"} ${type} ${count}`;
    typeTagBar.appendChild(tag);
  });
  container.appendChild(typeTagBar);

  // ── TextEditPanel (yellow background, Squad Beyond style) ──
  const textEls = elements.filter(el => el.type === "text" && el.textContent);
  if (textEls.length > 0) {
    const textPanel = document.createElement("div");
    textPanel.style.cssText = "background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px;margin-bottom:10px";

    const textPanelHeader = document.createElement("div");
    textPanelHeader.style.cssText = "font-size:11px;font-weight:700;color:#92400e;margin-bottom:8px;display:flex;align-items:center;gap:4px";
    textPanelHeader.innerHTML = `✏️ 画像テキスト編集 <span style="font-weight:400">${textEls.length}件</span>`;
    textPanel.appendChild(textPanelHeader);

    textEls.forEach((el, tIdx) => {
      const row = document.createElement("div");
      row.style.cssText = "margin-bottom:8px";
      row.dataset.textLayerId = el.id;

      // Number badge + original text label
      const labelRow = document.createElement("div");
      labelRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:4px";
      const badge = document.createElement("span");
      badge.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;font-size:10px;font-weight:700;flex-shrink:0";
      badge.textContent = tIdx + 1;
      labelRow.appendChild(badge);

      const origLabel = document.createElement("span");
      origLabel.style.cssText = "font-size:10px;color:#92400e;opacity:0.7";
      origLabel.textContent = `元:「${(el.originalText || el.textContent || "").slice(0, 20)}」`;
      labelRow.appendChild(origLabel);
      row.appendChild(labelRow);

      // Text input
      const input = document.createElement("input");
      input.type = "text";
      input.value = el.textContent || "";
      input.dataset.layerId = el.id;
      input.style.cssText = "width:100%;padding:8px 10px;font-size:13px;border:1px solid #fde68a;border-radius:6px;background:#fff;color:var(--text-primary);font-weight:600;transition:border-color 0.15s";
      input.addEventListener("focus", () => {
        input.style.borderColor = "#3b82f6";
        selectLayer(el.id);
        // Highlight element in canvas
        const div = layerDivs.get(el.id);
        if (div) div.style.outline = "3px solid #3b82f6";
      });
      input.addEventListener("blur", () => {
        input.style.borderColor = "#fde68a";
        const div = layerDivs.get(el.id);
        if (div) div.style.outline = el.id === selectedId ? "2px dashed #0ea5e9" : "";
      });
      input.addEventListener("input", () => {
        el.textContent = input.value;
        // Update canvas text
        const div = layerDivs.get(el.id);
        if (div) {
          const textDiv = div.querySelector("[data-text-overlay]");
          if (textDiv) textDiv.textContent = input.value;
        }
        // Update layer list chip
        const chip = layerList.querySelector(`[data-layer-id="${el.id}"]`);
        if (chip) {
          const txt = chip.querySelector(".layer-label");
          if (txt) txt.textContent = (el.textContent || "").slice(0, 20);
        }
        sendLivePreview();
      });
      row.appendChild(input);

      // Collapsible style section
      const styleToggle = document.createElement("button");
      styleToggle.style.cssText = "font-size:10px;color:#92400e;background:none;border:none;cursor:pointer;padding:2px 0;margin-top:4px;opacity:0.7";
      styleToggle.textContent = "▶ スタイル調整";
      const stylePanel = document.createElement("div");
      stylePanel.style.cssText = "display:none;padding:6px 0";

      styleToggle.addEventListener("click", () => {
        const isOpen = stylePanel.style.display !== "none";
        stylePanel.style.display = isOpen ? "none" : "block";
        styleToggle.textContent = isOpen ? "▶ スタイル調整" : "▼ スタイル調整";
      });
      row.appendChild(styleToggle);

      // Style controls inside collapsible
      const styleRow = document.createElement("div");
      styleRow.style.cssText = "display:flex;gap:6px;align-items:center;flex-wrap:wrap";

      // Font size
      const sizeInput = document.createElement("input");
      sizeInput.type = "number";
      sizeInput.value = el.fontSize || 16;
      sizeInput.min = 8;
      sizeInput.max = 200;
      sizeInput.style.cssText = "width:55px;padding:3px 6px;font-size:11px;border:1px solid #fde68a;border-radius:4px;background:#fff";
      sizeInput.title = "フォントサイズ";
      sizeInput.addEventListener("input", () => {
        el.fontSize = parseInt(sizeInput.value) || 16;
        updateLayerInCanvas(el);
        sendLivePreview();
      });
      const sizeLabel = document.createElement("span");
      sizeLabel.style.cssText = "font-size:9px;color:#92400e";
      sizeLabel.textContent = "px";

      // Bold toggle
      const boldBtn = document.createElement("button");
      boldBtn.style.cssText = `font-size:11px;padding:3px 8px;border:1px solid #fde68a;border-radius:4px;background:${el.fontWeight === "700" ? "#f59e0b22" : "#fff"};color:#92400e;cursor:pointer;font-weight:800`;
      boldBtn.textContent = "B";
      boldBtn.addEventListener("click", () => {
        el.fontWeight = el.fontWeight === "700" ? "400" : "700";
        boldBtn.style.background = el.fontWeight === "700" ? "#f59e0b22" : "#fff";
        updateLayerInCanvas(el);
        sendLivePreview();
      });

      // Color picker
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = el.color || "#333333";
      colorInput.style.cssText = "width:26px;height:22px;border:1px solid #fde68a;border-radius:4px;cursor:pointer;padding:0";
      colorInput.addEventListener("input", () => {
        el.color = colorInput.value;
        updateLayerInCanvas(el);
        sendLivePreview();
      });

      styleRow.appendChild(sizeInput);
      styleRow.appendChild(sizeLabel);
      styleRow.appendChild(boldBtn);
      styleRow.appendChild(colorInput);
      stylePanel.appendChild(styleRow);
      row.appendChild(stylePanel);

      textPanel.appendChild(row);
    });

    container.appendChild(textPanel);
  }

  // ── Layer List (all layers) ──
  const layerListLabel = document.createElement("div");
  layerListLabel.style.cssText = "font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px";
  layerListLabel.textContent = "◇ 全レイヤー一覧";
  container.appendChild(layerListLabel);

  const layerList = document.createElement("div");
  layerList.style.cssText = "max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;background:var(--bg-secondary);margin-bottom:10px";

  elements.forEach(el => {
    const tc = TYPE_COLORS[el.type] || { border: "#888", color: "#888" };
    const row = document.createElement("div");
    row.dataset.layerId = el.id;
    row.style.cssText = `display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid var(--border);cursor:pointer;transition:background 0.1s;height:32px;font-size:11px`;

    // Visibility toggle
    const visBtn = document.createElement("button");
    visBtn.style.cssText = "background:none;border:none;cursor:pointer;font-size:12px;padding:0;width:20px;text-align:center";
    visBtn.textContent = el.visible ? "👁" : "👁‍🗨";
    visBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      el.visible = !el.visible;
      visBtn.textContent = el.visible ? "👁" : "👁‍🗨";
      renderAllLayers();
    });
    row.appendChild(visBtn);

    // Type icon
    const typeIcon = document.createElement("span");
    typeIcon.style.cssText = `color:${tc.color};font-weight:700;font-size:11px;flex-shrink:0`;
    typeIcon.textContent = TYPE_ICONS[el.type] || "📦";
    row.appendChild(typeIcon);

    // Label
    const label = document.createElement("span");
    label.className = "layer-label";
    label.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:var(--text-primary)";
    label.textContent = el.textContent ? el.textContent.slice(0, 20) : el.label;
    row.appendChild(label);

    // z-index badge
    const zBadge = document.createElement("span");
    zBadge.style.cssText = "font-size:9px;color:var(--text-muted);flex-shrink:0";
    zBadge.textContent = `z${el.zIndex}`;
    row.appendChild(zBadge);

    row.addEventListener("click", () => selectLayer(el.id));
    row.addEventListener("mouseenter", () => {
      if (el.id !== selectedId) row.style.background = tc.border + "10";
    });
    row.addEventListener("mouseleave", () => {
      if (el.id !== selectedId) row.style.background = "";
    });

    layerList.appendChild(row);
  });
  container.appendChild(layerList);

  // ── Element Properties Panel ──
  const propPanel = document.createElement("div");
  propPanel.style.cssText = "border:1px solid var(--border);border-radius:8px;overflow:hidden;min-height:40px";
  container.appendChild(propPanel);

  // ── Status line ──
  const statusDiv = document.createElement("div");
  statusDiv.id = `canvas-edit-status-${blockIndex}`;
  statusDiv.style.cssText = "font-size:10px;color:var(--text-muted);margin-top:8px;min-height:14px";
  container.appendChild(statusDiv);

  // ── OCR: Auto-detect text from non-text layers ──
  const ocrBtn = document.createElement("button");
  ocrBtn.style.cssText = "width:100%;padding:8px;font-size:11px;font-weight:600;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;margin-bottom:8px;transition:all 0.15s";
  ocrBtn.textContent = "🔍 テキスト自動検出 (OCR)";
  ocrBtn.addEventListener("click", async () => {
    ocrBtn.disabled = true;
    ocrBtn.textContent = "⏳ OCR処理中...";
    let totalTexts = 0;
    for (const el of elements) {
      if (el.type !== "background" && el.layerImageUrl && !el.textContent) {
        try {
          const result = await window.API.ocrLayer(projectId, el.layerImageUrl);
          if (result.texts && result.texts.length > 0) {
            // Convert to text element
            const mainText = result.texts.map(t => t.text).join("");
            if (mainText.trim()) {
              el.type = "text";
              el.textContent = mainText;
              el.originalText = mainText;
              el.fontSize = result.texts[0]?.estimatedFontSize || 16;
              el.color = result.texts[0]?.dominantColor || "#333";
              el.fontWeight = result.texts[0]?.isBold ? "700" : "400";
              totalTexts++;
            }
          }
        } catch (err) {
          console.warn("[ocr-layer]", el.id, err);
        }
      }
    }
    ocrBtn.disabled = false;
    if (totalTexts > 0) {
      ocrBtn.textContent = `✓ ${totalTexts}件のテキストを検出`;
      // Re-render entire editor with new text elements
      try { localStorage.setItem(`fal_layers_${projectId}_${blockIndex}`, JSON.stringify({ elements })); } catch {}
      container.innerHTML = "";
      renderFalLayerEditor(container, elements, projectId, blockIndex, blockHtml, TYPE_ICONS);
    } else {
      ocrBtn.textContent = "テキストが検出されませんでした";
      setTimeout(() => { ocrBtn.textContent = "🔍 テキスト自動検出 (OCR)"; }, 2000);
    }
  });
  container.appendChild(ocrBtn);

  // ── Save button (layer composite) ──
  const saveBtn = document.createElement("button");
  saveBtn.style.cssText = "width:100%;padding:10px 16px;font-size:12px;font-weight:700;border:none;border-radius:8px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(59,130,246,0.3);margin-bottom:4px";
  saveBtn.textContent = "💾 レイヤー合成して保存";
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = "⏳ 合成中...";
    try {
      const w = elements[0]?.w || 412;
      const h = canvasH / (previewScale || 1);
      const result = await window.API.exportLayers(projectId, blockIndex, {
        elements: elements.filter(e => e.visible),
        width: w,
        height: h || 800,
      });
      if (result.ok && result.imageUrl) {
        // Update block HTML with composited image
        const newHtml = buildSbImageHtml(result.imageUrl, w, h);
        await window.API.updateBlock(projectId, blockIndex, { html: newHtml });
        window.loadPreview?.(true);
        statusDiv.innerHTML = '<span style="color:#10b981">✓ レイヤー合成保存完了</span>';
        saveBtn.textContent = "✓ 保存完了";
        saveBtn.style.background = "linear-gradient(135deg,#10b981,#059669)";
        setTimeout(() => {
          saveBtn.textContent = "💾 レイヤー合成して保存";
          saveBtn.style.background = "linear-gradient(135deg,#3b82f6,#8b5cf6)";
          saveBtn.disabled = false;
        }, 2000);
      }
    } catch (err) {
      statusDiv.innerHTML = `<span style="color:#ef4444">✗ ${err.message}</span>`;
      saveBtn.textContent = "💾 再試行";
      saveBtn.disabled = false;
    }
  });
  container.appendChild(saveBtn);

  const saveNote = document.createElement("div");
  saveNote.style.cssText = "font-size:9px;color:var(--text-muted);text-align:center;margin-bottom:8px";
  saveNote.textContent = "※ 全レイヤーをSharpで合成し、1枚の画像として保存します";
  container.appendChild(saveNote);

  // ── Helper: select layer ──
  function selectLayer(id) {
    selectedId = id;
    // Update canvas outlines
    layerDivs.forEach((div, elId) => {
      div.style.outline = elId === id ? "2px dashed #0ea5e9" : "";
      div.style.outlineOffset = elId === id ? "2px" : "";
    });
    // Update layer list
    layerList.querySelectorAll("[data-layer-id]").forEach(row => {
      const rowId = row.dataset.layerId;
      const el = elements.find(e => e.id === rowId);
      const tc = TYPE_COLORS[el?.type] || { border: "#888" };
      if (rowId === id) {
        row.style.background = tc.border + "15";
        row.style.borderLeft = `3px solid ${tc.border}`;
        row.style.fontWeight = "700";
        row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else {
        row.style.background = "";
        row.style.borderLeft = "";
        row.style.fontWeight = "500";
      }
    });
    buildPropPanel();
  }

  // ── Helper: update layer in canvas ──
  function updateLayerInCanvas(el) {
    const div = layerDivs.get(el.id);
    if (!div) return;
    const textDiv = div.querySelector("[data-text-overlay]");
    if (textDiv) {
      textDiv.style.fontSize = (el.fontSize || 16) + "px";
      textDiv.style.fontWeight = el.fontWeight || "400";
      textDiv.style.color = el.color || "#333";
      textDiv.textContent = el.textContent || "";
    }
  }

  // ── Helper: update text panel inputs ──
  function updateTextPanel() {
    const textPanelEl = container.querySelector(`[data-text-layer-id="${editingId || selectedId}"]`);
    if (textPanelEl) {
      const input = textPanelEl.querySelector("input[type='text']");
      const el = elements.find(e => e.id === (editingId || selectedId));
      if (input && el) input.value = el.textContent || "";
    }
  }

  // Property panel input refs
  let propInputRefs = {};

  function updatePropInputs() {
    const el = elements.find(e => e.id === selectedId);
    if (!el) return;
    if (propInputRefs.x) propInputRefs.x.value = el.x;
    if (propInputRefs.y) propInputRefs.y.value = el.y;
    if (propInputRefs.w) propInputRefs.w.value = el.w;
    if (propInputRefs.h) propInputRefs.h.value = el.h || "";
  }

  // ── Build Property Panel ──
  function buildPropPanel() {
    propPanel.innerHTML = "";
    propInputRefs = {};

    if (!selectedId) {
      propPanel.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:11px;padding:16px">レイヤーをクリックして選択</div>';
      return;
    }

    const el = elements.find(e => e.id === selectedId);
    if (!el) return;
    const tc = TYPE_COLORS[el.type] || { bg: "rgba(136,136,136,0.12)", color: "#888", border: "#888" };

    // Header
    const pHeader = document.createElement("div");
    pHeader.style.cssText = `padding:8px 12px;background:${tc.bg};display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--border)`;
    pHeader.innerHTML = `<span style="font-size:13px">${TYPE_ICONS[el.type] || "📦"}</span><span style="font-size:11px;font-weight:700;color:${tc.color}">${el.label}</span>`;
    propPanel.appendChild(pHeader);

    const pBody = document.createElement("div");
    pBody.style.cssText = "padding:10px 12px";

    // Position: X, Y, W, H
    const posLabel = document.createElement("div");
    posLabel.style.cssText = "font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px";
    posLabel.textContent = "📐 位置・サイズ (px)";
    pBody.appendChild(posLabel);

    const posGrid = document.createElement("div");
    posGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;margin-bottom:10px";

    [["X", "x", el.x], ["Y", "y", el.y], ["W", "w", el.w], ["H", "h", el.h || 0]].forEach(([label, key, val]) => {
      const cell = document.createElement("div");
      const lbl = document.createElement("div");
      lbl.style.cssText = "font-size:8px;color:var(--text-muted);font-weight:600;margin-bottom:2px;text-align:center";
      lbl.textContent = label;
      const inp = document.createElement("input");
      inp.type = "number";
      inp.value = Math.round(val);
      inp.style.cssText = "width:100%;padding:4px 3px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);text-align:center;font-weight:500";
      inp.addEventListener("input", () => {
        const v = parseInt(inp.value) || 0;
        el[key] = v;
        const div = layerDivs.get(el.id);
        if (div) {
          if (key === "x") div.style.left = v + "px";
          if (key === "y") div.style.top = v + "px";
          if (key === "w") div.style.width = v + "px";
          if (key === "h") div.style.height = v + "px";
        }
        sendLivePreview();
      });
      propInputRefs[key] = inp;
      cell.appendChild(lbl);
      cell.appendChild(inp);
      posGrid.appendChild(cell);
    });
    pBody.appendChild(posGrid);

    // Opacity slider
    const opacityLabel = document.createElement("div");
    opacityLabel.style.cssText = "font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:4px";
    opacityLabel.textContent = "不透明度";
    pBody.appendChild(opacityLabel);

    const opacityRow = document.createElement("div");
    opacityRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px";
    const opacitySlider = document.createElement("input");
    opacitySlider.type = "range";
    opacitySlider.min = 0;
    opacitySlider.max = 100;
    opacitySlider.value = Math.round((el.opacity ?? 1) * 100);
    opacitySlider.style.cssText = "flex:1";
    const opacityVal = document.createElement("span");
    opacityVal.style.cssText = "font-size:11px;color:var(--text-primary);width:35px;text-align:right";
    opacityVal.textContent = opacitySlider.value + "%";
    opacitySlider.addEventListener("input", () => {
      el.opacity = parseInt(opacitySlider.value) / 100;
      opacityVal.textContent = opacitySlider.value + "%";
      const div = layerDivs.get(el.id);
      if (div) div.style.opacity = el.opacity;
    });
    opacityRow.appendChild(opacitySlider);
    opacityRow.appendChild(opacityVal);
    pBody.appendChild(opacityRow);

    // Layer controls
    const layerRow = document.createElement("div");
    layerRow.style.cssText = "display:flex;gap:4px;margin-bottom:10px";

    const fwdBtn = document.createElement("button");
    fwdBtn.style.cssText = "flex:1;padding:6px;font-size:10px;border:1px solid var(--border);border-radius:4px;background:none;color:var(--text-primary);cursor:pointer";
    fwdBtn.textContent = "▲ 前面";
    fwdBtn.addEventListener("click", () => {
      el.zIndex = (el.zIndex || 0) + 1;
      renderAllLayers();
    });

    const bwdBtn = document.createElement("button");
    bwdBtn.style.cssText = "flex:1;padding:6px;font-size:10px;border:1px solid var(--border);border-radius:4px;background:none;color:var(--text-primary);cursor:pointer";
    bwdBtn.textContent = "▼ 背面";
    bwdBtn.addEventListener("click", () => {
      el.zIndex = Math.max(0, (el.zIndex || 0) - 1);
      renderAllLayers();
    });

    const lockBtn = document.createElement("button");
    lockBtn.style.cssText = "padding:6px 10px;font-size:10px;border:1px solid var(--border);border-radius:4px;background:none;color:var(--text-primary);cursor:pointer";
    lockBtn.textContent = el.locked ? "🔓" : "🔒";
    lockBtn.addEventListener("click", () => {
      el.locked = !el.locked;
      lockBtn.textContent = el.locked ? "🔓" : "🔒";
    });

    layerRow.appendChild(fwdBtn);
    layerRow.appendChild(bwdBtn);
    layerRow.appendChild(lockBtn);
    pBody.appendChild(layerRow);

    // AI edit section
    const aiSec = document.createElement("div");
    aiSec.style.cssText = "padding:10px;border:1px solid var(--border);border-radius:8px;background:linear-gradient(135deg,rgba(139,92,246,0.05),rgba(59,130,246,0.05))";

    const aiLabel = document.createElement("div");
    aiLabel.style.cssText = "font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:6px;display:flex;align-items:center;gap:4px";
    aiLabel.innerHTML = '<span style="font-size:12px">🤖</span> AI指示';
    aiSec.appendChild(aiLabel);

    const aiInput = document.createElement("textarea");
    aiInput.placeholder = el.type === "text"
      ? "例: もっとキャッチーに書き換えて"
      : "例: もっと派手なデザインに変更";
    aiInput.style.cssText = "width:100%;padding:8px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);resize:vertical;min-height:40px;max-height:80px;font-family:inherit;line-height:1.4";
    aiSec.appendChild(aiInput);

    const aiStatus = document.createElement("div");
    aiStatus.style.cssText = "font-size:10px;color:var(--text-muted);margin-top:4px;min-height:14px";
    aiSec.appendChild(aiStatus);

    const aiBtn = document.createElement("button");
    aiBtn.style.cssText = "width:100%;padding:8px;font-size:11px;font-weight:700;border:none;border-radius:6px;background:linear-gradient(135deg,#8b5cf6,#a855f7);color:#fff;cursor:pointer;margin-top:6px";
    aiBtn.textContent = "🤖 AI実行";
    aiBtn.addEventListener("click", async () => {
      const instr = aiInput.value.trim();
      if (!instr) { aiStatus.innerHTML = '<span style="color:#f59e0b">指示を入力してください</span>'; return; }
      aiBtn.disabled = true;
      aiBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span> 処理中...';
      try {
        const result = await window.API.layerEdit(projectId, blockIndex, {
          element: { type: el.type, content: el.textContent || el.label, boundingBox: { x: el.x, y: el.y, width: el.w, height: el.h } },
          instruction: instr,
          elementIndex: elements.indexOf(el),
          provider: window._selectedProvider || "pixai",
        });
        if (result.ok) {
          if (result.type === "text" && result.content) {
            el.textContent = result.content;
            updateLayerInCanvas(el);
            updateTextPanel();
            aiStatus.innerHTML = '<span style="color:#10b981">✓ テキスト更新完了</span>';
          } else if (result.type === "image" && result.imageUrl) {
            el.layerImageUrl = result.imageUrl;
            renderAllLayers();
            aiStatus.innerHTML = '<span style="color:#10b981">✓ 画像生成完了</span>';
          }
        }
      } catch (err) {
        aiStatus.innerHTML = `<span style="color:#ef4444">✗ ${err.message}</span>`;
      } finally {
        aiBtn.disabled = false;
        aiBtn.textContent = "🤖 AI実行";
      }
    });
    aiSec.appendChild(aiBtn);
    pBody.appendChild(aiSec);

    propPanel.appendChild(pBody);
  }

  // ── Helper: send live preview to iframe ──
  function sendLivePreview() {
    const iframe = document.getElementById("preview-iframe");
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({
      type: "layerTextOverlay",
      blockIndex,
      changes: elements.filter(el => el.type === "text" && el.textContent && el.textContent !== el.originalText).map(el => ({
        content: el.textContent,
        boundingBox: { x: el.x, y: el.y, width: el.w, height: el.h },
        style: { fontSize: el.fontSize, fontWeight: el.fontWeight, color: el.color },
        zIndex: el.zIndex || 0,
      })),
    }, "*");
  }

  // ── Helper: build SB-compatible image HTML ──
  function buildSbImageHtml(imageUrl, w, h) {
    const partId = "sb-part-" + Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-4);
    const cls = partId.replace("sb-part-", "sb-custom-part-");
    return `<div id="${partId}" class="${cls}"><style>#${partId}.${cls} img{width:100%;display:block}</style><picture><source type="image/webp" data-srcset="${imageUrl}"><img class="lazyload" data-src="${imageUrl}" alt="" style="width:100%"></picture></div>`;
  }

  // Initial render
  buildPropPanel();

  // Keyboard shortcuts
  function onKeyDown(e) {
    if (editingId) return; // Don't intercept while editing text
    if (!selectedId) return;
    const el = elements.find(e => e.id === selectedId);
    if (!el || el.locked) return;

    const delta = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowUp") { e.preventDefault(); el.y -= delta; }
    else if (e.key === "ArrowDown") { e.preventDefault(); el.y += delta; }
    else if (e.key === "ArrowLeft") { e.preventDefault(); el.x -= delta; }
    else if (e.key === "ArrowRight") { e.preventDefault(); el.x += delta; }
    else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      el.visible = false;
      renderAllLayers();
      return;
    }
    else if (e.key === "Escape") {
      selectLayer(null);
      return;
    }
    else return;

    const div = layerDivs.get(el.id);
    if (div) {
      div.style.left = el.x + "px";
      div.style.top = el.y + "px";
    }
    updatePropInputs();
    sendLivePreview();
  }

  document.addEventListener("keydown", onKeyDown);
  const keyCleanup = new MutationObserver(() => {
    if (!container.isConnected) {
      document.removeEventListener("keydown", onKeyDown);
      keyCleanup.disconnect();
    }
  });
  keyCleanup.observe(container.parentNode || document.body, { childList: true, subtree: true });
}

function renderElementsList(container, elements, projectId, blockIndex, blockHtml, TYPE_ICONS) {
  // テキストオーバーレイ状態を初期化
  const textEls = elements.filter(el => el.type === "text");
  if (textEls.length > 0 && blockHtml) {
    initTextOverlayState(projectId, blockIndex, blockHtml, elements);
  }

  // ── 元の状態を保存（変更検知用） ──
  const originalElements = elements.map(el => ({
    content: el.content,
    boundingBox: { ...el.boundingBox },
    type: el.type,
  }));
  // 元のblockHtmlを保持（保存時に使う）
  const originalBlockHtml = blockHtml;

  const TYPE_COLORS = {
    text: { bg: "rgba(59,130,246,0.12)", color: "#3b82f6", border: "#3b82f6" },
    decoration: { bg: "rgba(139,92,246,0.12)", color: "#8b5cf6", border: "#8b5cf6" },
    badge: { bg: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "#f59e0b" },
    photo: { bg: "rgba(16,185,129,0.12)", color: "#10b981", border: "#10b981" },
    background: { bg: "rgba(107,114,128,0.12)", color: "#6b7280", border: "#6b7280" },
    button: { bg: "rgba(236,72,153,0.12)", color: "#ec4899", border: "#ec4899" },
    icon: { bg: "rgba(6,182,212,0.12)", color: "#06b6d4", border: "#06b6d4" },
    logo: { bg: "rgba(168,85,247,0.12)", color: "#a855f7", border: "#a855f7" },
    separator: { bg: "rgba(107,114,128,0.12)", color: "#6b7280", border: "#6b7280" },
  };

  // ─── State ───
  let selectedIdx = -1;
  let isDragging = false;
  let isResizing = false;
  let resizeDir = "";
  let dragStartX = 0, dragStartY = 0;
  let dragOrigBox = { x: 0, y: 0, w: 0, h: 0 };
  const overlayDivs = [];

  // ─── Image URL取得 ───
  let imgUrl = null;
  try {
    const iframe = document.getElementById("preview-iframe");
    const iDoc = iframe?.contentDocument || iframe?.contentWindow?.document;
    if (iDoc) {
      const wrapper = iDoc.querySelector(`[data-block-index="${blockIndex}"]`);
      if (wrapper) {
        const imgTag = wrapper.querySelector("img");
        if (imgTag) imgUrl = imgTag.src || imgTag.getAttribute("data-src");
        if (!imgUrl) {
          const srcTag = wrapper.querySelector("source[srcset], source[data-srcset]");
          if (srcTag) imgUrl = srcTag.getAttribute("srcset") || srcTag.getAttribute("data-srcset");
        }
      }
    }
  } catch {}
  if (!imgUrl && blockHtml) {
    const tmpDoc = new DOMParser().parseFromString(blockHtml, "text/html");
    const imgTag = tmpDoc.querySelector("img");
    if (imgTag) imgUrl = imgTag.getAttribute("data-src") || imgTag.getAttribute("src");
    if (!imgUrl) {
      const srcTag = tmpDoc.querySelector("source[data-srcset], source[srcset]");
      if (srcTag) imgUrl = srcTag.getAttribute("data-srcset") || srcTag.getAttribute("srcset");
    }
  }

  // ─── Header ───
  const header = document.createElement("div");
  header.style.cssText = "font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:8px;display:flex;align-items:center;justify-content:space-between";
  header.innerHTML = `<span>📑 レイヤーエディター（${elements.length}層）</span>`;
  const headerBtns = document.createElement("div");
  headerBtns.style.cssText = "display:flex;gap:4px";

  const refreshBtn = document.createElement("button");
  refreshBtn.style.cssText = "font-size:10px;padding:2px 8px;border:1px solid var(--border);border-radius:4px;background:none;color:var(--text-muted);cursor:pointer;transition:all 0.15s";
  refreshBtn.textContent = "🔄";
  refreshBtn.title = "再分解（キャッシュクリア）";
  refreshBtn.addEventListener("click", () => {
    localStorage.removeItem(`extract_${projectId}_${blockIndex}`);
    container.innerHTML = "";
    buildExtractedElements(container, projectId, blockIndex, null, null, blockHtml);
  });
  headerBtns.appendChild(refreshBtn);

  const restoreBtn = document.createElement("button");
  restoreBtn.style.cssText = "font-size:10px;padding:2px 8px;border:1px solid var(--border);border-radius:4px;background:none;color:var(--text-muted);cursor:pointer;transition:all 0.15s";
  restoreBtn.textContent = "🖼";
  restoreBtn.title = "元画像に戻す";
  restoreBtn.addEventListener("click", () => sendRestoreBlock(blockIndex));
  headerBtns.appendChild(restoreBtn);
  header.appendChild(headerBtns);
  container.appendChild(header);

  // ─── Visual Canvas Workspace (Canva風: 全レイヤーを切り出し画像で表示) ───
  const workspace = document.createElement("div");
  workspace.style.cssText = "position:relative;background:#f0f0f0;border-radius:8px;overflow:hidden;margin-bottom:10px;user-select:none;cursor:default;background-image:repeating-conic-gradient(#ddd 0% 25%, transparent 0% 50%);background-size:16px 16px";

  // 元画像をゴースト表示（レイヤー位置の参照用）
  const bgImg = document.createElement("img");
  bgImg.style.cssText = "width:100%;display:block;pointer-events:none;opacity:0.15";
  if (imgUrl) bgImg.src = imgUrl;
  bgImg.onerror = () => { bgImg.style.display = "none"; };
  workspace.appendChild(bgImg);

  // Overlay container
  const overlayLayer = document.createElement("div");
  overlayLayer.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%";
  workspace.appendChild(overlayLayer);

  // レイヤー切り出しステータス
  const cropStatus = document.createElement("div");
  cropStatus.style.cssText = "position:absolute;bottom:4px;left:4px;font-size:9px;background:rgba(0,0,0,0.6);color:#fff;padding:2px 8px;border-radius:4px;z-index:50";
  cropStatus.textContent = "レイヤー切り出し中...";
  workspace.appendChild(cropStatus);

  // Create overlays for each element
  elements.forEach((el, idx) => {
    const bb = el.boundingBox || { x: 0, y: 0, width: 100, height: 10 };
    const tc = TYPE_COLORS[el.type] || { border: "#ec4899", color: "#ec4899" };

    const ov = document.createElement("div");
    ov.dataset.elIdx = idx;
    ov.style.cssText = `position:absolute;left:${bb.x}%;top:${bb.y}%;width:${bb.width}%;height:${bb.height}%;border:1.5px dashed ${tc.border}55;box-sizing:border-box;cursor:move;transition:border-color 0.1s,box-shadow 0.1s;overflow:hidden`;

    // レイヤー画像（cropLayers API後に設定される）
    const layerImg = document.createElement("img");
    layerImg.style.cssText = "width:100%;height:100%;object-fit:fill;pointer-events:none;display:none";
    layerImg.dataset.layerIdx = idx;
    ov.appendChild(layerImg);

    // Type label (top-left, on hover)
    const typeLabel = document.createElement("div");
    typeLabel.style.cssText = `position:absolute;top:-18px;left:0;font-size:8px;background:${tc.border};color:#fff;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity 0.15s;line-height:14px;z-index:5`;
    typeLabel.textContent = `${TYPE_ICONS[el.type] || "📦"} ${el.type}${el.type === "text" ? ": " + (el.content||"").slice(0,12) : ""}`;
    ov.appendChild(typeLabel);

    // Resize handles
    const handles = {};
    ["nw","n","ne","e","se","s","sw","w"].forEach(dir => {
      const h = document.createElement("div");
      h.dataset.resizeDir = dir;
      const sz = 7;
      let css = `position:absolute;width:${sz}px;height:${sz}px;background:#fff;border:1.5px solid ${tc.border};border-radius:50%;z-index:10;display:none;pointer-events:auto;`;
      const cursors = { nw:"nw-resize",n:"n-resize",ne:"ne-resize",e:"e-resize",se:"se-resize",s:"s-resize",sw:"sw-resize",w:"w-resize" };
      css += `cursor:${cursors[dir]};`;
      const half = -Math.floor(sz/2);
      if (dir.includes("n")) css += `top:${half}px;`;
      if (dir.includes("s")) css += `bottom:${half}px;`;
      if (dir === "n" || dir === "s") css += `left:calc(50% + ${half}px);`;
      if (dir.includes("w")) css += `left:${half}px;`;
      if (dir.includes("e")) css += `right:${half}px;`;
      if (dir === "w" || dir === "e") css += `top:calc(50% + ${half}px);`;
      h.style.cssText = css;
      h.addEventListener("mousedown", (e) => {
        e.stopPropagation(); e.preventDefault();
        selectElement(idx);
        isResizing = true; resizeDir = dir;
        dragStartX = e.clientX; dragStartY = e.clientY;
        dragOrigBox = { x: bb.x, y: bb.y, w: bb.width, h: bb.height };
      });
      handles[dir] = h;
      ov.appendChild(h);
    });

    // Hover
    ov.addEventListener("mouseenter", () => {
      if (selectedIdx !== idx) { ov.style.borderColor = tc.border + "99"; ov.style.boxShadow = `0 0 0 2px ${tc.border}33`; }
      typeLabel.style.opacity = "1";
    });
    ov.addEventListener("mouseleave", () => {
      if (selectedIdx !== idx) { ov.style.borderColor = tc.border + "55"; ov.style.boxShadow = "none"; }
      typeLabel.style.opacity = "0";
    });

    // Click / drag
    ov.addEventListener("mousedown", (e) => {
      if (isResizing) return;
      e.stopPropagation(); e.preventDefault();
      selectElement(idx);
      isDragging = true;
      dragStartX = e.clientX; dragStartY = e.clientY;
      dragOrigBox = { x: bb.x, y: bb.y, w: bb.width, h: bb.height };
    });

    overlayDivs.push({ ov, handles, bb, tc });
    overlayLayer.appendChild(ov);
  });

  // Click workspace background to deselect
  workspace.addEventListener("mousedown", (e) => {
    if (e.target === workspace || e.target === bgImg || e.target === overlayLayer) {
      selectElement(-1);
    }
  });

  // ─── Mouse move / up handlers ───
  function onMouseMove(e) {
    if (!isDragging && !isResizing) return;
    if (selectedIdx < 0) return;
    const bb = elements[selectedIdx].boundingBox;
    const rect = workspace.getBoundingClientRect();
    const dx = (e.clientX - dragStartX) / rect.width * 100;
    const dy = (e.clientY - dragStartY) / rect.height * 100;

    if (isDragging) {
      bb.x = Math.max(0, Math.min(100 - bb.width, dragOrigBox.x + dx));
      bb.y = Math.max(0, Math.min(100 - bb.height, dragOrigBox.y + dy));
    } else if (isResizing) {
      let nx = dragOrigBox.x, ny = dragOrigBox.y, nw = dragOrigBox.w, nh = dragOrigBox.h;
      if (resizeDir.includes("e")) { nw = Math.max(2, dragOrigBox.w + dx); }
      if (resizeDir.includes("w")) { nw = Math.max(2, dragOrigBox.w - dx); nx = dragOrigBox.x + dx; if (nw <= 2) nx = dragOrigBox.x + dragOrigBox.w - 2; }
      if (resizeDir.includes("s")) { nh = Math.max(2, dragOrigBox.h + dy); }
      if (resizeDir.includes("n")) { nh = Math.max(2, dragOrigBox.h - dy); ny = dragOrigBox.y + dy; if (nh <= 2) ny = dragOrigBox.y + dragOrigBox.h - 2; }
      bb.x = Math.max(0, nx); bb.y = Math.max(0, ny);
      bb.width = Math.min(100 - bb.x, nw); bb.height = Math.min(100 - bb.y, nh);
    }
    updateOverlayPos(selectedIdx);
    updatePropValues();
  }

  function onMouseUp() {
    if (isDragging || isResizing) {
      isDragging = false;
      isResizing = false;
      // Send update to iframe
      if (selectedIdx >= 0) sendElementUpdateToIframe(selectedIdx);
    }
  }

  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
  // Cleanup on container removal
  const observer = new MutationObserver(() => {
    if (!container.isConnected) {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      observer.disconnect();
    }
  });
  observer.observe(container.parentNode || document.body, { childList: true, subtree: true });

  container.appendChild(workspace);

  // ─── Auto crop layers (バックグラウンドで各レイヤーを切り出し) ───
  window.API.cropLayers(projectId, blockIndex, { elements }).then(result => {
    if (result.ok && result.crops) {
      let loaded = 0;
      result.crops.forEach(crop => {
        if (!crop.url) return;
        const layerImg = overlayLayer.querySelector(`img[data-layer-idx="${crop.index}"]`);
        if (layerImg) {
          layerImg.src = crop.url;
          layerImg.style.display = "block";
          layerImg.onload = () => {
            loaded++;
            cropStatus.textContent = `レイヤー読み込み: ${loaded}/${result.crops.filter(c=>c.url).length}`;
            if (loaded >= result.crops.filter(c=>c.url).length) {
              cropStatus.textContent = `✓ ${loaded}レイヤー切り出し完了`;
              setTimeout(() => { cropStatus.style.display = "none"; }, 2000);
              // 元画像のゴースト表示をさらに薄く
              bgImg.style.opacity = "0.08";
            }
          };
        }
      });
      // 画像のピクセルサイズを保存（保存時に使う）
      workspace.dataset.imgWidth = result.imgWidth;
      workspace.dataset.imgHeight = result.imgHeight;
    }
  }).catch(err => {
    console.warn("[crop-layers]", err);
    cropStatus.textContent = "切り出し失敗（元画像で表示）";
    bgImg.style.opacity = "0.85";
    setTimeout(() => { cropStatus.style.display = "none"; }, 3000);
  });

  // ─── Layer List (scrollable, grouped by type) ───
  const layerBar = document.createElement("div");
  layerBar.style.cssText = "max-height:180px;overflow-y:auto;margin-bottom:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-secondary)";

  // Group elements by type for display order
  const typeOrder = ["background","decoration","separator","photo","icon","logo","text","badge","button"];
  const sortedIndices = [...elements.keys()].sort((a, b) => {
    const ta = typeOrder.indexOf(elements[a].type);
    const tb = typeOrder.indexOf(elements[b].type);
    return (ta === -1 ? 99 : ta) - (tb === -1 ? 99 : tb);
  });

  let lastType = "";
  sortedIndices.forEach(idx => {
    const el = elements[idx];
    const tc = TYPE_COLORS[el.type] || { bg: "rgba(236,72,153,0.12)", color: "#ec4899", border: "#ec4899" };

    // Type section header
    if (el.type !== lastType) {
      lastType = el.type;
      const count = elements.filter(e => e.type === el.type).length;
      const secHeader = document.createElement("div");
      secHeader.style.cssText = `font-size:9px;font-weight:700;color:${tc.color};padding:4px 8px 2px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.7;border-top:${lastType !== elements[sortedIndices[0]].type ? "1px solid var(--border)" : "none"}`;
      secHeader.textContent = `${TYPE_ICONS[el.type]||"📦"} ${el.type} (${count})`;
      layerBar.appendChild(secHeader);
    }

    const chip = document.createElement("button");
    chip.dataset.layerIdx = idx;
    chip.style.cssText = `display:flex;align-items:center;gap:4px;width:100%;text-align:left;font-size:10px;padding:4px 8px;border:none;border-left:3px solid transparent;background:none;color:var(--text-primary);cursor:pointer;transition:all 0.12s;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
    const label = el.type === "text"
      ? `<span style="color:${tc.color};font-weight:700;min-width:16px">${idx}</span> ${(el.content||"").slice(0,25)}`
      : `<span style="color:${tc.color};font-weight:700;min-width:16px">${idx}</span> ${el.content ? el.content.slice(0,25) : el.type}`;
    chip.innerHTML = label;
    chip.addEventListener("click", () => selectElement(idx));
    chip.addEventListener("mouseenter", () => {
      if (idx !== selectedIdx) { chip.style.background = tc.bg; chip.style.borderLeftColor = tc.border; }
    });
    chip.addEventListener("mouseleave", () => {
      if (idx !== selectedIdx) { chip.style.background = "none"; chip.style.borderLeftColor = "transparent"; }
    });
    layerBar.appendChild(chip);
  });
  container.appendChild(layerBar);

  // ─── Property Panel (updates on selection) ───
  const propPanel = document.createElement("div");
  propPanel.style.cssText = "border:1px solid var(--border);border-radius:8px;overflow:hidden;min-height:40px";
  container.appendChild(propPanel);

  // ─── Status line ───
  const statusDiv = document.createElement("div");
  statusDiv.id = `canvas-edit-status-${blockIndex}`;
  statusDiv.style.cssText = "font-size:10px;color:var(--text-muted);margin-top:8px;min-height:14px";
  container.appendChild(statusDiv);

  // ─── Helper: update overlay position ───
  function updateOverlayPos(idx) {
    const d = overlayDivs[idx];
    if (!d) return;
    const bb = elements[idx].boundingBox;
    d.ov.style.left = bb.x + "%";
    d.ov.style.top = bb.y + "%";
    d.ov.style.width = bb.width + "%";
    d.ov.style.height = bb.height + "%";
  }

  // ─── Helper: send element update to iframe ───
  function sendElementUpdateToIframe(idx) {
    const el = elements[idx];
    const iframe = document.getElementById("preview-iframe");
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({
        type: "elementOverlay",
        blockIndex,
        elementIndex: idx,
        boundingBox: el.boundingBox,
        elements,
      }, "*");
    }
  }

  // ─── Helper: send live text overlay to iframe preview ───
  function sendLivePreviewToIframe() {
    const iframe = document.getElementById("preview-iframe");
    if (!iframe?.contentWindow) return;
    // Collect changed text elements
    const changes = [];
    elements.forEach((el, i) => {
      const orig = originalElements[i];
      if (!orig) return;
      if (el.type === "text" && el.content !== orig.content) {
        changes.push({
          index: i,
          content: el.content,
          boundingBox: el.boundingBox,
          style: el.style || {},
          zIndex: el.zIndex || 0,
        });
      }
    });
    iframe.contentWindow.postMessage({
      type: "layerTextOverlay",
      blockIndex,
      changes,
    }, "*");
  }

  // ─── Select element ───
  function selectElement(idx) {
    selectedIdx = idx;
    // Update visual state of overlays
    overlayDivs.forEach((d, i) => {
      const isSelected = i === idx;
      const tc = d.tc;
      d.ov.style.borderColor = isSelected ? tc.border : tc.border + "55";
      d.ov.style.borderStyle = isSelected ? "solid" : "dashed";
      d.ov.style.borderWidth = isSelected ? "2px" : "1.5px";
      d.ov.style.boxShadow = isSelected ? `0 0 0 3px ${tc.border}33, 0 2px 8px rgba(0,0,0,0.3)` : "none";
      d.ov.style.zIndex = isSelected ? "20" : "";
      // Show/hide resize handles
      Object.values(d.handles).forEach(h => { h.style.display = isSelected ? "block" : "none"; });
    });
    // Update layer list items
    layerBar.querySelectorAll("button[data-layer-idx]").forEach(chip => {
      const chipIdx = parseInt(chip.dataset.layerIdx, 10);
      const tc = TYPE_COLORS[elements[chipIdx]?.type] || { border: "#ec4899" };
      if (chipIdx === idx) {
        chip.style.borderLeftColor = tc.border;
        chip.style.background = tc.border + "15";
        chip.style.fontWeight = "700";
        // Scroll into view
        chip.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else {
        chip.style.borderLeftColor = "transparent";
        chip.style.background = "none";
        chip.style.fontWeight = "500";
      }
    });
    // Highlight in iframe
    const iframe = document.getElementById("preview-iframe");
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({
        type: "elementOverlay",
        blockIndex,
        elementIndex: idx,
        boundingBox: idx >= 0 ? elements[idx].boundingBox : null,
        elements: idx >= 0 ? elements : null,
      }, "*");
    }
    // Update property panel
    buildPropertyPanel();
  }

  // ─── Property input refs for live update ───
  let propInputs = {};

  function updatePropValues() {
    if (selectedIdx < 0) return;
    const bb = elements[selectedIdx].boundingBox;
    if (propInputs.x) propInputs.x.value = Math.round(bb.x * 10) / 10;
    if (propInputs.y) propInputs.y.value = Math.round(bb.y * 10) / 10;
    if (propInputs.w) propInputs.w.value = Math.round(bb.width * 10) / 10;
    if (propInputs.h) propInputs.h.value = Math.round(bb.height * 10) / 10;
  }

  // ─── Build Property Panel ───
  function buildPropertyPanel() {
    propPanel.innerHTML = "";
    propInputs = {};

    if (selectedIdx < 0) {
      propPanel.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:11px;padding:16px">要素をクリックして選択</div>';
      return;
    }

    const el = elements[selectedIdx];
    const bb = el.boundingBox;
    const tc = TYPE_COLORS[el.type] || { bg: "rgba(236,72,153,0.12)", color: "#ec4899", border: "#ec4899" };

    // Panel header
    const pHeader = document.createElement("div");
    pHeader.style.cssText = `padding:8px 12px;background:${tc.bg};display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--border)`;
    pHeader.innerHTML = `<span style="font-size:13px">${TYPE_ICONS[el.type]||"📦"}</span><span style="font-size:11px;font-weight:700;color:${tc.color}">${el.type.toUpperCase()}</span><span style="font-size:10px;color:var(--text-muted);margin-left:auto">#${selectedIdx}</span>`;
    propPanel.appendChild(pHeader);

    const pBody = document.createElement("div");
    pBody.style.cssText = "padding:10px 12px";

    // ── Text content (for text elements) ──
    if (el.type === "text") {
      const textLabel = document.createElement("div");
      textLabel.style.cssText = "font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px";
      textLabel.textContent = "テキスト内容";
      pBody.appendChild(textLabel);

      const textInput = document.createElement("input");
      textInput.type = "text";
      textInput.value = el.content || "";
      textInput.style.cssText = "width:100%;padding:7px 10px;font-size:13px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-weight:600;margin-bottom:10px;transition:border-color 0.15s";
      textInput.addEventListener("focus", () => { textInput.style.borderColor = tc.border; });
      textInput.addEventListener("blur", () => { textInput.style.borderColor = ""; });
      textInput.addEventListener("input", () => {
        el.content = textInput.value;
        // Update workspace text display (Canva風リアルタイム)
        const d = overlayDivs[selectedIdx];
        if (d) {
          // テキスト表示要素を更新（textDisplayはoverl最初の非-handle div）
          const txtEl = d.ov.querySelector("div:not([class^='resize-handle']):not([style*='top:-18px'])");
          if (txtEl && !txtEl.dataset.resizeDir) txtEl.textContent = el.content;
          // TypeLabelも更新
          const lbl = d.ov.querySelector("div[style*='top:-18px']");
          if (lbl) lbl.textContent = `✏️ text: ${(el.content||"").slice(0,12)}`;
        }
        // Update layer chip
        const chip = layerBar.querySelector(`[data-layer-idx="${selectedIdx}"]`);
        if (chip) chip.textContent = `✏️ ${(el.content||"").slice(0,8)}`;
        // Update overlay state
        const key = getOverlayKey(projectId, blockIndex);
        if (_textOverlayState[key]?.elements?.[selectedIdx]) {
          _textOverlayState[key].elements[selectedIdx].content = el.content;
        }
        // リアルタイムプレビュー反映
        sendLivePreviewToIframe();
      });
      pBody.appendChild(textInput);

      // ── Text Style ──
      const styleLabel = document.createElement("div");
      styleLabel.style.cssText = "font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px";
      styleLabel.textContent = "スタイル";
      pBody.appendChild(styleLabel);

      const styleRow = document.createElement("div");
      styleRow.style.cssText = "display:flex;gap:4px;align-items:center;margin-bottom:10px;flex-wrap:wrap";

      // Font size chips
      const elStyle = el.style || {};
      ["small","medium","large","xlarge"].forEach(sz => {
        const btn = document.createElement("button");
        btn.style.cssText = `font-size:10px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;background:${elStyle.fontSize === sz ? tc.border+"22" : "none"};color:${elStyle.fontSize === sz ? tc.border : "var(--text-muted)"};cursor:pointer;font-weight:600;transition:all 0.15s`;
        btn.textContent = { small:"S", medium:"M", large:"L", xlarge:"XL" }[sz];
        btn.addEventListener("click", () => {
          if (!el.style) el.style = {};
          el.style.fontSize = sz;
          styleRow.querySelectorAll("button").forEach(b => {
            b.style.background = "none"; b.style.color = "var(--text-muted)";
          });
          btn.style.background = tc.border + "22";
          btn.style.color = tc.border;
          const key = getOverlayKey(projectId, blockIndex);
          if (_textOverlayState[key]?.elements[selectedIdx]) _textOverlayState[key].elements[selectedIdx].style.fontSize = sz;
        });
        styleRow.appendChild(btn);
      });

      // Bold toggle
      const boldBtn = document.createElement("button");
      boldBtn.style.cssText = `font-size:10px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;background:${elStyle.fontWeight === "bold" ? tc.border+"22" : "none"};color:${elStyle.fontWeight === "bold" ? tc.border : "var(--text-muted)"};cursor:pointer;font-weight:800;transition:all 0.15s`;
      boldBtn.textContent = "B";
      boldBtn.addEventListener("click", () => {
        if (!el.style) el.style = {};
        el.style.fontWeight = el.style.fontWeight === "bold" ? "normal" : "bold";
        boldBtn.style.background = el.style.fontWeight === "bold" ? tc.border+"22" : "none";
        boldBtn.style.color = el.style.fontWeight === "bold" ? tc.border : "var(--text-muted)";
        const key = getOverlayKey(projectId, blockIndex);
        if (_textOverlayState[key]?.elements[selectedIdx]) _textOverlayState[key].elements[selectedIdx].style.fontWeight = el.style.fontWeight;
      });
      styleRow.appendChild(boldBtn);

      // Color picker
      const colorPick = document.createElement("input");
      colorPick.type = "color";
      colorPick.value = elStyle.color || "#000000";
      colorPick.style.cssText = "width:26px;height:22px;border:1px solid var(--border);border-radius:4px;cursor:pointer;padding:0";
      colorPick.addEventListener("input", () => {
        if (!el.style) el.style = {};
        el.style.color = colorPick.value;
        const key = getOverlayKey(projectId, blockIndex);
        if (_textOverlayState[key]?.elements[selectedIdx]) _textOverlayState[key].elements[selectedIdx].style.color = colorPick.value;
      });
      styleRow.appendChild(colorPick);

      pBody.appendChild(styleRow);
    }

    // ── Position & Size ──
    const posLabel = document.createElement("div");
    posLabel.style.cssText = "font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px";
    posLabel.textContent = "位置・サイズ (%)";
    pBody.appendChild(posLabel);

    const posGrid = document.createElement("div");
    posGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;margin-bottom:10px";

    [["X","x",bb.x],["Y","y",bb.y],["W","width",bb.width],["H","height",bb.height]].forEach(([label,key,val]) => {
      const cell = document.createElement("div");
      const lbl = document.createElement("div");
      lbl.style.cssText = "font-size:8px;color:var(--text-muted);font-weight:600;margin-bottom:2px;text-align:center";
      lbl.textContent = label;
      const inp = document.createElement("input");
      inp.type = "number";
      inp.min = 0; inp.max = 100; inp.step = 0.5;
      inp.value = Math.round(val * 10) / 10;
      inp.style.cssText = "width:100%;padding:4px 3px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);text-align:center;font-weight:500";
      inp.addEventListener("input", () => {
        const v = parseFloat(inp.value) || 0;
        if (key === "x") bb.x = v;
        else if (key === "y") bb.y = v;
        else if (key === "width") bb.width = v;
        else if (key === "height") bb.height = v;
        updateOverlayPos(selectedIdx);
        sendElementUpdateToIframe(selectedIdx);
      });
      // Store ref for live update during drag
      if (key === "x") propInputs.x = inp;
      else if (key === "y") propInputs.y = inp;
      else if (key === "width") propInputs.w = inp;
      else if (key === "height") propInputs.h = inp;
      cell.appendChild(lbl);
      cell.appendChild(inp);
      posGrid.appendChild(cell);
    });
    pBody.appendChild(posGrid);

    // ── AI指示セクション（全要素タイプ共通） ──
    const elType = el.type || "text";
    const aiSec = document.createElement("div");
    aiSec.style.cssText = "margin-bottom:10px;padding:10px;border:1px solid var(--border);border-radius:8px;background:linear-gradient(135deg,rgba(139,92,246,0.05),rgba(59,130,246,0.05))";

    const aiLabel = document.createElement("div");
    aiLabel.style.cssText = "font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px;display:flex;align-items:center;gap:4px";
    aiLabel.innerHTML = '<span style="font-size:12px">🤖</span> AI指示';
    aiSec.appendChild(aiLabel);

    // 要素内容の表示（テキストは既に上にあるので、ビジュアル要素のみ表示）
    if (elType !== "text" && el.content) {
      const contentPreview = document.createElement("div");
      contentPreview.style.cssText = "font-size:10px;color:var(--text-muted);margin-bottom:6px;padding:4px 6px;background:var(--bg-secondary);border-radius:4px;font-style:italic";
      contentPreview.textContent = `現在: ${el.content.slice(0, 60)}`;
      aiSec.appendChild(contentPreview);
    }

    const aiInput = document.createElement("textarea");
    aiInput.placeholder = elType === "text"
      ? "例: もっとキャッチーに書き換えて、数字を強調して"
      : "例: もっと派手なデザインに変更、色を赤系に";
    aiInput.style.cssText = "width:100%;padding:8px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);resize:vertical;min-height:48px;max-height:100px;font-family:inherit;line-height:1.4;transition:border-color 0.15s";
    aiInput.addEventListener("focus", () => { aiInput.style.borderColor = "#8b5cf6"; });
    aiInput.addEventListener("blur", () => { aiInput.style.borderColor = ""; });
    aiSec.appendChild(aiInput);

    // AI実行ステータス
    const aiStatus = document.createElement("div");
    aiStatus.style.cssText = "font-size:10px;color:var(--text-muted);margin-top:4px;min-height:14px";
    aiSec.appendChild(aiStatus);

    const aiBtn = document.createElement("button");
    aiBtn.style.cssText = "width:100%;padding:8px 12px;font-size:11px;font-weight:700;border:none;border-radius:6px;background:linear-gradient(135deg,#8b5cf6,#a855f7);color:#fff;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 6px rgba(139,92,246,0.3);margin-top:6px;display:flex;align-items:center;justify-content:center;gap:4px";
    aiBtn.innerHTML = elType === "text"
      ? '🤖 AIでテキスト書き換え'
      : '🤖 AIで画像生成';

    aiBtn.addEventListener("click", async () => {
      const instr = aiInput.value.trim();
      if (!instr) {
        aiStatus.innerHTML = '<span style="color:#f59e0b">指示を入力してください</span>';
        return;
      }

      aiBtn.disabled = true;
      aiBtn.style.opacity = "0.6";
      aiBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span> AI処理中...';
      aiStatus.innerHTML = '<span style="color:#8b5cf6">処理中...</span>';

      try {
        const result = await window.API.layerEdit(projectId, blockIndex, {
          element: el,
          instruction: instr,
          elementIndex: selectedIdx,
          provider: window._selectedProvider || "pixai",
        });

        if (result.ok) {
          if (result.type === "text" && result.content) {
            // テキスト更新
            el.content = result.content;
            // Input 更新
            const textInput = pBody.querySelector("input[type='text']");
            if (textInput) textInput.value = el.content;
            // ワークスペースのテキスト表示更新
            const d = overlayDivs[selectedIdx];
            if (d) {
              const txtEl = d.ov.querySelector("div:not([class^='resize-handle']):not([style*='top:-18px'])");
              if (txtEl && !txtEl.dataset.resizeDir) txtEl.textContent = el.content;
            }
            // Layer chip 更新
            const chip = layerBar.querySelector(`[data-layer-idx="${selectedIdx}"]`);
            if (chip) chip.textContent = `✏️ ${(el.content||"").slice(0,8)}`;
            // Overlay state 更新
            const key = getOverlayKey(projectId, blockIndex);
            if (_textOverlayState[key]?.elements?.[selectedIdx]) {
              _textOverlayState[key].elements[selectedIdx].content = el.content;
            }
            aiStatus.innerHTML = `<span style="color:#10b981">✓ テキスト更新完了</span>`;
          } else if (result.type === "image" && result.imageUrl) {
            // 画像生成結果をオーバーレイに適用
            el._generatedImageUrl = result.imageUrl;
            el.content = `[AI生成] ${instr.slice(0, 30)}`;
            // ワークスペースにプレビュー表示
            const d = overlayDivs[selectedIdx];
            if (d) {
              d.ov.style.backgroundImage = `url(${result.imageUrl})`;
              d.ov.style.backgroundSize = "cover";
              d.ov.style.backgroundPosition = "center";
            }
            // Layer chip 更新
            const chip = layerBar.querySelector(`[data-layer-idx="${selectedIdx}"]`);
            if (chip) chip.textContent = `${TYPE_ICONS[el.type]||"📦"} AI`;
            aiStatus.innerHTML = `<span style="color:#10b981">✓ 画像生成完了</span>`;
          }
        }
      } catch (err) {
        console.error("[layer-edit]", err);
        aiStatus.innerHTML = `<span style="color:#ef4444">✗ エラー: ${err.message}</span>`;
      } finally {
        aiBtn.disabled = false;
        aiBtn.style.opacity = "1";
        aiBtn.innerHTML = elType === "text"
          ? '🤖 AIでテキスト書き換え'
          : '🤖 AIで画像生成';
      }
    });
    aiSec.appendChild(aiBtn);

    pBody.appendChild(aiSec);

    // ── テキスト変更を保存（元画像HTMLを保持 + テキストオーバーレイ追加） ──
    const applyBtn = document.createElement("button");
    applyBtn.style.cssText = "width:100%;padding:10px 16px;font-size:12px;font-weight:700;border:none;border-radius:8px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(59,130,246,0.3);margin-top:8px";
    applyBtn.textContent = "💾 テキスト変更を保存";
    applyBtn.addEventListener("click", async () => {
      // 変更テキストだけ検出
      const changes = [];
      elements.forEach((el, i) => {
        const orig = originalElements[i];
        if (!orig) return;
        if (el.type === "text" && el.content !== orig.content) {
          changes.push({ ...el, index: i });
        }
      });
      if (changes.length === 0) {
        statusDiv.innerHTML = '<span style="color:#f59e0b">テキスト変更がありません</span>';
        return;
      }
      applyBtn.disabled = true;
      applyBtn.textContent = "⏳ 保存中...";
      try {
        // 元HTMLにテキストオーバーレイを追加（元画像はそのまま！）
        const overlayHtml = buildTextOnlyOverlay(originalBlockHtml, changes);
        await window.API.updateBlock(projectId, blockIndex, { html: overlayHtml });
        window.loadPreview?.(true);
        statusDiv.innerHTML = `<span style="color:#10b981">✓ ${changes.length}件のテキスト変更を保存</span>`;
        applyBtn.textContent = "✓ 保存完了";
        applyBtn.style.background = "linear-gradient(135deg,#10b981,#059669)";
        setTimeout(() => {
          applyBtn.textContent = "💾 テキスト変更を保存";
          applyBtn.style.background = "linear-gradient(135deg,#3b82f6,#8b5cf6)";
          applyBtn.disabled = false;
        }, 2000);
      } catch (err) {
        statusDiv.innerHTML = `<span style="color:#ef4444">✗ ${err.message}</span>`;
        applyBtn.textContent = "💾 再試行";
        applyBtn.disabled = false;
      }
    });
    pBody.appendChild(applyBtn);

    const saveNote = document.createElement("div");
    saveNote.style.cssText = "font-size:9px;color:var(--text-muted);text-align:center;margin-top:4px";
    saveNote.textContent = "※ 元画像は変更されません。テキストのみオーバーレイで上書き。";
    pBody.appendChild(saveNote);

    // ── Animation section ──
    const animSec = document.createElement("div");
    animSec.style.cssText = "margin-top:10px;padding-top:10px;border-top:1px solid var(--border)";
    buildElementAnimationUI(animSec, blockIndex, selectedIdx, el);
    pBody.appendChild(animSec);

    propPanel.appendChild(pBody);
  }

  // Initial state
  buildPropertyPanel();

  // ─── Block-wide animation (collapsible at bottom) ───
  const blockAnimSec = createCollapsibleSection("🎭", "ブロック全体のアニメーション", null, false);
  const animResult = buildAnimationSection(blockIndex);
  blockAnimSec.body.appendChild(animResult.section);
  container.appendChild(blockAnimSec.wrapper);
}

// 各要素のアニメーション設定UI
function buildElementAnimationUI(container, blockIndex, elIdx, el) {
  const animations = [
    { value: "", label: "なし" },
    { value: "fadeIn", label: "フェードイン" },
    { value: "slideInUp", label: "下から" },
    { value: "slideInLeft", label: "左から" },
    { value: "slideInRight", label: "右から" },
    { value: "bounceIn", label: "バウンス" },
    { value: "zoomIn", label: "ズーム" },
    { value: "pulse", label: "パルス" },
    { value: "shake", label: "シェイク" },
  ];

  const speeds = [
    { value: "0.3s", label: "速い" },
    { value: "0.6s", label: "普通" },
    { value: "1s", label: "遅い" },
  ];

  // アニメーション選択
  const animLabel = document.createElement("div");
  animLabel.style.cssText = "font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px";
  animLabel.textContent = "アニメーション";
  container.appendChild(animLabel);

  const animGrid = document.createElement("div");
  animGrid.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px";
  let selectedAnim = "";
  animations.forEach(a => {
    const chip = document.createElement("button");
    chip.className = "anim-chip" + (a.value === "" ? " active" : "");
    chip.textContent = a.label;
    chip.style.cssText += ";font-size:10px;padding:3px 8px";
    chip.addEventListener("click", () => {
      animGrid.querySelectorAll(".anim-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      selectedAnim = a.value;
      previewElementAnim();
    });
    animGrid.appendChild(chip);
  });
  container.appendChild(animGrid);

  // スピード選択
  const speedLabel = document.createElement("div");
  speedLabel.style.cssText = "font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px";
  speedLabel.textContent = "速度";
  container.appendChild(speedLabel);

  const speedGrid = document.createElement("div");
  speedGrid.style.cssText = "display:flex;gap:4px;margin-bottom:10px";
  let selectedSpeed = "0.6s";
  speeds.forEach(s => {
    const chip = document.createElement("button");
    chip.className = "anim-chip" + (s.value === "0.6s" ? " active" : "");
    chip.textContent = s.label;
    chip.style.cssText += ";font-size:10px;padding:3px 8px";
    chip.addEventListener("click", () => {
      speedGrid.querySelectorAll(".anim-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      selectedSpeed = s.value;
      previewElementAnim();
    });
    speedGrid.appendChild(chip);
  });
  container.appendChild(speedGrid);

  // プレビューボタン
  const previewBtn = document.createElement("button");
  previewBtn.className = "anim-preview-btn";
  previewBtn.style.cssText += ";width:100%;font-size:11px";
  previewBtn.textContent = "▶ プレビュー";
  previewBtn.addEventListener("click", previewElementAnim);
  container.appendChild(previewBtn);

  function previewElementAnim() {
    if (!selectedAnim) return;
    triggerAnimationPreview(blockIndex, {
      anim: selectedAnim,
      scroll: "",
      hover: "",
      speed: selectedSpeed,
    });
  }
}

// 改善5: デザイン・配置編集パネル
function buildElementDesignPanel(container, element, elIdx, blockIndex, projectId) {
  // ── Text content editing (for text elements) ──
  if (element.type === "text" && element.content) {
    const textLabel = document.createElement("div");
    textLabel.style.cssText = "font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px";
    textLabel.textContent = "テキスト内容";
    container.appendChild(textLabel);

    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.value = element.content;
    textInput.style.cssText = "width:100%;padding:6px 8px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);margin-bottom:10px;font-weight:500";
    textInput.addEventListener("input", () => {
      element.content = textInput.value;
      // Update the card header name
      const card = container.closest(".extract-element-card");
      if (card) {
        const nameSpan = card.querySelector("[data-card-header] span:nth-child(2)");
        if (nameSpan) {
          const display = `「${textInput.value}」`;
          nameSpan.textContent = display.length > 25 ? display.slice(0, 25) + "…" : display;
        }
      }
      // Update OCR text list display
      const ocrSection = container.closest(".ocr-inline-design")?.closest("div[style]");
      if (ocrSection) {
        const textSpan = ocrSection.querySelector("span[style*='text-overflow']");
        if (textSpan) textSpan.textContent = `「${textInput.value}」`;
      }
      sendElementUpdate();

      // テキスト状態を更新（適用ボタンで画像に反映）
      const key = getOverlayKey(projectId, blockIndex);
      if (_textOverlayState[key] && _textOverlayState[key].elements[elIdx]) {
        _textOverlayState[key].elements[elIdx].content = textInput.value;
      }
    });
    container.appendChild(textInput);
  }

  // Position & Size
  const posLabel = document.createElement("div");
  posLabel.style.cssText = "font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px";
  posLabel.textContent = "📐 位置・サイズ（%）";
  container.appendChild(posLabel);

  const posGrid = document.createElement("div");
  posGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:10px";
  const bb = element.boundingBox || { x: 0, y: 0, width: 100, height: 10 };
  const posState = { x: bb.x, y: bb.y, width: bb.width, height: bb.height };

  function sendElementUpdate() {
    const iframe = document.getElementById("preview-iframe");
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({
        type: "elementUpdate",
        blockIndex,
        elementIndex: elIdx,
        content: element.content,
        boundingBox: { ...posState },
        style: { ...styleState },
        zIndex: zState.z,
        visible: zState.visible,
      }, "*");
    }
  }

  [["X", "x"], ["Y", "y"], ["W", "width"], ["H", "height"]].forEach(([label, key]) => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:4px";
    const lbl = document.createElement("span");
    lbl.style.cssText = "font-size:10px;color:var(--text-muted);width:14px;font-weight:600";
    lbl.textContent = label;
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = 0; inp.max = 100; inp.step = 1;
    inp.value = Math.round(posState[key]);
    inp.style.cssText = "width:100%;padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary)";
    inp.addEventListener("input", () => {
      posState[key] = parseFloat(inp.value) || 0;
      sendElementUpdate();
    });
    row.appendChild(lbl);
    row.appendChild(inp);
    posGrid.appendChild(row);
  });
  container.appendChild(posGrid);

  // Style section
  const styleLabel = document.createElement("div");
  styleLabel.style.cssText = "font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px";
  styleLabel.textContent = "🎨 スタイル";
  container.appendChild(styleLabel);

  const styleState = {
    fontSize: element.style?.fontSize || "medium",
    fontWeight: element.style?.fontWeight || "normal",
    color: element.style?.color || "#000000",
    backgroundColor: element.style?.backgroundColor || "",
  };

  const styleGrid = document.createElement("div");
  styleGrid.style.cssText = "display:flex;flex-direction:column;gap:6px;margin-bottom:10px";

  // Font size
  const sizeRow = document.createElement("div");
  sizeRow.style.cssText = "display:flex;gap:4px";
  ["small", "medium", "large", "xlarge"].forEach(sz => {
    const btn = document.createElement("button");
    btn.className = "anim-chip" + (sz === styleState.fontSize ? " active" : "");
    btn.textContent = { small: "S", medium: "M", large: "L", xlarge: "XL" }[sz];
    btn.style.cssText += ";font-size:10px;padding:3px 8px;min-width:28px";
    btn.addEventListener("click", () => {
      styleState.fontSize = sz;
      sizeRow.querySelectorAll(".anim-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      sendElementUpdate();
    });
    sizeRow.appendChild(btn);
  });
  // Bold toggle
  const boldBtn = document.createElement("button");
  boldBtn.className = "anim-chip" + (styleState.fontWeight === "bold" ? " active" : "");
  boldBtn.innerHTML = "<b>B</b>";
  boldBtn.style.cssText += ";font-size:10px;padding:3px 8px;min-width:28px";
  boldBtn.addEventListener("click", () => {
    styleState.fontWeight = styleState.fontWeight === "bold" ? "normal" : "bold";
    boldBtn.classList.toggle("active");
    sendElementUpdate();
  });
  sizeRow.appendChild(boldBtn);
  styleGrid.appendChild(sizeRow);

  // Colors row
  const colorRow = document.createElement("div");
  colorRow.style.cssText = "display:flex;align-items:center;gap:8px";
  // Text color
  const textColorLabel = document.createElement("span");
  textColorLabel.style.cssText = "font-size:10px;color:var(--text-muted)";
  textColorLabel.textContent = "文字色";
  const textColorInput = document.createElement("input");
  textColorInput.type = "color";
  textColorInput.value = styleState.color;
  textColorInput.style.cssText = "width:28px;height:22px;border:1px solid var(--border);border-radius:4px;cursor:pointer;padding:0";
  textColorInput.addEventListener("input", () => { styleState.color = textColorInput.value; sendElementUpdate(); });
  // Background color
  const bgColorLabel = document.createElement("span");
  bgColorLabel.style.cssText = "font-size:10px;color:var(--text-muted)";
  bgColorLabel.textContent = "背景";
  const bgColorInput = document.createElement("input");
  bgColorInput.type = "color";
  bgColorInput.value = styleState.backgroundColor || "#ffffff";
  bgColorInput.style.cssText = "width:28px;height:22px;border:1px solid var(--border);border-radius:4px;cursor:pointer;padding:0";
  bgColorInput.addEventListener("input", () => { styleState.backgroundColor = bgColorInput.value; sendElementUpdate(); });
  colorRow.appendChild(textColorLabel);
  colorRow.appendChild(textColorInput);
  colorRow.appendChild(bgColorLabel);
  colorRow.appendChild(bgColorInput);
  styleGrid.appendChild(colorRow);
  container.appendChild(styleGrid);

  // Layer (z-index + visibility)
  const layerLabel = document.createElement("div");
  layerLabel.style.cssText = "font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px";
  layerLabel.textContent = "📊 レイヤー";
  container.appendChild(layerLabel);

  const zState = { z: element.zIndex ?? 0, visible: true };
  const layerRow = document.createElement("div");
  layerRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px";
  const zLabel = document.createElement("span");
  zLabel.style.cssText = "font-size:10px;color:var(--text-muted)";
  zLabel.textContent = "Z-Index";
  const zInput = document.createElement("input");
  zInput.type = "number"; zInput.min = 0; zInput.max = 100; zInput.value = zState.z;
  zInput.style.cssText = "width:50px;padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary)";
  zInput.addEventListener("input", () => { zState.z = parseInt(zInput.value) || 0; sendElementUpdate(); });
  const visCheck = document.createElement("input");
  visCheck.type = "checkbox"; visCheck.checked = true;
  visCheck.style.cursor = "pointer";
  visCheck.addEventListener("change", () => { zState.visible = visCheck.checked; sendElementUpdate(); });
  const visLabel = document.createElement("span");
  visLabel.style.cssText = "font-size:10px;color:var(--text-muted)";
  visLabel.textContent = "表示";
  layerRow.appendChild(zLabel);
  layerRow.appendChild(zInput);
  layerRow.appendChild(visCheck);
  layerRow.appendChild(visLabel);
  container.appendChild(layerRow);

  // Animation (reuse element animation UI)
  buildElementAnimationUI(container, blockIndex, elIdx, element);
}

// SB互換HTML生成: 要素オーバーレイをabsolute positioned divとして出力
/**
 * テキスト変更のみオーバーレイ: 元HTMLをそのまま保持し、変更テキストをposition:absoluteで重ねる
 */
function buildTextOnlyOverlay(originalBlockHtml, changedTextElements) {
  if (!changedTextElements || changedTextElements.length === 0) return originalBlockHtml;

  const fontSizes = { small: "12px", medium: "16px", large: "24px", xlarge: "36px" };
  const ovId = "txt-ov-" + Math.random().toString(36).slice(2, 6);

  let css = `#${ovId}{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10}\n`;
  let divs = "";

  changedTextElements.forEach((el, i) => {
    const bb = el.boundingBox || {};
    const s = el.style || {};
    const bgColor = s.backgroundColor || "rgba(255,255,255,0.95)";
    css += `#${ovId} .t${i}{position:absolute;left:${bb.x||0}%;top:${bb.y||0}%;width:${bb.width||10}%;height:${bb.height||5}%;z-index:${(el.zIndex||0)+10};font-size:${fontSizes[s.fontSize]||"16px"};font-weight:${s.fontWeight||"bold"};color:${s.color||"#000"};background:${bgColor};display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.2;padding:2px;box-sizing:border-box}\n`;
    divs += `<div class="t${i}">${el.content}</div>`;
  });

  // 元HTMLの最初の要素にposition:relativeを追加してオーバーレイを注入
  const tmpDoc = new DOMParser().parseFromString(originalBlockHtml, "text/html");
  const root = tmpDoc.body.firstElementChild;
  if (root) {
    const st = root.getAttribute("style") || "";
    if (!st.includes("position:relative") && !st.includes("position: relative")) {
      root.setAttribute("style", st + (st ? ";" : "") + "position:relative");
    }
    root.insertAdjacentHTML("beforeend", `<style>${css}</style><div id="${ovId}">${divs}</div>`);
    return root.outerHTML;
  }
  return `<div style="position:relative">${originalBlockHtml}<style>${css}</style><div id="${ovId}">${divs}</div></div>`;
}

/**
 * Canva方式: 全レイヤーを切り出し画像+テキストで再構成
 * 元画像は背景に、各レイヤーは独立した position:absolute 要素
 */
function buildLayerCompositeHtml(elements, layerUrls, baseImageSrc) {
  if (!elements || elements.length === 0) return "";
  const partId = "sb-part-" + Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-4);
  const cls = partId.replace("sb-part-", "sb-custom-part-");
  const fontSizes = { small: "12px", medium: "16px", large: "24px", xlarge: "36px" };

  let css = `#${partId}.${cls} { position: relative; overflow: hidden; }\n`;
  css += `#${partId}.${cls} .layer-base { width: 100%; display: block; }\n`;
  let html = "";

  // 元画像を背景として配置
  if (baseImageSrc) {
    const webpSrc = baseImageSrc.replace(/\.(jpg|jpeg|png|gif)$/i, ".webp");
    html += `<picture><source type="image/webp" data-srcset="${webpSrc}"><img class="lazyload layer-base" data-src="${baseImageSrc}" alt=""></picture>\n`;
  }

  // zIndex順にソートしてレイヤーを配置
  const sorted = elements.map((el, i) => ({ el, i })).sort((a, b) => (a.el.zIndex || 0) - (b.el.zIndex || 0));

  sorted.forEach(({ el, i }) => {
    const bb = el.boundingBox || {};
    const style = el.style || {};
    const elClass = `layer-${i}`;
    const layerUrl = layerUrls[i];

    // テキスト要素で内容が変更された場合: HTMLテキストで表示
    if (el.type === "text" && el.content) {
      css += `#${partId}.${cls} .${elClass} {
  position: absolute;
  left: ${bb.x || 0}%;
  top: ${bb.y || 0}%;
  width: ${bb.width || 100}%;
  height: ${bb.height || 10}%;
  z-index: ${(el.zIndex || 0) + 1};
  font-size: ${fontSizes[style.fontSize] || "16px"};
  font-weight: ${style.fontWeight || "normal"};
  color: ${style.color || "#000"};
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1.2;
  text-align: center;
  pointer-events: none;
}\n`;
      html += `<div class="${elClass}">${el.content}</div>\n`;
    } else if (layerUrl) {
      // 画像レイヤー: 切り出し画像で表示
      // URLからパスだけ取得（フルURLの場合）
      let src = layerUrl;
      try { src = new URL(layerUrl).pathname; } catch {}
      css += `#${partId}.${cls} .${elClass} {
  position: absolute;
  left: ${bb.x || 0}%;
  top: ${bb.y || 0}%;
  width: ${bb.width || 100}%;
  height: ${bb.height || 10}%;
  z-index: ${(el.zIndex || 0) + 1};
  pointer-events: none;
  overflow: hidden;
}\n`;
      css += `#${partId}.${cls} .${elClass} img { width: 100%; height: 100%; object-fit: fill; }\n`;
      html += `<div class="${elClass}"><img class="lazyload" data-src="${src}" alt="${el.type}"></div>\n`;
    }
  });

  return `<style>${css}</style><div id="${partId}" class="${cls}">\n${html}</div>`;
}

/**
 * 元のblockHTMLを保持し、変更された要素だけをオーバーレイとして追加する
 * 元画像・装飾・写真は一切触らない（Canva方式）
 */
function buildDiffOverlayHtml(originalBlockHtml, changedElements) {
  if (!changedElements || changedElements.length === 0) return originalBlockHtml;

  const fontSizes = { small: "12px", medium: "16px", large: "24px", xlarge: "36px" };
  const overlayId = "layer-ov-" + Math.random().toString(36).slice(2, 7);

  let css = `#${overlayId} { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10; }\n`;
  let overlayDivs = "";

  changedElements.forEach((el, i) => {
    const bb = el.boundingBox || {};
    const style = el.style || {};
    const elClass = `ov-${i}`;

    if (el.type === "text" && el.content) {
      // テキスト変更: 元テキスト領域を隠す背景 + 新テキスト
      css += `#${overlayId} .${elClass} {
  position: absolute;
  left: ${bb.x || 0}%;
  top: ${bb.y || 0}%;
  width: ${bb.width || 100}%;
  height: ${bb.height || 10}%;
  z-index: ${(el.zIndex || 0) + 10};
  font-size: ${fontSizes[style.fontSize] || "16px"};
  font-weight: ${style.fontWeight || "normal"};
  color: ${style.color || "#000"};
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1.2;
  text-align: center;
  text-shadow: 0 0 4px ${style.backgroundColor || "rgba(255,255,255,0.8)"}, 0 0 8px ${style.backgroundColor || "rgba(255,255,255,0.8)"};
  pointer-events: none;
}\n`;
      overlayDivs += `<div class="${elClass}">${el.content}</div>\n`;
    } else if (el._generatedImageUrl) {
      // AI生成画像: その位置に画像を配置
      css += `#${overlayId} .${elClass} {
  position: absolute;
  left: ${bb.x || 0}%;
  top: ${bb.y || 0}%;
  width: ${bb.width || 100}%;
  height: ${bb.height || 10}%;
  z-index: ${(el.zIndex || 0) + 10};
  overflow: hidden;
  pointer-events: none;
}\n`;
      overlayDivs += `<div class="${elClass}"><img class="lazyload" data-src="${el._generatedImageUrl}" style="width:100%;height:100%;object-fit:cover"></div>\n`;
    }
  });

  // 元のHTMLにposition:relativeラッパーとオーバーレイを追加
  const overlayBlock = `<style>${css}</style><div id="${overlayId}">${overlayDivs}</div>`;

  // 元HTMLをパースしてrelative wrapperを追加
  const tmpDoc = new DOMParser().parseFromString(originalBlockHtml, "text/html");
  const firstEl = tmpDoc.body.firstElementChild;
  if (firstEl) {
    // 既存の最初の要素にposition:relativeを追加
    const existing = firstEl.getAttribute("style") || "";
    if (!existing.includes("position")) {
      firstEl.setAttribute("style", existing + ";position:relative");
    }
    firstEl.insertAdjacentHTML("beforeend", overlayBlock);
    return firstEl.outerHTML;
  }

  // フォールバック: wrapperで囲む
  return `<div style="position:relative">${originalBlockHtml}${overlayBlock}</div>`;
}

function buildElementOverlayHtml(elements, baseImageSrc) {
  if (!elements || elements.length === 0) return "";
  const partId = "sb-part-" + Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-4);
  const cls = partId.replace("sb-part-", "sb-custom-part-");

  const fontSizes = { small: "12px", medium: "16px", large: "24px", xlarge: "36px" };

  let css = `#${partId}.${cls} { position: relative; }\n`;
  let html = "";

  elements.forEach((el, i) => {
    const bb = el.boundingBox || {};
    const style = el.style || {};
    const elClass = `el-overlay-${i}`;
    css += `#${partId}.${cls} .${elClass} {
  position: absolute;
  left: ${bb.x || 0}%;
  top: ${bb.y || 0}%;
  width: ${bb.width || 100}%;
  height: ${bb.height || 10}%;
  z-index: ${el.zIndex || i};
  font-size: ${fontSizes[style.fontSize] || "16px"};
  font-weight: ${style.fontWeight || "normal"};
  color: ${style.color || "#000"};
  ${style.backgroundColor ? "background-color:" + style.backgroundColor + ";" : ""}
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}\n`;
    if (el.type === "text" && el.content) {
      html += `<div class="${elClass}">${el.content}</div>\n`;
    } else if (el._generatedImageUrl) {
      css += `#${partId}.${cls} .${elClass} { overflow: hidden; }\n`;
      html += `<div class="${elClass}"><img class="lazyload" data-src="${el._generatedImageUrl}" style="width:100%;height:100%;object-fit:cover"></div>\n`;
    } else {
      html += `<div class="${elClass}"></div>\n`;
    }
  });

  return `<style>${css}</style><div id="${partId}" class="${cls}">\n${baseImageSrc ? `<img class="lazyload" data-src="${baseImageSrc}" style="width:100%;display:block">\n` : ""}${html}</div>`;
}

// 改善4: 類似画像検索セクション（自動キーワード生成 + RED対応）
function buildImageSearchSection(projectId, blockIndex) {
  const section = document.createElement("div");
  section.className = "image-search-section";

  // Auto-detected keywords label
  const autoLabel = document.createElement("div");
  autoLabel.style.cssText = "font-size:10px;color:var(--text-muted);margin-bottom:6px";
  autoLabel.textContent = "自動検出キーワード:";
  section.appendChild(autoLabel);

  // Search input row
  const searchRow = document.createElement("div");
  searchRow.className = "image-search-row";
  const searchInput = document.createElement("input");
  searchInput.className = "image-search-input";
  searchInput.placeholder = "AI がキーワードを生成中...";
  const searchBtn = document.createElement("button");
  searchBtn.className = "image-search-btn";
  searchBtn.textContent = "🔄 検索";
  searchRow.appendChild(searchInput);
  searchRow.appendChild(searchBtn);
  section.appendChild(searchRow);

  // Source chips (Google, Unsplash, RED)
  const chipRow = document.createElement("div");
  chipRow.className = "image-search-chips";
  let selectedSource = "google";
  [{ id: "google", label: "Google" }, { id: "unsplash", label: "Unsplash" }, { id: "red", label: "📕 RED" }].forEach(s => {
    const chip = document.createElement("button");
    chip.className = "image-search-chip" + (s.id === "google" ? " active" : "");
    chip.textContent = s.label;
    chip.addEventListener("click", () => {
      selectedSource = s.id;
      chipRow.querySelectorAll(".image-search-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      if (s.id === "red") {
        resultsGrid.style.display = "none";
        redSection.style.display = "";
      } else {
        resultsGrid.style.display = "";
        redSection.style.display = "none";
      }
    });
    chipRow.appendChild(chip);
  });
  section.appendChild(chipRow);

  // Results grid (Google/Unsplash)
  const resultsGrid = document.createElement("div");
  resultsGrid.className = "image-search-results";
  section.appendChild(resultsGrid);

  // RED manual import section (initially hidden)
  const redSection = document.createElement("div");
  redSection.style.cssText = "display:none;margin-top:8px";
  redSection.innerHTML = `
    <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">
      <div style="font-weight:600;margin-bottom:6px">📕 REDから画像を取り込む</div>
      <div style="margin-bottom:4px"><span style="color:#ec4899;font-weight:700">①</span> 下のリンクをクリックしてREDで検索</div>
      <div id="red-search-links" style="margin-bottom:8px"></div>
      <div style="margin-bottom:4px"><span style="color:#ec4899;font-weight:700">②</span> 気に入った画像を右クリック→保存 or スクショ</div>
      <div style="margin-bottom:6px"><span style="color:#ec4899;font-weight:700">③</span> 下のエリアにドロップ or クリックで選択（Ctrl+Vも可）</div>
    </div>
    <div id="red-drop-zone" style="border:2px dashed var(--border);border-radius:8px;padding:16px;text-align:center;cursor:pointer;transition:border-color 0.15s">
      <div style="font-size:16px;margin-bottom:4px">📷</div>
      <div style="font-size:11px;color:var(--text-muted)">画像をドロップ / クリックで選択 / Ctrl+V</div>
    </div>
    <div id="red-imported-images" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px"></div>
  `;
  section.appendChild(redSection);

  // RED drop zone events
  setTimeout(() => {
    const dropZone = redSection.querySelector("#red-drop-zone");
    const importedGrid = redSection.querySelector("#red-imported-images");
    if (!dropZone) return;

    dropZone.addEventListener("click", () => {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/*,video/*"; inp.multiple = true;
      inp.addEventListener("change", () => { if (inp.files) handleRedFiles(inp.files); });
      inp.click();
    });
    dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.style.borderColor = "#ec4899"; });
    dropZone.addEventListener("dragleave", () => { dropZone.style.borderColor = ""; });
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault(); dropZone.style.borderColor = "";
      if (e.dataTransfer?.files) handleRedFiles(e.dataTransfer.files);
    });

    // Clipboard paste
    function handlePasteForRed(e) {
      if (selectedSource !== "red") return;
      const items = Array.from(e.clipboardData?.items || []);
      const imgItems = items.filter(i => i.type.startsWith("image/"));
      if (imgItems.length > 0) {
        e.preventDefault();
        const files = imgItems.map(i => i.getAsFile()).filter(Boolean);
        if (files.length > 0) handleRedFiles(files);
      }
    }
    document.addEventListener("paste", handlePasteForRed);

    async function handleRedFiles(files) {
      for (const file of Array.from(files).filter(f => f.type.startsWith("image/"))) {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const result = await window.API.uploadFree(projectId, { imageData: reader.result, fileName: file.name });
            if (result.ok && result.imageUrl) {
              const card = document.createElement("div");
              card.style.cssText = "position:relative;border-radius:6px;overflow:hidden;border:1px solid var(--border);cursor:pointer";
              const img = document.createElement("img");
              img.src = result.imageUrl;
              img.style.cssText = "width:100%;aspect-ratio:1;object-fit:cover;display:block";
              card.appendChild(img);
              card.addEventListener("click", async () => {
                if (!confirm("この画像で差し替えますか？")) return;
                try {
                  await window.API.applyImage(projectId, blockIndex, { imageUrl: result.imageUrl });
                  window.loadPreview?.(true);
                  window.pushHistory?.("image_search", `ブロック ${blockIndex} RED画像差替`);
                  window.showToast("画像を差し替えました", "success");
                } catch (err) { window.showToast(`エラー: ${err.message}`, "error"); }
              });
              importedGrid.appendChild(card);
            }
          } catch (err) { window.showToast(`アップロードエラー: ${err.message}`, "error"); }
        };
        reader.readAsDataURL(file);
      }
    }
  }, 0);

  // Search handler
  async function doSearch() {
    const query = searchInput.value.trim();
    if (!query) return;
    if (selectedSource === "red") return; // RED uses manual import
    searchBtn.disabled = true;
    searchBtn.textContent = "検索中...";
    resultsGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:16px;color:var(--text-muted);font-size:12px"><span class="spinner"></span></div>';
    try {
      const resp = await window.API.searchImages(query, selectedSource);
      resultsGrid.innerHTML = "";
      if (resp.error) {
        resultsGrid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:12px;color:var(--text-muted);font-size:11px">${resp.error}</div>`;
        return;
      }
      if (!resp.results || resp.results.length === 0) {
        resultsGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:12px;color:var(--text-muted);font-size:12px">結果が見つかりませんでした</div>';
        return;
      }
      resp.results.forEach(img => {
        const card = document.createElement("div");
        card.className = "image-search-result-card";
        const thumb = document.createElement("img");
        thumb.src = img.thumbnail || img.src;
        thumb.alt = img.title || "";
        thumb.loading = "lazy";
        thumb.onerror = () => { card.style.display = "none"; };
        card.appendChild(thumb);
        if (img.credit) {
          const credit = document.createElement("div");
          credit.style.cssText = "position:absolute;bottom:2px;left:2px;font-size:8px;color:#fff;background:rgba(0,0,0,0.5);padding:1px 4px;border-radius:2px";
          credit.textContent = img.credit;
          card.appendChild(credit);
        }
        card.addEventListener("click", async () => {
          if (!confirm(`この画像で差し替えますか？`)) return;
          try {
            await window.API.applyImage(projectId, blockIndex, { imageUrl: img.src });
            window.loadPreview?.(true);
            window.pushHistory?.("image_search", `ブロック ${blockIndex} 画像検索差替`);
            window.showToast("画像を差し替えました", "success");
          } catch (err) { window.showToast(`エラー: ${err.message}`, "error"); }
        });
        resultsGrid.appendChild(card);
      });
    } catch (err) {
      resultsGrid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:12px;color:#ef4444;font-size:11px">検索エラー: ${err.message}</div>`;
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = "🔄 検索";
    }
  }

  searchBtn.addEventListener("click", doSearch);
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

  // Auto-generate keywords and search on load
  (async () => {
    try {
      autoLabel.textContent = "自動検出キーワード: 生成中...";
      const kwResult = await window.API.autoKeywords(projectId, blockIndex);
      if (kwResult.keywords) {
        searchInput.value = kwResult.keywords;
        searchInput.placeholder = "キーワードを編集可能";
        autoLabel.textContent = `自動検出キーワード: ${kwResult.keywords}`;
        // Auto-search
        doSearch();
        // Populate RED search links
        if (kwResult.redKeywords && kwResult.redKeywords.length > 0) {
          const linksDiv = redSection.querySelector("#red-search-links");
          if (linksDiv) {
            kwResult.redKeywords.forEach(kw => {
              const link = document.createElement("a");
              link.href = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(kw)}&type=54`;
              link.target = "_blank";
              link.rel = "noopener noreferrer";
              link.style.cssText = "display:block;font-size:11px;color:#3b82f6;text-decoration:none;margin-bottom:3px";
              link.textContent = `🔗「${kw}」で検索`;
              link.addEventListener("mouseenter", () => { link.style.textDecoration = "underline"; });
              link.addEventListener("mouseleave", () => { link.style.textDecoration = "none"; });
              linksDiv.appendChild(link);
            });
          }
        }
      } else {
        searchInput.placeholder = "画像を検索...（例：美容 女性 化粧品）";
        autoLabel.textContent = "自動検出キーワード: （検出失敗 — 手動入力してください）";
      }
    } catch {
      searchInput.placeholder = "画像を検索...（例：美容 女性 化粧品）";
      autoLabel.textContent = "自動検出キーワード: （生成エラー）";
    }
  })();

  return section;
}

// 改善6: 画像ピッカーモーダル
function openImagePickerModal(projectId, blockIndex) {
  // Remove existing modal if any
  document.querySelector(".image-picker-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "image-picker-overlay";

  const modal = document.createElement("div");
  modal.className = "image-picker-modal";

  // Header
  const header = document.createElement("div");
  header.className = "image-picker-header";
  header.innerHTML = '<span>画像を挿入</span>';
  const closeBtn = document.createElement("button");
  closeBtn.style.cssText = "background:none;border:none;cursor:pointer;font-size:18px;color:var(--text-muted);padding:4px";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", () => overlay.remove());
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // Body
  const body = document.createElement("div");
  body.className = "image-picker-body";

  // Upload area
  const uploadZone = document.createElement("div");
  uploadZone.className = "image-picker-upload-zone";
  uploadZone.innerHTML = '<div style="font-size:24px;margin-bottom:6px">📁</div><div style="font-size:12px;color:var(--text-muted)">画像をドラッグ＆ドロップ or クリックして選択（4枚まで）</div>';
  const fileInput = document.createElement("input");
  fileInput.type = "file"; fileInput.accept = "image/*,video/*"; fileInput.multiple = true; fileInput.style.display = "none";
  uploadZone.appendChild(fileInput);
  uploadZone.addEventListener("click", () => fileInput.click());
  uploadZone.addEventListener("dragover", (e) => { e.preventDefault(); uploadZone.classList.add("dragover"); });
  uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));

  const uploadPreview = document.createElement("div");
  uploadPreview.style.cssText = "display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:10px";

  function handleFiles(files) {
    const fileArr = Array.from(files).filter(f => f.type.startsWith("image/")).slice(0, 4);
    fileArr.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const card = document.createElement("div");
        card.style.cssText = "position:relative;border-radius:6px;overflow:hidden;border:1px solid var(--border)";
        const img = document.createElement("img");
        img.src = reader.result;
        img.style.cssText = "width:100%;aspect-ratio:4/3;object-fit:cover;display:block";
        card.appendChild(img);
        const btn = document.createElement("button");
        btn.style.cssText = "position:absolute;bottom:4px;left:4px;right:4px;padding:6px;font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:4px;cursor:pointer";
        btn.textContent = "挿入";
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          btn.innerHTML = '<span class="spinner"></span>';
          try {
            const uploadResult = await window.API.uploadFree(projectId, { imageData: reader.result, fileName: file.name });
            if (uploadResult.ok && uploadResult.imageUrl) {
              await insertImageBlock(projectId, blockIndex, uploadResult.imageUrl);
              window.showToast("画像を挿入しました", "success");
              overlay.remove();
            }
          } catch (err) { window.showToast(`エラー: ${err.message}`, "error"); }
          finally { btn.disabled = false; btn.textContent = "挿入"; }
        });
        card.appendChild(btn);
        uploadPreview.appendChild(card);
      };
      reader.readAsDataURL(file);
    });
  }

  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault(); uploadZone.classList.remove("dragover");
    if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener("change", () => { if (fileInput.files) handleFiles(fileInput.files); });

  body.appendChild(uploadZone);
  body.appendChild(uploadPreview);

  // Existing images grid
  const existingLabel = document.createElement("div");
  existingLabel.style.cssText = "font-size:12px;font-weight:600;color:var(--text-secondary);margin:14px 0 8px;border-top:1px solid var(--border);padding-top:12px";
  existingLabel.textContent = "プロジェクト内の画像";
  body.appendChild(existingLabel);

  const imageGrid = document.createElement("div");
  imageGrid.className = "image-picker-grid";
  imageGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:16px;color:var(--text-muted);font-size:12px"><span class="spinner"></span> 読み込み中...</div>';
  body.appendChild(imageGrid);

  // Load existing images
  window.API.getProjectImages(projectId).then(result => {
    imageGrid.innerHTML = "";
    const images = result.images || [];
    if (images.length === 0) {
      imageGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:16px;color:var(--text-muted);font-size:12px">画像がありません</div>';
      return;
    }
    images.forEach(img => {
      const thumb = document.createElement("img");
      thumb.className = "image-picker-thumb";
      thumb.src = img.src;
      thumb.title = img.src.split("/").pop() || "";
      thumb.onerror = () => { thumb.style.display = "none"; };
      thumb.addEventListener("click", async () => {
        if (!confirm("この画像を新しいブロックとして挿入しますか？")) return;
        try {
          await insertImageBlock(projectId, blockIndex, img.src);
          window.showToast("画像を挿入しました", "success");
          overlay.remove();
        } catch (err) { window.showToast(`エラー: ${err.message}`, "error"); }
      });
      imageGrid.appendChild(thumb);
    });
  }).catch(() => {
    imageGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);font-size:12px">読み込みエラー</div>';
  });

  modal.appendChild(body);
  overlay.appendChild(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  // Clipboard paste support (Ctrl+V)
  function handlePaste(e) {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(item => item.type.startsWith("image/"));
    if (imageItems.length > 0) {
      e.preventDefault();
      const files = imageItems.map(item => item.getAsFile()).filter(Boolean);
      if (files.length > 0) handleFiles(files);
    }
  }
  document.addEventListener("paste", handlePaste);
  // Clean up paste listener when modal closes
  const origRemove = overlay.remove.bind(overlay);
  overlay.remove = function() { document.removeEventListener("paste", handlePaste); origRemove(); };

  document.body.appendChild(overlay);
}

async function insertImageBlock(projectId, afterBlockIndex, imageUrl) {
  const imgHtml = `<picture><source type="image/webp" data-srcset="${imageUrl}"><img class="lazyload" data-src="${imageUrl}" alt="" style="width:100%"></picture>`;
  await window.API.insertBlock(projectId, {
    afterIndex: afterBlockIndex,
    type: "image",
    html: imgHtml,
  });
  window.loadPreview?.(true);
  window.pushHistory?.("insert_block", `画像ブロック挿入`);
}

window.openImagePickerModal = openImagePickerModal;
window.openEditPanel = openEditPanel;

document.getElementById("edit-panel-close")?.addEventListener("click", () => {
  document.getElementById("edit-panel").classList.remove("open");
});

// ── Widget挿入ボタン（編集パネル右上） ──────────────────────
let _widgetPanelActive = false;
let _savedPanelContent = null;

document.getElementById("edit-panel-widget-btn")?.addEventListener("click", () => {
  const body = document.getElementById("edit-panel-body");
  const widgetBtn = document.getElementById("edit-panel-widget-btn");
  const modeToggle = document.querySelector(".edit-mode-toggle");

  if (_widgetPanelActive) {
    // ── 戻る: 元の編集パネルに復帰 ──
    _widgetPanelActive = false;
    widgetBtn.classList.remove("active");
    if (modeToggle) modeToggle.style.display = "";
    if (window._currentPanelData) {
      const { projectId, blockIndex, blockType } = window._currentPanelData;
      openEditPanel(projectId, blockIndex, blockType);
    }
    return;
  }

  // ── Widget入稿画面を表示 ──
  _widgetPanelActive = true;
  widgetBtn.classList.add("active");
  if (modeToggle) modeToggle.style.display = "none";

  body.innerHTML = "";

  // 戻るボタン
  const backBar = document.createElement("div");
  backBar.style.cssText = "padding:8px 0 12px;border-bottom:1px solid var(--border);margin-bottom:12px";
  const backBtn = document.createElement("button");
  backBtn.style.cssText = "display:flex;align-items:center;gap:6px;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:12px;padding:4px 8px;border-radius:6px;transition:all 0.15s";
  backBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> 編集に戻る';
  backBtn.addEventListener("mouseenter", () => { backBtn.style.color = "var(--text-primary)"; backBtn.style.background = "var(--bg-tertiary)"; });
  backBtn.addEventListener("mouseleave", () => { backBtn.style.color = ""; backBtn.style.background = ""; });
  backBtn.addEventListener("click", () => {
    _widgetPanelActive = false;
    widgetBtn.classList.remove("active");
    if (modeToggle) modeToggle.style.display = "";
    if (window._currentPanelData) {
      const { projectId, blockIndex, blockType } = window._currentPanelData;
      openEditPanel(projectId, blockIndex, blockType);
    }
  });
  backBar.appendChild(backBtn);
  body.appendChild(backBar);

  // 挿入位置
  const posSec = document.createElement("div");
  posSec.style.cssText = "margin-bottom:14px";
  const posLabel = document.createElement("label");
  posLabel.className = "form-label";
  posLabel.textContent = "挿入位置";
  posLabel.style.cssText = "display:block;font-size:11px;margin-bottom:4px;color:var(--text-muted)";
  const posSelect = document.createElement("select");
  posSelect.className = "form-input";
  posSelect.style.cssText = "width:100%;font-size:12px";
  posSelect.innerHTML = '<option value="end">末尾に追加</option>';

  const state = window._editorState || {};
  const blocks = state.projectData?.blocks || window._currentPanelData?.blocks || [];
  if (window._currentPanelData) {
    // 現在のブロックの下をデフォルトに
    const curIdx = window._currentPanelData.blockIndex;
    posSelect.innerHTML = `<option value="${curIdx}">現在のブロック (${curIdx}) の下</option><option value="end">末尾に追加</option>`;
  }
  // APIから全ブロックリスト取得して追加
  if (window._currentPanelData?.projectId) {
    window.API.getProject(window._currentPanelData.projectId).then(proj => {
      if (proj?.blocks) {
        proj.blocks.forEach(b => {
          const opt = document.createElement("option");
          opt.value = b.index;
          opt.textContent = `ブロック ${b.index} (${b.type}) の後`;
          posSelect.appendChild(opt);
        });
      }
    }).catch(() => {});
  }
  posSec.appendChild(posLabel);
  posSec.appendChild(posSelect);
  body.appendChild(posSec);

  // Widgetテンプレート一覧
  const listHeader = document.createElement("div");
  listHeader.style.cssText = "font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:10px";
  listHeader.textContent = "ウィジェットテンプレート";
  body.appendChild(listHeader);

  const templates = window.getAllWidgetTemplates ? window.getAllWidgetTemplates() : (window.WIDGET_TEMPLATES || []);
  const listContainer = document.createElement("div");
  listContainer.style.cssText = "display:flex;flex-direction:column;gap:8px";

  templates.forEach(tmpl => {
    const card = document.createElement("div");
    card.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:all 0.15s";
    card.addEventListener("mouseenter", () => { card.style.borderColor = "rgba(139,92,246,0.4)"; card.style.background = "rgba(139,92,246,0.04)"; });
    card.addEventListener("mouseleave", () => { card.style.borderColor = ""; card.style.background = ""; });

    const icon = document.createElement("span");
    icon.style.cssText = "font-size:18px;flex-shrink:0;width:32px;text-align:center";
    icon.textContent = tmpl.icon;

    const info = document.createElement("div");
    info.style.cssText = "flex:1;min-width:0";
    info.innerHTML = `<div style="font-size:12px;font-weight:600;color:var(--text-primary)">${tmpl.name}</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${tmpl.description}</div>`;

    const catBadge = document.createElement("span");
    catBadge.style.cssText = "font-size:9px;padding:2px 6px;background:rgba(139,92,246,0.1);color:#8b5cf6;border-radius:6px;flex-shrink:0";
    catBadge.textContent = tmpl.category;

    const insertBtn = document.createElement("button");
    insertBtn.style.cssText = "font-size:11px;padding:4px 10px;border:1px solid rgba(139,92,246,0.3);border-radius:6px;background:rgba(139,92,246,0.08);color:#8b5cf6;cursor:pointer;flex-shrink:0;transition:all 0.15s";
    insertBtn.textContent = "挿入";
    insertBtn.addEventListener("mouseenter", () => { insertBtn.style.background = "rgba(139,92,246,0.2)"; });
    insertBtn.addEventListener("mouseleave", () => { insertBtn.style.background = "rgba(139,92,246,0.08)"; });
    insertBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      insertBtn.disabled = true;
      insertBtn.textContent = "...";
      try {
        const generated = tmpl.generate();
        const posVal = posSelect.value;
        let afterIndex = posVal === "end" ? null : parseInt(posVal, 10);
        const pid = window._currentPanelData?.projectId;
        if (!pid) throw new Error("プロジェクトIDが不明です");
        const result = await window.API.insertBlock(pid, {
          afterIndex,
          html: generated.html,
          type: generated.type,
          widgetType: generated.widgetType,
        });
        if (result.ok) {
          window.showToast?.(`${tmpl.name} を挿入しました`, "success");
          window.loadEditor?.(result.insertedIndex);
          window.pushHistory?.("insert_widget", `${tmpl.name} を挿入`);
          // 戻る
          _widgetPanelActive = false;
          widgetBtn.classList.remove("active");
          if (modeToggle) modeToggle.style.display = "";
        }
      } catch (err) {
        window.showToast?.(`エラー: ${err.message}`, "error");
      } finally {
        insertBtn.disabled = false;
        insertBtn.textContent = "挿入";
      }
    });

    card.appendChild(icon);
    card.appendChild(info);
    card.appendChild(catBadge);
    card.appendChild(insertBtn);
    listContainer.appendChild(card);
  });

  body.appendChild(listContainer);
});

// ── AI テキスト編集パネル ──────────────────────────────────

function buildAiTextPanel(projectId, blockIndex, block) {
  const frag = document.createDocumentFragment();

  // HTMLからテキストを抽出（block.textが空の場合のフォールバック）
  let extractedText = block.text || "";
  if (!extractedText && block.html) {
    const tmpDoc = new DOMParser().parseFromString(block.html, "text/html");
    // style/scriptタグを除去してテキスト取得
    tmpDoc.querySelectorAll("style, script").forEach(el => el.remove());
    extractedText = (tmpDoc.body.textContent || "").replace(/\s+/g, " ").trim();
  }

  // AIプロバイダー選択
  const providerSection = createSection("AIプロバイダー");
  const providerRow = document.createElement("div");
  providerRow.style.cssText = "display:flex;gap:6px";
  const providers = window._availableProviders || [];
  const providerBtns = {};

  // PixAI
  const providerPixAI = document.createElement("button");
  providerPixAI.className = "panel-btn";
  providerPixAI.textContent = "PixAI";
  providerPixAI.dataset.provider = "pixai";
  if (!providers.includes("pixai")) { providerPixAI.style.opacity = "0.5"; providerPixAI.title = "PixAI APIキー未設定"; }
  providerBtns.pixai = providerPixAI;

  // Nano Banana Pro
  const providerGemini = document.createElement("button");
  providerGemini.className = "panel-btn";
  providerGemini.textContent = "Nano Banana";
  providerGemini.dataset.provider = "nanobanana";
  if (!providers.includes("nanobanana")) { providerGemini.style.opacity = "0.5"; providerGemini.title = "Nano Banana APIキー未設定"; }
  providerBtns.nanobanana = providerGemini;

  // デフォルトプロバイダー: PixAI優先
  let selectedProvider = window._selectedProvider || (providers.includes("pixai") ? "pixai" : providers.includes("nanobanana") ? "nanobanana" : "nanobanana");
  window._selectedProvider = selectedProvider;

  function updateProviderBtns() {
    Object.values(providerBtns).forEach(b => b.className = "panel-btn");
    if (providerBtns[selectedProvider]) providerBtns[selectedProvider].className = "panel-btn primary";
  }
  updateProviderBtns();

  providerPixAI.addEventListener("click", () => {
    if (!providers.includes("pixai")) { window.showToast("PixAI APIキーを設定してください", "info"); return; }
    selectedProvider = "pixai"; window._selectedProvider = "pixai"; updateProviderBtns();
  });
  providerGemini.addEventListener("click", () => {
    if (!providers.includes("nanobanana")) { window.showToast("Nano Banana APIキーを設定してください", "info"); return; }
    selectedProvider = "nanobanana"; window._selectedProvider = "nanobanana"; updateProviderBtns();
  });

  providerRow.appendChild(providerPixAI);
  providerRow.appendChild(providerGemini);
  providerSection.appendChild(providerRow);
  frag.appendChild(providerSection);

  // デザイン要件
  const designSection = createSection("デザイン要件（AI共通指示）");
  const designArea = document.createElement("textarea");
  designArea.className = "panel-textarea";
  designArea.placeholder = "例：大人女性向け高級感のあるトーン / ポップで明るい雰囲気 / 医療系の信頼感...";
  designArea.rows = 2;
  designArea.value = window._designRequirements || "";
  designArea.addEventListener("input", () => {
    window._designRequirements = designArea.value;
  });
  designSection.appendChild(designArea);
  const designHint = document.createElement("div");
  designHint.style.cssText = "font-size:11px;color:var(--text-muted);margin-top:4px";
  designHint.textContent = "ここに書いた内容がAI書き換え・画像生成の全指示に反映されます";
  designSection.appendChild(designHint);
  frag.appendChild(designSection);

  // 現在のテキスト表示（HTMLから抽出）
  const currentSection = createSection("現在のテキスト");
  const currentText = document.createElement("div");
  currentText.className = "ai-result-preview";
  currentText.textContent = extractedText || "(テキストなし)";
  currentSection.appendChild(currentText);
  frag.appendChild(currentSection);

  // クイックプリセット
  const presetSection = createSection("クイック指示");
  const presetRow = document.createElement("div");
  presetRow.style.cssText = "display:flex;flex-wrap:wrap;gap:6px";
  const presets = [
    "トンマナを変えて大人っぽく",
    "煽りを強めて",
    "文章を短くして",
    "もっと具体的に",
    "別商品に差し替えて",
    "信頼感を出して",
  ];
  presets.forEach((p) => {
    const chip = document.createElement("button");
    chip.className = "panel-btn";
    chip.style.cssText = "font-size:11px;padding:4px 10px;border-radius:12px";
    chip.textContent = p;
    chip.addEventListener("click", () => {
      aiInput.value = p;
    });
    presetRow.appendChild(chip);
  });
  presetSection.appendChild(presetRow);
  frag.appendChild(presetSection);

  // AI指示入力
  const aiSection = document.createElement("div");
  aiSection.className = "ai-prompt-section";
  const aiTitle = document.createElement("div");
  aiTitle.className = "panel-section-title";
  aiTitle.textContent = "AI書き換え指示";
  aiSection.appendChild(aiTitle);

  const aiInput = document.createElement("textarea");
  aiInput.className = "panel-textarea";
  aiInput.placeholder = "例：トンマナを変えて大人っぽくして / もっと煽りを強めて / 文章を短くして / 別商品に差し替えて...";
  aiInput.rows = 3;
  aiSection.appendChild(aiInput);

  // カスタムプロンプト（詳細指示）
  const customSection = document.createElement("div");
  customSection.style.marginTop = "8px";
  const customToggle = document.createElement("button");
  customToggle.className = "panel-btn";
  customToggle.style.cssText = "font-size:11px;width:100%;text-align:left;padding:6px 10px";
  customToggle.textContent = "▶ カスタムプロンプト（詳細指示）";
  const customArea = document.createElement("textarea");
  customArea.className = "panel-textarea";
  customArea.placeholder = "AIへの詳細な追加指示。例：\n・商品名を「○○」に変更\n・ターゲットは30代女性\n・数字やデータを含めて\n・HTML構造は維持して";
  customArea.rows = 4;
  customArea.style.display = "none";
  customToggle.addEventListener("click", () => {
    const open = customArea.style.display !== "none";
    customArea.style.display = open ? "none" : "block";
    customToggle.textContent = open ? "▶ カスタムプロンプト（詳細指示）" : "▼ カスタムプロンプト（詳細指示）";
  });
  customSection.appendChild(customToggle);
  customSection.appendChild(customArea);
  aiSection.appendChild(customSection);

  const aiBtnRow = document.createElement("div");
  aiBtnRow.className = "panel-btn-row";
  const aiBtn = document.createElement("button");
  aiBtn.className = "panel-btn primary";
  aiBtn.textContent = "AIで書き換え";

  // 結果表示エリア
  const resultArea = document.createElement("div");
  resultArea.style.marginTop = "12px";

  aiBtn.addEventListener("click", async () => {
    const instruction = aiInput.value.trim();
    if (!instruction) {
      window.showToast("書き換え指示を入力してください", "error");
      return;
    }

    aiBtn.disabled = true;
    aiBtn.innerHTML = '<span class="spinner"></span> AI処理中...';

    try {
      const customPrompt = customArea.value.trim();
      const result = await window.API.aiRewrite(projectId, blockIndex, {
        instruction: customPrompt ? `${instruction}\n\n追加指示: ${customPrompt}` : instruction,
        text: extractedText,
        html: block.html || "",
        designRequirements: window._designRequirements || "",
        provider: selectedProvider,
      });

      if (result.ok) {
        resultArea.innerHTML = "";

        const previewTitle = document.createElement("div");
        previewTitle.className = "panel-section-title";
        previewTitle.textContent = "書き換え結果";
        resultArea.appendChild(previewTitle);

        const preview = document.createElement("div");
        preview.className = "ai-result-preview";
        preview.textContent = result.rewritten;
        resultArea.appendChild(preview);

        // 適用ボタン
        const applyRow = document.createElement("div");
        applyRow.className = "panel-btn-row";

        const applyBtn = document.createElement("button");
        applyBtn.className = "panel-btn primary";
        applyBtn.textContent = "この内容で適用";
        applyBtn.addEventListener("click", async () => {
          applyBtn.disabled = true;
          try {
            // block.html内のテキストを書き換え
            let newHtml = block.html;
            if (extractedText && result.rewritten) {
              // まずblock.textで直接置換を試行
              if (block.text && newHtml.includes(block.text)) {
                newHtml = newHtml.replace(block.text, result.rewritten);
              } else {
                // HTMLからテキストノードを書き換え
                const tmpDoc = new DOMParser().parseFromString(newHtml, "text/html");
                tmpDoc.querySelectorAll("style, script").forEach(el => el.remove());
                const textNodes = [];
                const walker = document.createTreeWalker(tmpDoc.body, NodeFilter.SHOW_TEXT, null, false);
                let node;
                while ((node = walker.nextNode())) {
                  if (node.textContent.trim()) textNodes.push(node);
                }
                // 全テキストを結合して書き換え結果で更新
                if (textNodes.length === 1) {
                  textNodes[0].textContent = result.rewritten;
                } else if (textNodes.length > 1) {
                  // 最初のテキストノードに全結果を入れ、残りを空にする
                  textNodes[0].textContent = result.rewritten;
                  for (let i = 1; i < textNodes.length; i++) {
                    textNodes[i].textContent = "";
                  }
                }
                // style/scriptを戻すため元HTMLからstyle部分を保持
                const origDoc = new DOMParser().parseFromString(block.html, "text/html");
                const styles = origDoc.querySelectorAll("style");
                const scripts = origDoc.querySelectorAll("script");
                styles.forEach(s => tmpDoc.body.prepend(s.cloneNode(true)));
                scripts.forEach(s => tmpDoc.body.appendChild(s.cloneNode(true)));
                newHtml = tmpDoc.body.innerHTML;
              }
            }
            await window.API.updateBlock(projectId, blockIndex, {
              html: newHtml,
              text: result.rewritten,
            });
            window.showToast("適用しました", "success");
            window.loadPreview(true);
            window.loadEditor();
            window.pushHistory?.("ai_rewrite", `ブロック ${blockIndex} AI書き換え`);
          } catch (err) {
            window.showToast(`エラー: ${err.message}`, "error");
          } finally {
            applyBtn.disabled = false;
          }
        });

        const retryBtn = document.createElement("button");
        retryBtn.className = "panel-btn";
        retryBtn.textContent = "やり直す";
        retryBtn.addEventListener("click", () => {
          resultArea.innerHTML = "";
        });

        applyRow.appendChild(applyBtn);
        applyRow.appendChild(retryBtn);
        resultArea.appendChild(applyRow);
      }
    } catch (err) {
      window.showToast(`AIエラー: ${err.message}`, "error");
    } finally {
      aiBtn.disabled = false;
      aiBtn.textContent = "AIで書き換え";
    }
  });

  aiBtnRow.appendChild(aiBtn);
  aiSection.appendChild(aiBtnRow);
  aiSection.appendChild(resultArea);
  frag.appendChild(aiSection);

  // HTMLソース（参考用）
  const htmlSection = createSection("HTMLソース");
  const codeArea = document.createElement("textarea");
  codeArea.className = "panel-code";
  codeArea.value = block.html || "";
  codeArea.rows = 6;
  codeArea.readOnly = true;
  htmlSection.appendChild(codeArea);
  frag.appendChild(htmlSection);

  return frag;
}

// ── 手動テキスト編集パネル ─────────────────────────────────

// HTMLからスタイル情報を抽出するヘルパー
function extractStyles(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const el = tmp.querySelector("[style]") || tmp.firstElementChild || tmp;
  const cs = el.style || {};
  // font-sizeを探す（ネストされた要素も含めて）
  let fontSize = "";
  let color = "";
  let bgColor = "";
  let bold = false;

  function walk(node) {
    if (!node) return;
    if (node.style) {
      if (node.style.fontSize && !fontSize) fontSize = node.style.fontSize;
      if (node.style.color && !color) color = node.style.color;
      if (node.style.backgroundColor && !bgColor) bgColor = node.style.backgroundColor;
    }
    if (node.tagName === "STRONG" || node.tagName === "B" ||
        (node.style && (node.style.fontWeight === "bold" || node.style.fontWeight >= 700))) {
      bold = true;
    }
    // font color属性
    if (node.tagName === "FONT" && node.getAttribute("color") && !color) {
      color = node.getAttribute("color");
    }
    for (const child of (node.children || [])) walk(child);
  }
  walk(tmp);
  return { fontSize, color, bgColor, bold };
}

// rgbをhexに変換
function rgbToHex(rgb) {
  if (!rgb) return "";
  if (rgb.startsWith("#")) return rgb;
  const match = rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return rgb;
  return "#" + [match[1], match[2], match[3]].map(x => parseInt(x).toString(16).padStart(2, "0")).join("");
}

// HTMLのルート要素にスタイルを適用
function applyStylesToHtml(html, styles) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  // ルート要素（またはスタイルを持つ最初の要素）を取得
  const root = tmp.firstElementChild || tmp;
  // 既存のstyleを更新
  if (styles.fontSize) root.style.fontSize = styles.fontSize;
  if (styles.color) root.style.color = styles.color;
  if (styles.bgColor) root.style.backgroundColor = styles.bgColor;
  if (styles.bold === true && root.style.fontWeight !== "bold") root.style.fontWeight = "bold";
  if (styles.bold === false && root.style.fontWeight) root.style.fontWeight = "";
  return tmp.innerHTML;
}

function buildTextPanel(projectId, blockIndex, block) {
  const frag = document.createDocumentFragment();
  const styles = extractStyles(block.html || "");
  // 編集中のHTML状態を保持
  let currentHtml = block.html || "";
  // block.textが空ならHTMLからテキスト抽出
  let currentText = block.text || "";
  if (!currentText && block.html) {
    const tmpDoc = new DOMParser().parseFromString(block.html, "text/html");
    tmpDoc.querySelectorAll("style, script").forEach(el => el.remove());
    currentText = (tmpDoc.body.textContent || "").replace(/\s+/g, " ").trim();
  }

  // ビジュアルプレビュー
  const previewSection = createSection("プレビュー");
  const previewBox = document.createElement("div");
  previewBox.className = "visual-preview-box";
  previewBox.innerHTML = currentHtml;
  previewSection.appendChild(previewBox);
  frag.appendChild(previewSection);

  // テキスト編集
  const textSection = createSection("テキスト内容");
  const textarea = document.createElement("textarea");
  textarea.className = "panel-textarea";
  textarea.value = currentText;
  textarea.rows = 4;
  textSection.appendChild(textarea);
  frag.appendChild(textSection);

  // ── スタイル編集コントロール ──
  const styleSection = document.createElement("div");
  styleSection.className = "panel-section style-controls";
  const styleTitle = document.createElement("div");
  styleTitle.className = "panel-section-title";
  styleTitle.textContent = "スタイル";
  styleSection.appendChild(styleTitle);

  // 文字サイズ
  const sizeRow = document.createElement("div");
  sizeRow.className = "style-control-row";
  sizeRow.innerHTML = '<label class="style-control-label">文字サイズ</label>';
  const sizeInputWrap = document.createElement("div");
  sizeInputWrap.className = "style-control-input-wrap";
  const sizeInput = document.createElement("input");
  sizeInput.type = "number";
  sizeInput.className = "style-control-number";
  sizeInput.value = parseInt(styles.fontSize) || "";
  sizeInput.placeholder = "例: 16";
  sizeInput.min = "8";
  sizeInput.max = "80";
  const sizeUnit = document.createElement("span");
  sizeUnit.className = "style-control-unit";
  sizeUnit.textContent = "px";
  sizeInputWrap.appendChild(sizeInput);
  sizeInputWrap.appendChild(sizeUnit);
  // プリセットボタン
  const sizePresets = document.createElement("div");
  sizePresets.className = "style-presets";
  [12, 14, 16, 20, 24, 32].forEach(sz => {
    const btn = document.createElement("button");
    btn.className = "style-preset-btn" + (parseInt(styles.fontSize) === sz ? " active" : "");
    btn.textContent = sz;
    btn.addEventListener("click", () => {
      sizeInput.value = sz;
      sizePresets.querySelectorAll(".style-preset-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      sizeInput.dispatchEvent(new Event("input"));
    });
    sizePresets.appendChild(btn);
  });
  sizeRow.appendChild(sizeInputWrap);
  sizeRow.appendChild(sizePresets);
  styleSection.appendChild(sizeRow);

  // 文字色
  const colorRow = document.createElement("div");
  colorRow.className = "style-control-row";
  colorRow.innerHTML = '<label class="style-control-label">文字色</label>';
  const colorWrap = document.createElement("div");
  colorWrap.className = "style-control-color-wrap";
  const colorPicker = document.createElement("input");
  colorPicker.type = "color";
  colorPicker.className = "style-color-picker";
  colorPicker.value = rgbToHex(styles.color) || "#000000";
  const colorText = document.createElement("input");
  colorText.type = "text";
  colorText.className = "style-color-text";
  colorText.value = rgbToHex(styles.color) || "";
  colorText.placeholder = "例: #ff0000 / red";
  colorWrap.appendChild(colorPicker);
  colorWrap.appendChild(colorText);
  // プリセット色
  const colorPresets = document.createElement("div");
  colorPresets.className = "style-presets";
  ["#000000", "#ff0000", "#0066ff", "#ff6600", "#008800", "#ffffff"].forEach(c => {
    const btn = document.createElement("button");
    btn.className = "style-preset-color";
    btn.style.backgroundColor = c;
    if (c === "#ffffff") btn.style.border = "1px solid var(--border)";
    btn.addEventListener("click", () => {
      colorPicker.value = c;
      colorText.value = c;
      colorPicker.dispatchEvent(new Event("input"));
    });
    colorPresets.appendChild(btn);
  });
  colorRow.appendChild(colorWrap);
  colorRow.appendChild(colorPresets);
  styleSection.appendChild(colorRow);

  // 背景色（アンダーカラー）
  const bgRow = document.createElement("div");
  bgRow.className = "style-control-row";
  bgRow.innerHTML = '<label class="style-control-label">背景色 / アンダーカラー</label>';
  const bgWrap = document.createElement("div");
  bgWrap.className = "style-control-color-wrap";
  const bgPicker = document.createElement("input");
  bgPicker.type = "color";
  bgPicker.className = "style-color-picker";
  bgPicker.value = rgbToHex(styles.bgColor) || "#ffff00";
  const bgText = document.createElement("input");
  bgText.type = "text";
  bgText.className = "style-color-text";
  bgText.value = rgbToHex(styles.bgColor) || "";
  bgText.placeholder = "例: #ffff00 / yellow";
  bgWrap.appendChild(bgPicker);
  bgWrap.appendChild(bgText);
  const bgPresets = document.createElement("div");
  bgPresets.className = "style-presets";
  ["#ffff00", "#ffcccc", "#ccffcc", "#cce5ff", "#ffe0cc", "transparent"].forEach(c => {
    const btn = document.createElement("button");
    btn.className = "style-preset-color";
    if (c === "transparent") {
      btn.style.background = "linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)";
      btn.style.backgroundSize = "8px 8px";
      btn.style.backgroundPosition = "0 0, 4px 4px";
      btn.title = "なし";
    } else {
      btn.style.backgroundColor = c;
    }
    btn.addEventListener("click", () => {
      if (c === "transparent") {
        bgPicker.value = "#ffffff";
        bgText.value = "";
      } else {
        bgPicker.value = c;
        bgText.value = c;
      }
      bgPicker.dispatchEvent(new Event("input"));
    });
    bgPresets.appendChild(btn);
  });
  bgRow.appendChild(bgWrap);
  bgRow.appendChild(bgPresets);
  styleSection.appendChild(bgRow);

  // 太字トグル
  const boldRow = document.createElement("div");
  boldRow.className = "style-control-row";
  boldRow.innerHTML = '<label class="style-control-label">太字</label>';
  const boldBtn = document.createElement("button");
  boldBtn.className = "style-bold-toggle" + (styles.bold ? " active" : "");
  boldBtn.innerHTML = "<b>B</b> 太字";
  boldBtn.addEventListener("click", () => {
    boldBtn.classList.toggle("active");
    rebuildPreview();
  });
  boldRow.appendChild(boldBtn);
  styleSection.appendChild(boldRow);

  frag.appendChild(styleSection);

  // HTMLソース（折りたたみ）
  const htmlToggle = document.createElement("button");
  htmlToggle.className = "oneclick-advanced-toggle";
  htmlToggle.textContent = "HTMLソースを編集";
  const htmlContent = document.createElement("div");
  htmlContent.className = "oneclick-advanced-content";
  htmlToggle.addEventListener("click", () => {
    htmlContent.classList.toggle("open");
    htmlToggle.classList.toggle("open");
  });
  frag.appendChild(htmlToggle);

  const codeArea = document.createElement("textarea");
  codeArea.className = "panel-code";
  codeArea.value = currentHtml;
  codeArea.rows = 8;
  htmlContent.appendChild(codeArea);
  frag.appendChild(htmlContent);

  // 初回テキスト（HTML抽出込み）をベースライン保持
  const _baseText = currentText;

  // ── プレビュー再構築関数 ──
  function rebuildPreview() {
    // テキスト更新: HTMLのテキストノードを直接置換
    let html = currentHtml;
    const oldText = currentText;
    const newText = textarea.value;
    if (oldText && newText !== oldText) {
      // まずシンプルな文字列置換を試行
      if (html.includes(oldText)) {
        html = html.replace(oldText, newText);
      } else {
        // テキストノードレベルで置換
        const tmpDoc = new DOMParser().parseFromString(html, "text/html");
        const walker = document.createTreeWalker(tmpDoc.body, NodeFilter.SHOW_TEXT, null, false);
        let node;
        const textNodes = [];
        while ((node = walker.nextNode())) {
          if (node.textContent.trim()) textNodes.push(node);
        }
        if (textNodes.length === 1) {
          textNodes[0].textContent = newText;
        } else if (textNodes.length > 0) {
          // 全テキストノードの結合テキストを置換
          const combined = textNodes.map(n => n.textContent.trim()).join(" ");
          if (combined === oldText) {
            textNodes[0].textContent = newText;
            for (let i = 1; i < textNodes.length; i++) textNodes[i].textContent = "";
          }
        }
        // style要素を保持
        const origStyles = new DOMParser().parseFromString(block.html, "text/html").querySelectorAll("style");
        tmpDoc.querySelectorAll("style").forEach(s => s.remove());
        origStyles.forEach(s => tmpDoc.body.prepend(s.cloneNode(true)));
        html = tmpDoc.body.innerHTML;
      }
    }
    // スタイル適用
    const newStyles = {};
    if (sizeInput.value) newStyles.fontSize = sizeInput.value + "px";
    if (colorText.value) newStyles.color = colorText.value;
    if (bgText.value) newStyles.bgColor = bgText.value;
    newStyles.bold = boldBtn.classList.contains("active");
    html = applyStylesToHtml(html, newStyles);

    currentHtml = html;
    currentText = textarea.value;
    codeArea.value = html;
    previewBox.innerHTML = html;

    // リアルタイム自動保存
    autoSave(projectId, blockIndex, () => ({
      html: currentHtml,
      text: currentText,
    }));
  }

  // イベント接続
  textarea.addEventListener("input", rebuildPreview);
  sizeInput.addEventListener("input", () => {
    sizePresets.querySelectorAll(".style-preset-btn").forEach(b => {
      b.classList.toggle("active", b.textContent === sizeInput.value);
    });
    rebuildPreview();
  });
  colorPicker.addEventListener("input", () => { colorText.value = colorPicker.value; rebuildPreview(); });
  colorText.addEventListener("input", () => {
    try { colorPicker.value = colorText.value; } catch {}
    rebuildPreview();
  });
  bgPicker.addEventListener("input", () => { bgText.value = bgPicker.value; rebuildPreview(); });
  bgText.addEventListener("input", () => {
    try { bgPicker.value = bgText.value; } catch {}
    rebuildPreview();
  });

  frag.appendChild(buildSaveRow(projectId, blockIndex, () => ({
    html: codeArea.value,
    text: textarea.value,
  })));

  return frag;
}

// ── AI画像ウィザード ──────────────────────────────────────────

function buildAiImageWizard(projectId, blockIndex, block) {
  const container = document.createElement("div");
  container.className = "ai-wizard-container";

  const asset = block.assets?.[0];
  const originalW = asset?.width || 580;
  const originalH = asset?.height || 580;

  // 状態オブジェクト
  const state = {
    currentStep: 0,
    provider: null,
    image1Url: null,
    image2Url: null,
    composedUrl: null,
    layout: null,
    bubbles: [],
    referenceLocalPath: null,
    prompt: "",
  };

  // ステップ定義
  const STEPS = ["プロバイダー", "画像生成", "2枚目", "合成", "吹き出し", "配置"];
  const stepBar = buildStepIndicator(STEPS.length, STEPS);
  container.appendChild(stepBar.el);

  const content = document.createElement("div");
  content.className = "ai-wizard-content";
  container.appendChild(content);

  function goToStep(idx) {
    state.currentStep = idx;
    stepBar.setStep(idx);
    renderWizardStep();
  }

  function renderWizardStep() {
    content.innerHTML = "";
    switch (state.currentStep) {
      case 0: renderStep1Provider(); break;
      case 1: renderStep2Generate(); break;
      case 2: renderStep3Second(); break;
      case 3: renderStep4Compose(); break;
      case 4: renderStep5Bubbles(); break;
      case 5: renderStep6Place(); break;
    }
  }

  // ── Step 1: プロバイダー選択 ──
  function renderStep1Provider() {
    const step = document.createElement("div");
    step.className = "ai-wizard-step";

    const title = document.createElement("h3");
    title.className = "ai-wizard-step-title";
    title.textContent = "AIプロバイダーを選択";
    step.appendChild(title);

    const desc = document.createElement("p");
    desc.className = "ai-wizard-step-desc";
    desc.textContent = "画像生成に使用するAIプロバイダーを選んでください";
    step.appendChild(desc);

    const grid = document.createElement("div");
    grid.className = "ai-wizard-provider-grid";

    const providers = window._availableProviders || [];

    // PixAI card
    const pixaiCard = document.createElement("button");
    pixaiCard.className = "ai-wizard-provider-card" + (providers.includes("pixai") ? "" : " disabled");
    pixaiCard.innerHTML = `
      <div class="provider-card-icon">&#x1F3A8;</div>
      <div class="provider-card-name">PixAI</div>
      <div class="provider-card-desc">アニメ・イラスト系に強い</div>
    `;
    if (providers.includes("pixai")) {
      pixaiCard.addEventListener("click", () => { state.provider = "pixai"; goToStep(1); });
    } else {
      pixaiCard.addEventListener("click", () => window.showToast("PixAI APIキーを設定してください", "info"));
    }
    grid.appendChild(pixaiCard);

    // Nano Banana Pro card
    const nbCard = document.createElement("button");
    nbCard.className = "ai-wizard-provider-card" + (providers.includes("nanobanana") ? "" : " disabled");
    nbCard.innerHTML = `
      <div class="provider-card-icon">&#x1F34C;</div>
      <div class="provider-card-name">Nano Banana Pro</div>
      <div class="provider-card-desc">写真・リアル系に強い</div>
    `;
    if (providers.includes("nanobanana")) {
      nbCard.addEventListener("click", () => { state.provider = "nanobanana"; goToStep(1); });
    } else {
      nbCard.addEventListener("click", () => window.showToast("Nano Banana APIキーを設定してください", "info"));
    }
    grid.appendChild(nbCard);

    step.appendChild(grid);
    content.appendChild(step);
  }

  // ── Step 2: 画像生成 ──
  function renderStep2Generate() {
    const step = document.createElement("div");
    step.className = "ai-wizard-step";

    const title = document.createElement("h3");
    title.className = "ai-wizard-step-title";
    title.textContent = "画像を生成";
    step.appendChild(title);

    // 戻るボタン
    const backBtn = document.createElement("button");
    backBtn.className = "panel-btn";
    backBtn.style.cssText = "margin-bottom:12px;font-size:12px";
    backBtn.textContent = "← プロバイダー選択に戻る";
    backBtn.addEventListener("click", () => goToStep(0));
    step.appendChild(backBtn);

    // タブ: A) ゼロから / B) 参考画像
    const tabBar = document.createElement("div");
    tabBar.style.cssText = "display:flex;gap:6px;margin-bottom:12px";
    const tabA = document.createElement("button");
    tabA.className = "panel-btn primary";
    tabA.textContent = "プロンプトから生成";
    const tabB = document.createElement("button");
    tabB.className = "panel-btn";
    tabB.textContent = "参考画像から生成";
    tabBar.appendChild(tabA);
    tabBar.appendChild(tabB);
    step.appendChild(tabBar);

    const tabContent = document.createElement("div");
    step.appendChild(tabContent);

    // 結果表示エリア
    const resultArea = document.createElement("div");
    resultArea.className = "ai-wizard-result-area";
    resultArea.style.display = "none";
    step.appendChild(resultArea);

    function showTabA() {
      tabA.className = "panel-btn primary";
      tabB.className = "panel-btn";
      tabContent.innerHTML = "";
      renderPromptTab(tabContent, resultArea);
    }
    function showTabB() {
      tabA.className = "panel-btn";
      tabB.className = "panel-btn primary";
      tabContent.innerHTML = "";
      renderReferenceTab(tabContent, resultArea);
    }
    tabA.addEventListener("click", showTabA);
    tabB.addEventListener("click", showTabB);
    showTabA();

    content.appendChild(step);
  }

  function renderPromptTab(container, resultArea) {
    const promptArea = document.createElement("textarea");
    promptArea.className = "panel-textarea";
    promptArea.placeholder = "画像の説明を入力してください...（例：明るい雰囲気の美容製品、白背景）";
    promptArea.rows = 4;
    promptArea.value = state.prompt;
    promptArea.addEventListener("input", () => { state.prompt = promptArea.value; });
    container.appendChild(promptArea);

    const genBtn = document.createElement("button");
    genBtn.className = "oneclick-main-btn";
    genBtn.style.marginTop = "10px";
    genBtn.textContent = "画像を生成";
    genBtn.addEventListener("click", async () => {
      if (!promptArea.value.trim()) { window.showToast("プロンプトを入力してください", "warning"); return; }
      genBtn.disabled = true;
      genBtn.textContent = "生成中...";
      try {
        const res = await window.API.generateImage(projectId, blockIndex, {
          prompt: promptArea.value.trim(),
          provider: state.provider,
        });
        if (res.imageUrl) {
          showGeneratedResult(resultArea, res.imageUrl);
        }
      } catch (err) {
        window.showToast(`生成エラー: ${err.message}`, "error");
      } finally {
        genBtn.disabled = false;
        genBtn.textContent = "画像を生成";
      }
    });
    container.appendChild(genBtn);
  }

  function renderReferenceTab(container, resultArea) {
    // ファイル選択
    const uploadRow = document.createElement("div");
    uploadRow.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:10px";
    const fileBtn = document.createElement("button");
    fileBtn.className = "panel-btn";
    fileBtn.textContent = "参考画像を選択";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*,video/*";
    fileInput.style.display = "none";
    const statusText = document.createElement("span");
    statusText.style.cssText = "font-size:12px;color:var(--text-muted)";
    fileBtn.addEventListener("click", () => fileInput.click());
    uploadRow.appendChild(fileBtn);
    uploadRow.appendChild(fileInput);
    uploadRow.appendChild(statusText);
    container.appendChild(uploadRow);

    // 自動プロンプト表示エリア
    const promptLabel = document.createElement("div");
    promptLabel.style.cssText = "font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;display:none";
    promptLabel.textContent = "自動生成プロンプト（編集可能）";
    container.appendChild(promptLabel);

    const autoPromptArea = document.createElement("textarea");
    autoPromptArea.className = "panel-textarea";
    autoPromptArea.rows = 4;
    autoPromptArea.style.display = "none";
    container.appendChild(autoPromptArea);

    const genRefBtn = document.createElement("button");
    genRefBtn.className = "oneclick-main-btn";
    genRefBtn.style.cssText = "margin-top:10px;display:none";
    genRefBtn.textContent = "この内容で画像を生成";
    container.appendChild(genRefBtn);

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      fileBtn.disabled = true;
      fileBtn.textContent = "アップロード中...";
      statusText.textContent = "";

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          // アップロード
          const upRes = await window.API.uploadFree(projectId, { imageData: reader.result, fileName: file.name });
          if (!upRes.ok) throw new Error("Upload failed");
          state.referenceLocalPath = upRes.localPath;
          statusText.textContent = `✓ ${file.name}`;

          // 自動describe
          statusText.textContent = `✓ ${file.name} — プロンプト生成中...`;
          const descRes = await window.API.describeUploaded(projectId, {
            localPath: upRes.localPath,
            provider: state.provider,
          });

          autoPromptArea.value = descRes.description || "";
          state.prompt = autoPromptArea.value;
          promptLabel.style.display = "block";
          autoPromptArea.style.display = "block";
          genRefBtn.style.display = "block";
          statusText.textContent = `✓ ${file.name}`;
        } catch (err) {
          window.showToast(`エラー: ${err.message}`, "error");
          statusText.textContent = "エラー";
        } finally {
          fileBtn.disabled = false;
          fileBtn.textContent = "参考画像を選択";
        }
      };
      reader.readAsDataURL(file);
    });

    autoPromptArea.addEventListener("input", () => { state.prompt = autoPromptArea.value; });

    genRefBtn.addEventListener("click", async () => {
      genRefBtn.disabled = true;
      genRefBtn.textContent = "生成中...";
      try {
        let res;
        if (state.referenceLocalPath) {
          res = await window.API.aiFromReference(projectId, {
            localPath: state.referenceLocalPath,
            provider: state.provider,
            customPrompt: autoPromptArea.value,
            width: originalW,
            height: originalH,
          });
          if (res.ok && res.images?.[0]) {
            showGeneratedResult(resultArea, res.images[0]);
          }
        } else {
          res = await window.API.generateImage(projectId, blockIndex, {
            prompt: autoPromptArea.value,
            provider: state.provider,
          });
          if (res.imageUrl) {
            showGeneratedResult(resultArea, res.imageUrl);
          }
        }
      } catch (err) {
        window.showToast(`生成エラー: ${err.message}`, "error");
      } finally {
        genRefBtn.disabled = false;
        genRefBtn.textContent = "この内容で画像を生成";
      }
    });
  }

  function showGeneratedResult(area, imageUrl) {
    area.style.display = "block";
    area.innerHTML = "";

    const preview = document.createElement("div");
    preview.className = "ai-wizard-preview";
    const img = document.createElement("img");
    img.src = imageUrl;
    img.alt = "生成画像";
    preview.appendChild(img);
    area.appendChild(preview);

    const useBtn = document.createElement("button");
    useBtn.className = "oneclick-main-btn";
    useBtn.textContent = "この画像を使う →";
    useBtn.addEventListener("click", () => {
      state.image1Url = imageUrl;
      goToStep(2);
    });
    area.appendChild(useBtn);
  }

  // ── Step 3: 2枚目生成（任意） ──
  function renderStep3Second() {
    const step = document.createElement("div");
    step.className = "ai-wizard-step";

    const title = document.createElement("h3");
    title.className = "ai-wizard-step-title";
    title.textContent = "2枚目の画像を生成しますか？";
    step.appendChild(title);

    // 1枚目プレビュー
    if (state.image1Url) {
      const preview = document.createElement("div");
      preview.className = "ai-wizard-preview small";
      const img = document.createElement("img");
      img.src = state.image1Url;
      img.alt = "1枚目";
      preview.appendChild(img);
      const label = document.createElement("div");
      label.style.cssText = "text-align:center;font-size:12px;color:var(--text-muted);margin-top:4px";
      label.textContent = "1枚目の画像";
      preview.appendChild(label);
      step.appendChild(preview);
    }

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:10px;margin-top:14px";

    const yesBtn = document.createElement("button");
    yesBtn.className = "oneclick-main-btn";
    yesBtn.style.flex = "1";
    yesBtn.textContent = "はい、PixAIでもう1枚生成";
    yesBtn.addEventListener("click", () => {
      btnRow.style.display = "none";
      renderSecondGenUI(step);
    });
    btnRow.appendChild(yesBtn);

    const skipBtn = document.createElement("button");
    skipBtn.className = "panel-btn";
    skipBtn.style.cssText = "flex:1;padding:12px";
    skipBtn.textContent = "スキップ → 吹き出しへ";
    skipBtn.addEventListener("click", () => {
      state.image2Url = null;
      goToStep(4); // 合成スキップ → 吹き出しへ
    });
    btnRow.appendChild(skipBtn);

    step.appendChild(btnRow);
    content.appendChild(step);
  }

  function renderSecondGenUI(parentStep) {
    const genSection = document.createElement("div");
    genSection.style.cssText = "margin-top:12px";

    const promptLabel = document.createElement("div");
    promptLabel.style.cssText = "font-size:12px;font-weight:600;margin-bottom:4px;color:var(--text-secondary)";
    promptLabel.textContent = "2枚目のプロンプト";
    genSection.appendChild(promptLabel);

    const promptArea = document.createElement("textarea");
    promptArea.className = "panel-textarea";
    promptArea.rows = 3;
    promptArea.placeholder = "2枚目の画像の説明...";
    genSection.appendChild(promptArea);

    const genBtn = document.createElement("button");
    genBtn.className = "oneclick-main-btn";
    genBtn.style.marginTop = "8px";
    genBtn.textContent = "2枚目を生成（PixAI）";

    const resultArea = document.createElement("div");
    resultArea.className = "ai-wizard-result-area";
    resultArea.style.display = "none";

    genBtn.addEventListener("click", async () => {
      if (!promptArea.value.trim()) { window.showToast("プロンプトを入力してください", "warning"); return; }
      genBtn.disabled = true;
      genBtn.textContent = "生成中...";
      try {
        const res = await window.API.generateImage(projectId, blockIndex, {
          prompt: promptArea.value.trim(),
          provider: "pixai",
        });
        if (res.imageUrl) {
          resultArea.style.display = "block";
          resultArea.innerHTML = "";
          const preview = document.createElement("div");
          preview.className = "ai-wizard-preview";
          const img = document.createElement("img");
          img.src = res.imageUrl;
          img.alt = "2枚目";
          preview.appendChild(img);
          resultArea.appendChild(preview);

          const useBtn = document.createElement("button");
          useBtn.className = "oneclick-main-btn";
          useBtn.textContent = "この画像を使う → 合成へ";
          useBtn.addEventListener("click", () => {
            state.image2Url = res.imageUrl;
            goToStep(3); // 合成レイアウト選択
          });
          resultArea.appendChild(useBtn);
        }
      } catch (err) {
        window.showToast(`生成エラー: ${err.message}`, "error");
      } finally {
        genBtn.disabled = false;
        genBtn.textContent = "2枚目を生成（PixAI）";
      }
    });

    genSection.appendChild(genBtn);
    genSection.appendChild(resultArea);
    parentStep.appendChild(genSection);
  }

  // ── Step 4: 合成レイアウト選択 ──
  function renderStep4Compose() {
    // 画像が1枚のみなら吹き出しステップへスキップ
    if (!state.image2Url) {
      goToStep(4);
      return;
    }

    const step = document.createElement("div");
    step.className = "ai-wizard-step";

    const title = document.createElement("h3");
    title.className = "ai-wizard-step-title";
    title.textContent = "レイアウトを選択";
    step.appendChild(title);

    // 2枚のプレビュー
    const previewRow = document.createElement("div");
    previewRow.style.cssText = "display:flex;gap:8px;margin-bottom:12px";
    [state.image1Url, state.image2Url].forEach((url, i) => {
      const box = document.createElement("div");
      box.className = "ai-wizard-preview small";
      box.style.flex = "1";
      const img = document.createElement("img");
      img.src = url;
      img.alt = `画像${i + 1}`;
      box.appendChild(img);
      previewRow.appendChild(box);
    });
    step.appendChild(previewRow);

    // レイアウト選択（2コマ系を優先）
    const twoCell = COMIC_LAYOUTS.filter(l => l.cells === 2);
    const layoutGrid = document.createElement("div");
    layoutGrid.className = "ai-wizard-layout-grid";

    twoCell.forEach(layout => {
      const card = document.createElement("button");
      card.className = "ai-wizard-layout-card" + (state.layout === layout.id ? " selected" : "");
      card.textContent = layout.name;
      card.addEventListener("click", () => {
        state.layout = layout.id;
        layoutGrid.querySelectorAll(".ai-wizard-layout-card").forEach(c => c.classList.remove("selected"));
        card.classList.add("selected");
      });
      layoutGrid.appendChild(card);
    });
    step.appendChild(layoutGrid);

    // 合成ボタン
    const composeBtn = document.createElement("button");
    composeBtn.className = "oneclick-main-btn";
    composeBtn.style.marginTop = "12px";
    composeBtn.textContent = "合成する";

    const composeResult = document.createElement("div");
    composeResult.className = "ai-wizard-result-area";
    composeResult.style.display = "none";

    composeBtn.addEventListener("click", async () => {
      if (!state.layout) { window.showToast("レイアウトを選択してください", "warning"); return; }
      composeBtn.disabled = true;
      composeBtn.textContent = "合成中...";
      try {
        const res = await window.API.composeImages(projectId, {
          image1Path: state.image1Url,
          image2Path: state.image2Url,
          layout: state.layout,
          width: originalW,
          height: originalH,
        });
        if (res.ok && res.imageUrl) {
          state.composedUrl = res.imageUrl;
          composeResult.style.display = "block";
          composeResult.innerHTML = "";
          const preview = document.createElement("div");
          preview.className = "ai-wizard-preview";
          const img = document.createElement("img");
          img.src = res.imageUrl;
          img.alt = "合成結果";
          preview.appendChild(img);
          composeResult.appendChild(preview);

          // iframe にプレビュー
          const previewFrame = document.querySelector("#preview-frame");
          if (previewFrame?.contentWindow) {
            previewFrame.contentWindow.postMessage({
              type: "comicOverlay", blockIndex, imageUrl: res.imageUrl,
            }, "*");
          }

          const nextBtn = document.createElement("button");
          nextBtn.className = "oneclick-main-btn";
          nextBtn.textContent = "吹き出しを追加 →";
          nextBtn.addEventListener("click", () => goToStep(4));
          composeResult.appendChild(nextBtn);
        }
      } catch (err) {
        window.showToast(`合成エラー: ${err.message}`, "error");
      } finally {
        composeBtn.disabled = false;
        composeBtn.textContent = "合成する";
      }
    });

    step.appendChild(composeBtn);
    step.appendChild(composeResult);
    content.appendChild(step);
  }

  // ── Step 5: 吹き出し＆テキスト ──
  function renderStep5Bubbles() {
    const step = document.createElement("div");
    step.className = "ai-wizard-step";

    const title = document.createElement("h3");
    title.className = "ai-wizard-step-title";
    title.textContent = "吹き出しを追加";
    step.appendChild(title);

    const desc = document.createElement("p");
    desc.className = "ai-wizard-step-desc";
    desc.textContent = "吹き出しの種類を選んで追加してください。テキストも入力できます。";
    step.appendChild(desc);

    // 吹き出しタイプ選択
    const typeGrid = document.createElement("div");
    typeGrid.className = "ai-wizard-bubble-grid";

    BUBBLE_TYPES.filter(b => b.id !== "none").forEach(btype => {
      const card = document.createElement("button");
      card.className = "ai-wizard-bubble-card";

      // プレビューアイコン
      const preview = document.createElement("div");
      preview.className = "bubble-type-preview";
      preview.style.cssText = `
        width:40px;height:30px;border-radius:${btype.borderRadius || "8px"};
        background:${btype.bg || "#fff"};
        border:${btype.border || "2px solid #000"};
        ${btype.color ? "color:" + btype.color + ";" : ""}
      `;
      card.appendChild(preview);

      const label = document.createElement("span");
      label.textContent = btype.name;
      card.appendChild(label);

      card.addEventListener("click", () => {
        const newBubble = {
          id: `bubble_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: btype.id,
          x: 10 + state.bubbles.length * 5,
          y: 10 + state.bubbles.length * 5,
          width: 140,
          height: 60,
          text: "",
        };
        state.bubbles.push(newBubble);
        renderBubbleList();
      });
      typeGrid.appendChild(card);
    });
    step.appendChild(typeGrid);

    // 追加済み吹き出しリスト
    const bubbleListContainer = document.createElement("div");
    bubbleListContainer.className = "ai-wizard-bubble-list";
    step.appendChild(bubbleListContainer);

    function renderBubbleList() {
      bubbleListContainer.innerHTML = "";
      if (state.bubbles.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "color:var(--text-muted);font-size:12px;padding:8px 0";
        empty.textContent = "まだ吹き出しがありません。上から追加してください。";
        bubbleListContainer.appendChild(empty);
        return;
      }

      state.bubbles.forEach((bubble, i) => {
        const row = document.createElement("div");
        row.className = "ai-wizard-bubble-item";

        const btype = BUBBLE_TYPES.find(b => b.id === bubble.type) || {};
        const label = document.createElement("span");
        label.className = "bubble-item-label";
        label.textContent = `${i + 1}. ${btype.name || bubble.type}`;
        row.appendChild(label);

        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.className = "bubble-item-text";
        textInput.placeholder = "テキストを入力...";
        textInput.value = bubble.text;
        textInput.addEventListener("input", () => { bubble.text = textInput.value; });
        row.appendChild(textInput);

        const delBtn = document.createElement("button");
        delBtn.className = "panel-btn";
        delBtn.style.cssText = "padding:4px 8px;font-size:11px;color:var(--danger)";
        delBtn.textContent = "×";
        delBtn.addEventListener("click", () => {
          state.bubbles.splice(i, 1);
          renderBubbleList();
        });
        row.appendChild(delBtn);

        bubbleListContainer.appendChild(row);
      });
    }

    renderBubbleList();

    // 次へボタン
    const nextBtn = document.createElement("button");
    nextBtn.className = "oneclick-main-btn";
    nextBtn.style.marginTop = "14px";
    nextBtn.textContent = state.bubbles.length > 0 ? "配置画面へ →" : "吹き出しなしで完了 →";
    nextBtn.addEventListener("click", () => {
      if (state.bubbles.length > 0) {
        goToStep(5);
      } else {
        // 吹き出しなし — 直接完了
        applyFinal();
      }
    });
    step.appendChild(nextBtn);

    // スキップ（画像だけ適用）
    const skipBtn = document.createElement("button");
    skipBtn.className = "panel-btn";
    skipBtn.style.cssText = "margin-top:8px;width:100%;text-align:center";
    skipBtn.textContent = "吹き出しなしで画像のみ適用";
    skipBtn.addEventListener("click", () => applyFinal());
    step.appendChild(skipBtn);

    content.appendChild(step);
  }

  // ── Step 6: 配置（ドラッグ＆ドロップ） ──
  function renderStep6Place() {
    const step = document.createElement("div");
    step.className = "ai-wizard-step";

    const title = document.createElement("h3");
    title.className = "ai-wizard-step-title";
    title.textContent = "吹き出しを配置";
    step.appendChild(title);

    const desc = document.createElement("p");
    desc.className = "ai-wizard-step-desc";
    desc.textContent = "吹き出しをドラッグして配置してください。角をドラッグでリサイズ。";
    step.appendChild(desc);

    // Canvas
    const canvas = document.createElement("div");
    canvas.className = "bubble-canvas";

    const bgImg = document.createElement("img");
    bgImg.src = state.composedUrl || state.image1Url;
    bgImg.alt = "背景画像";
    bgImg.draggable = false;
    canvas.appendChild(bgImg);

    // 吹き出し要素を配置
    state.bubbles.forEach((bubble, i) => {
      const el = createBubbleElement(bubble, canvas);
      canvas.appendChild(el);
    });

    step.appendChild(canvas);

    // 完了ボタン
    const applyBtn = document.createElement("button");
    applyBtn.className = "oneclick-main-btn";
    applyBtn.style.marginTop = "12px";
    applyBtn.textContent = "完了・適用";
    applyBtn.addEventListener("click", () => applyFinal());
    step.appendChild(applyBtn);

    content.appendChild(step);

    // iframe リアルタイムプレビュー
    sendBubblePreview();
  }

  function createBubbleElement(bubble, canvas) {
    const el = document.createElement("div");
    el.className = "bubble-draggable";
    el.dataset.bubbleId = bubble.id;

    const btype = BUBBLE_TYPES.find(b => b.id === bubble.type) || {};

    el.style.cssText = `
      left:${bubble.x}px;top:${bubble.y}px;
      width:${bubble.width}px;height:${bubble.height}px;
      border-radius:${btype.borderRadius || "8px"};
      background:${btype.bg || "#fff"};
      border:${btype.border || "2px solid #000"};
      ${btype.color ? "color:" + btype.color + ";" : "color:#000;"}
      display:flex;align-items:center;justify-content:center;
      text-align:center;font-size:13px;font-weight:bold;
      padding:4px;box-sizing:border-box;word-break:break-all;
      line-height:1.3;
    `;
    el.textContent = bubble.text || "";

    // ドラッグ処理
    let isDragging = false, startX, startY, origX, origY;

    el.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("bubble-resize-handle")) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origX = bubble.x;
      origY = bubble.y;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      bubble.x = Math.max(0, origX + dx);
      bubble.y = Math.max(0, origY + dy);
      el.style.left = bubble.x + "px";
      el.style.top = bubble.y + "px";
      sendBubblePreview();
    });

    document.addEventListener("mouseup", () => { isDragging = false; });

    // リサイズハンドル
    const handle = document.createElement("div");
    handle.className = "bubble-resize-handle";
    el.appendChild(handle);

    let isResizing = false, rStartX, rStartY, rOrigW, rOrigH;
    handle.addEventListener("mousedown", (e) => {
      isResizing = true;
      rStartX = e.clientX;
      rStartY = e.clientY;
      rOrigW = bubble.width;
      rOrigH = bubble.height;
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isResizing) return;
      bubble.width = Math.max(60, rOrigW + (e.clientX - rStartX));
      bubble.height = Math.max(30, rOrigH + (e.clientY - rStartY));
      el.style.width = bubble.width + "px";
      el.style.height = bubble.height + "px";
      sendBubblePreview();
    });

    document.addEventListener("mouseup", () => { isResizing = false; });

    return el;
  }

  function sendBubblePreview() {
    const previewFrame = document.querySelector("#preview-frame");
    if (previewFrame?.contentWindow) {
      previewFrame.contentWindow.postMessage({
        type: "bubbleOverlay",
        blockIndex,
        bubbles: state.bubbles,
        imageUrl: state.composedUrl || state.image1Url,
      }, "*");
    }
  }

  // ── 最終適用 ──
  async function applyFinal() {
    const imageUrl = state.composedUrl || state.image1Url;
    if (!imageUrl) { window.showToast("画像がありません", "warning"); return; }

    try {
      // 画像をブロックに適用
      await window.API.applyImage(projectId, blockIndex, { imageUrl });

      // 吹き出しがある場合、オーバーレイHTMLを生成してブロックHTMLに追加
      if (state.bubbles.length > 0) {
        const overlayHtml = buildBubbleOverlayHtml(state.bubbles, imageUrl);
        const currentBlock = await window.API.getBlock(projectId, blockIndex);
        if (currentBlock) {
          await window.API.updateBlock(projectId, blockIndex, {
            html: overlayHtml,
          });
        }
      }

      window.showToast("画像ウィザードを適用しました", "success");
      window.loadPreview(true);
      if (window.pushHistory) window.pushHistory();
    } catch (err) {
      window.showToast(`適用エラー: ${err.message}`, "error");
    }
  }

  function buildBubbleOverlayHtml(bubbles, imageUrl) {
    const bubbleEls = bubbles.map(b => {
      const btype = BUBBLE_TYPES.find(bt => bt.id === b.type) || {};
      return `<div style="position:absolute;left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px;border-radius:${btype.borderRadius || "8px"};background:${btype.bg || "#fff"};border:${btype.border || "2px solid #000"};${btype.color ? "color:" + btype.color + ";" : "color:#000;"}display:flex;align-items:center;justify-content:center;text-align:center;font-size:13px;font-weight:bold;padding:4px;box-sizing:border-box;word-break:break-all;line-height:1.3;">${escapeHtml(b.text)}</div>`;
    }).join("\n");

    return `<div style="position:relative;display:inline-block;width:100%;">
  <img src="${imageUrl}" style="width:100%;display:block;" alt="" />
  ${bubbleEls}
</div>`;
  }

  function escapeHtml(str) {
    return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // 初期表示
  goToStep(0);
  return container;
}

// ── 画像パネル（既存） ────────────────────────────────────────

function buildImagePanel(projectId, blockIndex, block) {
  const frag = document.createDocumentFragment();
  const asset = block.assets?.[0];
  const originalSrc = asset?.src || asset?.webpSrc || "";

  // 元画像プレビュー
  const previewSection = createSection("元画像");
  if (asset) {
    const box = document.createElement("div");
    box.className = "image-preview-box";
    const img = document.createElement("img");
    img.src = originalSrc;
    img.alt = "元画像";
    img.onerror = () => { img.style.display = "none"; };
    box.appendChild(img);
    if (asset.width && asset.height) {
      const dims = document.createElement("div");
      dims.style.cssText = "font-size:11px; color:var(--text-muted); padding:6px; text-align:center";
      dims.textContent = `${asset.width} x ${asset.height}`;
      box.appendChild(dims);
    }
    previewSection.appendChild(box);
  }
  frag.appendChild(previewSection);

  // ── AIプロバイダー選択（画像） ──
  const imgProviderSection = createSection("AIプロバイダー");
  const imgProviderRow = document.createElement("div");
  imgProviderRow.style.cssText = "display:flex;gap:6px";
  const imgProviders = window._availableProviders || [];

  const imgProviderPixai = document.createElement("button");
  imgProviderPixai.className = "panel-btn";
  imgProviderPixai.textContent = "PixAI";
  if (!imgProviders.includes("pixai")) { imgProviderPixai.style.opacity = "0.5"; imgProviderPixai.title = "PixAI APIキー未設定"; }

  const imgProviderGemini = document.createElement("button");
  imgProviderGemini.className = "panel-btn";
  imgProviderGemini.textContent = "Nano Banana";
  if (!imgProviders.includes("nanobanana")) { imgProviderGemini.style.opacity = "0.5"; imgProviderGemini.title = "Nano Banana APIキー未設定"; }

  // デフォルト: PixAI優先
  let imgSelectedProvider = window._selectedProvider || (imgProviders.includes("pixai") ? "pixai" : "nanobanana");
  function updateImgProviderBtns() {
    imgProviderPixai.className = imgSelectedProvider === "pixai" ? "panel-btn primary" : "panel-btn";
    imgProviderPixai.style.opacity = imgSelectedProvider === "pixai" || imgProviders.includes("pixai") ? "1" : "0.5";
    imgProviderGemini.className = imgSelectedProvider === "nanobanana" ? "panel-btn primary" : "panel-btn";
    imgProviderGemini.style.opacity = imgSelectedProvider === "nanobanana" || imgProviders.includes("nanobanana") ? "1" : "0.5";
  }
  updateImgProviderBtns();

  imgProviderPixai.addEventListener("click", () => {
    if (!imgProviders.includes("pixai")) { window.showToast("PixAI APIキーを設定してください", "info"); return; }
    imgSelectedProvider = "pixai"; window._selectedProvider = "pixai"; updateImgProviderBtns();
  });
  imgProviderGemini.addEventListener("click", () => {
    if (!imgProviders.includes("nanobanana")) { window.showToast("Nano Banana APIキーを設定してください", "info"); return; }
    imgSelectedProvider = "nanobanana"; window._selectedProvider = "nanobanana"; updateImgProviderBtns();
  });

  imgProviderRow.appendChild(imgProviderPixai);
  imgProviderRow.appendChild(imgProviderGemini);
  imgProviderSection.appendChild(imgProviderRow);
  frag.appendChild(imgProviderSection);

  // ── デザイン要件（画像AI共通） ──
  const imgDesignSection = createSection("デザイン要件（AI共通指示）");
  const imgDesignArea = document.createElement("textarea");
  imgDesignArea.className = "panel-textarea";
  imgDesignArea.placeholder = "例：大人女性向け高級感のあるトーン / ポップで明るい雰囲気...";
  imgDesignArea.rows = 2;
  imgDesignArea.value = window._designRequirements || "";
  imgDesignArea.addEventListener("input", () => {
    window._designRequirements = imgDesignArea.value;
  });
  imgDesignSection.appendChild(imgDesignArea);
  const imgDesignHint = document.createElement("div");
  imgDesignHint.style.cssText = "font-size:11px;color:var(--text-muted);margin-top:4px";
  imgDesignHint.textContent = "テキスト編集AIとも共有されます";
  imgDesignSection.appendChild(imgDesignHint);
  frag.appendChild(imgDesignSection);

  // ── 現在テキスト表示 ──
  const textInfoSection = createSection("現在テキスト");
  const textInfoArea = document.createElement("div");
  textInfoArea.style.cssText = "font-size:12px;color:var(--text-secondary);line-height:1.6;padding:8px 10px;background:var(--bg-tertiary);border-radius:6px;max-height:80px;overflow-y:auto;white-space:pre-wrap;word-break:break-all";
  textInfoArea.textContent = block.text || "(テキストなし)";
  textInfoSection.appendChild(textInfoArea);
  frag.appendChild(textInfoSection);

  // ── 現在画像情報 ──
  const imgInfoSection = createSection("現在画像");
  const imgInfoRow = document.createElement("div");
  imgInfoRow.style.cssText = "font-size:11px;color:var(--text-muted);padding:4px 0";
  imgInfoRow.textContent = asset ? `${asset.width || "?"}×${asset.height || "?"} / ${asset.type || "image"} / ${(originalSrc.split("/").pop() || "").slice(0, 30)}` : "画像情報なし";
  imgInfoSection.appendChild(imgInfoRow);
  frag.appendChild(imgInfoSection);

  // ── 画像生成モード選択 ──
  const genModeSection = createSection("生成モード");
  const genModeRow = document.createElement("div");
  genModeRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
  let selectedGenMode = "similar";
  const genModes = [
    { value: "similar", label: "類似生成", desc: "元画像に近い画像を生成" },
    { value: "tonmana", label: "トンマナ変更", desc: "構図維持、色味・雰囲気だけ変更" },
    { value: "new", label: "新規生成", desc: "ゼロから新しい画像を生成" },
  ];
  const genModeDesc = document.createElement("div");
  genModeDesc.style.cssText = "font-size:11px;color:var(--text-muted);margin-top:4px";
  genModeDesc.textContent = genModes[0].desc;
  genModes.forEach((mode) => {
    const btn = document.createElement("button");
    btn.className = mode.value === "similar" ? "panel-btn primary" : "panel-btn";
    btn.textContent = mode.label;
    btn.addEventListener("click", () => {
      selectedGenMode = mode.value;
      genModeRow.querySelectorAll(".panel-btn").forEach(b => { b.className = "panel-btn"; });
      btn.className = "panel-btn primary";
      genModeDesc.textContent = mode.desc;
    });
    genModeRow.appendChild(btn);
  });
  genModeSection.appendChild(genModeRow);
  genModeSection.appendChild(genModeDesc);
  frag.appendChild(genModeSection);

  // ── ワンクリックAI画像生成 ──
  const oneClickSection = document.createElement("div");
  oneClickSection.className = "panel-section oneclick-section";

  const oneClickTitle = document.createElement("div");
  oneClickTitle.className = "panel-section-title";
  oneClickTitle.textContent = "AI画像生成";
  oneClickSection.appendChild(oneClickTitle);

  // オプション行: ニュアンス
  const nuanceRow = document.createElement("div");
  nuanceRow.className = "oneclick-option-row";
  nuanceRow.innerHTML = '<span class="oneclick-option-label">ニュアンス</span>';
  const nuanceGroup = document.createElement("div");
  nuanceGroup.className = "oneclick-radio-group";
  [
    { value: "same", label: "ほぼ同じ" },
    { value: "slight", label: "少し変化" },
    { value: "big", label: "大きく変化" },
  ].forEach((opt, i) => {
    const radio = document.createElement("label");
    radio.className = "oneclick-radio" + (i === 0 ? " active" : "");
    radio.innerHTML = `<input type="radio" name="nuance-${blockIndex}" value="${opt.value}" ${i === 0 ? "checked" : ""}><span>${opt.label}</span>`;
    radio.querySelector("input").addEventListener("change", () => {
      nuanceGroup.querySelectorAll(".oneclick-radio").forEach(r => r.classList.remove("active"));
      radio.classList.add("active");
    });
    nuanceGroup.appendChild(radio);
  });
  nuanceRow.appendChild(nuanceGroup);
  oneClickSection.appendChild(nuanceRow);

  // オプション行: スタイル
  const styleRow = document.createElement("div");
  styleRow.className = "oneclick-option-row";
  styleRow.innerHTML = '<span class="oneclick-option-label">スタイル</span>';
  const styleGroup = document.createElement("div");
  styleGroup.className = "oneclick-radio-group";
  [
    { value: "photo", label: "写真風" },
    { value: "manga", label: "漫画風" },
    { value: "illustration", label: "イラスト" },
    { value: "flat", label: "フラット" },
  ].forEach((opt, i) => {
    const radio = document.createElement("label");
    radio.className = "oneclick-radio" + (i === 0 ? " active" : "");
    radio.innerHTML = `<input type="radio" name="style-${blockIndex}" value="${opt.value}" ${i === 0 ? "checked" : ""}><span>${opt.label}</span>`;
    radio.querySelector("input").addEventListener("change", () => {
      styleGroup.querySelectorAll(".oneclick-radio").forEach(r => r.classList.remove("active"));
      radio.classList.add("active");
    });
    styleGroup.appendChild(radio);
  });
  styleRow.appendChild(styleGroup);
  oneClickSection.appendChild(styleRow);

  // カスタムプロンプト入力
  const promptRow = document.createElement("div");
  promptRow.style.cssText = "margin-top:8px";
  const promptLabel = document.createElement("div");
  promptLabel.style.cssText = "font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.3px;margin-bottom:4px";
  promptLabel.textContent = "追加指示（任意）";
  const promptInput = document.createElement("textarea");
  promptInput.className = "panel-textarea";
  promptInput.placeholder = "例：背景を青空に変えて / もっと明るく / 人物を笑顔に...";
  promptInput.rows = 2;
  promptInput.style.cssText = "min-height:auto";
  promptRow.appendChild(promptLabel);
  promptRow.appendChild(promptInput);
  oneClickSection.appendChild(promptRow);

  // 参考画像アップロード（ローカルから）
  const refUploadRow = document.createElement("div");
  refUploadRow.style.cssText = "margin-top:8px";
  const refUploadLabel = document.createElement("div");
  refUploadLabel.style.cssText = "font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.3px;margin-bottom:4px";
  refUploadLabel.textContent = "参考画像（ローカルから・任意）";
  refUploadRow.appendChild(refUploadLabel);
  const refBtnRow = document.createElement("div");
  refBtnRow.style.cssText = "display:flex;gap:8px;align-items:center";
  const refSelectBtn = document.createElement("button");
  refSelectBtn.className = "panel-btn";
  refSelectBtn.style.cssText = "font-size:11px;padding:5px 10px";
  refSelectBtn.textContent = "📁 参考画像を選択";
  const refFileInput = document.createElement("input");
  refFileInput.type = "file";
  refFileInput.accept = "image/*,video/*";
  refFileInput.style.display = "none";
  const refStatusText = document.createElement("span");
  refStatusText.style.cssText = "font-size:11px;color:var(--text-muted)";
  let imgPanelRefPath = null;
  refSelectBtn.addEventListener("click", () => refFileInput.click());
  refFileInput.addEventListener("change", async () => {
    const file = refFileInput.files?.[0];
    if (!file) return;
    refSelectBtn.disabled = true;
    refSelectBtn.textContent = "アップロード中...";
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await window.API.uploadFree(projectId, { imageData: reader.result, fileName: file.name });
        if (res.ok) {
          imgPanelRefPath = res.localPath;
          refStatusText.textContent = `✓ ${file.name}`;
          window.showToast("参考画像をアップロードしました", "success");
        }
      } catch (err) {
        window.showToast(`アップロードエラー: ${err.message}`, "error");
      } finally {
        refSelectBtn.disabled = false;
        refSelectBtn.textContent = "📁 参考画像を選択";
      }
    };
    reader.readAsDataURL(file);
  });
  refBtnRow.appendChild(refSelectBtn);
  refBtnRow.appendChild(refFileInput);
  refBtnRow.appendChild(refStatusText);
  refUploadRow.appendChild(refBtnRow);
  oneClickSection.appendChild(refUploadRow);

  // メインボタン
  const mainBtn = document.createElement("button");
  mainBtn.className = "oneclick-main-btn";
  const mainBtnLabels = { similar: "AIで類似画像を生成", tonmana: "トンマナを変更して生成", new: "新規画像を生成" };
  mainBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2v14M2 9h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> ' + mainBtnLabels.similar;

  // 生成モード変更時にボタンラベルを更新
  genModeRow.addEventListener("click", () => {
    setTimeout(() => {
      mainBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2v14M2 9h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> ' + (mainBtnLabels[selectedGenMode] || mainBtnLabels.similar);
    }, 0);
  });

  // 生成結果エリア
  const resultGrid = document.createElement("div");
  resultGrid.className = "oneclick-result-grid";

  mainBtn.addEventListener("click", async () => {
    const nuance = oneClickSection.querySelector(`input[name="nuance-${blockIndex}"]:checked`)?.value || "same";
    const style = oneClickSection.querySelector(`input[name="style-${blockIndex}"]:checked`)?.value || "photo";

    mainBtn.disabled = true;
    mainBtn.innerHTML = '<span class="spinner"></span> 2パターン生成中...（約30秒）';
    resultGrid.innerHTML = "";

    try {
      const customPrompt = promptInput.value.trim();
      let result;
      const aiProvider = window._selectedProvider || "pixai";
      if (imgPanelRefPath) {
        result = await window.API.aiFromReference(projectId, {
          localPath: imgPanelRefPath,
          style,
          genMode: selectedGenMode,
          customPrompt,
          designRequirements: window._designRequirements || "",
          provider: aiProvider,
        });
      } else {
        result = await window.API.oneClickImage(projectId, blockIndex, { nuance, style, designRequirements: window._designRequirements || "", customPrompt, genMode: selectedGenMode, provider: aiProvider });
      }
      if (result.ok && result.images) {
        window.showToast(`${result.images.length}パターン生成しました`, "success");
        resultGrid.innerHTML = "";

        result.images.forEach((imgUrl, i) => {
          const card = document.createElement("div");
          card.className = "oneclick-variant-card";

          const varImg = document.createElement("img");
          varImg.src = imgUrl;
          varImg.alt = `パターン ${i + 1}`;
          card.appendChild(varImg);

          const applyBtn = document.createElement("button");
          applyBtn.className = "oneclick-apply-btn";
          applyBtn.textContent = "これを使う";
          applyBtn.addEventListener("click", async () => {
            applyBtn.disabled = true;
            applyBtn.innerHTML = '<span class="spinner"></span>';
            try {
              await window.API.applyImage(projectId, blockIndex, { imageUrl: imgUrl });
              window.loadPreview(true);
              window.pushHistory?.("image_apply", `ブロック ${blockIndex} AI画像適用`);
              // PixAI の場合のみ確認ダイアログを表示
              const provider = window._selectedProvider || "pixai";
              if (provider === "pixai") {
                showPixAIConfirmation(resultGrid, projectId, blockIndex, imgUrl, {
                  nuance: nuanceGroup?.querySelector("input:checked")?.value || "same",
                  style: styleGroup?.querySelector("input:checked")?.value || "photo",
                  promptInput,
                });
                return;
              }
              window.showToast("画像を適用しました", "success");
            } catch (err) {
              window.showToast(`エラー: ${err.message}`, "error");
            } finally {
              applyBtn.disabled = false;
              applyBtn.textContent = "これを使う";
            }
          });
          card.appendChild(applyBtn);
          resultGrid.appendChild(card);
        });
      }
    } catch (err) {
      window.showToast(`エラー: ${err.message}`, "error");
    } finally {
      mainBtn.disabled = false;
      mainBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2v14M2 9h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> ' + (mainBtnLabels[selectedGenMode] || mainBtnLabels.similar);
    }
  });

  oneClickSection.appendChild(mainBtn);
  oneClickSection.appendChild(resultGrid);
  frag.appendChild(oneClickSection);

  // ── 手持ち画像アップロード ──
  const uploadSection = createSection("手持ち画像で差し替え");
  const uploadZone = document.createElement("div");
  uploadZone.className = "upload-drop-zone";
  uploadZone.innerHTML = '<div class="upload-drop-icon">📁</div><div class="upload-drop-text">画像をドラッグ＆ドロップ<br>またはクリックして選択</div>';
  const uploadInput = document.createElement("input");
  uploadInput.type = "file";
  uploadInput.accept = "image/*,video/*";
  uploadInput.style.display = "none";
  uploadZone.appendChild(uploadInput);
  uploadZone.addEventListener("click", () => uploadInput.click());
  uploadZone.addEventListener("dragover", (e) => { e.preventDefault(); uploadZone.classList.add("dragover"); });
  uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));
  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith("image/")) {
      handleUploadFile(file);
    }
  });

  const uploadPreview = document.createElement("div");
  uploadPreview.className = "upload-preview-area";

  function handleUploadFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      uploadPreview.innerHTML = "";

      const card = document.createElement("div");
      card.className = "oneclick-variant-card";
      const img = document.createElement("img");
      img.src = dataUrl;
      card.appendChild(img);
      const label = document.createElement("div");
      label.style.cssText = "font-size:11px; color:var(--text-muted); text-align:center; padding:4px";
      label.textContent = file.name;
      card.appendChild(label);

      const applyBtn = document.createElement("button");
      applyBtn.className = "oneclick-apply-btn";
      applyBtn.textContent = "この画像を適用";
      applyBtn.addEventListener("click", async () => {
        applyBtn.disabled = true;
        applyBtn.innerHTML = '<span class="spinner"></span> アップロード中...';
        try {
          const uploadResult = await window.API.uploadImage(projectId, blockIndex, {
            imageData: dataUrl,
            fileName: file.name,
          });
          if (uploadResult.ok) {
            await window.API.applyImage(projectId, blockIndex, { imageUrl: uploadResult.imageUrl });
            window.showToast("画像を適用しました", "success");
            window.loadPreview(true);
            window.pushHistory?.("image_upload", `ブロック ${blockIndex} 画像アップロード`);
          }
        } catch (err) {
          window.showToast(`エラー: ${err.message}`, "error");
        } finally {
          applyBtn.disabled = false;
          applyBtn.textContent = "この画像を適用";
        }
      });
      card.appendChild(applyBtn);
      uploadPreview.appendChild(card);
    };
    reader.readAsDataURL(file);
  }

  uploadInput.addEventListener("change", () => {
    const file = uploadInput.files?.[0];
    if (file) handleUploadFile(file);
  });

  uploadSection.appendChild(uploadZone);
  uploadSection.appendChild(uploadPreview);
  frag.appendChild(uploadSection);

  // ── 詳細設定（折りたたみ） ──
  const advancedToggle = document.createElement("button");
  advancedToggle.className = "oneclick-advanced-toggle";
  advancedToggle.textContent = "詳細設定（プロンプト指定で生成）";
  advancedToggle.addEventListener("click", () => {
    advancedContent.classList.toggle("open");
    advancedToggle.classList.toggle("open");
  });
  frag.appendChild(advancedToggle);

  const advancedContent = document.createElement("div");
  advancedContent.className = "oneclick-advanced-content";

  // AI画像説明
  const descSection = createSection("AI画像説明");
  const descArea = document.createElement("textarea");
  descArea.className = "panel-textarea";
  descArea.placeholder = "「説明を取得」ボタンで元画像をAI分析...";
  descArea.rows = 3;
  descSection.appendChild(descArea);

  const descBtnRow = document.createElement("div");
  descBtnRow.className = "panel-btn-row";
  const descBtn = document.createElement("button");
  descBtn.className = "panel-btn";
  descBtn.textContent = "説明を取得";
  descBtn.addEventListener("click", async () => {
    descBtn.disabled = true;
    descBtn.innerHTML = '<span class="spinner"></span> 分析中...';
    try {
      const result = await window.API.describeImage(projectId, blockIndex, { provider: window._selectedProvider || "pixai" });
      descArea.value = result.description;
    } catch (err) {
      window.showToast(`エラー: ${err.message}`, "error");
    } finally {
      descBtn.disabled = false;
      descBtn.textContent = "説明を取得";
    }
  });
  descBtnRow.appendChild(descBtn);
  descSection.appendChild(descBtnRow);
  advancedContent.appendChild(descSection);

  // 画像生成プロンプト
  const promptSection = createSection("画像生成プロンプト");
  const promptArea = document.createElement("textarea");
  promptArea.className = "panel-textarea";
  promptArea.placeholder = "生成したい画像の指示を入力...";
  promptArea.rows = 4;
  promptSection.appendChild(promptArea);

  const genBtnRow = document.createElement("div");
  genBtnRow.className = "panel-btn-row";
  const genBtn = document.createElement("button");
  genBtn.className = "panel-btn primary";
  genBtn.textContent = "画像を生成";

  const genContainer = document.createElement("div");
  genContainer.style.marginTop = "12px";

  genBtn.addEventListener("click", async () => {
    const prompt = promptArea.value.trim();
    const desc = descArea.value.trim();
    if (!prompt && !desc) {
      window.showToast("プロンプトを入力するか、先に画像説明を取得してください", "error");
      return;
    }
    genBtn.disabled = true;
    genBtn.innerHTML = '<span class="spinner"></span> 生成中...';
    try {
      const result = await window.API.generateImage(projectId, blockIndex, {
        prompt: prompt || undefined,
        description: desc || undefined,
        provider: window._selectedProvider || "pixai",
      });
      if (result.ok) {
        window.showToast("画像を生成しました", "success");
        genContainer.innerHTML = "";
        const compare = document.createElement("div");
        compare.className = "image-compare";

        const beforeDiv = document.createElement("div");
        beforeDiv.innerHTML = '<div class="image-compare-label">変更前</div>';
        const beforeImg = document.createElement("img");
        beforeImg.src = originalSrc;
        beforeImg.style.cssText = "width:100%; border-radius:4px";
        beforeDiv.appendChild(beforeImg);

        const afterDiv = document.createElement("div");
        afterDiv.innerHTML = '<div class="image-compare-label">変更後</div>';
        const afterImg = document.createElement("img");
        afterImg.src = result.imageUrl;
        afterImg.style.cssText = "width:100%; border-radius:4px";
        afterDiv.appendChild(afterImg);

        compare.appendChild(beforeDiv);
        compare.appendChild(afterDiv);
        genContainer.appendChild(compare);
      }
    } catch (err) {
      window.showToast(`エラー: ${err.message}`, "error");
    } finally {
      genBtn.disabled = false;
      genBtn.textContent = "画像を生成";
    }
  });

  genBtnRow.appendChild(genBtn);
  promptSection.appendChild(genBtnRow);
  promptSection.appendChild(genContainer);
  advancedContent.appendChild(promptSection);

  frag.appendChild(advancedContent);

  // 改善4: 類似画像検索
  const searchSection = createSection("類似画像検索");
  searchSection.appendChild(buildImageSearchSection(projectId, blockIndex));
  frag.appendChild(searchSection);

  // HTMLソース
  const htmlSection = createSection("HTMLソース");
  const codeArea = document.createElement("textarea");
  codeArea.className = "panel-code";
  codeArea.value = block.html || "";
  codeArea.rows = 6;
  htmlSection.appendChild(codeArea);
  frag.appendChild(htmlSection);

  frag.appendChild(buildSaveRow(projectId, blockIndex, () => ({ html: codeArea.value })));

  return frag;
}

// ── 画像クイック編集パネル（手動モード — ブラッシュアップ版） ──
function buildImageQuickPanel(projectId, blockIndex, block) {
  const frag = document.createDocumentFragment();
  const asset = block.assets?.[0];
  const originalSrc = asset?.src || asset?.webpSrc || "";
  const blockHtml = block.html || "";
  const parsedDoc = new DOMParser().parseFromString(blockHtml, "text/html");
  const allImgs = Array.from(parsedDoc.querySelectorAll("img, source[data-srcset]")).filter(
    el => (el.getAttribute("src") || el.getAttribute("data-src") || el.getAttribute("data-srcset")) && el.tagName !== "PICTURE"
  );
  const firstImg = parsedDoc.querySelector("img");
  let selectedImgIndex = 0;

  // ============================================================
  // Section 1: 画像要素（折りたたみ・大プレビュー・スマートラベル）
  // ============================================================
  const imgSec = createCollapsibleSection("📷", "画像要素", allImgs.length, true);

  // 選択中画像の大きいプレビュー
  const selectedPreview = document.createElement("div");
  selectedPreview.className = "bp-img-selected-preview";
  const selectedImg = document.createElement("img");
  const firstSrc = allImgs[0] ? (allImgs[0].getAttribute("src") || allImgs[0].getAttribute("data-src") || allImgs[0].getAttribute("data-srcset") || "") : originalSrc;
  selectedImg.src = firstSrc || originalSrc;
  selectedImg.onerror = () => { selectedImg.style.display = "none"; };
  selectedPreview.appendChild(selectedImg);

  // アクションバー（AI生成 & 差し替え）
  const actionBar = document.createElement("div");
  actionBar.className = "bp-img-action-bar";
  const aiGenBtn = document.createElement("button");
  aiGenBtn.className = "bp-action-btn bp-action-ai";
  aiGenBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg> AI で類似画像生成';
  const replaceBtn = document.createElement("button");
  replaceBtn.className = "bp-action-btn bp-action-replace";
  replaceBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 10V2m-3 3l3-3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 10v3h12v-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> 画像を差し替え';
  actionBar.appendChild(aiGenBtn);
  actionBar.appendChild(replaceBtn);
  selectedPreview.appendChild(actionBar);
  imgSec.body.appendChild(selectedPreview);

  // サムネイル一覧（120x80px拡大、スマートラベル）
  if (allImgs.length > 0) {
    const thumbGrid = document.createElement("div");
    thumbGrid.className = "bp-thumb-grid";
    allImgs.forEach((el, i) => {
      const src = el.getAttribute("src") || el.getAttribute("data-src") || el.getAttribute("data-srcset") || "";
      const card = document.createElement("div");
      card.className = "bp-thumb-card" + (i === 0 ? " bp-thumb-selected" : "");
      const thumb = document.createElement("img");
      thumb.src = src;
      thumb.onerror = () => { thumb.style.display = "none"; };
      card.appendChild(thumb);
      const label = document.createElement("div");
      label.className = "bp-thumb-label";
      label.textContent = getImageElementLabel(el, i);
      card.appendChild(label);
      // サイズ情報
      const sizeInfo = document.createElement("div");
      sizeInfo.className = "bp-thumb-size";
      const w = el.getAttribute("width") || asset?.width || "";
      const h = el.getAttribute("height") || asset?.height || "";
      sizeInfo.textContent = w && h ? `${w}×${h}` : "";
      card.appendChild(sizeInfo);

      card.addEventListener("click", () => {
        selectedImgIndex = i;
        thumbGrid.querySelectorAll(".bp-thumb-card").forEach(c => c.classList.remove("bp-thumb-selected"));
        card.classList.add("bp-thumb-selected");
        selectedImg.src = src;
        selectedImg.style.display = "";
        // プレビューのブロック内でこの要素をハイライト
        const iframe = document.getElementById("preview-iframe");
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage({ type: "highlightBlock", blockIndex }, "*");
        }
      });
      thumbGrid.appendChild(card);
    });
    imgSec.body.appendChild(thumbGrid);
  }

  // AI生成 展開パネル（クリックで開閉）
  const aiPanel = document.createElement("div");
  aiPanel.className = "bp-ai-gen-panel";
  aiPanel.style.display = "none";

  const aiPanelContent = document.createElement("div");
  aiPanelContent.style.cssText = "padding:10px 0";
  // ニュアンス
  const nuanceLabel = document.createElement("div");
  nuanceLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin-bottom:4px";
  nuanceLabel.textContent = "ニュアンス:";
  aiPanelContent.appendChild(nuanceLabel);
  const nuanceRow = document.createElement("div");
  nuanceRow.style.cssText = "display:flex;gap:4px;margin-bottom:8px";
  let aiNuance = "same";
  [{ v: "same", l: "ほぼ同じ" }, { v: "slight", l: "少し変える" }, { v: "big", l: "大きく変える" }].forEach((o, i) => {
    const btn = document.createElement("button");
    btn.className = "anim-chip" + (i === 0 ? " active" : "");
    btn.textContent = o.l;
    btn.addEventListener("click", () => {
      aiNuance = o.v;
      nuanceRow.querySelectorAll(".anim-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
    nuanceRow.appendChild(btn);
  });
  aiPanelContent.appendChild(nuanceRow);
  // スタイル
  const styleLabel = document.createElement("div");
  styleLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin-bottom:4px";
  styleLabel.textContent = "スタイル:";
  aiPanelContent.appendChild(styleLabel);
  const styleRow = document.createElement("div");
  styleRow.style.cssText = "display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap";
  let aiStyle = "photo";
  [{ v: "photo", l: "写真風" }, { v: "manga", l: "漫画風" }, { v: "illustration", l: "イラスト" }, { v: "flat", l: "フラット" }].forEach((o, i) => {
    const btn = document.createElement("button");
    btn.className = "anim-chip" + (i === 0 ? " active" : "");
    btn.textContent = o.l;
    btn.addEventListener("click", () => {
      aiStyle = o.v;
      styleRow.querySelectorAll(".anim-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
    styleRow.appendChild(btn);
  });
  aiPanelContent.appendChild(styleRow);
  // 生成ボタン
  const goBtn = document.createElement("button");
  goBtn.className = "bp-action-btn bp-action-ai";
  goBtn.style.cssText = "width:100%;justify-content:center;padding:10px";
  goBtn.textContent = "生成する";
  const aiResultGrid = document.createElement("div");
  aiResultGrid.className = "oneclick-result-grid";
  goBtn.addEventListener("click", async () => {
    goBtn.disabled = true;
    goBtn.innerHTML = '<span class="spinner"></span> 生成中...（約30秒）';
    aiResultGrid.innerHTML = "";
    try {
      const result = await window.API.oneClickImage(projectId, blockIndex, {
        nuance: aiNuance, style: aiStyle,
        designRequirements: window._designRequirements || "",
        genMode: "similar", provider: window._selectedProvider || "pixai",
      });
      if (result.ok && result.images) {
        window.showToast(`${result.images.length}パターン生成しました`, "success");
        result.images.forEach((imgUrl, idx) => {
          const card = document.createElement("div");
          card.className = "oneclick-variant-card";
          const varImg = document.createElement("img");
          varImg.src = imgUrl;
          varImg.alt = `パターン ${idx + 1}`;
          card.appendChild(varImg);
          const applyBtn = document.createElement("button");
          applyBtn.className = "oneclick-apply-btn";
          applyBtn.textContent = "これを使う";
          applyBtn.addEventListener("click", async () => {
            applyBtn.disabled = true;
            applyBtn.innerHTML = '<span class="spinner"></span>';
            try {
              await window.API.applyImage(projectId, blockIndex, { imageUrl: imgUrl });
              window.loadPreview(true);
              window.pushHistory?.("image_apply", `ブロック ${blockIndex} AI画像適用`);
              // PixAI の場合のみ確認ダイアログを表示
              const provider = window._selectedProvider || "pixai";
              if (provider === "pixai") {
                showPixAIConfirmation(aiResultGrid, projectId, blockIndex, imgUrl, {
                  nuance: aiNuance, style: aiStyle,
                });
                return;
              }
              window.showToast("画像を適用しました", "success");
            } catch (err) { window.showToast(`エラー: ${err.message}`, "error"); }
            finally { applyBtn.disabled = false; applyBtn.textContent = "これを使う"; }
          });
          card.appendChild(applyBtn);
          aiResultGrid.appendChild(card);
        });
      }
    } catch (err) { window.showToast(`エラー: ${err.message}`, "error"); }
    finally { goBtn.disabled = false; goBtn.textContent = "生成する"; }
  });
  aiPanelContent.appendChild(goBtn);
  aiPanelContent.appendChild(aiResultGrid);
  aiPanel.appendChild(aiPanelContent);
  imgSec.body.appendChild(aiPanel);

  // 差し替えパネル
  const replacePanel = document.createElement("div");
  replacePanel.className = "bp-replace-panel";
  replacePanel.style.display = "none";
  const uploadZone = document.createElement("div");
  uploadZone.className = "upload-drop-zone";
  uploadZone.style.cssText = "margin:8px 0;padding:16px";
  uploadZone.innerHTML = '<div class="upload-drop-icon">📁</div><div class="upload-drop-text">ドラッグ＆ドロップ or クリック</div>';
  const uploadInput = document.createElement("input");
  uploadInput.type = "file"; uploadInput.accept = "image/*,video/*"; uploadInput.style.display = "none";
  uploadZone.appendChild(uploadInput);
  uploadZone.addEventListener("click", () => uploadInput.click());
  uploadZone.addEventListener("dragover", (e) => { e.preventDefault(); uploadZone.classList.add("dragover"); });
  uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));
  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault(); uploadZone.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
  });
  const uploadPreview = document.createElement("div");
  uploadPreview.className = "upload-preview-area";
  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      uploadPreview.innerHTML = "";
      const card = document.createElement("div");
      card.className = "oneclick-variant-card";
      const img = document.createElement("img");
      img.src = reader.result;
      card.appendChild(img);
      const applyBtn = document.createElement("button");
      applyBtn.className = "oneclick-apply-btn";
      applyBtn.textContent = "この画像を適用";
      applyBtn.addEventListener("click", async () => {
        applyBtn.disabled = true;
        applyBtn.innerHTML = '<span class="spinner"></span> アップロード中...';
        try {
          const uploadResult = await window.API.uploadImage(projectId, blockIndex, { imageData: reader.result, fileName: file.name });
          if (uploadResult.ok) {
            await window.API.applyImage(projectId, blockIndex, { imageUrl: uploadResult.imageUrl });
            window.showToast("画像を適用しました", "success");
            window.loadPreview(true);
            window.pushHistory?.("image_upload", `ブロック ${blockIndex} 画像アップロード`);
          }
        } catch (err) { window.showToast(`エラー: ${err.message}`, "error"); }
        finally { applyBtn.disabled = false; applyBtn.textContent = "この画像を適用"; }
      });
      card.appendChild(applyBtn);
      uploadPreview.appendChild(card);
    };
    reader.readAsDataURL(file);
  }
  uploadInput.addEventListener("change", () => { const file = uploadInput.files?.[0]; if (file) handleFile(file); });
  replacePanel.appendChild(uploadZone);
  replacePanel.appendChild(uploadPreview);
  imgSec.body.appendChild(replacePanel);

  // ボタン切り替え
  aiGenBtn.addEventListener("click", () => {
    const show = aiPanel.style.display === "none";
    aiPanel.style.display = show ? "" : "none";
    replacePanel.style.display = "none";
  });
  replaceBtn.addEventListener("click", () => {
    const show = replacePanel.style.display === "none";
    replacePanel.style.display = show ? "" : "none";
    aiPanel.style.display = "none";
  });

  // 改善4: 類似画像検索セクション
  imgSec.body.appendChild(buildImageSearchSection(projectId, blockIndex));

  frag.appendChild(imgSec.wrapper);

  // ============================================================
  // Section 2: テキスト要素（HTML + OCR 2段表示）
  // ============================================================
  const textItems = extractTextNodes(blockHtml);
  const textSec = createCollapsibleSection("📝", "テキスト要素", textItems.length, true);

  // HTMLテキスト
  if (textItems.length > 0) {
    const htmlTextLabel = document.createElement("div");
    htmlTextLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin-bottom:4px;font-weight:600";
    htmlTextLabel.textContent = `── HTMLテキスト（${textItems.length}）──`;
    textSec.body.appendChild(htmlTextLabel);
  }
  const textContainer = document.createElement("div");
  textContainer.className = "text-nodes-container";
  textItems.forEach((item) => {
    const row = document.createElement("div");
    row.className = "text-node-row";
    const tagBadge = document.createElement("span");
    tagBadge.className = "text-node-tag";
    tagBadge.textContent = item.parentTag.toLowerCase();
    row.appendChild(tagBadge);
    const input = document.createElement("textarea");
    input.className = "text-node-input";
    input.value = item.currentText;
    input.rows = 1;
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
    input.addEventListener("input", () => {
      item.currentText = input.value;
      input.style.height = "auto";
      input.style.height = input.scrollHeight + "px";
    });
    row.appendChild(input);
    textContainer.appendChild(row);
  });
  if (textItems.length === 0) {
    const noText = document.createElement("div");
    noText.style.cssText = "color:var(--text-muted);font-size:12px;padding:8px";
    noText.textContent = "テキストノードなし";
    textContainer.appendChild(noText);
  }
  textSec.body.appendChild(textContainer);

  // 画像内テキスト（OCR via AI Vision）
  const ocrArea = document.createElement("div");
  ocrArea.className = "bp-ocr-area";
  const ocrLabel = document.createElement("div");
  ocrLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin:10px 0 4px;font-weight:600";
  ocrLabel.textContent = "── 画像内テキスト（AI Vision）──";
  ocrArea.appendChild(ocrLabel);
  const ocrResults = document.createElement("div");
  ocrResults.style.cssText = "font-size:12px;color:var(--text-secondary);padding:6px 8px;background:var(--bg-tertiary);border-radius:6px;min-height:30px";
  ocrResults.textContent = "「OCR検出」ボタンで画像内テキストを抽出";
  ocrArea.appendChild(ocrResults);
  const ocrBtnRow = document.createElement("div");
  ocrBtnRow.style.cssText = "display:flex;gap:6px;margin-top:6px";
  const ocrBtn = document.createElement("button");
  ocrBtn.className = "panel-btn";
  ocrBtn.style.cssText = "font-size:11px;flex:1";
  ocrBtn.textContent = "OCR検出";
  const ocrRetryBtn = document.createElement("button");
  ocrRetryBtn.className = "panel-btn";
  ocrRetryBtn.style.cssText = "font-size:11px;display:none";
  ocrRetryBtn.textContent = "再検出";

  async function runOcr() {
    ocrBtn.disabled = true;
    ocrRetryBtn.style.display = "none";
    ocrBtn.innerHTML = '<span class="spinner"></span> AI Vision で検出中...';
    try {
      // Use extract-elements API (returns text elements via OCR endpoint)
      const resp = await window.API.extractElements(projectId, blockIndex);
      const textElements = (resp.elements || []).filter(el => el.type === "text");
      ocrResults.innerHTML = "";
      if (textElements.length > 0) {
        const badge = document.createElement("div");
        badge.style.cssText = "font-size:11px;color:#22c55e;font-weight:600;margin-bottom:6px";
        badge.textContent = `✅ ${textElements.length}個のテキストが検出されました`;
        ocrResults.appendChild(badge);
        textElements.forEach(el => {
          const line = document.createElement("div");
          line.style.cssText = "padding:4px 0;border-bottom:1px solid var(--border);font-size:12px;display:flex;align-items:flex-start;gap:6px";
          const icon = document.createElement("span");
          icon.textContent = "✏️";
          icon.style.cssText = "flex-shrink:0;font-size:11px";
          const text = document.createElement("span");
          text.textContent = el.content;
          text.style.cssText = "flex:1";
          line.appendChild(icon);
          line.appendChild(text);
          ocrResults.appendChild(line);
        });
        ocrRetryBtn.style.display = "";
      } else {
        ocrResults.textContent = "テキストが検出されませんでした";
        ocrRetryBtn.style.display = "";
      }
    } catch (err) {
      ocrResults.textContent = "OCRエラー: " + err.message;
      ocrRetryBtn.style.display = "";
    } finally {
      ocrBtn.disabled = false;
      ocrBtn.textContent = "OCR検出";
    }
  }

  ocrBtn.addEventListener("click", runOcr);
  ocrRetryBtn.addEventListener("click", () => {
    // Clear cache and retry
    const cacheKey = `extract_${projectId}_${blockIndex}`;
    localStorage.removeItem(cacheKey);
    runOcr();
  });
  ocrBtnRow.appendChild(ocrBtn);
  ocrBtnRow.appendChild(ocrRetryBtn);
  ocrArea.appendChild(ocrBtnRow);
  textSec.body.appendChild(ocrArea);

  frag.appendChild(textSec.wrapper);

  // ============================================================
  // Section 3: アニメーション（ライブプレビュー統合）
  // ============================================================
  const animSec = createCollapsibleSection("🎬", "アニメーション", null, false);

  let selectedAnim = "";
  let selectedScroll = "";
  let selectedHover = "";
  let selectedSpeed = "0.6s";

  function fireAnimPreview() {
    triggerAnimationPreview(blockIndex, { anim: selectedAnim, scroll: selectedScroll, hover: selectedHover, speed: selectedSpeed });
  }

  // CSSアニメーション
  const animLabel = document.createElement("div");
  animLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin-bottom:4px";
  animLabel.textContent = "CSSアニメーション";
  animSec.body.appendChild(animLabel);
  const animRow = document.createElement("div");
  animRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px";
  [
    { value: "", label: "なし" }, { value: "fadeIn", label: "フェードイン" },
    { value: "slideInUp", label: "スライドアップ" }, { value: "slideInLeft", label: "スライド左" },
    { value: "slideInRight", label: "スライド右" }, { value: "bounceIn", label: "バウンス" },
    { value: "pulse", label: "パルス" }, { value: "shake", label: "シェイク" },
    { value: "zoomIn", label: "ズームイン" }, { value: "flipIn", label: "フリップ" },
  ].forEach(a => {
    const btn = document.createElement("button");
    btn.className = a.value === "" ? "anim-chip active" : "anim-chip";
    btn.textContent = a.label;
    btn.addEventListener("click", () => {
      selectedAnim = a.value;
      animRow.querySelectorAll(".anim-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      fireAnimPreview();
    });
    animRow.appendChild(btn);
  });
  animSec.body.appendChild(animRow);

  // スクロール連動
  const scrollLabel = document.createElement("div");
  scrollLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin-bottom:4px";
  scrollLabel.textContent = "スクロール連動（表示時に発動）";
  animSec.body.appendChild(scrollLabel);
  const scrollRow = document.createElement("div");
  scrollRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px";
  [
    { value: "", label: "なし" }, { value: "scrollFadeIn", label: "フェードイン" },
    { value: "scrollSlideUp", label: "スライドアップ" }, { value: "scrollZoom", label: "ズーム" },
    { value: "scrollBlur", label: "ブラー解除" },
  ].forEach(s => {
    const btn = document.createElement("button");
    btn.className = s.value === "" ? "anim-chip active" : "anim-chip";
    btn.textContent = s.label;
    btn.addEventListener("click", () => {
      selectedScroll = s.value;
      scrollRow.querySelectorAll(".anim-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      fireAnimPreview();
    });
    scrollRow.appendChild(btn);
  });
  animSec.body.appendChild(scrollRow);

  // ホバーエフェクト
  const hoverLabel = document.createElement("div");
  hoverLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin-bottom:4px";
  hoverLabel.textContent = "ホバーエフェクト";
  animSec.body.appendChild(hoverLabel);
  const hoverRow = document.createElement("div");
  hoverRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px";
  [
    { value: "", label: "なし" }, { value: "hoverScale", label: "拡大" },
    { value: "hoverBright", label: "明るく" }, { value: "hoverShadow", label: "影追加" },
    { value: "hoverLift", label: "浮かせる" }, { value: "hoverGray", label: "グレー→カラー" },
  ].forEach(h => {
    const btn = document.createElement("button");
    btn.className = h.value === "" ? "anim-chip active" : "anim-chip";
    btn.textContent = h.label;
    btn.addEventListener("click", () => {
      selectedHover = h.value;
      hoverRow.querySelectorAll(".anim-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      fireAnimPreview();
    });
    hoverRow.appendChild(btn);
  });
  animSec.body.appendChild(hoverRow);

  // 速度（セグメント型）
  const speedRow = document.createElement("div");
  speedRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:8px";
  const speedLbl = document.createElement("span");
  speedLbl.style.cssText = "font-size:11px;color:var(--text-muted)";
  speedLbl.textContent = "速度:";
  speedRow.appendChild(speedLbl);
  const speedSelect = document.createElement("select");
  speedSelect.className = "form-input";
  speedSelect.style.cssText = "font-size:11px;padding:4px 6px;width:auto";
  [{ v: "0.3s", l: "速い" }, { v: "0.6s", l: "普通" }, { v: "1s", l: "遅い" }, { v: "1.5s", l: "とても遅い" }].forEach(o => {
    const opt = document.createElement("option");
    opt.value = o.v; opt.textContent = o.l;
    if (o.v === "0.6s") opt.selected = true;
    speedSelect.appendChild(opt);
  });
  speedSelect.addEventListener("change", () => { selectedSpeed = speedSelect.value; fireAnimPreview(); });
  speedRow.appendChild(speedSelect);
  animSec.body.appendChild(speedRow);

  // プレビュー再生ボタン
  const replayBtn = document.createElement("button");
  replayBtn.className = "anim-preview-btn";
  replayBtn.textContent = "▶ プレビュー再生";
  replayBtn.addEventListener("click", fireAnimPreview);
  animSec.body.appendChild(replayBtn);

  frag.appendChild(animSec.wrapper);

  // ============================================================
  // Section 4: 画像プロパティ（ラベル付き）
  // ============================================================
  const propsSec = createCollapsibleSection("📐", "画像プロパティ", null, false);

  // 元サイズ表示
  const origSizeInfo = document.createElement("div");
  origSizeInfo.style.cssText = "font-size:12px;color:var(--text-secondary);margin-bottom:8px";
  origSizeInfo.textContent = `元サイズ: ${asset?.width || "?"} × ${asset?.height || "?"} px`;
  propsSec.body.appendChild(origSizeInfo);

  // 表示幅
  const wRow = document.createElement("div");
  wRow.className = "bp-prop-row";
  wRow.innerHTML = '<label class="bp-prop-label">表示幅</label>';
  const wInput = document.createElement("input");
  wInput.type = "text"; wInput.className = "bp-prop-input";
  wInput.value = asset?.width || firstImg?.getAttribute("width") || "";
  wInput.placeholder = "auto";
  wRow.appendChild(wInput);
  const wUnit = document.createElement("span");
  wUnit.className = "bp-prop-unit"; wUnit.textContent = "px";
  wRow.appendChild(wUnit);
  propsSec.body.appendChild(wRow);

  // 表示高さ
  const hRow = document.createElement("div");
  hRow.className = "bp-prop-row";
  hRow.innerHTML = '<label class="bp-prop-label">表示高さ</label>';
  const hInput = document.createElement("input");
  hInput.type = "text"; hInput.className = "bp-prop-input";
  hInput.value = asset?.height || firstImg?.getAttribute("height") || "";
  hInput.placeholder = "auto";
  hRow.appendChild(hInput);
  const hUnit = document.createElement("span");
  hUnit.className = "bp-prop-unit"; hUnit.textContent = "px";
  hRow.appendChild(hUnit);
  propsSec.body.appendChild(hRow);

  // サイズプリセット
  const presetBtns = document.createElement("div");
  presetBtns.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px";
  [{ l: "580px", w: "580" }, { l: "100%", w: "100%" }, { l: "400px", w: "400" }].forEach(p => {
    const btn = document.createElement("button");
    btn.className = "style-preset-btn";
    btn.textContent = p.l;
    btn.addEventListener("click", () => { wInput.value = p.w; });
    presetBtns.appendChild(btn);
  });
  propsSec.body.appendChild(presetBtns);

  // object-fit
  const fitRow = document.createElement("div");
  fitRow.className = "bp-prop-row";
  fitRow.innerHTML = '<label class="bp-prop-label">object-fit</label>';
  const fitSelect = document.createElement("select");
  fitSelect.className = "bp-prop-input";
  fitSelect.style.width = "auto";
  ["cover", "contain", "fill", "none"].forEach(v => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = v;
    fitSelect.appendChild(opt);
  });
  fitRow.appendChild(fitSelect);
  propsSec.body.appendChild(fitRow);

  // 角丸
  const radiusRow = document.createElement("div");
  radiusRow.className = "bp-prop-row";
  radiusRow.innerHTML = '<label class="bp-prop-label">角丸</label>';
  const radiusInput = document.createElement("input");
  radiusInput.type = "number"; radiusInput.className = "bp-prop-input";
  radiusInput.value = "0"; radiusInput.min = "0"; radiusInput.placeholder = "0";
  radiusRow.appendChild(radiusInput);
  const radiusUnit = document.createElement("span");
  radiusUnit.className = "bp-prop-unit"; radiusUnit.textContent = "px";
  radiusRow.appendChild(radiusUnit);
  propsSec.body.appendChild(radiusRow);

  // alt
  const altRow = document.createElement("div");
  altRow.className = "bp-prop-row";
  altRow.innerHTML = '<label class="bp-prop-label">alt</label>';
  const altInput = document.createElement("input");
  altInput.type = "text"; altInput.className = "bp-prop-input";
  altInput.value = firstImg?.getAttribute("alt") || "";
  altInput.placeholder = "代替テキスト";
  altRow.appendChild(altInput);
  propsSec.body.appendChild(altRow);

  // リンク
  const linkEl = parsedDoc.querySelector("a");
  const linkRow = document.createElement("div");
  linkRow.className = "bp-prop-row";
  linkRow.innerHTML = '<label class="bp-prop-label">リンクURL</label>';
  const hrefInput = document.createElement("input");
  hrefInput.type = "url"; hrefInput.className = "bp-prop-input";
  hrefInput.value = linkEl?.getAttribute("href") || "";
  hrefInput.placeholder = "空欄でリンクなし";
  linkRow.appendChild(hrefInput);
  propsSec.body.appendChild(linkRow);
  const targetRow = document.createElement("div");
  targetRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-top:4px";
  const targetCheck = document.createElement("input");
  targetCheck.type = "checkbox";
  targetCheck.checked = linkEl?.getAttribute("target") === "_blank";
  const targetLbl = document.createElement("span");
  targetLbl.style.cssText = "font-size:11px;color:var(--text-secondary)";
  targetLbl.textContent = "別タブで開く";
  targetRow.appendChild(targetCheck);
  targetRow.appendChild(targetLbl);
  propsSec.body.appendChild(targetRow);

  frag.appendChild(propsSec.wrapper);

  // ============================================================
  // Section 5: HTMLソース（折りたたみ）
  // ============================================================
  const htmlSec = createCollapsibleSection("&lt;/&gt;", "HTMLソース", null, false);
  const codeArea = document.createElement("textarea");
  codeArea.className = "panel-code";
  codeArea.value = blockHtml;
  codeArea.rows = 6;
  htmlSec.body.appendChild(codeArea);
  frag.appendChild(htmlSec.wrapper);

  // ============================================================
  // 保存
  // ============================================================
  frag.appendChild(buildSaveRow(projectId, blockIndex, () => {
    if (codeArea.value !== blockHtml) {
      return { html: codeArea.value };
    }
    let html = applyTextChanges(blockHtml, textItems);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const imgEl = doc.querySelector("img");
    if (imgEl) {
      if (altInput.value) imgEl.setAttribute("alt", altInput.value);
      else imgEl.removeAttribute("alt");
      if (wInput.value) imgEl.style.width = String(wInput.value).includes("%") ? wInput.value : wInput.value + "px";
      if (hInput.value) imgEl.style.height = hInput.value + "px";
      if (radiusInput.value && radiusInput.value !== "0") imgEl.style.borderRadius = radiusInput.value + "px";
      if (fitSelect.value !== "cover") imgEl.style.objectFit = fitSelect.value;
    }
    const existingA = doc.querySelector("a");
    const docImg = doc.querySelector("img");
    if (hrefInput.value.trim()) {
      if (existingA) {
        existingA.setAttribute("href", hrefInput.value.trim());
        if (targetCheck.checked) existingA.setAttribute("target", "_blank");
        else existingA.removeAttribute("target");
      } else if (docImg) {
        const a = doc.createElement("a");
        a.setAttribute("href", hrefInput.value.trim());
        if (targetCheck.checked) a.setAttribute("target", "_blank");
        docImg.parentNode.insertBefore(a, docImg);
        a.appendChild(docImg);
      }
    } else if (existingA && docImg) {
      existingA.parentNode.insertBefore(docImg, existingA);
      existingA.remove();
    }
    // アニメーション適用
    const duration = speedSelect.value;
    const targetEl = doc.body.firstElementChild || doc.body;
    let styleTag = doc.querySelector("style") || null;
    let cssRules = "";
    const animId = `anim-${blockIndex}-${Date.now().toString(36)}`;
    if (selectedAnim || selectedScroll || selectedHover) targetEl.classList.add(animId);
    if (selectedAnim) {
      const kf = { fadeIn:`@keyframes fadeIn{from{opacity:0}to{opacity:1}}`, slideInUp:`@keyframes slideInUp{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}}`, slideInLeft:`@keyframes slideInLeft{from{opacity:0;transform:translateX(-40px)}to{opacity:1;transform:translateX(0)}}`, slideInRight:`@keyframes slideInRight{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:translateX(0)}}`, bounceIn:`@keyframes bounceIn{0%{opacity:0;transform:scale(0.3)}50%{opacity:1;transform:scale(1.05)}70%{transform:scale(0.9)}100%{transform:scale(1)}}`, pulse:`@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}`, shake:`@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}`, zoomIn:`@keyframes zoomIn{from{opacity:0;transform:scale(0.5)}to{opacity:1;transform:scale(1)}}`, flipIn:`@keyframes flipIn{from{opacity:0;transform:rotateY(-90deg)}to{opacity:1;transform:rotateY(0)}}` };
      cssRules += (kf[selectedAnim]||"") + `\n.${animId}{animation:${selectedAnim} ${duration} ease both;}\n`;
    }
    if (selectedScroll) {
      const skf = { scrollFadeIn:`@keyframes scrollFadeIn{from{opacity:0}to{opacity:1}}`, scrollSlideUp:`@keyframes scrollSlideUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}`, scrollZoom:`@keyframes scrollZoom{from{opacity:0;transform:scale(0.8)}to{opacity:1;transform:scale(1)}}`, scrollBlur:`@keyframes scrollBlur{from{opacity:0;filter:blur(10px)}to{opacity:1;filter:blur(0)}}` };
      cssRules += (skf[selectedScroll]||"") + `\n.${animId}.scroll-visible{animation:${selectedScroll} ${duration} ease both;}\n.${animId}{opacity:0;}\n`;
      const script = doc.createElement("script");
      script.textContent = `(function(){var el=document.querySelector('.${animId}');if(el){new IntersectionObserver(function(e){e.forEach(function(entry){if(entry.isIntersecting){el.classList.add('scroll-visible');}}); },{threshold:0.15}).observe(el);}})();`;
      doc.body.appendChild(script);
    }
    if (selectedHover) {
      const hs = { hoverScale:`.${animId}:hover{transform:scale(1.05);transition:transform ${duration} ease;}`, hoverBright:`.${animId}:hover{filter:brightness(1.15);transition:filter ${duration} ease;}`, hoverShadow:`.${animId}:hover{box-shadow:0 8px 25px rgba(0,0,0,0.2);transition:box-shadow ${duration} ease;}`, hoverLift:`.${animId}:hover{transform:translateY(-4px);box-shadow:0 6px 20px rgba(0,0,0,0.15);transition:all ${duration} ease;}`, hoverGray:`.${animId}{filter:grayscale(100%);transition:filter ${duration} ease;}\n.${animId}:hover{filter:grayscale(0%);}` };
      cssRules += (hs[selectedHover]||"") + "\n";
    }
    if (cssRules) {
      if (!styleTag) { styleTag = doc.createElement("style"); doc.body.insertBefore(styleTag, doc.body.firstChild); }
      styleTag.textContent = (styleTag.textContent||"") + "\n" + cssRules;
    }
    return { html: doc.body.innerHTML, text: textItems.map(t => t.currentText).join(" ") };
  }));

  return frag;
}

// ── CTA URL編集（AI編集モード用、ウィザードの下に追加表示） ──

function buildCtaUrlEditor(projectId, blockIndex, block) {
  const section = document.createElement("div");
  section.className = "ai-wizard-step";
  section.style.cssText = "border-top:2px solid var(--border);margin-top:16px;padding-top:16px";

  const title = document.createElement("h3");
  title.className = "ai-wizard-step-title";
  title.textContent = "CTA リンクURL";
  section.appendChild(title);

  const linkBox = document.createElement("div");
  linkBox.className = "link-insert-box";
  linkBox.style.cssText = "display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg-tertiary);border-radius:8px;border:1px solid var(--border)";

  const linkIcon = document.createElement("div");
  linkIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M8.5 11.5a4 4 0 005.66 0l2.82-2.83a4 4 0 00-5.66-5.65l-1.41 1.41" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M11.5 8.5a4 4 0 00-5.66 0L3.02 11.33a4 4 0 005.66 5.65l1.41-1.41" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  linkIcon.style.cssText = "flex-shrink:0;color:var(--text-muted)";

  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.className = "bubble-item-text";
  urlInput.style.cssText = "flex:1;padding:8px 10px;font-size:13px";
  urlInput.value = block.href || "";
  urlInput.placeholder = "https://example.com/your-link";

  linkBox.appendChild(linkIcon);
  linkBox.appendChild(urlInput);
  section.appendChild(linkBox);

  if (block.href) {
    const current = document.createElement("div");
    current.style.cssText = "font-size:11px;color:var(--text-muted);margin-top:6px;word-break:break-all";
    current.textContent = `現在: ${block.href}`;
    section.appendChild(current);
  }

  // リアルタイム保存
  urlInput.addEventListener("input", () => {
    const newUrl = urlInput.value.trim();
    // HTMLのhrefも差し替え
    let html = block.html || "";
    if (block.href && newUrl) {
      html = html.split(block.href).join(newUrl);
    }
    autoSave(projectId, blockIndex, () => ({ html, href: newUrl }));
  });

  return section;
}

// ── CTAパネル（手動編集用、既存） ───────────────────────────────

function buildCtaPanel(projectId, blockIndex, block) {
  const frag = document.createDocumentFragment();

  // リンク挿入ボックス
  const urlSection = document.createElement("div");
  urlSection.className = "panel-section link-insert-section";
  const urlTitle = document.createElement("div");
  urlTitle.className = "panel-section-title";
  urlTitle.textContent = "リンク挿入";
  urlSection.appendChild(urlTitle);

  const linkBox = document.createElement("div");
  linkBox.className = "link-insert-box";

  const linkIcon = document.createElement("div");
  linkIcon.className = "link-insert-icon";
  linkIcon.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M8.5 11.5a4 4 0 005.66 0l2.82-2.83a4 4 0 00-5.66-5.65l-1.41 1.41" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M11.5 8.5a4 4 0 00-5.66 0L3.02 11.33a4 4 0 005.66 5.65l1.41-1.41" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  const linkInputWrap = document.createElement("div");
  linkInputWrap.className = "link-insert-input-wrap";
  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.className = "link-insert-input";
  urlInput.value = block.href || "";
  urlInput.placeholder = "https://example.com/your-link";
  linkInputWrap.appendChild(urlInput);

  if (block.href) {
    const currentLink = document.createElement("div");
    currentLink.className = "link-current";
    currentLink.innerHTML = `<span class="link-current-label">現在のリンク:</span> <a href="${block.href}" target="_blank" rel="noopener">${block.href.length > 50 ? block.href.slice(0, 50) + "..." : block.href}</a>`;
    linkInputWrap.appendChild(currentLink);
  }

  linkBox.appendChild(linkIcon);
  linkBox.appendChild(linkInputWrap);
  urlSection.appendChild(linkBox);

  // クイック設定ヒント
  const hint = document.createElement("div");
  hint.className = "link-insert-hint";
  hint.textContent = "遷移先URLを入力して保存ボタンを押してください";
  urlSection.appendChild(hint);
  frag.appendChild(urlSection);

  // CTA画像プレビュー
  const asset = block.assets?.[0];
  if (asset) {
    const imgSection = createSection("CTA画像");
    const box = document.createElement("div");
    box.className = "image-preview-box";
    const img = document.createElement("img");
    img.src = asset.src || asset.webpSrc || "";
    img.alt = "CTA";
    img.onerror = () => { img.style.display = "none"; };
    box.appendChild(img);
    imgSection.appendChild(box);
    frag.appendChild(imgSection);
  }

  // テキスト内容（CTAにテキストがある場合）
  if (block.text) {
    const textSection = createSection("ボタンテキスト");
    const textarea = document.createElement("textarea");
    textarea.className = "panel-textarea";
    textarea.value = block.text;
    textarea.rows = 2;
    textSection.appendChild(textarea);
    frag.appendChild(textSection);
  }

  // HTMLソース（折りたたみ）
  const htmlToggle = document.createElement("button");
  htmlToggle.className = "oneclick-advanced-toggle";
  htmlToggle.textContent = "HTMLソースを編集";
  const htmlContent = document.createElement("div");
  htmlContent.className = "oneclick-advanced-content";
  htmlToggle.addEventListener("click", () => {
    htmlContent.classList.toggle("open");
    htmlToggle.classList.toggle("open");
  });
  frag.appendChild(htmlToggle);

  const codeArea = document.createElement("textarea");
  codeArea.className = "panel-code";
  codeArea.value = block.html || "";
  codeArea.rows = 6;
  htmlContent.appendChild(codeArea);
  frag.appendChild(htmlContent);

  // CTA URLリアルタイム保存
  urlInput.addEventListener("input", () => {
    autoSave(projectId, blockIndex, () => ({
      html: codeArea.value,
      href: urlInput.value.trim(),
    }));
  });

  // HTMLソース変更時もリアルタイム保存
  codeArea.addEventListener("input", () => {
    autoSave(projectId, blockIndex, () => ({
      html: codeArea.value,
      href: urlInput.value.trim(),
    }));
  });

  // ボタンテキスト変更時もリアルタイム保存（textareaがある場合）
  const textAreas = frag.querySelectorAll(".panel-textarea");
  textAreas.forEach(ta => {
    if (ta !== urlInput) {
      ta.addEventListener("input", () => {
        autoSave(projectId, blockIndex, () => ({
          html: codeArea.value,
          href: urlInput.value.trim(),
        }));
      });
    }
  });

  return frag;
}

// ── VEO3 動画ウィザード ────────────────────────────────────────

function buildVideoWizard(projectId, blockIndex, block) {
  const container = document.createElement("div");
  container.className = "ai-wizard-container";

  // ── 現在の動画プレビュー ──
  if (block.videoSrc) {
    const previewSec = createSection("現在の動画");
    const video = document.createElement("video");
    video.src = block.videoSrc;
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    video.style.cssText = "width:100%;border-radius:8px";
    previewSec.appendChild(video);
    container.appendChild(previewSec);
  }

  // ── アップロード → 自動プロンプト生成 ──
  const uploadSec = createSection("動画アップロード（参考用）");
  const uploadRow = document.createElement("div");
  uploadRow.style.cssText = "display:flex;gap:8px;align-items:center";
  const uploadBtn = document.createElement("button");
  uploadBtn.className = "panel-btn";
  uploadBtn.textContent = "動画ファイルを選択";
  const uploadInput = document.createElement("input");
  uploadInput.type = "file";
  uploadInput.accept = "image/*,video/*";
  uploadInput.style.display = "none";
  const uploadStatus = document.createElement("span");
  uploadStatus.style.cssText = "font-size:12px;color:var(--text-muted)";
  uploadBtn.addEventListener("click", () => uploadInput.click());
  uploadRow.appendChild(uploadBtn);
  uploadRow.appendChild(uploadInput);
  uploadRow.appendChild(uploadStatus);
  uploadSec.appendChild(uploadRow);
  container.appendChild(uploadSec);

  let uploadedLocalPath = null;

  // プロンプト編集エリア
  const promptSec = createSection("プロンプト（説明）");
  const promptArea = document.createElement("textarea");
  promptArea.className = "panel-textarea";
  promptArea.rows = 4;
  promptArea.placeholder = "動画の内容を説明してください...（例: 美容液を手に取る女性、明るい照明）";
  promptSec.appendChild(promptArea);
  container.appendChild(promptSec);

  // アップロード時の自動プロンプト生成
  uploadInput.addEventListener("change", async () => {
    const file = uploadInput.files?.[0];
    if (!file) return;
    uploadBtn.disabled = true;
    uploadBtn.textContent = "アップロード中...";
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const upRes = await window.API.uploadVideo(projectId, blockIndex, {
          videoData: reader.result,
          fileName: file.name,
        });
        if (upRes.ok) {
          uploadedLocalPath = upRes.localPath;
          uploadStatus.textContent = `✓ ${file.name}`;

          // 自動プロンプト生成
          uploadStatus.textContent = `✓ ${file.name} — プロンプト生成中...`;
          const descRes = await window.API.describeVideo(projectId, blockIndex, {
            localPath: upRes.localPath,
          });
          if (descRes.description) {
            promptArea.value = descRes.description;
          }
          uploadStatus.textContent = `✓ ${file.name}`;

          // 手動モードとしてもアップロード動画を即時適用
          applyVideoToBlock(upRes.videoUrl);
        }
      } catch (err) {
        window.showToast(`アップロードエラー: ${err.message}`, "error");
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = "動画ファイルを選択";
      }
    };
    reader.readAsDataURL(file);
  });

  // ── 変化度 ──
  const varSec = createSection("変化度");
  const varRow = document.createElement("div");
  varRow.style.cssText = "display:flex;gap:6px";
  let selectedVariation = "normal";
  const variations = [
    { value: "slight", label: "少し変える" },
    { value: "normal", label: "普通" },
    { value: "big", label: "大幅に変える" },
  ];
  variations.forEach(v => {
    const btn = document.createElement("button");
    btn.className = v.value === "normal" ? "panel-btn primary" : "panel-btn";
    btn.textContent = v.label;
    btn.addEventListener("click", () => {
      selectedVariation = v.value;
      varRow.querySelectorAll(".panel-btn").forEach(b => b.className = "panel-btn");
      btn.className = "panel-btn primary";
    });
    varRow.appendChild(btn);
  });
  varSec.appendChild(varRow);
  container.appendChild(varSec);

  // ── 出力形式 ──
  const formatSec = createSection("出力形式");
  const formatRow = document.createElement("div");
  formatRow.style.cssText = "display:flex;gap:6px";
  let selectedFormat = "mp4";
  [
    { value: "mp4", label: "動画 (MP4)" },
    { value: "gif", label: "GIF" },
  ].forEach(f => {
    const btn = document.createElement("button");
    btn.className = f.value === "mp4" ? "panel-btn primary" : "panel-btn";
    btn.textContent = f.label;
    btn.addEventListener("click", () => {
      selectedFormat = f.value;
      formatRow.querySelectorAll(".panel-btn").forEach(b => b.className = "panel-btn");
      btn.className = "panel-btn primary";
    });
    formatRow.appendChild(btn);
  });
  formatSec.appendChild(formatRow);
  container.appendChild(formatSec);

  // ── 画質 ──
  const qualitySec = createSection("画質");
  const qualityRow = document.createElement("div");
  qualityRow.style.cssText = "display:flex;gap:6px";
  let selectedQuality = "720p";
  [
    { value: "480p", label: "標準 (480p)" },
    { value: "720p", label: "高画質 (720p)" },
  ].forEach(q => {
    const btn = document.createElement("button");
    btn.className = q.value === "720p" ? "panel-btn primary" : "panel-btn";
    btn.textContent = q.label;
    btn.addEventListener("click", () => {
      selectedQuality = q.value;
      qualityRow.querySelectorAll(".panel-btn").forEach(b => b.className = "panel-btn");
      btn.className = "panel-btn primary";
    });
    qualityRow.appendChild(btn);
  });
  qualitySec.appendChild(qualityRow);
  container.appendChild(qualitySec);

  // ── VEO3で作成ボタン ──
  const genBtn = document.createElement("button");
  genBtn.className = "oneclick-main-btn veo3-gen-btn";
  genBtn.innerHTML = '<span class="veo3-icon">&#x1F3AC;</span> VEO3で作成';
  genBtn.style.marginTop = "12px";

  const resultArea = document.createElement("div");
  resultArea.className = "ai-wizard-result-area";
  resultArea.style.display = "none";

  genBtn.addEventListener("click", async () => {
    const prompt = promptArea.value.trim();
    if (!prompt) { window.showToast("プロンプトを入力してください", "warning"); return; }

    // 変化度をプロンプトに反映
    let finalPrompt = prompt;
    if (selectedVariation === "slight") {
      finalPrompt = `この動画をほぼ同じ内容で微細に変更してください: ${prompt}`;
    } else if (selectedVariation === "big") {
      finalPrompt = `この動画のコンセプトを参考にしつつ、大幅にリメイクした新しい動画を生成: ${prompt}`;
    }

    genBtn.disabled = true;
    genBtn.innerHTML = '<span class="spinner"></span> VEO3で生成中...（最大3分）';

    try {
      const res = await window.API.generateVideo(projectId, blockIndex, {
        prompt: finalPrompt,
        resolution: selectedQuality,
        format: selectedFormat,
      });

      if (res.ok && res.videoUrl) {
        resultArea.style.display = "block";
        resultArea.innerHTML = "";

        const preview = document.createElement("div");
        preview.className = "ai-wizard-preview";
        const vid = document.createElement("video");
        vid.src = res.videoUrl;
        vid.controls = true;
        vid.muted = true;
        vid.playsInline = true;
        vid.autoplay = true;
        vid.style.cssText = "width:100%;border-radius:8px";
        preview.appendChild(vid);
        resultArea.appendChild(preview);

        const applyBtn = document.createElement("button");
        applyBtn.className = "oneclick-main-btn";
        applyBtn.textContent = "この動画を適用";
        applyBtn.addEventListener("click", () => applyVideoToBlock(res.videoUrl));
        resultArea.appendChild(applyBtn);
      }
    } catch (err) {
      window.showToast(`VEO3生成エラー: ${err.message}`, "error");
    } finally {
      genBtn.disabled = false;
      genBtn.innerHTML = '<span class="veo3-icon">&#x1F3AC;</span> VEO3で作成';
    }
  });

  container.appendChild(genBtn);
  container.appendChild(resultArea);

  // ── 動画を適用する関数 ──
  async function applyVideoToBlock(videoUrl) {
    try {
      // ブロックHTMLの動画ソースを差し替え
      let html = block.html || "";
      const oldSrcs = [];
      if (block.videoSrc) oldSrcs.push(block.videoSrc);
      if (block.assets) {
        block.assets.filter(a => a.type === "video").forEach(a => {
          if (a.src) oldSrcs.push(a.src);
        });
      }
      // data-src, src 属性も含めて差し替え
      for (const old of oldSrcs) {
        if (old) html = html.split(old).join(videoUrl);
      }
      // もし置換できなければ、source要素のdata-srcを差し替え
      if (!oldSrcs.length || html === block.html) {
        html = html.replace(/(data-src|src)="[^"]*\.(mp4|webm|gif)[^"]*"/g, `$1="${videoUrl}"`);
      }

      await window.API.updateBlock(projectId, blockIndex, { html });
      window.loadPreview(true);
      window.pushHistory?.("video_apply", `ブロック ${blockIndex} 動画適用`);
      window.showToast("動画を適用しました", "success");
    } catch (err) {
      window.showToast(`適用エラー: ${err.message}`, "error");
    }
  }

  return container;
}

// ── 動画パネル（既存） ──────────────────────────────────────────

function buildVideoPanel(projectId, blockIndex, block) {
  const frag = document.createDocumentFragment();

  const infoSection = createSection("動画ソース");
  const info = document.createElement("div");
  info.style.cssText = "font-size:12px; color:var(--text-secondary); word-break:break-all";
  info.textContent = block.videoSrc || "ソースなし";
  infoSection.appendChild(info);

  if (block.width && block.height) {
    const dims = document.createElement("div");
    dims.style.cssText = "font-size:11px; color:var(--text-muted); margin-top:4px";
    dims.textContent = `${block.width} x ${block.height}`;
    infoSection.appendChild(dims);
  }
  frag.appendChild(infoSection);

  if (block.videoSrc) {
    const playerSection = createSection("プレビュー");
    const video = document.createElement("video");
    video.src = block.videoSrc;
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    video.style.cssText = "width:100%; border-radius:var(--radius-sm)";
    playerSection.appendChild(video);
    frag.appendChild(playerSection);
  }

  const htmlSection = createSection("HTMLソース");
  const codeArea = document.createElement("textarea");
  codeArea.className = "panel-code";
  codeArea.value = block.html || "";
  codeArea.rows = 6;
  htmlSection.appendChild(codeArea);
  frag.appendChild(htmlSection);

  frag.appendChild(buildSaveRow(projectId, blockIndex, () => ({ html: codeArea.value })));

  return frag;
}

// ── 動画手動編集パネル ────────────────────────────────────

function buildVideoQuickPanel(projectId, blockIndex, block) {
  const frag = document.createDocumentFragment();
  const blockHtml = block.html || "";

  // ── 動画プレビュー ──
  if (block.videoSrc) {
    const playerSection = createSection("動画プレビュー");
    const video = document.createElement("video");
    video.src = block.videoSrc;
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    video.style.cssText = "width:100%;border-radius:6px";
    playerSection.appendChild(video);
    if (block.width && block.height) {
      const dims = document.createElement("div");
      dims.style.cssText = "font-size:11px;color:var(--text-muted);margin-top:4px;text-align:center";
      dims.textContent = `${block.width} x ${block.height}`;
      playerSection.appendChild(dims);
    }
    frag.appendChild(playerSection);
  }

  // ── テキスト要素 ──
  const textSection = createSection("テキスト要素");
  const textItems = extractTextNodes(blockHtml);
  const textContainer = document.createElement("div");
  textContainer.className = "text-nodes-container";
  textItems.forEach((item) => {
    const row = document.createElement("div");
    row.className = "text-node-row";
    const tagBadge = document.createElement("span");
    tagBadge.className = "text-node-tag";
    tagBadge.textContent = item.parentTag.toLowerCase();
    row.appendChild(tagBadge);
    const input = document.createElement("textarea");
    input.className = "text-node-input";
    input.value = item.currentText;
    input.rows = 1;
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
    input.addEventListener("input", () => {
      item.currentText = input.value;
      input.style.height = "auto";
      input.style.height = input.scrollHeight + "px";
    });
    row.appendChild(input);
    textContainer.appendChild(row);
  });
  if (textItems.length === 0) {
    const noText = document.createElement("div");
    noText.style.cssText = "color:var(--text-muted);font-size:12px;padding:8px";
    noText.textContent = "テキストノードなし";
    textContainer.appendChild(noText);
  }
  textSection.appendChild(textContainer);
  frag.appendChild(textSection);

  // ── アニメーション ──
  const animSection = createSection("アニメーション");
  // CSSアニメーション
  const animLabel = document.createElement("div");
  animLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin-bottom:4px";
  animLabel.textContent = "CSSアニメーション";
  animSection.appendChild(animLabel);
  const animRow = document.createElement("div");
  animRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px";
  let selectedAnim = "";
  [
    { value: "", label: "なし" },
    { value: "fadeIn", label: "フェードイン" },
    { value: "slideInUp", label: "スライドアップ" },
    { value: "slideInLeft", label: "スライド左" },
    { value: "bounceIn", label: "バウンス" },
    { value: "pulse", label: "パルス" },
    { value: "zoomIn", label: "ズームイン" },
  ].forEach(a => {
    const btn = document.createElement("button");
    btn.className = a.value === "" ? "anim-chip active" : "anim-chip";
    btn.textContent = a.label;
    btn.addEventListener("click", () => {
      selectedAnim = a.value;
      animRow.querySelectorAll(".anim-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
    animRow.appendChild(btn);
  });
  animSection.appendChild(animRow);

  // スクロール連動
  const scrollLabel = document.createElement("div");
  scrollLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin-bottom:4px";
  scrollLabel.textContent = "スクロール連動";
  animSection.appendChild(scrollLabel);
  const scrollRow = document.createElement("div");
  scrollRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px";
  let selectedScroll = "";
  [
    { value: "", label: "なし" },
    { value: "scrollFadeIn", label: "フェードイン" },
    { value: "scrollSlideUp", label: "スライドアップ" },
    { value: "scrollZoom", label: "ズーム" },
  ].forEach(s => {
    const btn = document.createElement("button");
    btn.className = s.value === "" ? "anim-chip active" : "anim-chip";
    btn.textContent = s.label;
    btn.addEventListener("click", () => {
      selectedScroll = s.value;
      scrollRow.querySelectorAll(".anim-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
    scrollRow.appendChild(btn);
  });
  animSection.appendChild(scrollRow);

  // ホバーエフェクト
  const hoverLabel = document.createElement("div");
  hoverLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin-bottom:4px";
  hoverLabel.textContent = "ホバーエフェクト";
  animSection.appendChild(hoverLabel);
  const hoverRow = document.createElement("div");
  hoverRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px";
  let selectedHover = "";
  [
    { value: "", label: "なし" },
    { value: "hoverScale", label: "拡大" },
    { value: "hoverShadow", label: "影追加" },
    { value: "hoverLift", label: "浮かせる" },
  ].forEach(h => {
    const btn = document.createElement("button");
    btn.className = h.value === "" ? "anim-chip active" : "anim-chip";
    btn.textContent = h.label;
    btn.addEventListener("click", () => {
      selectedHover = h.value;
      hoverRow.querySelectorAll(".anim-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
    hoverRow.appendChild(btn);
  });
  animSection.appendChild(hoverRow);

  const speedRow = document.createElement("div");
  speedRow.style.cssText = "display:flex;align-items:center;gap:8px";
  const speedLabel = document.createElement("span");
  speedLabel.style.cssText = "font-size:11px;color:var(--text-muted)";
  speedLabel.textContent = "速度:";
  const speedSelect = document.createElement("select");
  speedSelect.className = "form-input";
  speedSelect.style.cssText = "font-size:11px;padding:4px 6px;width:auto";
  [{ v: "0.3s", l: "速い" }, { v: "0.6s", l: "普通" }, { v: "1s", l: "遅い" }].forEach(o => {
    const opt = document.createElement("option");
    opt.value = o.v;
    opt.textContent = o.l;
    if (o.v === "0.6s") opt.selected = true;
    speedSelect.appendChild(opt);
  });
  speedRow.appendChild(speedLabel);
  speedRow.appendChild(speedSelect);
  animSection.appendChild(speedRow);
  frag.appendChild(animSection);

  // ── コピーボタン ──
  const copySection = createSection("コピー");
  const copyRow = document.createElement("div");
  copyRow.style.cssText = "display:flex;gap:6px";
  const copyHtmlBtn = document.createElement("button");
  copyHtmlBtn.className = "panel-btn";
  copyHtmlBtn.textContent = "HTMLコピー";
  copyHtmlBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(codeArea.value).then(() => {
      window.showToast("HTMLをコピーしました", "success");
    });
  });
  const copyBrowserBtn = document.createElement("button");
  copyBrowserBtn.className = "panel-btn";
  copyBrowserBtn.textContent = "ブラウザコピー";
  copyBrowserBtn.addEventListener("click", () => {
    const html = codeArea.value;
    const blob = new Blob([html], { type: "text/html" });
    try {
      const item = new ClipboardItem({ "text/html": blob, "text/plain": new Blob([html], { type: "text/plain" }) });
      navigator.clipboard.write([item]).then(() => {
        window.showToast("ブラウザ形式でコピーしました", "success");
      }).catch(() => {
        navigator.clipboard.writeText(html).then(() => {
          window.showToast("テキストとしてコピーしました", "success");
        });
      });
    } catch { navigator.clipboard.writeText(html).then(() => { window.showToast("テキストとしてコピーしました", "success"); }); }
  });
  copyRow.appendChild(copyHtmlBtn);
  copyRow.appendChild(copyBrowserBtn);
  copySection.appendChild(copyRow);
  frag.appendChild(copySection);

  // ── HTMLソース ──
  const htmlSection = createSection("HTMLソース");
  const codeArea = document.createElement("textarea");
  codeArea.className = "panel-code";
  codeArea.value = blockHtml;
  codeArea.rows = 6;
  htmlSection.appendChild(codeArea);
  frag.appendChild(htmlSection);

  // ── 保存 ──
  frag.appendChild(buildSaveRow(projectId, blockIndex, () => {
    if (codeArea.value !== blockHtml) {
      return { html: codeArea.value };
    }
    let html = applyTextChanges(blockHtml, textItems);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const duration = speedSelect.value;
    const targetEl = doc.body.firstElementChild || doc.body;
    let styleTag = doc.querySelector("style") || null;
    let cssRules = "";
    const animId = `vanim-${blockIndex}-${Date.now().toString(36)}`;
    if (selectedAnim || selectedScroll || selectedHover) {
      targetEl.classList.add(animId);
    }
    if (selectedAnim) {
      const kf = {
        fadeIn: `@keyframes fadeIn{from{opacity:0}to{opacity:1}}`,
        slideInUp: `@keyframes slideInUp{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}}`,
        slideInLeft: `@keyframes slideInLeft{from{opacity:0;transform:translateX(-40px)}to{opacity:1;transform:translateX(0)}}`,
        bounceIn: `@keyframes bounceIn{0%{opacity:0;transform:scale(0.3)}50%{opacity:1;transform:scale(1.05)}70%{transform:scale(0.9)}100%{transform:scale(1)}}`,
        pulse: `@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}`,
        zoomIn: `@keyframes zoomIn{from{opacity:0;transform:scale(0.5)}to{opacity:1;transform:scale(1)}}`,
      };
      cssRules += (kf[selectedAnim] || "") + `\n.${animId}{animation:${selectedAnim} ${duration} ease both;}\n`;
    }
    if (selectedScroll) {
      const skf = {
        scrollFadeIn: `@keyframes scrollFadeIn{from{opacity:0}to{opacity:1}}`,
        scrollSlideUp: `@keyframes scrollSlideUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}`,
        scrollZoom: `@keyframes scrollZoom{from{opacity:0;transform:scale(0.8)}to{opacity:1;transform:scale(1)}}`,
      };
      cssRules += (skf[selectedScroll] || "") + `\n.${animId}.scroll-visible{animation:${selectedScroll} ${duration} ease both;}\n.${animId}{opacity:0;}\n`;
      const script = doc.createElement("script");
      script.textContent = `(function(){var el=document.querySelector('.${animId}');if(el){new IntersectionObserver(function(e){e.forEach(function(entry){if(entry.isIntersecting){el.classList.add('scroll-visible');}}); },{threshold:0.15}).observe(el);}})();`;
      doc.body.appendChild(script);
    }
    if (selectedHover) {
      const hs = {
        hoverScale: `.${animId}:hover{transform:scale(1.05);transition:transform ${duration} ease;}`,
        hoverShadow: `.${animId}:hover{box-shadow:0 8px 25px rgba(0,0,0,0.2);transition:box-shadow ${duration} ease;}`,
        hoverLift: `.${animId}:hover{transform:translateY(-4px);box-shadow:0 6px 20px rgba(0,0,0,0.15);transition:all ${duration} ease;}`,
      };
      cssRules += (hs[selectedHover] || "") + "\n";
    }
    if (cssRules) {
      if (!styleTag) {
        styleTag = doc.createElement("style");
        doc.body.insertBefore(styleTag, doc.body.firstChild);
      }
      styleTag.textContent = (styleTag.textContent || "") + "\n" + cssRules;
    }
    return { html: doc.body.innerHTML, text: textItems.map(t => t.currentText).join(" ") };
  }));

  return frag;
}

// ── ウィジェットパネル ─────────────────────────────────────

function buildWidgetPanel(projectId, blockIndex, block) {
  const frag = document.createDocumentFragment();
  const blockHtml = block.html || "";

  // ── ウィジェット種別 ──
  const typeSection = createSection("ウィジェット種別");
  const badge = document.createElement("span");
  badge.className = "widget-type-badge";
  badge.textContent = block.widgetType || "カスタム";
  typeSection.appendChild(badge);

  if (block.sbPartId) {
    const idInfo = document.createElement("div");
    idInfo.style.cssText = "font-size:11px; color:var(--text-muted); margin-top:6px; font-family:var(--font-mono)";
    idInfo.textContent = `${block.sbPartId} / ${block.sbCustomClass || ""}`;
    typeSection.appendChild(idInfo);
  }
  frag.appendChild(typeSection);

  // ── HTMLプレビュー（iframe） ──
  const previewSection = createSection("プレビュー");
  const previewFrame = document.createElement("iframe");
  previewFrame.className = "widget-inline-preview";
  previewFrame.sandbox = "allow-scripts allow-same-origin";
  previewFrame.style.cssText = "width:100%;border:1px solid var(--border);border-radius:6px;min-height:120px;background:#fff";
  previewSection.appendChild(previewFrame);
  frag.appendChild(previewSection);

  // プレビュー更新関数
  function updateInlinePreview(html) {
    const doc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12px;font-family:-apple-system,"Hiragino Sans",sans-serif;}</style></head><body>${html}</body></html>`;
    previewFrame.srcdoc = doc;
    // iframeの高さ自動調整
    previewFrame.onload = () => {
      try {
        const h = previewFrame.contentDocument.body.scrollHeight;
        previewFrame.style.height = Math.min(Math.max(h + 24, 80), 400) + "px";
      } catch {}
    };
  }
  // 初期プレビュー
  setTimeout(() => updateInlinePreview(blockHtml), 0);

  // ── 編集モード切替（クイック編集 / HTML編集） ──
  let widgetEditMode = "quick"; // "quick" | "html"
  const modeRow = document.createElement("div");
  modeRow.style.cssText = "display:flex;gap:6px;margin:8px 0";

  const wQuickBtn = document.createElement("button");
  wQuickBtn.className = "widget-edit-btn";
  wQuickBtn.style.background = "rgba(236,72,153,0.15)";
  wQuickBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5l3 3L5 14H2v-3z" stroke="currentColor" stroke-width="1.5"/></svg> クイック編集';

  const wHtmlBtn = document.createElement("button");
  wHtmlBtn.className = "widget-edit-btn";
  wHtmlBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 3l-3 5 3 5M11 3l3 5-3 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> HTML編集';

  const wFullEditorBtn = document.createElement("button");
  wFullEditorBtn.className = "widget-edit-btn";
  wFullEditorBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M1 5h14" stroke="currentColor" stroke-width="1.5"/></svg> フルエディタ';
  wFullEditorBtn.addEventListener("click", () => {
    if (window.openWidgetHtmlEditor) window.openWidgetHtmlEditor(blockIndex);
  });

  modeRow.appendChild(wQuickBtn);
  modeRow.appendChild(wHtmlBtn);
  modeRow.appendChild(wFullEditorBtn);
  frag.appendChild(modeRow);

  // ── クイック編集エリア（テキストノード編集） ──
  const quickSection = document.createElement("div");
  quickSection.className = "panel-section";
  const quickTitle = document.createElement("div");
  quickTitle.className = "panel-section-title";
  quickTitle.textContent = "テキスト内容";
  quickSection.appendChild(quickTitle);

  const textItems = extractTextNodes(blockHtml);
  const textContainer = document.createElement("div");
  textContainer.className = "text-nodes-container";

  // CSS表示
  const cssArea = document.createElement("textarea");
  cssArea.className = "panel-code pane-css-editor";
  cssArea.value = extractCssFromHtml(blockHtml);
  cssArea.rows = 4;
  cssArea.readOnly = true;

  // HTMLソースエリア（先に作成）
  const codeArea = document.createElement("textarea");
  codeArea.className = "panel-code";
  codeArea.value = blockHtml;
  codeArea.rows = 8;
  codeArea.readOnly = true;

  textItems.forEach((item) => {
    const row = document.createElement("div");
    row.className = "text-node-row";
    const input = document.createElement("textarea");
    input.className = "text-node-input";
    input.value = item.currentText;
    input.rows = 1;
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
    input.addEventListener("input", () => {
      item.currentText = input.value;
      input.style.height = "auto";
      input.style.height = input.scrollHeight + "px";
      const newHtml = applyTextChanges(blockHtml, textItems);
      codeArea.value = newHtml;
      updateInlinePreview(newHtml);
      autoSave(projectId, blockIndex, () => ({
        html: newHtml,
        text: textItems.map(t => t.currentText).join(" "),
      }));
    });
    row.appendChild(input);
    textContainer.appendChild(row);
  });

  if (textItems.length === 0) {
    const noText = document.createElement("div");
    noText.style.cssText = "color:var(--text-muted);font-size:12px;padding:8px";
    noText.textContent = "テキストノードなし";
    textContainer.appendChild(noText);
  }
  quickSection.appendChild(textContainer);

  // ── HTMLソースセクション ──
  const htmlSection = document.createElement("div");
  htmlSection.className = "panel-section";
  const htmlTitle = document.createElement("div");
  htmlTitle.className = "panel-section-title";
  htmlTitle.textContent = "HTMLソース";
  htmlSection.appendChild(htmlTitle);
  codeArea.addEventListener("input", () => {
    updateInlinePreview(codeArea.value);
    autoSave(projectId, blockIndex, () => ({ html: codeArea.value }));
  });
  htmlSection.appendChild(codeArea);

  // ── CSSセクション ──
  const cssSection = document.createElement("div");
  cssSection.className = "panel-section";
  const cssTitle = document.createElement("div");
  cssTitle.className = "panel-section-title";
  cssTitle.textContent = "CSS";
  cssSection.appendChild(cssTitle);
  cssSection.appendChild(cssArea);

  // 各セクションを追加
  frag.appendChild(quickSection);
  frag.appendChild(cssSection);
  frag.appendChild(htmlSection);

  // ── モード切替ロジック ──
  function setWidgetEditMode(mode) {
    widgetEditMode = mode;
    if (mode === "quick") {
      wQuickBtn.style.background = "rgba(236,72,153,0.15)";
      wHtmlBtn.style.background = "";
      // テキスト編集可能、HTML/CSS読取専用
      textContainer.querySelectorAll(".text-node-input").forEach(t => { t.readOnly = false; t.style.opacity = "1"; });
      codeArea.readOnly = true;
      codeArea.style.opacity = "0.7";
      cssArea.readOnly = true;
      cssArea.style.opacity = "0.7";
      quickSection.style.display = "";
    } else {
      wHtmlBtn.style.background = "rgba(236,72,153,0.15)";
      wQuickBtn.style.background = "";
      // HTML/CSS編集可能、テキスト読取専用
      textContainer.querySelectorAll(".text-node-input").forEach(t => { t.readOnly = true; t.style.opacity = "0.5"; });
      codeArea.readOnly = false;
      codeArea.style.opacity = "1";
      cssArea.readOnly = false;
      cssArea.style.opacity = "1";
      quickSection.style.display = "";
    }
  }

  wQuickBtn.addEventListener("click", () => setWidgetEditMode("quick"));
  wHtmlBtn.addEventListener("click", () => setWidgetEditMode("html"));

  // 初期モード
  setWidgetEditMode("quick");

  // ── キット追加セクション ──
  const kitSection = createSection("ウィジェットキット追加");
  const kitGrid = document.createElement("div");
  kitGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px";

  const allTemplates = window.getAllWidgetTemplates ? window.getAllWidgetTemplates() : (window.WIDGET_TEMPLATES || []);
  allTemplates.forEach((tpl) => {
    const card = document.createElement("button");
    card.className = "widget-kit-card";
    card.innerHTML = `<span class="widget-kit-icon">${tpl.icon || "W"}</span><span class="widget-kit-name">${tpl.name}</span>`;
    card.title = tpl.description || "";
    card.addEventListener("click", async () => {
      const generated = tpl.generate();
      try {
        const result = await window.API.insertBlock(projectId, {
          afterIndex: blockIndex,
          html: generated.html,
          type: generated.type || "widget",
        });
        if (result.ok) {
          window.showToast(`「${tpl.name}」を追加しました`, "success");
          await window.loadEditor?.(blockIndex + 1);
          window.loadPreview?.(true);
          window.pushHistory?.("insert_block", `Widget「${tpl.name}」を追加`);
        }
      } catch (err) {
        window.showToast(`追加エラー: ${err.message}`, "error");
      }
    });
    kitGrid.appendChild(card);
  });

  kitSection.appendChild(kitGrid);
  frag.appendChild(kitSection);

  return frag;
}

// ── スペーサーパネル ───────────────────────────────────────

function buildSpacerPanel(block) {
  const frag = document.createDocumentFragment();

  const section = createSection("スペーサー");
  const info = document.createElement("div");
  info.style.cssText = "font-size:13px; color:var(--text-muted)";
  info.textContent = "空行・改行要素";
  section.appendChild(info);
  frag.appendChild(section);

  const htmlSection = createSection("HTML");
  const codeArea = document.createElement("textarea");
  codeArea.className = "panel-code";
  codeArea.value = block.html || "";
  codeArea.rows = 3;
  codeArea.readOnly = true;
  htmlSection.appendChild(codeArea);
  frag.appendChild(htmlSection);

  return frag;
}

// ── 3パネル編集ビュー（CSS / テキスト内容 / HTMLソース） ──────

function build3PanePanel(projectId, blockIndex, block) {
  const frag = document.createDocumentFragment();
  const blockHtml = block.html || "";

  // ── CSSパネル ──
  const cssSection = createSection("ウィジェットCSS");
  const cssArea = document.createElement("textarea");
  cssArea.className = "panel-code pane-css-editor";
  cssArea.value = extractCssFromHtml(blockHtml);
  cssArea.rows = 6;
  cssArea.readOnly = true;
  cssSection.appendChild(cssArea);
  frag.appendChild(cssSection);

  // ── 画像セクション（画像系ブロックの場合） ──
  const imageTypes = ["image", "cta_link", "fv"];
  const hasImage = imageTypes.includes(block.type) || (block.assets && block.assets.length > 0);
  if (hasImage) {
    const asset = block.assets?.[0];
    const imgSrc = asset?.src || asset?.webpSrc || "";

    // 画像プレビュー
    const imgPreviewSection = createSection("画像プレビュー");
    if (imgSrc) {
      const box = document.createElement("div");
      box.className = "image-preview-box";
      const previewImg = document.createElement("img");
      previewImg.src = imgSrc;
      previewImg.alt = "現在の画像";
      previewImg.style.cssText = "width:100%;border-radius:4px";
      previewImg.onerror = () => { previewImg.style.display = "none"; };
      box.appendChild(previewImg);
      if (asset?.width && asset?.height) {
        const dims = document.createElement("div");
        dims.style.cssText = "font-size:11px;color:var(--text-muted);padding:6px;text-align:center";
        dims.textContent = `${asset.width} x ${asset.height}`;
        box.appendChild(dims);
      }
      imgPreviewSection.appendChild(box);
    }
    frag.appendChild(imgPreviewSection);

    // サイズ調整
    const sizeSection = createSection("サイズ調整");
    const sizeRow = document.createElement("div");
    sizeRow.style.cssText = "display:flex;gap:8px;align-items:center";
    const wLabel = document.createElement("span");
    wLabel.style.cssText = "font-size:12px;color:var(--text-muted)";
    wLabel.textContent = "幅:";
    const wInput = document.createElement("input");
    wInput.type = "number";
    wInput.className = "panel-input-sm";
    wInput.value = asset?.width || "";
    wInput.placeholder = "auto";
    const hLabel = document.createElement("span");
    hLabel.style.cssText = "font-size:12px;color:var(--text-muted)";
    hLabel.textContent = "高さ:";
    const hInput = document.createElement("input");
    hInput.type = "number";
    hInput.className = "panel-input-sm";
    hInput.value = asset?.height || "";
    hInput.placeholder = "auto";
    sizeRow.appendChild(wLabel);
    sizeRow.appendChild(wInput);
    sizeRow.appendChild(hLabel);
    sizeRow.appendChild(hInput);
    sizeSection.appendChild(sizeRow);

    // サイズプリセット
    const presetRow = document.createElement("div");
    presetRow.style.cssText = "display:flex;gap:4px;margin-top:6px;flex-wrap:wrap";
    [
      { label: "元サイズ", w: asset?.width, h: asset?.height },
      { label: "580×auto", w: 580, h: "" },
      { label: "400×400", w: 400, h: 400 },
      { label: "300×250", w: 300, h: 250 },
    ].forEach(p => {
      const btn = document.createElement("button");
      btn.className = "style-preset-btn";
      btn.textContent = p.label;
      btn.addEventListener("click", () => {
        wInput.value = p.w || "";
        hInput.value = p.h || "";
      });
      presetRow.appendChild(btn);
    });
    sizeSection.appendChild(presetRow);
    frag.appendChild(sizeSection);

    // 画像差し替え（アップロード）
    const uploadSection = createSection("画像差し替え");
    const uploadZone = document.createElement("div");
    uploadZone.className = "upload-drop-zone";
    uploadZone.innerHTML = '<div class="upload-drop-icon">📁</div><div class="upload-drop-text">画像をドラッグ＆ドロップ<br>またはクリックして選択</div>';
    const uploadInput = document.createElement("input");
    uploadInput.type = "file";
    uploadInput.accept = "image/*,video/*";
    uploadInput.style.display = "none";
    uploadZone.appendChild(uploadInput);
    uploadZone.addEventListener("click", () => uploadInput.click());
    uploadZone.addEventListener("dragover", (e) => { e.preventDefault(); uploadZone.classList.add("dragover"); });
    uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));
    uploadZone.addEventListener("drop", (e) => {
      e.preventDefault();
      uploadZone.classList.remove("dragover");
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith("image/")) handle3PaneUpload(file);
    });
    const uploadPreview = document.createElement("div");
    uploadPreview.className = "upload-preview-area";

    function handle3PaneUpload(file) {
      const reader = new FileReader();
      reader.onload = () => {
        uploadPreview.innerHTML = "";
        const card = document.createElement("div");
        card.className = "oneclick-variant-card";
        const uImg = document.createElement("img");
        uImg.src = reader.result;
        card.appendChild(uImg);
        const applyBtn = document.createElement("button");
        applyBtn.className = "oneclick-apply-btn";
        applyBtn.textContent = "この画像を適用";
        applyBtn.addEventListener("click", async () => {
          applyBtn.disabled = true;
          applyBtn.innerHTML = '<span class="spinner"></span> アップロード中...';
          try {
            const uploadResult = await window.API.uploadImage(projectId, blockIndex, {
              imageData: reader.result,
              fileName: file.name,
            });
            if (uploadResult.ok) {
              await window.API.applyImage(projectId, blockIndex, { imageUrl: uploadResult.imageUrl });
              window.showToast("画像を適用しました", "success");
              window.loadPreview(true);
              window.pushHistory?.("image_upload", `ブロック ${blockIndex} 画像アップロード`);
            }
          } catch (err) {
            window.showToast(`エラー: ${err.message}`, "error");
          } finally {
            applyBtn.disabled = false;
            applyBtn.textContent = "この画像を適用";
          }
        });
        card.appendChild(applyBtn);
        uploadPreview.appendChild(card);
      };
      reader.readAsDataURL(file);
    }

    uploadInput.addEventListener("change", () => {
      const file = uploadInput.files?.[0];
      if (file) handle3PaneUpload(file);
    });
    uploadSection.appendChild(uploadZone);
    uploadSection.appendChild(uploadPreview);
    frag.appendChild(uploadSection);
  }

  // ── テキスト内容パネル ──
  const textSection = createSection("テキスト内容");
  const textItems = extractTextNodes(blockHtml);
  const textContainer = document.createElement("div");
  textContainer.className = "text-nodes-container";

  // HTMLソースパネル（先に作成、テキスト変更時に参照するため）
  const codeArea = document.createElement("textarea");
  codeArea.className = "panel-code";
  codeArea.value = blockHtml;
  codeArea.rows = 8;
  codeArea.readOnly = true;

  textItems.forEach((item) => {
    const row = document.createElement("div");
    row.className = "text-node-row";
    const input = document.createElement("textarea");
    input.className = "text-node-input";
    input.value = item.currentText;
    input.rows = 1;
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
    input.addEventListener("input", () => {
      item.currentText = input.value;
      input.style.height = "auto";
      input.style.height = input.scrollHeight + "px";
      const newHtml = applyTextChanges(blockHtml, textItems);
      codeArea.value = newHtml;
      autoSave(projectId, blockIndex, () => ({
        html: newHtml,
        text: textItems.map(t => t.currentText).join(" "),
      }));
    });
    row.appendChild(input);
    textContainer.appendChild(row);
  });

  if (textItems.length === 0) {
    const noText = document.createElement("div");
    noText.style.cssText = "color:var(--text-muted);font-size:12px;padding:8px";
    noText.textContent = "テキストノードなし";
    textContainer.appendChild(noText);
  }

  textSection.appendChild(textContainer);
  frag.appendChild(textSection);

  // ── モード切替ボタン（HTML編集 / クイック編集） ──
  const modeBtnRow = document.createElement("div");
  modeBtnRow.style.cssText = "display:flex;gap:8px;margin:8px 0";
  const htmlEditBtn = document.createElement("button");
  htmlEditBtn.className = "widget-edit-btn";
  htmlEditBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 3l-3 5 3 5M11 3l3 5-3 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> HTML編集';
  const quickEditBtn = document.createElement("button");
  quickEditBtn.className = "widget-edit-btn";
  quickEditBtn.style.background = "rgba(236,72,153,0.15)";
  quickEditBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5l3 3L5 14H2v-3z" stroke="currentColor" stroke-width="1.5"/></svg> クイック編集';

  htmlEditBtn.addEventListener("click", () => {
    cssArea.readOnly = false;
    codeArea.readOnly = false;
    cssArea.style.opacity = "1";
    codeArea.style.opacity = "1";
    textContainer.querySelectorAll(".text-node-input").forEach(t => {
      t.readOnly = true;
      t.style.opacity = "0.5";
    });
    htmlEditBtn.style.background = "rgba(236,72,153,0.15)";
    quickEditBtn.style.background = "";
  });

  quickEditBtn.addEventListener("click", () => {
    cssArea.readOnly = true;
    codeArea.readOnly = true;
    cssArea.style.opacity = "0.7";
    codeArea.style.opacity = "0.7";
    textContainer.querySelectorAll(".text-node-input").forEach(t => {
      t.readOnly = false;
      t.style.opacity = "1";
    });
    quickEditBtn.style.background = "rgba(236,72,153,0.15)";
    htmlEditBtn.style.background = "";
  });

  modeBtnRow.appendChild(htmlEditBtn);
  modeBtnRow.appendChild(quickEditBtn);
  frag.appendChild(modeBtnRow);

  // ── HTMLソースパネル ──
  const htmlSection = createSection("HTMLソース");
  codeArea.addEventListener("input", () => {
    autoSave(projectId, blockIndex, () => ({ html: codeArea.value }));
  });
  htmlSection.appendChild(codeArea);
  frag.appendChild(htmlSection);

  // 保存ボタン
  frag.appendChild(buildSaveRow(projectId, blockIndex, () => {
    if (!codeArea.readOnly) {
      return { html: codeArea.value };
    }
    const newHtml = applyTextChanges(blockHtml, textItems);
    return { html: newHtml, text: textItems.map(t => t.currentText).join(" ") };
  }));

  return frag;
}

// ── テキスト抽出ユーティリティ（3パネルビュー用） ─────────────

/**
 * HTMLからテキストノードを抽出（双方向バインド用）
 */
function extractTextNodes(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const results = [];
  const walker = document.createTreeWalker(
    doc.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const text = node.textContent?.trim();
        if (!text) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (parent?.closest("script, style, noscript")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  let idx = 0;
  let current;
  while ((current = walker.nextNode())) {
    const parent = current.parentElement;
    results.push({
      id: `text-${String(idx).padStart(3, "0")}`,
      originalText: current.textContent.trim(),
      currentText: current.textContent.trim(),
      parentTag: parent?.tagName || "",
      parentClass: parent?.className || "",
    });
    idx++;
  }
  return results;
}

/**
 * テキスト変更をHTMLに反映
 */
function applyTextChanges(html, textItems) {
  let result = html;
  for (const item of textItems) {
    if (item.currentText !== item.originalText) {
      result = result.replace(item.originalText, item.currentText);
    }
  }
  return result;
}

/**
 * HTMLからCSSを抽出
 */
function extractCssFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let css = "";
  doc.querySelectorAll("style").forEach(s => {
    css += s.textContent + "\n";
  });
  doc.querySelectorAll("[style]").forEach(el => {
    const tag = el.tagName.toLowerCase();
    const cls = el.className ? "." + el.className.split(" ")[0] : "";
    css += `/* inline */ ${tag}${cls} { ${el.getAttribute("style")} }\n`;
  });
  return css.trim();
}

// ── コミックエディター ─────────────────────────────────────

/**
 * PixAI生成後の確認UI
 */
function showPixAIConfirmation(container, projectId, blockIndex, imgUrl, opts) {
  // 既存の確認UIがあれば削除
  const existing = container.parentElement?.querySelector(".pixai-confirm-ui");
  if (existing) existing.remove();

  const wrap = document.createElement("div");
  wrap.className = "pixai-confirm-ui";
  wrap.innerHTML = '<div class="pixai-confirm-title">この画像でよろしいですか？</div>';

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:8px;margin-top:8px";

  // はい → コミック編集へ
  const yesBtn = document.createElement("button");
  yesBtn.className = "panel-btn primary";
  yesBtn.textContent = "はい → コミック編集へ";
  yesBtn.addEventListener("click", () => {
    wrap.remove();
    openComicEditor(projectId, blockIndex, imgUrl);
  });

  // いいえ → 再生成
  const noBtn = document.createElement("button");
  noBtn.className = "panel-btn";
  noBtn.textContent = "いいえ → 再生成";
  noBtn.addEventListener("click", () => {
    wrap.innerHTML = "";
    const retryLabel = document.createElement("div");
    retryLabel.style.cssText = "font-size:12px;color:var(--text-secondary);margin-bottom:6px";
    retryLabel.textContent = "プロンプトを修正して再生成:";
    wrap.appendChild(retryLabel);

    const retryInput = document.createElement("textarea");
    retryInput.className = "panel-textarea";
    retryInput.rows = 2;
    retryInput.placeholder = "修正指示を入力...";
    retryInput.value = opts.promptInput?.value || "";
    wrap.appendChild(retryInput);

    const retryBtn = document.createElement("button");
    retryBtn.className = "panel-btn primary";
    retryBtn.style.cssText = "margin-top:6px;width:100%";
    retryBtn.textContent = "再生成する";
    retryBtn.addEventListener("click", async () => {
      retryBtn.disabled = true;
      retryBtn.innerHTML = '<span class="spinner"></span> 再生成中...';
      try {
        if (opts.promptInput) opts.promptInput.value = retryInput.value;
        // 再生成トリガー: opts.genFunction があればそれを呼ぶ
        if (typeof opts.genFunction === "function") {
          wrap.remove();
          await opts.genFunction();
        } else {
          // フォールバック: oneClickImage API直接呼び出し
          const result = await window.API.oneClickImage(projectId, blockIndex, {
            nuance: opts.nuance || "same",
            style: opts.style || "photo",
            designRequirements: window._designRequirements || "",
            customPrompt: retryInput.value,
            genMode: "similar",
            provider: "pixai",
          });
          if (result.ok && result.images && result.images.length > 0) {
            window.showToast(`${result.images.length}パターン再生成しました`, "success");
            wrap.remove();
            // 親のresultGridに再表示（container = resultGrid）
            container.innerHTML = "";
            result.images.forEach((newUrl, i) => {
              const card = document.createElement("div");
              card.className = "oneclick-variant-card";
              const vImg = document.createElement("img");
              vImg.src = newUrl; vImg.alt = `パターン ${i + 1}`;
              card.appendChild(vImg);
              const apBtn = document.createElement("button");
              apBtn.className = "oneclick-apply-btn";
              apBtn.textContent = "これを使う";
              apBtn.addEventListener("click", async () => {
                apBtn.disabled = true;
                apBtn.innerHTML = '<span class="spinner"></span>';
                try {
                  await window.API.applyImage(projectId, blockIndex, { imageUrl: newUrl });
                  window.loadPreview(true);
                  showPixAIConfirmation(container, projectId, blockIndex, newUrl, opts);
                } catch (err) {
                  window.showToast(`エラー: ${err.message}`, "error");
                } finally {
                  apBtn.disabled = false; apBtn.textContent = "これを使う";
                }
              });
              card.appendChild(apBtn);
              container.appendChild(card);
            });
          }
        }
      } catch (err) {
        window.showToast(`再生成エラー: ${err.message}`, "error");
      } finally {
        retryBtn.disabled = false;
        retryBtn.textContent = "再生成する";
      }
    });
    wrap.appendChild(retryBtn);
  });

  btnRow.appendChild(yesBtn);
  btnRow.appendChild(noBtn);
  wrap.appendChild(btnRow);

  // resultGridの親（oneClickSection）に追加
  const parent = container.parentElement || container;
  parent.appendChild(wrap);
}

/**
 * ステップインジケーター生成
 */
function buildStepIndicator(totalSteps, labels) {
  const el = document.createElement("div");
  el.className = "comic-step-bar";
  const steps = [];
  labels.forEach((label, i) => {
    const step = document.createElement("div");
    step.className = "comic-step" + (i === 0 ? " active" : "");
    step.innerHTML = `<span class="comic-step-num">${i + 1}</span><span class="comic-step-label">${label}</span>`;
    el.appendChild(step);
    steps.push(step);
    if (i < labels.length - 1) {
      const line = document.createElement("div");
      line.className = "comic-step-line";
      el.appendChild(line);
    }
  });
  return {
    el,
    setStep(idx) {
      steps.forEach((s, i) => {
        s.classList.toggle("active", i === idx);
        s.classList.toggle("done", i < idx);
      });
    }
  };
}

/**
 * コミックエディター メインウィザード
 */
function openComicEditor(projectId, blockIndex, imageUrl) {
  const body = document.getElementById("edit-panel-body");
  if (!body) return;
  body.innerHTML = "";

  // ヘッダー
  const header = document.createElement("div");
  header.className = "comic-editor-header";
  header.innerHTML = '<span class="comic-editor-icon">📖</span> コミックエディター';
  body.appendChild(header);

  // ステップインジケーター
  const stepBar = buildStepIndicator(4, ["コマ配置", "吹き出し", "文字", "動き"]);
  body.appendChild(stepBar.el);

  // コンテンツエリア
  const content = document.createElement("div");
  content.className = "comic-editor-content";
  body.appendChild(content);

  // 状態管理
  const state = {
    currentStep: 0,
    layout: null,
    bubbles: [],    // [{cellIndex, type}]
    texts: [],      // [{bubbleIndex, text, fontSize, bold}]
    animations: [], // [{target, targetType, anim, speed}]
    imageUrl,
  };

  renderComicStep(content, state, stepBar, projectId, blockIndex);
}

/**
 * ステップ切り替えルーター
 */
function renderComicStep(container, state, stepBar, projectId, blockIndex) {
  container.innerHTML = "";
  stepBar.setStep(state.currentStep);

  const onNext = () => {
    state.currentStep++;
    renderComicStep(container, state, stepBar, projectId, blockIndex);
  };
  const onBack = () => {
    state.currentStep--;
    renderComicStep(container, state, stepBar, projectId, blockIndex);
  };

  switch (state.currentStep) {
    case 0:
      renderPanelLayoutStep(container, state, onNext, projectId, blockIndex);
      break;
    case 1:
      renderBubbleStep(container, state, onNext, onBack, projectId, blockIndex);
      break;
    case 2:
      renderTextStep(container, state, onNext, onBack, projectId, blockIndex);
      break;
    case 3:
      renderAnimationStep(container, state, onBack, projectId, blockIndex);
      break;
  }
}

/**
 * Step 1: コマ配置 — 20種テンプレート選択
 */
function renderPanelLayoutStep(container, state, onNext, projectId, blockIndex) {
  const desc = document.createElement("div");
  desc.className = "comic-step-desc";
  desc.textContent = "コマ割りレイアウトを選択してください";
  container.appendChild(desc);

  const grid = document.createElement("div");
  grid.className = "comic-layout-grid";

  let selectedIdx = state.layout ? COMIC_LAYOUTS.findIndex(l => l.id === state.layout.id) : -1;

  COMIC_LAYOUTS.forEach((layout, i) => {
    const card = document.createElement("div");
    card.className = "comic-layout-card" + (i === selectedIdx ? " selected" : "");
    card.title = layout.name;

    // ミニプレビュー
    const preview = document.createElement("div");
    preview.className = "comic-layout-preview";
    if (layout.diagonal) {
      preview.innerHTML = '<div style="position:absolute;inset:0;overflow:hidden"><div style="position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(135deg,var(--accent-light) 50%,var(--bg-tertiary) 50%)"></div></div>';
      preview.style.position = "relative";
    } else {
      preview.style.display = "grid";
      preview.style.gridTemplate = layout.grid;
      if (layout.areas) preview.style.gridTemplateAreas = layout.areas;
      preview.style.gap = "2px";
      const areaLetters = "abcdefghij";
      for (let c = 0; c < layout.cells; c++) {
        const cell = document.createElement("div");
        cell.className = "comic-layout-cell";
        if (layout.areas) cell.style.gridArea = areaLetters[c];
        cell.textContent = c + 1;
        preview.appendChild(cell);
      }
    }
    card.appendChild(preview);

    const name = document.createElement("div");
    name.className = "comic-layout-name";
    name.textContent = layout.name;
    card.appendChild(name);

    card.addEventListener("click", () => {
      grid.querySelectorAll(".comic-layout-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedIdx = i;
      state.layout = layout;

      // iframe にオーバーレイ送信
      const iframe = document.getElementById("preview-iframe");
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage({
          type: "comicOverlay",
          blockIndex,
          layout,
          imageUrl: state.imageUrl,
        }, "*");
      }
    });
    grid.appendChild(card);
  });

  container.appendChild(grid);

  // ナビゲーション
  const nav = document.createElement("div");
  nav.className = "comic-nav-row";
  const nextBtn = document.createElement("button");
  nextBtn.className = "panel-btn primary";
  nextBtn.textContent = "次へ → 吹き出し配置";
  nextBtn.addEventListener("click", () => {
    if (!state.layout) { window.showToast("レイアウトを選択してください", "info"); return; }
    // 吹き出し配列を初期化
    if (state.bubbles.length === 0) {
      for (let c = 0; c < state.layout.cells; c++) {
        state.bubbles.push({ cellIndex: c, type: "none" });
      }
    }
    onNext();
  });
  nav.appendChild(nextBtn);
  container.appendChild(nav);
}

/**
 * Step 2: 吹き出し配置
 */
function renderBubbleStep(container, state, onNext, onBack, projectId, blockIndex) {
  const desc = document.createElement("div");
  desc.className = "comic-step-desc";
  desc.textContent = "各コマに吹き出しタイプを設定";
  container.appendChild(desc);

  const list = document.createElement("div");
  list.className = "comic-bubble-list";

  // bubbles配列をlayoutに合わせてリサイズ
  while (state.bubbles.length < state.layout.cells) {
    state.bubbles.push({ cellIndex: state.bubbles.length, type: "none" });
  }

  state.bubbles.forEach((bubble, idx) => {
    const card = document.createElement("div");
    card.className = "comic-bubble-card";

    const label = document.createElement("div");
    label.className = "comic-bubble-label";
    label.textContent = `コマ ${idx + 1}`;
    card.appendChild(label);

    const chips = document.createElement("div");
    chips.className = "comic-bubble-chips";
    BUBBLE_TYPES.forEach(bt => {
      const chip = document.createElement("button");
      chip.className = "anim-chip" + (bubble.type === bt.id ? " active" : "");
      chip.textContent = bt.name;
      chip.addEventListener("click", () => {
        chips.querySelectorAll(".anim-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        bubble.type = bt.id;
        // iframeに吹き出しプレビュー送信
        const iframe = document.getElementById("preview-iframe");
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage({
            type: "comicBubble",
            blockIndex,
            cellIndex: idx,
            bubbleType: bt.id,
            layout: state.layout,
          }, "*");
        }
      });
      chips.appendChild(chip);
    });
    card.appendChild(chips);
    list.appendChild(card);
  });

  container.appendChild(list);

  // ナビゲーション
  const nav = document.createElement("div");
  nav.className = "comic-nav-row";
  const backBtn = document.createElement("button");
  backBtn.className = "panel-btn";
  backBtn.textContent = "← 戻る";
  backBtn.addEventListener("click", onBack);
  const nextBtn = document.createElement("button");
  nextBtn.className = "panel-btn primary";
  nextBtn.textContent = "次へ → 文字入力";
  nextBtn.addEventListener("click", () => {
    // テキスト配列を吹き出しがある分だけ初期化
    const bubblesWithType = state.bubbles.filter(b => b.type !== "none");
    if (state.texts.length === 0) {
      bubblesWithType.forEach((b, i) => {
        state.texts.push({ bubbleIndex: state.bubbles.indexOf(b), text: "", fontSize: 16, bold: false });
      });
    }
    onNext();
  });
  nav.appendChild(backBtn);
  nav.appendChild(nextBtn);
  container.appendChild(nav);
}

/**
 * Step 3: 文字入力
 */
function renderTextStep(container, state, onNext, onBack, projectId, blockIndex) {
  const desc = document.createElement("div");
  desc.className = "comic-step-desc";
  desc.textContent = "吹き出しにテキストを入力";
  container.appendChild(desc);

  // 吹き出しが設定されたコマのみ
  const bubblesWithType = state.bubbles.filter(b => b.type !== "none");

  if (bubblesWithType.length === 0) {
    const noMsg = document.createElement("div");
    noMsg.style.cssText = "padding:20px;text-align:center;color:var(--text-muted);font-size:13px";
    noMsg.textContent = "吹き出しが設定されていません。スキップできます。";
    container.appendChild(noMsg);
  } else {
    // texts配列を同期
    while (state.texts.length < bubblesWithType.length) {
      state.texts.push({ bubbleIndex: state.bubbles.indexOf(bubblesWithType[state.texts.length]), text: "", fontSize: 16, bold: false });
    }

    const list = document.createElement("div");
    list.className = "comic-text-list";

    bubblesWithType.forEach((bubble, tIdx) => {
      const card = document.createElement("div");
      card.className = "comic-text-card";

      const header = document.createElement("div");
      header.className = "comic-text-header";
      const btInfo = BUBBLE_TYPES.find(bt => bt.id === bubble.type) || BUBBLE_TYPES[0];
      header.textContent = `コマ ${bubble.cellIndex + 1} — ${btInfo.name}`;
      card.appendChild(header);

      const textData = state.texts[tIdx] || { text: "", fontSize: 16, bold: false };

      const textarea = document.createElement("textarea");
      textarea.className = "panel-textarea";
      textarea.rows = 2;
      textarea.placeholder = "セリフを入力...";
      textarea.value = textData.text;
      textarea.addEventListener("input", () => {
        textData.text = textarea.value;
        // iframeにテキストプレビュー送信
        const iframe = document.getElementById("preview-iframe");
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage({
            type: "comicText",
            blockIndex,
            cellIndex: bubble.cellIndex,
            text: textarea.value,
            fontSize: textData.fontSize,
            bold: textData.bold,
            bubbleType: bubble.type,
            layout: state.layout,
          }, "*");
        }
      });
      card.appendChild(textarea);

      // フォントサイズ + 太字
      const optRow = document.createElement("div");
      optRow.style.cssText = "display:flex;gap:6px;align-items:center;margin-top:6px";

      const sizeLabel = document.createElement("span");
      sizeLabel.style.cssText = "font-size:11px;color:var(--text-muted)";
      sizeLabel.textContent = "文字サイズ:";
      optRow.appendChild(sizeLabel);

      const sizeChips = document.createElement("div");
      sizeChips.style.cssText = "display:flex;gap:3px";
      [{ v: 12, l: "小" }, { v: 16, l: "中" }, { v: 20, l: "大" }, { v: 24, l: "特大" }].forEach(s => {
        const chip = document.createElement("button");
        chip.className = "anim-chip" + (textData.fontSize === s.v ? " active" : "");
        chip.textContent = s.l;
        chip.style.cssText += ";font-size:10px;padding:2px 6px";
        chip.addEventListener("click", () => {
          sizeChips.querySelectorAll(".anim-chip").forEach(c => c.classList.remove("active"));
          chip.classList.add("active");
          textData.fontSize = s.v;
        });
        sizeChips.appendChild(chip);
      });
      optRow.appendChild(sizeChips);

      const boldLabel = document.createElement("label");
      boldLabel.style.cssText = "font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:3px;margin-left:8px;cursor:pointer";
      const boldCb = document.createElement("input");
      boldCb.type = "checkbox";
      boldCb.checked = textData.bold;
      boldCb.addEventListener("change", () => { textData.bold = boldCb.checked; });
      boldLabel.appendChild(boldCb);
      boldLabel.appendChild(document.createTextNode("太字"));
      optRow.appendChild(boldLabel);

      card.appendChild(optRow);
      list.appendChild(card);
    });
    container.appendChild(list);
  }

  // ナビゲーション
  const nav = document.createElement("div");
  nav.className = "comic-nav-row";
  const backBtn = document.createElement("button");
  backBtn.className = "panel-btn";
  backBtn.textContent = "← 戻る";
  backBtn.addEventListener("click", onBack);
  const nextBtn = document.createElement("button");
  nextBtn.className = "panel-btn primary";
  nextBtn.textContent = "次へ → 動き追加";
  nextBtn.addEventListener("click", onNext);
  nav.appendChild(backBtn);
  nav.appendChild(nextBtn);
  container.appendChild(nav);
}

/**
 * Step 4: 動き追加
 */
function renderAnimationStep(container, state, onBack, projectId, blockIndex) {
  const desc = document.createElement("div");
  desc.className = "comic-step-desc";
  desc.textContent = "各要素にアニメーションを追加（任意）";
  container.appendChild(desc);

  const animations = [
    { value: "", label: "なし" },
    { value: "fadeIn", label: "フェードイン" },
    { value: "slideInUp", label: "下から" },
    { value: "slideInLeft", label: "左から" },
    { value: "slideInRight", label: "右から" },
    { value: "bounceIn", label: "バウンス" },
    { value: "zoomIn", label: "ズーム" },
    { value: "pulse", label: "パルス" },
    { value: "shake", label: "シェイク" },
  ];
  const speeds = [
    { value: "0.3s", label: "速い" },
    { value: "0.6s", label: "普通" },
    { value: "1s", label: "遅い" },
  ];

  // 要素リスト生成
  const elements = [];
  // コマ枠
  for (let c = 0; c < (state.layout?.cells || 0); c++) {
    elements.push({ target: `cell-${c}`, targetType: "cell", label: `コマ ${c + 1}` });
  }
  // 吹き出し
  state.bubbles.forEach((b, i) => {
    if (b.type !== "none") {
      elements.push({ target: `bubble-${i}`, targetType: "bubble", label: `吹き出し (コマ${b.cellIndex + 1})` });
    }
  });

  // animations配列を初期化
  if (state.animations.length === 0) {
    elements.forEach(el => {
      state.animations.push({ target: el.target, targetType: el.targetType, anim: "", speed: "0.6s" });
    });
  }

  const list = document.createElement("div");
  list.className = "comic-anim-list";

  elements.forEach((el, eIdx) => {
    const card = document.createElement("div");
    card.className = "comic-anim-card";

    const header = document.createElement("div");
    header.className = "comic-anim-header";
    header.textContent = el.label;
    card.appendChild(header);

    const animData = state.animations[eIdx] || { anim: "", speed: "0.6s" };

    // アニメーション選択チップ
    const animChips = document.createElement("div");
    animChips.style.cssText = "display:flex;flex-wrap:wrap;gap:3px;margin:6px 0";
    animations.forEach(a => {
      const chip = document.createElement("button");
      chip.className = "anim-chip" + (animData.anim === a.value ? " active" : "");
      chip.textContent = a.label;
      chip.style.cssText += ";font-size:10px;padding:2px 7px";
      chip.addEventListener("click", () => {
        animChips.querySelectorAll(".anim-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        animData.anim = a.value;
      });
      animChips.appendChild(chip);
    });
    card.appendChild(animChips);

    // 速度チップ
    const speedChips = document.createElement("div");
    speedChips.style.cssText = "display:flex;gap:3px;margin-bottom:6px";
    speeds.forEach(s => {
      const chip = document.createElement("button");
      chip.className = "anim-chip" + (animData.speed === s.value ? " active" : "");
      chip.textContent = s.label;
      chip.style.cssText += ";font-size:10px;padding:2px 7px";
      chip.addEventListener("click", () => {
        speedChips.querySelectorAll(".anim-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        animData.speed = s.value;
      });
      speedChips.appendChild(chip);
    });
    card.appendChild(speedChips);

    // プレビューボタン
    const previewBtn = document.createElement("button");
    previewBtn.className = "anim-preview-btn";
    previewBtn.style.cssText += ";width:100%;font-size:10px;padding:4px";
    previewBtn.textContent = "▶ プレビュー";
    previewBtn.addEventListener("click", () => {
      if (!animData.anim) return;
      const iframe = document.getElementById("preview-iframe");
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage({
          type: "comicAnimation",
          blockIndex,
          target: el.target,
          anim: animData.anim,
          speed: animData.speed,
          layout: state.layout,
        }, "*");
      }
    });
    card.appendChild(previewBtn);
    list.appendChild(card);
  });

  container.appendChild(list);

  // ナビゲーション
  const nav = document.createElement("div");
  nav.className = "comic-nav-row";
  const backBtn = document.createElement("button");
  backBtn.className = "panel-btn";
  backBtn.textContent = "← 戻る";
  backBtn.addEventListener("click", onBack);
  const finishBtn = document.createElement("button");
  finishBtn.className = "panel-btn primary";
  finishBtn.textContent = "完了 → 保存";
  finishBtn.addEventListener("click", async () => {
    finishBtn.disabled = true;
    finishBtn.innerHTML = '<span class="spinner"></span> 保存中...';
    try {
      const html = buildComicBlockHtml(state);
      await window.API.updateBlock(projectId, blockIndex, { html });
      window.loadPreview(true);
      window.pushHistory?.("comic_save", `ブロック ${blockIndex} コミック保存`);
      window.showToast("コミックを保存しました", "success");
      // iframeのオーバーレイをクリア
      const iframe = document.getElementById("preview-iframe");
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage({ type: "comicOverlay", blockIndex, layout: null }, "*");
      }
      // エディターパネルを閉じる
      document.getElementById("edit-panel")?.classList.remove("open");
    } catch (err) {
      window.showToast(`保存エラー: ${err.message}`, "error");
    } finally {
      finishBtn.disabled = false;
      finishBtn.textContent = "完了 → 保存";
    }
  });
  nav.appendChild(backBtn);
  nav.appendChild(finishBtn);
  container.appendChild(nav);
}

/**
 * コミック状態 → SB互換HTML生成
 */
function buildComicBlockHtml(state) {
  const partId = "sb-part-" + Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-4);
  const cls = partId.replace("sb-part-", "sb-custom-part-");
  const layout = state.layout;
  const gridTpl = layout.grid || "1fr / 1fr";
  const gridAreas = layout.areas || "";

  // CSS生成
  let css = `
#${partId}.${cls} .comic-container { position:relative; width:100%; }
#${partId}.${cls} .comic-base-img { width:100%; display:block; }
#${partId}.${cls} .comic-grid {
  position:absolute; top:0; left:0; right:0; bottom:0;
  display:grid; grid-template:${gridTpl}; gap:3px;
  ${gridAreas ? "grid-template-areas:" + gridAreas + ";" : ""}
}
#${partId}.${cls} .comic-cell {
  border:2px solid #000; position:relative; overflow:hidden;
}
#${partId}.${cls} .comic-bubble {
  position:absolute; padding:8px 12px; max-width:70%;
  bottom:10%; left:50%; transform:translateX(-50%);
  text-align:center; z-index:2;
}
#${partId}.${cls} .bubble-round { background:#fff; border:2px solid #000; border-radius:50%; }
#${partId}.${cls} .bubble-rect { background:#fff; border:2px solid #000; border-radius:12px; }
#${partId}.${cls} .bubble-spike { background:#fff; border:2px solid #000; clip-path:polygon(0% 20%,8% 0%,16% 18%,30% 4%,40% 16%,50% 0%,60% 16%,70% 4%,84% 18%,92% 0%,100% 20%,100% 80%,92% 100%,84% 82%,70% 96%,60% 84%,50% 100%,40% 84%,30% 96%,16% 82%,8% 100%,0% 80%); padding:16px; }
#${partId}.${cls} .bubble-cloud { background:#fff; border:2px solid #000; border-radius:50% 50% 50% 50% / 60% 60% 40% 40%; filter:drop-shadow(0 2px 2px rgba(0,0,0,0.1)); }
#${partId}.${cls} .bubble-shout { background:#ff0; border:2px solid #000; clip-path:polygon(0% 20%,15% 0%,25% 25%,50% 0%,75% 25%,85% 0%,100% 20%,100% 80%,85% 100%,75% 75%,50% 100%,25% 75%,15% 100%,0% 80%); padding:16px; }
#${partId}.${cls} .bubble-think { background:#fff; border:2px dashed #666; border-radius:50%; }
#${partId}.${cls} .bubble-narration { background:rgba(0,0,0,0.7); color:#fff; border:none; border-radius:4px; }
`;

  // アニメーション用キーフレーム（使用されているもののみ）
  const usedAnims = new Set(state.animations.filter(a => a.anim).map(a => a.anim));
  const keyframeMap = {
    fadeIn: "@keyframes fadeIn{from{opacity:0}to{opacity:1}}",
    slideInUp: "@keyframes slideInUp{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}}",
    slideInLeft: "@keyframes slideInLeft{from{opacity:0;transform:translateX(-40px)}to{opacity:1;transform:translateX(0)}}",
    slideInRight: "@keyframes slideInRight{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:translateX(0)}}",
    bounceIn: "@keyframes bounceIn{0%{opacity:0;transform:scale(0.3)}50%{opacity:1;transform:scale(1.05)}70%{transform:scale(0.9)}100%{transform:scale(1)}}",
    zoomIn: "@keyframes zoomIn{from{opacity:0;transform:scale(0.5)}to{opacity:1;transform:scale(1)}}",
    pulse: "@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}",
    shake: "@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}",
  };
  usedAnims.forEach(a => {
    if (keyframeMap[a]) css += "\n" + keyframeMap[a];
  });

  // アニメーションスタイル
  state.animations.forEach((animCfg, idx) => {
    if (animCfg.anim) {
      const targetClass = animCfg.target.replace("-", "-cell-");
      css += `\n#${partId}.${cls} .comic-anim-${animCfg.target} { animation:${animCfg.anim} ${animCfg.speed} ease forwards; }`;
    }
  });

  // HTML生成
  const areaLetters = "abcdefghij";
  let cellsHtml = "";
  for (let c = 0; c < layout.cells; c++) {
    const cellAnim = state.animations.find(a => a.target === `cell-${c}`);
    const animClass = cellAnim?.anim ? ` comic-anim-cell-${c}` : "";
    const areaStyle = layout.areas ? ` style="grid-area:${areaLetters[c]}"` : "";
    let bubbleHtml = "";
    const bubble = state.bubbles[c];
    if (bubble && bubble.type !== "none") {
      const textEntry = state.texts.find(t => t.bubbleIndex === c);
      const text = textEntry?.text || "";
      const fontSize = textEntry?.fontSize || 16;
      const bold = textEntry?.bold ? "font-weight:bold;" : "";
      const bubbleAnim = state.animations.find(a => a.target === `bubble-${c}`);
      const bubbleAnimClass = bubbleAnim?.anim ? ` comic-anim-bubble-${c}` : "";
      bubbleHtml = `
      <div class="comic-bubble bubble-${bubble.type}${bubbleAnimClass}">
        <span style="font-size:${fontSize}px;${bold}">${text}</span>
      </div>`;
    }
    cellsHtml += `
    <div class="comic-cell${animClass}"${areaStyle}>${bubbleHtml}
    </div>`;
  }

  // 画像URL処理
  const imgUrl = state.imageUrl || "";
  const webpUrl = imgUrl.replace(/\.(jpg|jpeg|png|gif)$/i, ".webp");

  const html = `<div><div class="sb-custom"><span><div id="${partId}" class="${cls}">
<style>${css}
</style>
<div class="comic-container">
  <picture><source type="image/webp" data-srcset="${webpUrl}"><img class="lazyload comic-base-img" data-src="${imgUrl}" alt="comic"></picture>
  <div class="comic-grid">${cellsHtml}
  </div>
</div>
</div></span></div></div>`;

  return html;
}

// ── ヘルパー ───────────────────────────────────────────────

function createSection(title) {
  const section = document.createElement("div");
  section.className = "panel-section";
  const titleEl = document.createElement("div");
  titleEl.className = "panel-section-title";
  titleEl.textContent = title;
  section.appendChild(titleEl);
  return section;
}

/**
 * 折りたたみ可能セクション
 * @param {string} icon - 絵文字アイコン
 * @param {string} title - セクションタイトル
 * @param {number|string} count - バッジに表示する数
 * @param {boolean} openByDefault - 初期展開状態
 * @returns {{ wrapper: HTMLElement, body: HTMLElement }}
 */
function createCollapsibleSection(icon, title, count, openByDefault = true) {
  const wrapper = document.createElement("div");
  wrapper.className = "bp-section" + (openByDefault ? " bp-open" : "");

  const header = document.createElement("div");
  header.className = "bp-section-header";
  header.innerHTML = `<span class="bp-section-arrow">${openByDefault ? "▼" : "▶"}</span><span>${icon} ${title}</span>${count != null ? `<span class="bp-section-badge">${count}</span>` : ""}<span style="flex:1"></span><span class="bp-section-toggle">折り畳み</span>`;
  wrapper.appendChild(header);

  const body = document.createElement("div");
  body.className = "bp-section-body";
  if (!openByDefault) body.style.display = "none";
  wrapper.appendChild(body);

  header.addEventListener("click", () => {
    const isOpen = wrapper.classList.toggle("bp-open");
    body.style.display = isOpen ? "" : "none";
    header.querySelector(".bp-section-arrow").textContent = isOpen ? "▼" : "▶";
  });

  return { wrapper, body };
}

/**
 * 画像要素のラベルを生成
 */
function getImageElementLabel(el, index) {
  const tag = el.tagName?.toLowerCase() || "";
  if (tag === "source") {
    const media = el.getAttribute("media") || "";
    if (media.includes("min-width")) return "PC用 source";
    return "SP用 source";
  }
  if (tag === "img") return "メイン画像";
  return `${tag} [${index}]`;
}

function buildSaveRow(projectId, blockIndex, getData) {
  const row = document.createElement("div");
  row.className = "panel-btn-row";

  const btn = document.createElement("button");
  btn.className = "panel-btn primary";
  btn.textContent = "保存";

  const indicator = document.createElement("span");
  indicator.className = "save-indicator";
  indicator.textContent = "保存しました";

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      await window.API.updateBlock(projectId, blockIndex, getData());
      indicator.classList.add("show");
      setTimeout(() => indicator.classList.remove("show"), 2000);
      window.loadPreview(true); // preserve scroll position
      window.pushHistory?.("manual_save", `ブロック ${blockIndex} 手動保存`);
    } catch (err) {
      window.showToast(`保存エラー: ${err.message}`, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "保存";
    }
  });

  row.appendChild(btn);
  row.appendChild(indicator);
  return row;
}
