/**
 * app.js - SPA Router + State Management + Screen Transitions
 */

const state = {
  projectId: null,
  projectData: null,
  currentScreen: "landing",
  sseConnection: null,
};

// ── Screen Navigation ──────────────────────────────────────

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  const screen = document.getElementById(`screen-${name}`);
  if (screen) {
    screen.classList.add("active");
    state.currentScreen = name;
  }
}

// ── Toast ──────────────────────────────────────────────────

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    toast.style.transition = "all 0.3s";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
window.showToast = showToast;

// ── Modals ─────────────────────────────────────────────────

function openModal(id) { document.getElementById(id)?.classList.add("active"); }
function closeModal(id) { document.getElementById(id)?.classList.remove("active"); }
window.openModal = openModal;
window.closeModal = closeModal;

document.querySelectorAll("[data-close-modal]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
});
document.querySelectorAll(".modal-backdrop").forEach((b) => {
  b.addEventListener("click", () => b.closest(".modal")?.classList.remove("active"));
});

// ── Screen 1: Landing ──────────────────────────────────────

const urlInput = document.getElementById("url-input");
const btnStart = document.getElementById("btn-start");

urlInput.addEventListener("input", () => {
  btnStart.disabled = !isValidUrl(urlInput.value.trim());
});

urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !btnStart.disabled) startClone();
});

urlInput.addEventListener("paste", () => {
  setTimeout(() => {
    urlInput.dispatchEvent(new Event("input"));
    if (!btnStart.disabled) urlInput.select();
  }, 50);
});

btnStart.addEventListener("click", startClone);

function isValidUrl(str) {
  try { const u = new URL(str); return u.protocol === "http:" || u.protocol === "https:"; }
  catch { return false; }
}

async function startClone() {
  const url = urlInput.value.trim();
  if (!url) return;

  showScreen("loading");
  document.getElementById("loading-url").textContent = url;
  resetProgress();

  try {
    const result = await window.API.createProject(url);
    state.projectId = result.id;
    setSegmentActive("scrape");
    state.sseConnection = window.API.connectSSE(result.id, {
      onProgress: handleProgress,
      onReady: handleReady,
      onError: handleError,
    });
  } catch (err) {
    showToast(`エラー: ${err.message}`, "error");
    showScreen("landing");
  }
}

// ── Screen 2: Loading ──────────────────────────────────────

function resetProgress() {
  ["scrape", "parse", "ready"].forEach((s) => {
    document.getElementById(`seg-${s}`).className = "segment";
  });
  document.getElementById("counter-assets").textContent = "-";
  document.getElementById("counter-blocks").textContent = "-";
  document.getElementById("counter-sections").textContent = "-";
  document.getElementById("log-entries").innerHTML = "";
}

function setSegmentActive(n) { document.getElementById(`seg-${n}`).className = "segment active"; }
function setSegmentDone(n) { document.getElementById(`seg-${n}`).className = "segment done"; }

function addLogEntry(message) {
  const entries = document.getElementById("log-entries");
  const entry = document.createElement("div");
  entry.className = "log-entry";
  const time = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  entry.innerHTML = `<span class="log-time">${time}</span>${escapeHtml(message)}`;
  entries.appendChild(entry);
  entries.parentElement.scrollTop = entries.parentElement.scrollHeight;
}

function handleProgress(data) {
  addLogEntry(data.message);
  if (data.phase === "scrape" && data.assetCount !== undefined) {
    document.getElementById("counter-assets").textContent = data.assetCount;
    setSegmentDone("scrape");
    setSegmentActive("parse");
  }
  if (data.phase === "parse" && data.blockCount !== undefined) {
    document.getElementById("counter-blocks").textContent = data.blockCount;
    if (data.sectionCount !== undefined)
      document.getElementById("counter-sections").textContent = data.sectionCount;
    setSegmentDone("parse");
    setSegmentActive("ready");
  }
}

async function handleReady(data) {
  setSegmentDone("ready");
  document.getElementById("counter-blocks").textContent = data.blockCount;
  document.getElementById("counter-assets").textContent = data.assetCount;
  addLogEntry("準備完了!");
  await new Promise((r) => setTimeout(r, 600));
  await loadEditor();
}

function handleError(data) {
  addLogEntry(`エラー: ${data.message}`);
  showToast(`Error: ${data.message}`, "error");
}

// ── Screen 3: Editor ───────────────────────────────────────

async function loadEditor() {
  try {
    state.projectData = await window.API.getProject(state.projectId);
    showScreen("editor");
    document.getElementById("toolbar-title").textContent = state.projectData.slug;
    document.getElementById("toolbar-block-count").textContent = `${state.projectData.blockCount} ブロック`;
    renderBlockList(state.projectData.blocks);
    loadPreview();
    document.getElementById("btn-export").disabled = state.projectData.status !== "done";
  } catch (err) {
    showToast(`エラー: ${err.message}`, "error");
  }
}

function renderBlockList(blocks) {
  const list = document.getElementById("block-list");
  list.innerHTML = "";
  blocks.forEach((block) => {
    const item = document.createElement("div");
    item.className = "block-item";
    item.dataset.index = block.index;

    const previewText = block.text
      ? block.text.slice(0, 80)
      : block.type === "image"
        ? `image ${block.assets?.[0]?.width || "?"}x${block.assets?.[0]?.height || "?"}`
        : block.type === "cta_link"
          ? (block.href?.slice(0, 60) || "CTA Link")
          : (block.widgetType || block.type);

    item.innerHTML = `
      <span class="block-index">${block.index}</span>
      <div class="block-info">
        <span class="block-type-tag ${block.type}">${block.type}</span>
        <div class="block-preview-text">${escapeHtml(previewText)}</div>
      </div>`;

    item.addEventListener("click", () => {
      list.querySelectorAll(".block-item.active").forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
      const iframe = document.getElementById("preview-iframe");
      iframe.contentWindow?.postMessage({ type: "scrollToBlock", blockIndex: block.index }, "*");
      iframe.contentWindow?.postMessage({ type: "highlightBlock", blockIndex: block.index }, "*");
      window.openEditPanel(state.projectId, block.index, block.type);
    });

    list.appendChild(item);
  });
}

function loadPreview() {
  const iframe = document.getElementById("preview-iframe");
  if (iframe && state.projectId) {
    iframe.src = window.API.getPreviewUrl(state.projectId);
  }
}

// iframe -> parent message
window.addEventListener("message", (e) => {
  // Origin check - only accept from same origin
  if (e.origin !== window.location.origin) return;
  if (e.data?.type !== "blockClick") return;

  const idx = e.data.blockIndex;
  const list = document.getElementById("block-list");
  list.querySelectorAll(".block-item.active").forEach((i) => i.classList.remove("active"));
  const item = list.querySelector(`[data-index="${idx}"]`);
  if (item) {
    item.classList.add("active");
    item.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  const block = state.projectData?.blocks?.[idx];
  if (block) window.openEditPanel(state.projectId, idx, block.type);
});

// ── Tabs ───────────────────────────────────────────────────

document.querySelectorAll(".pane-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const pane = tab.closest(".pane");
    pane.querySelectorAll(".pane-tab").forEach((t) => t.classList.remove("active"));
    pane.querySelectorAll(".tab-content").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`)?.classList.add("active");
    if (tab.dataset.tab === "code") loadCodeView();
  });
});

async function loadCodeView() {
  if (!state.projectData?.blocks) return;
  const editor = document.getElementById("code-editor");
  editor.innerHTML = "";
  let lineNum = 1;
  for (const b of state.projectData.blocks) {
    const div = document.createElement("div");
    div.className = "code-line";
    div.innerHTML = `<span class="code-line-num">${lineNum}</span><span class="code-line-text"><span class="hl-comment">&lt;!-- [${b.index}] ${b.type}${b.widgetType ? `:${b.widgetType}` : ""} --&gt;</span></span>`;
    editor.appendChild(div);
    lineNum++;
    if (b.text) {
      const t = document.createElement("div");
      t.className = "code-line";
      t.innerHTML = `<span class="code-line-num">${lineNum}</span><span class="code-line-text">${escapeHtml(b.text.slice(0, 120))}</span>`;
      editor.appendChild(t);
      lineNum++;
    }
  }
}

// ── Toolbar ────────────────────────────────────────────────

document.getElementById("btn-back").addEventListener("click", () => {
  closeEditPanel();
  showScreen("landing");
  state.projectId = null;
  state.projectData = null;
});

document.getElementById("btn-text-modify").addEventListener("click", openTextModifyModal);

document.getElementById("btn-build").addEventListener("click", async () => {
  if (!state.projectId) return;
  const btn = document.getElementById("btn-build");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> ビルド中...';
  try {
    const result = await window.API.build(state.projectId);
    if (result.ok) {
      showToast("ビルド完了!", "success");
      document.getElementById("btn-export").disabled = false;
      openExportModal(result);
    } else {
      showToast(`ビルドエラー: ${result.error}`, "error");
    }
  } catch (err) {
    showToast(`ビルドエラー: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 8l3 3 5-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>ビルド</span>';
  }
});

document.getElementById("btn-export").addEventListener("click", async () => {
  if (!state.projectId) return;
  if (state.projectData?.status !== "done") {
    try {
      const result = await window.API.build(state.projectId);
      openExportModal(result);
    } catch (err) {
      showToast(`エラー: ${err.message}`, "error");
    }
  } else {
    openExportModal(null);
  }
});

// ── Text Modify Modal ──────────────────────────────────────

function openTextModifyModal() {
  openModal("modal-text-modify");

  const termsContainer = document.getElementById("frequent-terms");
  termsContainer.innerHTML = "";
  if (state.projectData?.analysis?.frequentTerms) {
    state.projectData.analysis.frequentTerms.forEach((t) => {
      const chip = document.createElement("span");
      chip.className = "term-chip";
      chip.innerHTML = `${escapeHtml(t.term)}<span class="term-count">x${t.count}</span>`;
      chip.addEventListener("click", () => addReplacementRow(t.term, ""));
      termsContainer.appendChild(chip);
    });
  }

  if (state.projectData?.analysis?.ctaLinks?.[0]) {
    document.getElementById("cta-url-input").value = state.projectData.analysis.ctaLinks[0].href;
  }
}

function addReplacementRow(oldText = "", newText = "") {
  const list = document.getElementById("replacements-list");
  const row = document.createElement("div");
  row.className = "replacement-row";
  row.innerHTML = `
    <input type="text" placeholder="旧テキスト" class="input-old" value="${escapeHtml(oldText)}">
    <span class="arrow">\u2192</span>
    <input type="text" placeholder="新テキスト" class="input-new" value="${escapeHtml(newText)}">
    <button class="btn-remove-row" title="削除">\u00d7</button>`;
  row.querySelector(".btn-remove-row").addEventListener("click", () => row.remove());
  list.appendChild(row);
}

document.getElementById("btn-add-replacement").addEventListener("click", () => addReplacementRow());

document.querySelectorAll(".btn-remove-row").forEach((btn) => {
  btn.addEventListener("click", () => btn.closest(".replacement-row").remove());
});

document.getElementById("btn-apply-text-modify").addEventListener("click", async () => {
  if (!state.projectId) return;
  const rows = document.querySelectorAll("#replacements-list .replacement-row");
  const directReplacements = {};
  rows.forEach((row) => {
    const old = row.querySelector(".input-old").value.trim();
    const nw = row.querySelector(".input-new").value.trim();
    if (old && nw) directReplacements[old] = nw;
  });
  const ctaUrl = document.getElementById("cta-url-input").value.trim();
  const config = { directReplacements };
  if (ctaUrl) config.ctaUrl = ctaUrl;

  try {
    const result = await window.API.textModify(state.projectId, config);
    if (result.ok) {
      showToast(`差し替え完了 (${result.blockCount} ブロック)`, "success");
      closeModal("modal-text-modify");
      await loadEditor();
    } else {
      showToast(`Error: ${result.error}`, "error");
    }
  } catch (err) {
    showToast(`エラー: ${err.message}`, "error");
  }
});

// ── Export Modal ────────────────────────────────────────────

function openExportModal(buildResult) {
  openModal("modal-export");
  const vr = document.getElementById("validation-results");
  const stats = document.getElementById("export-stats");
  vr.innerHTML = "";
  stats.innerHTML = "";

  if (buildResult) {
    const checks = [];

    if (buildResult.valid) {
      checks.push({ label: "SBフラグメント形式: 正常", pass: true });
    }
    if (buildResult.errors?.length) {
      buildResult.errors.forEach((e) => checks.push({ label: e, pass: false }));
    } else {
      checks.push({ label: "バリデーションエラーなし", pass: true });
    }
    buildResult.warnings?.forEach((w) => checks.push({ label: w, pass: true, warn: true }));

    if (!buildResult.errors?.length && !buildResult.warnings?.length) {
      checks.push({ label: "全チェック通過", pass: true });
    }

    checks.forEach((c) => {
      const item = document.createElement("div");
      item.className = "validation-item";
      const cls = !c.pass ? "fail" : c.warn ? "warn" : "pass";
      const icon = !c.pass ? "\u2717" : c.warn ? "!" : "\u2713";
      item.innerHTML = `<span class="validation-icon ${cls}">${icon}</span><span>${escapeHtml(c.label)}</span>`;
      vr.appendChild(item);
    });

    stats.innerHTML = `
      <div class="stat-card"><div class="stat-value">${buildResult.sizeFormatted || "-"}</div><div class="stat-label">ファイルサイズ</div></div>
      <div class="stat-card"><div class="stat-value">${buildResult.blockCount || "-"}</div><div class="stat-label">ブロック数</div></div>`;
  }
}

document.getElementById("btn-download-html").addEventListener("click", () => {
  if (state.projectId) window.location.href = window.API.getExportUrl(state.projectId);
});

document.getElementById("btn-copy-html").addEventListener("click", async () => {
  if (!state.projectId) return;
  try {
    const res = await fetch(window.API.getExportUrl(state.projectId));
    const html = await res.text();
    await navigator.clipboard.writeText(html);
    showToast("クリップボードにコピーしました", "success");
  } catch {
    showToast("コピーに失敗しました", "error");
  }
});

// ── Helpers ────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function closeEditPanel() {
  document.getElementById("edit-panel")?.classList.remove("open");
}

window.escapeHtml = escapeHtml;
window.closeEditPanel = closeEditPanel;
window.loadPreview = loadPreview;
window.loadEditor = loadEditor;
window.state = state;

// ── Status Check ──────────────────────────────────────────

async function checkStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    const geminiEl = document.getElementById("status-gemini");
    if (data.gemini) {
      geminiEl.classList.add("connected");
      geminiEl.classList.remove("disconnected");
      geminiEl.querySelector(".status-value").textContent = `接続済 (${data.geminiKeyCount}キー)`;
    } else {
      geminiEl.classList.add("disconnected");
      geminiEl.classList.remove("connected");
      geminiEl.querySelector(".status-value").textContent = "未設定";
    }
  } catch {
    const geminiEl = document.getElementById("status-gemini");
    if (geminiEl) {
      geminiEl.classList.add("disconnected");
      geminiEl.querySelector(".status-value").textContent = "接続エラー";
    }
  }
}

// ── Setup Guide ───────────────────────────────────────────

document.getElementById("btn-setup-guide")?.addEventListener("click", () => {
  openModal("modal-setup");
});

// Init
checkStatus();
urlInput.focus();
