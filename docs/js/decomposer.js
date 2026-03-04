/**
 * decomposer.js — AI画像分解エディタ (article-cloner 統合版)
 *
 * previewMode: "image" | "decomposed"
 *  - image: 元画像 + 「AIで分解する」ボタン
 *  - decomposed: 元画像は完全非表示、HTML/CSS再構成のみ
 */

// ── State ──
const state = {
  originalImage: null,       // data URL
  previewMode: "upload",     // "upload" | "image" | "decomposed"
  canvasWidth: 600,
  canvasHeight: 800,
  background: "#ffffff",
  elements: [],
  selectedId: null,
  isLoading: false,
  error: null,
  showOriginalOverlay: false,
};

const FONT_PX = { S: 12, M: 16, L: 22, XL: 32, XXL: 48 };
const TYPE_META = {
  text:              { icon: "✏️", color: "#f97316", bg: "rgba(249,115,22,.12)" },
  price:             { icon: "💰", color: "#f59e0b", bg: "rgba(245,158,11,.12)" },
  badge:             { icon: "🏷️", color: "#ef4444", bg: "rgba(239,68,68,.12)" },
  icon:              { icon: "⭐", color: "#3b82f6", bg: "rgba(59,130,246,.12)" },
  arrow:             { icon: "➡️", color: "#3b82f6", bg: "rgba(59,130,246,.12)" },
  decoration:        { icon: "🎨", color: "#10b981", bg: "rgba(16,185,129,.12)" },
  background_area:   { icon: "🎨", color: "#eab308", bg: "rgba(234,179,8,.12)" },
  image_placeholder: { icon: "🖼️", color: "#6b7280", bg: "rgba(107,114,128,.12)" },
};

// ── Render ──
function render() {
  const app = document.getElementById("app");
  app.innerHTML = "";

  if (state.previewMode === "upload") {
    app.appendChild(buildUploadScreen());
    return;
  }

  // Toolbar
  app.appendChild(buildToolbar());

  // Error
  if (state.error) {
    const err = document.createElement("div");
    err.className = "error-bar";
    err.textContent = state.error;
    app.appendChild(err);
  }

  // Layout
  const layout = document.createElement("div");
  layout.className = "editor-layout";

  // Preview
  const preview = document.createElement("div");
  preview.className = "preview-area";
  if (state.previewMode === "image") {
    preview.appendChild(buildImagePreview());
  } else if (state.previewMode === "decomposed") {
    preview.appendChild(buildDecomposedPreview());
    if (state.showOriginalOverlay && state.originalImage) {
      const ov = document.createElement("div");
      ov.className = "ref-overlay";
      const img = document.createElement("img");
      img.src = state.originalImage;
      img.draggable = false;
      ov.appendChild(img);
      preview.appendChild(ov);
    }
  }
  layout.appendChild(preview);

  // Panel (decomposed mode only)
  if (state.previewMode === "decomposed") {
    layout.appendChild(buildPanel());
  }

  app.appendChild(layout);
}

// ── Upload Screen ──
function buildUploadScreen() {
  const wrap = document.createElement("div");
  wrap.className = "upload-screen";

  const title = document.createElement("div");
  title.className = "upload-title";
  title.textContent = "AI 画像分解エディタ";
  wrap.appendChild(title);

  const sub = document.createElement("div");
  sub.className = "upload-sub";
  sub.textContent = "広告画像をアップロード → AIが自動で要素を分解 → テキスト編集可能に";
  wrap.appendChild(sub);

  const drop = document.createElement("div");
  drop.className = "upload-drop";
  drop.innerHTML = `<div class="icon">🖼️</div><div class="main-text">画像をドラッグ＆ドロップ</div><div class="sub-text">またはクリックしてファイルを選択</div><div class="hint">PNG / JPEG / WebP（5MB以下推奨）</div>`;

  if (state.isLoading) {
    drop.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:12px"><div style="width:32px;height:32px;border:2px solid #ff0066;border-top-color:transparent;border-radius:50%;animation:spin .6s linear infinite"></div><div style="color:#888">AIが画像を分析中...</div></div>`;
  }

  drop.addEventListener("click", () => document.getElementById("file-input").click());
  drop.addEventListener("dragover", (e) => e.preventDefault());
  drop.addEventListener("drop", (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); });
  wrap.appendChild(drop);

  return wrap;
}

// ── Image Preview (before decompose) ──
function buildImagePreview() {
  const wrap = document.createElement("div");
  wrap.className = "image-preview";

  const img = document.createElement("img");
  img.src = state.originalImage;
  img.draggable = false;
  wrap.appendChild(img);

  const btn = document.createElement("button");
  btn.className = "analyze-btn";
  btn.disabled = state.isLoading;
  if (state.isLoading) {
    btn.innerHTML = '<span class="spinner"></span>AIが分析中...';
  } else {
    btn.textContent = "🔍 AIで分解する";
  }
  btn.addEventListener("click", handleAnalyze);
  wrap.appendChild(btn);

  return wrap;
}

// ── Decomposed Preview ──
function buildDecomposedPreview() {
  const canvas = document.createElement("div");
  canvas.className = "decomposed-canvas";
  canvas.style.aspectRatio = `${state.canvasWidth} / ${state.canvasHeight}`;
  canvas.style.background = state.background;

  canvas.addEventListener("click", (e) => {
    if (e.target === canvas) { state.selectedId = null; render(); }
  });

  state.elements.forEach((el) => {
    canvas.appendChild(buildElement(el));
  });

  return canvas;
}

function buildElement(el) {
  const div = document.createElement("div");
  div.className = "element" + (el.id === state.selectedId ? " selected" : "");

  if (el.type === "image_placeholder") div.className += " placeholder";
  if (el.type === "background_area") div.className += " bg-area";

  div.style.left = el.x + "%";
  div.style.top = el.y + "%";
  div.style.width = el.width + "%";
  div.style.height = el.height + "%";
  div.style.zIndex = el.zIndex;
  div.style.opacity = el.opacity;

  if (el.type === "background_area" || el.type === "decoration") {
    div.style.background = el.backgroundColor !== "transparent" ? el.backgroundColor : el.color;
    div.style.borderRadius = el.borderRadius;
    if (el.border !== "none") div.style.border = el.border;
  } else if (el.type === "image_placeholder") {
    div.textContent = el.content;
  } else {
    div.style.fontSize = FONT_PX[el.fontSize] + "px";
    div.style.fontWeight = el.fontWeight;
    div.style.color = el.color;
    if (el.backgroundColor !== "transparent") div.style.background = el.backgroundColor;
    div.style.textAlign = el.textAlign;
    div.style.justifyContent = el.textAlign === "center" ? "center" : el.textAlign === "right" ? "flex-end" : "flex-start";
    div.style.borderRadius = el.borderRadius;
    if (el.border !== "none") div.style.border = el.border;
    if (el.rotation) div.style.transform = `rotate(${el.rotation}deg)`;
    div.textContent = el.content;
  }

  // Click to select
  div.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    state.selectedId = el.id;
    render();

    // Drag
    const canvasEl = div.parentElement;
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const origX = el.x, origY = el.y;

    const onMove = (ev) => {
      el.x = Math.max(0, Math.min(100 - el.width, origX + (ev.clientX - startX) / rect.width * 100));
      el.y = Math.max(0, Math.min(100 - el.height, origY + (ev.clientY - startY) / rect.height * 100));
      div.style.left = el.x + "%";
      div.style.top = el.y + "%";
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  return div;
}

// ── Toolbar ──
function buildToolbar() {
  const bar = document.createElement("div");
  bar.className = "toolbar";

  const brand = document.createElement("span");
  brand.className = "toolbar-brand";
  brand.textContent = "AI画像分解";
  bar.appendChild(brand);

  const sep = document.createElement("div");
  sep.className = "toolbar-sep";
  bar.appendChild(sep);

  if (state.previewMode === "decomposed") {
    bar.appendChild(tbBtn("🔙 元画像に戻す", false, () => { state.previewMode = "image"; state.elements = []; state.selectedId = null; state.showOriginalOverlay = false; render(); }));
    bar.appendChild(tbBtn("＋テキスト追加", false, () => {
      state.elements.push({ id: "el_" + Date.now(), type: "text", content: "新しいテキスト", x: 10, y: 10, width: 30, height: 8, fontSize: "M", fontWeight: "bold", color: "#333", backgroundColor: "transparent", textAlign: "center", borderRadius: "0px", border: "none", zIndex: 10, rotation: 0, opacity: 1 });
      state.selectedId = state.elements[state.elements.length - 1].id;
      render();
    }));
    bar.appendChild(tbBtn("👁 参考表示", state.showOriginalOverlay, () => { state.showOriginalOverlay = !state.showOriginalOverlay; render(); }));
    bar.appendChild(tbBtn("🔄 再検出", false, handleAnalyze, state.isLoading));
  }

  bar.appendChild(tbBtn("📷 別の画像", false, () => document.getElementById("file-input").click()));

  const spacer = document.createElement("div");
  spacer.className = "tb-spacer";
  bar.appendChild(spacer);

  if (state.previewMode === "decomposed") {
    const count = document.createElement("span");
    count.className = "tb-count";
    count.textContent = state.elements.length + " 要素";
    bar.appendChild(count);

    bar.appendChild(tbBtn("JSON出力", false, () => {
      const data = { width: state.canvasWidth, height: state.canvasHeight, background: state.background, elements: state.elements };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "decomposed.json"; a.click();
    }));
  }

  if (state.isLoading) {
    const spin = document.createElement("div");
    spin.style.cssText = "width:16px;height:16px;border:2px solid #ff0066;border-top-color:transparent;border-radius:50%;animation:spin .6s linear infinite";
    bar.appendChild(spin);
  }

  return bar;
}

function tbBtn(text, active, onClick, disabled) {
  const btn = document.createElement("button");
  btn.className = "tb-btn" + (active ? " active" : "");
  btn.textContent = text;
  btn.disabled = !!disabled;
  btn.addEventListener("click", onClick);
  return btn;
}

// ── Right Panel ──
function buildPanel() {
  const panel = document.createElement("div");
  panel.className = "panel";

  // Background
  const bgSec = document.createElement("div");
  bgSec.className = "panel-section";
  const bgLabel = document.createElement("div");
  bgLabel.className = "panel-label";
  bgLabel.textContent = "背景CSS";
  bgSec.appendChild(bgLabel);
  const bgInput = document.createElement("input");
  bgInput.className = "panel-input";
  bgInput.value = state.background;
  bgInput.placeholder = "#fff or linear-gradient(...)";
  bgInput.addEventListener("input", () => { state.background = bgInput.value; renderPreviewOnly(); });
  bgSec.appendChild(bgInput);
  panel.appendChild(bgSec);

  const hr = document.createElement("div");
  hr.style.cssText = "border-top:1px solid #333;margin-bottom:12px";
  panel.appendChild(hr);

  if (state.selectedId) {
    const el = state.elements.find(e => e.id === state.selectedId);
    if (el) { panel.appendChild(buildPropertyEditor(el)); return panel; }
  }

  // Element summary + text list
  panel.appendChild(buildElementSummary());
  panel.appendChild(buildTextList());

  return panel;
}

function buildElementSummary() {
  const sec = document.createElement("div");
  sec.className = "panel-section";
  const lbl = document.createElement("div");
  lbl.style.cssText = "font-size:12px;font-weight:600;color:#e0e0e8;margin-bottom:8px";
  lbl.textContent = `📄 抽出された要素（${state.elements.length}）`;
  sec.appendChild(lbl);

  const chips = document.createElement("div");
  chips.className = "chips";
  const counts = {};
  state.elements.forEach(el => { counts[el.type] = (counts[el.type] || 0) + 1; });
  Object.entries(counts).forEach(([type, count]) => {
    const m = TYPE_META[type] || { icon: "📦", color: "#888", bg: "rgba(136,136,136,.12)" };
    const c = document.createElement("span");
    c.className = "chip";
    c.style.background = m.bg;
    c.style.color = m.color;
    c.textContent = `${m.icon} ${type} ${count}`;
    chips.appendChild(c);
  });
  sec.appendChild(chips);
  return sec;
}

function buildTextList() {
  const sec = document.createElement("div");
  sec.className = "panel-section";

  const editable = state.elements.filter(el => el.type === "text" || el.type === "price" || el.type === "badge");
  if (editable.length === 0) return sec;

  const title = document.createElement("div");
  title.style.cssText = "font-size:11px;font-weight:600;color:#3b82f6;margin-bottom:4px";
  title.textContent = `📝 画像テキスト編集 ${editable.length}件`;
  sec.appendChild(title);

  const desc = document.createElement("div");
  desc.style.cssText = "font-size:10px;color:#888;margin-bottom:12px;line-height:1.4";
  desc.textContent = "下のフィールドを編集すると、左のプレビューにリアルタイムで反映されます。";
  sec.appendChild(desc);

  editable.forEach((el, i) => {
    const item = document.createElement("div");
    item.className = "text-item";

    const m = TYPE_META[el.type] || TYPE_META.text;
    const label = document.createElement("div");
    label.className = "text-item-label";
    label.innerHTML = `<span class="text-item-num" style="background:${m.bg};color:${m.color}">#${i + 1}</span> <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">元: 「${el.content.length > 25 ? el.content.slice(0, 25) + "…" : el.content}」</span>`;
    item.appendChild(label);

    const input = document.createElement("input");
    input.value = el.content;
    input.addEventListener("focus", () => { state.selectedId = el.id; renderPreviewOnly(); });
    input.addEventListener("input", () => { el.content = input.value; renderPreviewOnly(); });
    item.appendChild(input);

    const styleBtn = document.createElement("button");
    styleBtn.className = "style-btn";
    styleBtn.textContent = "スタイル調整";
    styleBtn.addEventListener("click", () => { state.selectedId = el.id; render(); });
    item.appendChild(styleBtn);

    sec.appendChild(item);
  });

  return sec;
}

// ── Property Editor ──
function buildPropertyEditor(el) {
  const sec = document.createElement("div");

  const typeLabels = { text: "テキスト", price: "価格", badge: "バッジ", icon: "アイコン", arrow: "矢印", decoration: "装飾", background_area: "背景エリア", image_placeholder: "画像エリア" };
  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px";
  header.innerHTML = `<span style="font-size:12px;font-weight:700;color:#e0e0e8">${typeLabels[el.type] || el.type}</span><span style="font-size:9px;color:#666">${el.id}</span>`;

  const backBtn = document.createElement("button");
  backBtn.className = "tb-btn";
  backBtn.style.cssText = "font-size:10px;margin-left:8px";
  backBtn.textContent = "← 一覧";
  backBtn.addEventListener("click", () => { state.selectedId = null; render(); });
  header.appendChild(backBtn);
  sec.appendChild(header);

  // Content
  const contentLabel = document.createElement("div"); contentLabel.className = "panel-label"; contentLabel.textContent = "テキスト内容"; sec.appendChild(contentLabel);
  const ta = document.createElement("textarea"); ta.className = "panel-textarea"; ta.value = el.content;
  ta.addEventListener("input", () => { el.content = ta.value; renderPreviewOnly(); });
  sec.appendChild(ta);

  // Position
  const posLabel = document.createElement("div"); posLabel.className = "panel-label"; posLabel.style.marginTop = "10px"; posLabel.textContent = "位置・サイズ (%)"; sec.appendChild(posLabel);
  const posGrid = document.createElement("div"); posGrid.className = "prop-grid";
  [["X", "x"], ["Y", "y"], ["W", "width"], ["H", "height"]].forEach(([lbl, key]) => {
    const row = document.createElement("div"); row.className = "prop-num";
    const l = document.createElement("label"); l.textContent = lbl; row.appendChild(l);
    const inp = document.createElement("input"); inp.type = "number"; inp.min = 0; inp.max = 100; inp.step = 0.5; inp.value = Math.round(el[key] * 10) / 10;
    inp.addEventListener("input", () => { el[key] = parseFloat(inp.value) || 0; renderPreviewOnly(); });
    row.appendChild(inp); posGrid.appendChild(row);
  });
  sec.appendChild(posGrid);

  // Font size
  const fsLabel = document.createElement("div"); fsLabel.className = "panel-label"; fsLabel.style.marginTop = "10px"; fsLabel.textContent = "フォントサイズ"; sec.appendChild(fsLabel);
  const fsRow = document.createElement("div"); fsRow.className = "prop-btn-row";
  ["S", "M", "L", "XL", "XXL"].forEach(sz => {
    const b = document.createElement("button"); b.className = "prop-btn " + (el.fontSize === sz ? "on" : "off"); b.textContent = sz;
    b.addEventListener("click", () => { el.fontSize = sz; render(); });
    fsRow.appendChild(b);
  });
  sec.appendChild(fsRow);

  // Weight + Align
  const waLabel = document.createElement("div"); waLabel.className = "panel-label"; waLabel.style.marginTop = "10px"; waLabel.textContent = "太さ / 配置"; sec.appendChild(waLabel);
  const waRow = document.createElement("div"); waRow.className = "prop-btn-row";
  [["通常", "normal"], ["太字", "bold"]].forEach(([lbl, val]) => {
    const b = document.createElement("button"); b.className = "prop-btn " + (el.fontWeight === val ? "on" : "off"); b.textContent = lbl;
    b.addEventListener("click", () => { el.fontWeight = val; render(); });
    waRow.appendChild(b);
  });
  waRow.appendChild(document.createElement("div")); // spacer
  [["左", "left"], ["中", "center"], ["右", "right"]].forEach(([lbl, val]) => {
    const b = document.createElement("button"); b.className = "prop-btn " + (el.textAlign === val ? "on" : "off"); b.textContent = lbl;
    b.addEventListener("click", () => { el.textAlign = val; render(); });
    waRow.appendChild(b);
  });
  sec.appendChild(waRow);

  // Colors
  const cLabel = document.createElement("div"); cLabel.className = "panel-label"; cLabel.style.marginTop = "10px"; cLabel.textContent = "文字色 / 背景色"; sec.appendChild(cLabel);
  const cRow = document.createElement("div"); cRow.style.cssText = "display:flex;gap:8px;align-items:center";
  const colorIn = document.createElement("input"); colorIn.type = "color"; colorIn.value = el.color;
  colorIn.style.cssText = "width:28px;height:28px;border:1px solid #444;border-radius:4px;cursor:pointer;padding:0";
  colorIn.addEventListener("input", () => { el.color = colorIn.value; renderPreviewOnly(); });
  cRow.appendChild(colorIn);
  const bgIn = document.createElement("input"); bgIn.type = "color"; bgIn.value = el.backgroundColor === "transparent" ? "#000000" : el.backgroundColor;
  bgIn.style.cssText = "width:28px;height:28px;border:1px solid #444;border-radius:4px;cursor:pointer;padding:0";
  bgIn.addEventListener("input", () => { el.backgroundColor = bgIn.value; renderPreviewOnly(); });
  cRow.appendChild(bgIn);
  const transBtn = document.createElement("button"); transBtn.className = "prop-btn " + (el.backgroundColor === "transparent" ? "on" : "off"); transBtn.textContent = "透明";
  transBtn.addEventListener("click", () => { el.backgroundColor = "transparent"; render(); });
  cRow.appendChild(transBtn);
  sec.appendChild(cRow);

  // Rotation + Opacity
  const roLabel = document.createElement("div"); roLabel.className = "panel-label"; roLabel.style.marginTop = "10px"; roLabel.textContent = `回転: ${el.rotation}° / 透明度: ${Math.round(el.opacity * 100)}%`; sec.appendChild(roLabel);
  const rotIn = document.createElement("input"); rotIn.type = "range"; rotIn.min = -180; rotIn.max = 180; rotIn.value = el.rotation; rotIn.style.width = "100%";
  rotIn.addEventListener("input", () => { el.rotation = Number(rotIn.value); roLabel.textContent = `回転: ${el.rotation}° / 透明度: ${Math.round(el.opacity * 100)}%`; renderPreviewOnly(); });
  sec.appendChild(rotIn);
  const opaIn = document.createElement("input"); opaIn.type = "range"; opaIn.min = 0; opaIn.max = 100; opaIn.value = Math.round(el.opacity * 100); opaIn.style.width = "100%";
  opaIn.addEventListener("input", () => { el.opacity = Number(opaIn.value) / 100; roLabel.textContent = `回転: ${el.rotation}° / 透明度: ${Math.round(el.opacity * 100)}%`; renderPreviewOnly(); });
  sec.appendChild(opaIn);

  // Actions
  const actions = document.createElement("div"); actions.className = "action-row";
  const dupBtn = document.createElement("button"); dupBtn.className = "action-btn dup"; dupBtn.textContent = "複製";
  dupBtn.addEventListener("click", () => {
    const dup = { ...el, id: "el_" + Date.now(), x: Math.min(el.x + 3, 90), y: Math.min(el.y + 3, 90) };
    state.elements.push(dup); state.selectedId = dup.id; render();
  });
  const delBtn = document.createElement("button"); delBtn.className = "action-btn del"; delBtn.textContent = "削除";
  delBtn.addEventListener("click", () => {
    state.elements = state.elements.filter(e => e.id !== el.id); state.selectedId = null; render();
  });
  actions.appendChild(dupBtn); actions.appendChild(delBtn);
  sec.appendChild(actions);

  return sec;
}

// ── Fast re-render (preview only, no panel rebuild) ──
function renderPreviewOnly() {
  const preview = document.querySelector(".preview-area");
  if (!preview) return;
  // Re-render canvas
  const oldCanvas = preview.querySelector(".decomposed-canvas");
  if (oldCanvas) {
    const newCanvas = buildDecomposedPreview();
    oldCanvas.replaceWith(newCanvas);
  }
  // Update background input if exists
  const bgInput = document.querySelector(".panel .panel-input");
  if (bgInput && bgInput !== document.activeElement) bgInput.value = state.background;
}

// ── File handling ──
function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = () => {
    let dataUrl = reader.result;
    // Resize if > 4MB
    if (file.size > 4 * 1024 * 1024) {
      resizeImage(dataUrl, 2000).then(resized => {
        state.originalImage = resized;
        state.previewMode = "image";
        state.elements = [];
        state.selectedId = null;
        state.error = null;
        render();
      });
    } else {
      state.originalImage = dataUrl;
      state.previewMode = "image";
      state.elements = [];
      state.selectedId = null;
      state.error = null;
      render();
    }
  };
  reader.readAsDataURL(file);
}

function resizeImage(dataUrl, maxDim) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.src = dataUrl;
  });
}

// ── Analyze ──
async function handleAnalyze() {
  if (!state.originalImage) return;
  state.isLoading = true;
  state.error = null;
  render();

  try {
    const base64 = state.originalImage.split(",")[1];
    const mediaType = state.originalImage.split(";")[0].split(":")[1];

    const res = await fetch("/api/decompose-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64, mediaType }),
    });

    if (!res.ok) throw new Error("分析に失敗しました");
    const result = await res.json();
    if (result.error) throw new Error(result.error);

    // ★ 核心: previewMode を "decomposed" に切替 → 元画像は完全非表示 ★
    state.previewMode = "decomposed";
    state.canvasWidth = result.width || 600;
    state.canvasHeight = result.height || 800;
    state.background = result.background || "#ffffff";
    state.elements = result.elements || [];
    state.selectedId = null;
  } catch (err) {
    state.error = err.message;
  } finally {
    state.isLoading = false;
    render();
  }
}

// ── Init ──
document.getElementById("file-input").addEventListener("change", (e) => {
  handleFile(e.target.files[0]);
});
render();
