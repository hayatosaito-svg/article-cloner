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

function loadPreview(preserveScroll = false) {
  const iframe = document.getElementById("preview-iframe");
  if (!iframe || !state.projectId) return;

  let scrollTop = 0;
  if (preserveScroll) {
    try { scrollTop = iframe.contentDocument?.documentElement?.scrollTop || iframe.contentWindow?.scrollY || 0; } catch {}
  }

  const url = window.API.getPreviewUrl(state.projectId);
  iframe.src = url;

  if (preserveScroll && scrollTop > 0) {
    iframe.addEventListener("load", function restoreScroll() {
      iframe.removeEventListener("load", restoreScroll);
      try {
        iframe.contentWindow.scrollTo(0, scrollTop);
        // Also try after a short delay for lazy-loaded content
        setTimeout(() => { try { iframe.contentWindow.scrollTo(0, scrollTop); } catch {} }, 200);
      } catch {}
    });
  }
}

// iframe -> parent message
window.addEventListener("message", (e) => {
  // Origin check - only accept from same origin
  if (e.origin !== window.location.origin) return;

  if (e.data?.type === "blockClick") {
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
  }

  // Inline edit save - update block without iframe reload
  if (e.data?.type === "inlineEditSave") {
    const idx = e.data.blockIndex;
    const newHtml = e.data.html;
    const newText = e.data.text;

    if (state.projectId != null && idx != null) {
      // Find the full block html wrapper by rebuilding from the block's original wrapper
      const block = state.projectData?.blocks?.[idx];
      if (block) {
        // The inline edit changes the inner content; we need to wrap it back in the block's outer tag
        // Since the block.html is the full outer element, we replace its inner content
        const parser = new DOMParser();
        const doc = parser.parseFromString(block.html, "text/html");
        const root = doc.body.firstChild;
        if (root) {
          root.innerHTML = newHtml;
          const updatedHtml = root.outerHTML;
          window.API.updateBlock(state.projectId, idx, {
            html: updatedHtml,
            text: newText,
          }).then(() => {
            // Update local state
            block.html = updatedHtml;
            block.text = newText;
            // Update block list preview text
            const item = document.querySelector(`#block-list [data-index="${idx}"] .block-preview-text`);
            if (item) item.textContent = (newText || "").slice(0, 80);
            // Update panel if open for this block
            if (window._currentPanelData?.blockIndex === idx) {
              const codeArea = document.querySelector("#edit-panel-body .panel-code");
              if (codeArea) codeArea.value = updatedHtml;
              const textArea = document.querySelector("#edit-panel-body .panel-textarea");
              if (textArea) textArea.value = newText || "";
            }
            showToast("インライン編集を保存しました", "success");
          }).catch((err) => {
            showToast(`保存エラー: ${err.message}`, "error");
          });
        }
      }
    }
  }
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

// Modal tab switching
document.querySelectorAll(".modal-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const parent = tab.closest(".modal-body");
    parent.querySelectorAll(".modal-tab").forEach((t) => t.classList.remove("active"));
    parent.querySelectorAll(".modal-tab-content").forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    const target = document.getElementById(tab.dataset.modalTab);
    if (target) target.classList.add("active");

    // Load block text when switching to that tab
    if (tab.dataset.modalTab === "tab-block-text") loadBlockTextList();
  });
});

let _blockTextData = [];

async function loadBlockTextList() {
  if (!state.projectId) return;
  const list = document.getElementById("block-text-list");
  list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px">読み込み中...</div>';
  try {
    const result = await window.API.getTextBlocks(state.projectId);
    _blockTextData = result.textBlocks || [];
    list.innerHTML = "";

    if (_blockTextData.length === 0) {
      list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px">テキストブロックがありません</div>';
      return;
    }

    // Header row
    const header = document.createElement("div");
    header.className = "block-text-row";
    header.style.cssText = "border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:4px";
    header.innerHTML = '<div class="block-text-index">#</div><div style="font-size:11px;font-weight:600;color:var(--text-muted)">元テキスト</div><div style="font-size:11px;font-weight:600;color:var(--text-muted)">新テキスト</div>';
    list.appendChild(header);

    _blockTextData.forEach((block) => {
      const row = document.createElement("div");
      row.className = "block-text-row";
      row.dataset.blockIndex = block.index;

      const idx = document.createElement("div");
      idx.className = "block-text-index";
      idx.textContent = block.index;
      row.appendChild(idx);

      const orig = document.createElement("textarea");
      orig.className = "block-text-original";
      orig.value = block.text;
      orig.readOnly = true;
      row.appendChild(orig);

      const newText = document.createElement("textarea");
      newText.className = "block-text-new";
      newText.value = block.text;
      newText.placeholder = "新しいテキストを入力...";
      row.appendChild(newText);

      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = `<div style="color:var(--red);font-size:12px;padding:8px">エラー: ${escapeHtml(err.message)}</div>`;
  }
}

function openTextModifyModal() {
  openModal("modal-text-modify");

  // Reset to first tab
  const tabs = document.querySelectorAll("#modal-text-modify .modal-tab");
  const contents = document.querySelectorAll("#modal-text-modify .modal-tab-content");
  tabs.forEach((t) => t.classList.remove("active"));
  contents.forEach((c) => c.classList.remove("active"));
  tabs[0]?.classList.add("active");
  contents[0]?.classList.add("active");

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

// Find and Replace functionality
document.getElementById("btn-find-count")?.addEventListener("click", () => {
  const findText = document.getElementById("find-input").value;
  if (!findText) { document.getElementById("find-count").textContent = "0件"; return; }

  let count = 0;
  if (state.projectData?.blocks) {
    state.projectData.blocks.forEach((b) => {
      if (b.text) {
        const matches = b.text.split(findText).length - 1;
        count += matches;
      }
    });
  }
  document.getElementById("find-count").textContent = `${count}件`;

  // Show preview of matches
  const preview = document.getElementById("find-replace-preview");
  preview.innerHTML = "";
  if (count > 0) {
    const replaceText = document.getElementById("replace-input").value;
    const label = document.createElement("label");
    label.className = "form-label";
    label.textContent = `マッチ箇所プレビュー（${count}件）`;
    preview.appendChild(label);

    state.projectData.blocks.forEach((b) => {
      if (b.text && b.text.includes(findText)) {
        const div = document.createElement("div");
        div.style.cssText = "font-size:12px;padding:6px 8px;margin:4px 0;background:var(--bg-tertiary);border-radius:4px;color:var(--text-secondary);line-height:1.5";
        const highlighted = escapeHtml(b.text.slice(0, 200)).split(escapeHtml(findText)).join(
          `<mark style="background:rgba(251,191,36,0.3);color:#fbbf24;padding:0 2px;border-radius:2px">${escapeHtml(findText)}</mark>`
        );
        div.innerHTML = `<span style="color:var(--text-muted);font-size:10px">[${b.index}]</span> ${highlighted}`;
        preview.appendChild(div);
      }
    });
  }
});

document.getElementById("btn-find-replace-all")?.addEventListener("click", async () => {
  const findText = document.getElementById("find-input").value;
  const replaceText = document.getElementById("replace-input").value;
  if (!findText) { showToast("検索テキストを入力してください", "error"); return; }

  try {
    const result = await window.API.textModify(state.projectId, {
      directReplacements: { [findText]: replaceText },
    });
    if (result.ok) {
      showToast(`置換完了 (${result.blockCount} ブロック)`, "success");
      closeModal("modal-text-modify");
      await loadEditor();
    }
  } catch (err) {
    showToast(`エラー: ${err.message}`, "error");
  }
});

document.getElementById("btn-apply-text-modify").addEventListener("click", async () => {
  if (!state.projectId) return;

  // Check which tab is active
  const activeTab = document.querySelector("#modal-text-modify .modal-tab.active");
  const tabId = activeTab?.dataset.modalTab;

  if (tabId === "tab-block-text") {
    // Block-by-block replacement
    const rows = document.querySelectorAll("#block-text-list .block-text-row[data-block-index]");
    const blockReplacements = [];
    rows.forEach((row) => {
      const idx = parseInt(row.dataset.blockIndex, 10);
      const origText = row.querySelector(".block-text-original")?.value || "";
      const newText = row.querySelector(".block-text-new")?.value || "";
      if (newText !== origText) {
        blockReplacements.push({ index: idx, newText });
      }
    });

    if (blockReplacements.length === 0) {
      showToast("変更されたブロックがありません", "info");
      return;
    }

    try {
      const result = await window.API.textModify(state.projectId, { blockReplacements });
      if (result.ok) {
        showToast(`${blockReplacements.length}ブロックを更新しました`, "success");
        closeModal("modal-text-modify");
        await loadEditor();
      }
    } catch (err) {
      showToast(`エラー: ${err.message}`, "error");
    }
    return;
  }

  if (tabId === "tab-find-replace") {
    // Trigger find-replace-all
    document.getElementById("btn-find-replace-all")?.click();
    return;
  }

  // Default: bulk replacement (tab-bulk-replace)
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

// ── API Key Setup ────────────────────────────────────────

async function checkStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    const statusEl = document.getElementById("api-key-status");
    const card = document.getElementById("api-key-card");
    const body = document.getElementById("api-key-body");
    const hint = document.getElementById("api-key-hint");

    if (data.gemini) {
      statusEl.classList.add("connected");
      statusEl.classList.remove("disconnected");
      statusEl.querySelector(".api-key-status-text").textContent = `接続済 (${data.geminiKeyCount}キー)`;
      card.classList.add("connected");
      body.classList.add("collapsed");
      hint.innerHTML = '<span style="color:var(--green)">AI機能が使えます。</span> キーを追加したい場合は下の入力欄を使ってください。';
    } else {
      statusEl.classList.add("disconnected");
      statusEl.classList.remove("connected");
      statusEl.querySelector(".api-key-status-text").textContent = "未設定";
      card.classList.remove("connected");
      body.classList.remove("collapsed");
      hint.innerHTML = '';
    }
  } catch {
    const statusEl = document.getElementById("api-key-status");
    if (statusEl) {
      statusEl.classList.add("disconnected");
      statusEl.querySelector(".api-key-status-text").textContent = "接続エラー";
    }
  }
}

// Toggle collapsed body on header click
document.getElementById("api-key-header")?.addEventListener("click", () => {
  document.getElementById("api-key-body")?.classList.toggle("collapsed");
});

// Save API key
document.getElementById("btn-save-key")?.addEventListener("click", async () => {
  const input = document.getElementById("api-key-input");
  const btn = document.getElementById("btn-save-key");
  const hint = document.getElementById("api-key-hint");
  const key = input.value.trim();

  if (!key) {
    hint.innerHTML = '<span style="color:var(--red)">APIキーを入力してください</span>';
    return;
  }

  btn.disabled = true;
  btn.textContent = "確認中...";
  hint.innerHTML = '<span style="color:var(--text-muted)">APIキーを検証しています...</span>';

  try {
    const res = await fetch("/api/set-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const data = await res.json();

    if (res.ok && data.ok) {
      hint.innerHTML = '<span style="color:var(--green)">APIキーを保存しました! AI機能が使えます。</span>';
      input.value = "";
      showToast("Gemini APIキーを設定しました", "success");
      await checkStatus();
    } else {
      hint.innerHTML = `<span style="color:var(--red)">${escapeHtml(data.error || "保存に失敗しました")}</span>`;
    }
  } catch (err) {
    hint.innerHTML = `<span style="color:var(--red)">エラー: ${escapeHtml(err.message)}</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "保存";
  }
});

// Enter key to save
document.getElementById("api-key-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("btn-save-key")?.click();
});

// Init
checkStatus();
urlInput.focus();
