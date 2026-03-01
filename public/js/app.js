/**
 * app.js - SPA Router + State Management + Screen Transitions
 */

const state = {
  projectId: null,
  projectData: null,
  currentScreen: "landing",
  sseConnection: null,
};

// ── Undo/Redo History ─────────────────────────────────────

const history = { entries: [], currentIndex: -1, maxEntries: 100 };

async function pushHistory(action, description) {
  if (!state.projectId) return;
  try {
    const snapshot = await window.API.getSnapshot(state.projectId);
    // Trim any redo entries after current
    if (history.currentIndex < history.entries.length - 1) {
      history.entries = history.entries.slice(0, history.currentIndex + 1);
    }
    history.entries.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      action,
      description,
      snapshot,
    });
    // Enforce max entries
    if (history.entries.length > history.maxEntries) {
      history.entries.shift();
    }
    history.currentIndex = history.entries.length - 1;
    updateUndoRedoButtons();
  } catch (err) {
    console.warn("pushHistory failed:", err);
  }
}

async function undo() {
  if (history.currentIndex <= 0) return;
  history.currentIndex--;
  const entry = history.entries[history.currentIndex];
  try {
    await window.API.restore(state.projectId, entry.snapshot);
    await loadEditor();
    showToast(`元に戻しました: ${entry.description}`, "info");
  } catch (err) {
    showToast(`Undoエラー: ${err.message}`, "error");
    history.currentIndex++;
  }
  updateUndoRedoButtons();
}

async function redo() {
  if (history.currentIndex >= history.entries.length - 1) return;
  history.currentIndex++;
  const entry = history.entries[history.currentIndex];
  try {
    await window.API.restore(state.projectId, entry.snapshot);
    await loadEditor();
    showToast(`やり直しました: ${entry.description}`, "info");
  } catch (err) {
    showToast(`Redoエラー: ${err.message}`, "error");
    history.currentIndex--;
  }
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  const btnUndo = document.getElementById("btn-undo");
  const btnRedo = document.getElementById("btn-redo");
  if (btnUndo) btnUndo.disabled = history.currentIndex <= 0;
  if (btnRedo) btnRedo.disabled = history.currentIndex >= history.entries.length - 1;
}

window.pushHistory = pushHistory;
window.history_ = history;

// ── History Sidebar ───────────────────────────────────────

function openHistorySidebar() {
  // Close other sidebars
  document.getElementById("edit-panel")?.classList.remove("open");
  document.getElementById("widget-sidebar")?.classList.remove("open");

  renderHistoryList();
  document.getElementById("history-sidebar")?.classList.add("open");
}

function renderHistoryList(filter = "all") {
  const list = document.getElementById("history-list");
  if (!list) return;
  list.innerHTML = "";

  if (history.entries.length === 0) {
    list.innerHTML = '<div class="history-empty">履歴がありません</div>';
    return;
  }

  const filtered = filter === "all"
    ? history.entries
    : history.entries.filter((e) => {
        if (filter === "image") return e.action.includes("image");
        if (filter === "insert") return e.action.includes("insert");
        if (filter === "text_modify") return e.action.includes("text");
        return e.action === filter;
      });

  if (filtered.length === 0) {
    list.innerHTML = '<div class="history-empty">該当する履歴がありません</div>';
    return;
  }

  // Reverse to show newest first
  [...filtered].reverse().forEach((entry) => {
    const realIdx = history.entries.indexOf(entry);
    const item = document.createElement("div");
    item.className = "history-item" + (realIdx === history.currentIndex ? " current" : "");

    const time = new Date(entry.timestamp).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    const actionLabel = {
      initial: "初期",
      edit_block: "編集",
      insert_block: "挿入",
      insert_widget: "Widget",
      text_modify: "差替",
      text_replace: "検索置換",
      inline_edit: "インライン",
      image_apply: "AI画像",
      image_upload: "画像UP",
      ai_rewrite: "AI書換",
      manual_save: "手動保存",
      save_point: "セーブ",
      tag_change: "タグ",
      exit_popup_change: "離脱POP",
    }[entry.action] || entry.action;

    item.innerHTML = `
      <div class="history-item-header">
        <span class="history-time">${time}</span>
        <span class="history-action-badge">${escapeHtml(actionLabel)}</span>
      </div>
      <div class="history-item-desc">${escapeHtml(entry.description)}</div>
      ${realIdx !== history.currentIndex ? '<button class="history-restore-btn">この状態に戻す</button>' : '<span class="history-current-label">現在の状態</span>'}
    `;

    const restoreBtn = item.querySelector(".history-restore-btn");
    if (restoreBtn) {
      restoreBtn.addEventListener("click", async () => {
        try {
          await window.API.restore(state.projectId, entry.snapshot);
          history.currentIndex = realIdx;
          await loadEditor();
          updateUndoRedoButtons();
          renderHistoryList(document.getElementById("history-filter")?.value || "all");
          showToast(`「${entry.description}」の状態に戻しました`, "info");
        } catch (err) {
          showToast(`復元エラー: ${err.message}`, "error");
        }
      });
    }

    list.appendChild(item);
  });
}

document.getElementById("history-sidebar-close")?.addEventListener("click", () => {
  document.getElementById("history-sidebar")?.classList.remove("open");
});

document.getElementById("history-filter")?.addEventListener("change", (e) => {
  renderHistoryList(e.target.value);
});

// ── Screen Navigation ──────────────────────────────────────

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  const screen = document.getElementById(`screen-${name}`);
  if (screen) {
    screen.classList.add("active");
    state.currentScreen = name;
  }
  // URLハッシュを更新（editor画面ではprojectIdを付与）
  if (name === "editor" && state.projectId) {
    history.replaceState(null, "", `#editor/${state.projectId}`);
  } else if (name === "landing") {
    history.replaceState(null, "", window.location.pathname);
  }
}

// ── ハッシュルーティング: リロード時にエディター復帰 ──
async function handleHashRoute() {
  const hash = window.location.hash;
  const match = hash.match(/^#editor\/(.+)$/);
  if (match) {
    const projectId = match[1];
    try {
      state.projectId = projectId;
      await loadEditor();
      return true;
    } catch (err) {
      console.warn("プロジェクト復帰失敗:", err.message);
      state.projectId = null;
      history.replaceState(null, "", window.location.pathname);
    }
  }
  return false;
}

// ── 保存済みプロジェクト一覧表示 ──
async function loadProjectList() {
  try {
    const data = await window.API.listProjects();
    const list = document.getElementById("saved-project-list");
    if (!list || !data.projects?.length) return;
    list.innerHTML = "";
    list.style.display = "";
    data.projects.filter(p => p.status === "ready" || p.status === "done").forEach(p => {
      const item = document.createElement("div");
      item.className = "saved-project-item";
      const ago = Math.floor((Date.now() - p.createdAt) / 60000);
      const timeStr = ago < 60 ? `${ago}分前` : ago < 1440 ? `${Math.floor(ago / 60)}時間前` : `${Math.floor(ago / 1440)}日前`;
      item.innerHTML = `<div class="saved-project-name">${p.slug}</div><div class="saved-project-meta">${p.blockCount}ブロック · ${timeStr}</div>`;
      item.addEventListener("click", async () => {
        state.projectId = p.id;
        await loadEditor();
      });
      list.appendChild(item);
    });
  } catch {}
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
  addLogEntry("プロジェクト作成中...");

  try {
    const result = await window.API.createProject(url);
    state.projectId = result.id;
    addLogEntry("SSE接続中...");
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

let _editorLoaded = false;

async function loadEditor(scrollToBlockIndex) {
  try {
    state.projectData = await window.API.getProject(state.projectId);
    showScreen("editor");
    document.getElementById("toolbar-title").textContent = state.projectData.slug;
    document.getElementById("toolbar-block-count").textContent = `${state.projectData.blockCount} ブロック`;
    renderBlockList(state.projectData.blocks);
    // Preserve scroll position after initial load
    loadPreview(_editorLoaded);
    _editorLoaded = true;
    document.getElementById("btn-export").disabled = state.projectData.status !== "done";
    // Push initial history entry (only once)
    if (history.entries.length === 0) {
      pushHistory("initial", "初期状態");
      // Load user widget templates
      if (window.loadUserWidgetTemplates) window.loadUserWidgetTemplates();
    }
    // Scroll to specific block after insert
    if (scrollToBlockIndex != null) {
      setTimeout(() => {
        const iframe = document.getElementById("preview-iframe");
        iframe?.contentWindow?.postMessage({ type: "scrollToBlock", blockIndex: scrollToBlockIndex }, "*");
      }, 500);
    }
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
        // Retry with delays for lazy-loaded content
        setTimeout(() => { try { iframe.contentWindow.scrollTo(0, scrollTop); } catch {} }, 100);
        setTimeout(() => { try { iframe.contentWindow.scrollTo(0, scrollTop); } catch {} }, 300);
        setTimeout(() => { try { iframe.contentWindow.scrollTo(0, scrollTop); } catch {} }, 600);
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
    // If widget block and context menu click coordinates available, show context menu
    if (block?.type === "widget" && e.data.blockType === "widget" && e.data.clientX != null) {
      const iframeEl = document.getElementById("preview-iframe");
      const iframeRect = iframeEl?.getBoundingClientRect() || { left: 0, top: 0 };
      const menuX = e.data.clientX + iframeRect.left;
      const menuY = e.data.clientY + iframeRect.top;
      if (window.showWidgetContextMenu) {
        window.showWidgetContextMenu(idx, menuX, menuY);
      }
    }
    if (block) window.openEditPanel(state.projectId, idx, block.type);
  }

  // Color picker request from iframe inline toolbar
  if (e.data?.type === "openColorPicker" && window.ColorPicker) {
    const iframeEl = document.getElementById("preview-iframe");
    const iframeRect = iframeEl?.getBoundingClientRect() || { left: 0, top: 0 };
    const ar = e.data.anchorRect || {};
    // Calculate position in parent viewport coordinates
    const anchorTop = (ar.top || 0) + iframeRect.top;
    const anchorLeft = (ar.left || 0) + iframeRect.left;
    const anchorBottom = (ar.bottom || 0) + iframeRect.top;
    // Create a virtual anchor element for positioning
    const virtualAnchor = document.createElement("div");
    virtualAnchor.style.cssText = `position:fixed;top:${anchorTop}px;left:${anchorLeft}px;width:${ar.width||28}px;height:${ar.height||28}px;pointer-events:none`;
    document.body.appendChild(virtualAnchor);
    const action = e.data.action;
    window.ColorPicker.open({
      initialColor: e.data.currentColor || "#ffffff",
      mode: action === "backColor" ? "bg-color" : "text-color",
      anchorEl: virtualAnchor,
      onApply: (color) => {
        virtualAnchor.remove();
        iframeEl?.contentWindow?.postMessage({ type: "applyColor", action, color }, "*");
      },
      onCancel: () => { virtualAnchor.remove(); },
    });
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
            pushHistory("inline_edit", `ブロック ${idx} インライン編集`);
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

// Undo / Redo buttons
document.getElementById("btn-undo")?.addEventListener("click", undo);
document.getElementById("btn-redo")?.addEventListener("click", redo);

// Keyboard shortcuts: Ctrl+Z = undo, Ctrl+Y / Cmd+Shift+Z = redo
document.addEventListener("keydown", (e) => {
  if (state.currentScreen !== "editor") return;
  // Avoid when typing in input/textarea
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;

  if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
    e.preventDefault();
    undo();
  }
  if ((e.ctrlKey && e.key === "y") || (e.metaKey && e.shiftKey && e.key === "z")) {
    e.preventDefault();
    redo();
  }
});

// Refresh preview (+ save point in history)
document.getElementById("btn-refresh").addEventListener("click", () => {
  pushHistory("save_point", "手動セーブポイント");
  loadPreview(true);
  showToast("プレビューを更新しました", "info");
});

// Tag settings
document.getElementById("btn-tag-settings")?.addEventListener("click", () => {
  window.openTagSettingsModal?.();
});

// Exit popup
document.getElementById("btn-exit-popup")?.addEventListener("click", () => {
  window.openExitPopupModal?.();
});

// History sidebar
document.getElementById("btn-history")?.addEventListener("click", openHistorySidebar);

// Viewport toggle
const viewportSizes = [412, 768, -1]; // -1 = 100%
let viewportIdx = 0;
document.getElementById("btn-viewport").addEventListener("click", () => {
  viewportIdx = (viewportIdx + 1) % viewportSizes.length;
  const size = viewportSizes[viewportIdx];
  const iframe = document.getElementById("preview-iframe");
  const label = document.querySelector("#btn-viewport span");
  const vpLabel = document.querySelector(".preview-viewport");
  if (size === -1) {
    iframe.style.width = "100%";
    label.textContent = "100%";
    if (vpLabel) vpLabel.textContent = "100%";
  } else {
    iframe.style.width = size + "px";
    label.textContent = size + "px";
    if (vpLabel) vpLabel.textContent = size + "px";
  }
});

// +Block modal
document.getElementById("btn-add-block").addEventListener("click", () => {
  openAddBlockModal();
});

function openAddBlockModal() {
  const select = document.getElementById("add-block-position");
  select.innerHTML = '<option value="end">末尾に追加</option>';
  if (state.projectData?.blocks) {
    state.projectData.blocks.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.index;
      opt.textContent = `ブロック ${b.index} (${b.type}) の後`;
      select.appendChild(opt);
    });
  }
  document.getElementById("add-block-html").value = "";
  openModal("modal-add-block");
}

document.getElementById("btn-insert-block")?.addEventListener("click", async () => {
  const html = document.getElementById("add-block-html").value.trim();
  if (!html) {
    showToast("HTMLを入力してください", "error");
    return;
  }
  const posVal = document.getElementById("add-block-position").value;
  const afterIndex = posVal === "end" ? null : parseInt(posVal, 10);
  try {
    const result = await window.API.insertBlock(state.projectId, {
      afterIndex,
      html,
      type: "widget",
    });
    if (result.ok) {
      showToast(`ブロック ${result.insertedIndex} に挿入しました`, "success");
      closeModal("modal-add-block");
      await loadEditor(result.insertedIndex);
      pushHistory("insert_block", `ブロック ${result.insertedIndex} を挿入`);
    }
  } catch (err) {
    showToast(`エラー: ${err.message}`, "error");
  }
});

// ── 画像アップロードモーダル ──────────────────────────────
let _uploadedImageData = null; // { imageData, fileName, imageUrl, localPath }

document.getElementById("btn-upload-image")?.addEventListener("click", () => {
  openUploadImageModal();
});

function openUploadImageModal() {
  _uploadedImageData = null;
  const zone = document.getElementById("upload-modal-zone");
  const preview = document.getElementById("upload-modal-preview");
  const actions = document.getElementById("upload-modal-actions");
  const results = document.getElementById("upload-ai-results");
  const fileInput = document.getElementById("upload-modal-file");
  zone.classList.remove("has-file");
  zone.style.display = "";
  preview.style.display = "none";
  actions.style.display = "none";
  results.innerHTML = "";
  fileInput.value = "";

  // 挿入位置を更新
  const select = document.getElementById("upload-insert-position");
  select.innerHTML = '<option value="end">末尾に追加</option>';
  if (state.projectData?.blocks) {
    state.projectData.blocks.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.index;
      opt.textContent = `ブロック ${b.index} (${b.type}) の後`;
      select.appendChild(opt);
    });
  }

  // リセット AI options
  document.querySelectorAll("[data-ref-mode]").forEach((b, i) => {
    b.className = i === 0 ? "panel-btn primary" : "panel-btn";
  });
  document.querySelectorAll("[data-ref-style]").forEach((b, i) => {
    b.className = i === 0 ? "oneclick-radio active" : "oneclick-radio";
  });
  document.getElementById("upload-ai-prompt").value = "";

  openModal("modal-upload-image");
}

// ドラッグ＆ドロップ / クリック
const uploadZoneEl = document.getElementById("upload-modal-zone");
const uploadFileEl = document.getElementById("upload-modal-file");

uploadZoneEl?.addEventListener("click", () => uploadFileEl?.click());
uploadZoneEl?.addEventListener("dragover", (e) => { e.preventDefault(); uploadZoneEl.classList.add("dragover"); });
uploadZoneEl?.addEventListener("dragleave", () => uploadZoneEl.classList.remove("dragover"));
uploadZoneEl?.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZoneEl.classList.remove("dragover");
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith("image/")) handleUploadModalFile(file);
});
uploadFileEl?.addEventListener("change", () => {
  const file = uploadFileEl?.files?.[0];
  if (file) handleUploadModalFile(file);
});

async function handleUploadModalFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    const imageData = reader.result;

    // プレビュー表示
    const zone = document.getElementById("upload-modal-zone");
    const preview = document.getElementById("upload-modal-preview");
    const actions = document.getElementById("upload-modal-actions");
    const img = document.getElementById("upload-modal-img");
    const info = document.getElementById("upload-modal-info");

    zone.style.display = "none";
    preview.style.display = "block";
    actions.style.display = "flex";
    img.src = imageData;
    info.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;

    // サーバーにアップロード
    try {
      const result = await window.API.uploadFree(state.projectId, { imageData, fileName: file.name });
      if (result.ok) {
        _uploadedImageData = { imageData, fileName: file.name, imageUrl: result.imageUrl, localPath: result.localPath };
        showToast("画像をアップロードしました", "success");
      }
    } catch (err) {
      showToast(`アップロードエラー: ${err.message}`, "error");
    }
  };
  reader.readAsDataURL(file);
}

// 新規画像ブロックとして挿入
document.getElementById("btn-upload-insert")?.addEventListener("click", async () => {
  if (!_uploadedImageData || !state.projectId) return;
  const btn = document.getElementById("btn-upload-insert");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 挿入中...';
  try {
    const posVal = document.getElementById("upload-insert-position").value;
    const afterIndex = posVal === "end" ? null : parseInt(posVal, 10);
    const imgHtml = `<div style="text-align:center"><picture><img src="${_uploadedImageData.imageUrl}" style="max-width:100%;height:auto" alt="uploaded image"></picture></div>`;
    const result = await window.API.insertBlock(state.projectId, {
      afterIndex,
      html: imgHtml,
      type: "image",
    });
    if (result.ok) {
      showToast(`画像ブロック ${result.insertedIndex} に挿入しました`, "success");
      closeModal("modal-upload-image");
      await loadEditor(result.insertedIndex);
      pushHistory("image_insert", `画像ブロック ${result.insertedIndex} を挿入`);
    }
  } catch (err) {
    showToast(`エラー: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> 新規画像ブロックとして挿入';
  }
});

// AI生成モード選択
document.querySelectorAll("[data-ref-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-ref-mode]").forEach((b) => b.className = "panel-btn");
    btn.className = "panel-btn primary";
  });
});
document.querySelectorAll("[data-ref-style]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-ref-style]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

// 参考画像からAI生成
document.getElementById("btn-upload-ai-gen")?.addEventListener("click", async () => {
  if (!_uploadedImageData?.localPath || !state.projectId) {
    showToast("先に画像をアップロードしてください", "error");
    return;
  }
  const btn = document.getElementById("btn-upload-ai-gen");
  const resultsEl = document.getElementById("upload-ai-results");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> AI生成中...（約30秒）';
  resultsEl.innerHTML = "";

  const genMode = document.querySelector("[data-ref-mode].primary")?.dataset.refMode || "similar";
  const style = document.querySelector("[data-ref-style].active")?.dataset.refStyle || "photo";
  const customPrompt = document.getElementById("upload-ai-prompt")?.value.trim() || "";

  try {
    const result = await window.API.aiFromReference(state.projectId, {
      localPath: _uploadedImageData.localPath,
      style,
      genMode,
      customPrompt,
      designRequirements: window._designRequirements || "",
    });
    if (result.ok && result.images) {
      showToast(`${result.images.length}パターン生成しました`, "success");
      result.images.forEach((imgUrl, i) => {
        const card = document.createElement("div");
        card.className = "oneclick-variant-card";
        const varImg = document.createElement("img");
        varImg.src = imgUrl;
        varImg.alt = `生成パターン ${i + 1}`;
        card.appendChild(varImg);

        // ブロック挿入ボタン
        const insertBtn = document.createElement("button");
        insertBtn.className = "oneclick-apply-btn";
        insertBtn.textContent = "ブロック挿入";
        insertBtn.addEventListener("click", async () => {
          insertBtn.disabled = true;
          insertBtn.innerHTML = '<span class="spinner"></span>';
          try {
            const posVal = document.getElementById("upload-insert-position").value;
            const afterIndex = posVal === "end" ? null : parseInt(posVal, 10);
            const imgHtml = `<div style="text-align:center"><picture><img src="${imgUrl}" style="max-width:100%;height:auto" alt="AI generated"></picture></div>`;
            const r = await window.API.insertBlock(state.projectId, { afterIndex, html: imgHtml, type: "image" });
            if (r.ok) {
              showToast(`画像ブロック ${r.insertedIndex} に挿入`, "success");
              closeModal("modal-upload-image");
              await loadEditor(r.insertedIndex);
              pushHistory("image_ai_insert", `AI画像ブロック ${r.insertedIndex} を挿入`);
            }
          } catch (err) {
            showToast(`エラー: ${err.message}`, "error");
          } finally {
            insertBtn.disabled = false;
            insertBtn.textContent = "ブロック挿入";
          }
        });
        card.appendChild(insertBtn);
        resultsEl.appendChild(card);
      });
    }
  } catch (err) {
    showToast(`AI生成エラー: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg> 参考画像からAI生成';
  }
});

// Widget sidebar
document.getElementById("btn-open-widgets")?.addEventListener("click", () => {
  openWidgetSidebar();
});

document.getElementById("widget-sidebar-close")?.addEventListener("click", () => {
  document.getElementById("widget-sidebar")?.classList.remove("open");
});

function openWidgetSidebar() {
  // Close edit panel if open (but not widget sidebar itself)
  document.getElementById("edit-panel")?.classList.remove("open");

  // Populate position select
  const select = document.getElementById("widget-insert-position");
  select.innerHTML = '<option value="end">末尾に追加</option>';
  if (state.projectData?.blocks) {
    state.projectData.blocks.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.index;
      opt.textContent = `ブロック ${b.index} (${b.type}) の後`;
      select.appendChild(opt);
    });
  }

  // Populate widget list
  const list = document.getElementById("widget-list");
  list.innerHTML = "";
  const templates = window.getAllWidgetTemplates ? window.getAllWidgetTemplates() : (window.WIDGET_TEMPLATES || []);
  templates.forEach((tmpl) => {
    const card = document.createElement("div");
    card.className = "widget-card";

    const icon = document.createElement("div");
    icon.className = "widget-card-icon";
    icon.textContent = tmpl.icon;

    const info = document.createElement("div");
    info.className = "widget-card-info";
    info.innerHTML = `
      <div class="widget-card-name">${escapeHtml(tmpl.name)}</div>
      <div class="widget-card-desc">${escapeHtml(tmpl.description)}</div>
      <span class="widget-card-category">${escapeHtml(tmpl.category)}</span>`;

    const btn = document.createElement("button");
    btn.className = "widget-card-btn";
    btn.textContent = "挿入";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "挿入中...";
      try {
        const generated = tmpl.generate();
        const posVal = document.getElementById("widget-insert-position").value;
        const afterIndex = posVal === "end" ? null : parseInt(posVal, 10);
        const result = await window.API.insertBlock(state.projectId, {
          afterIndex,
          html: generated.html,
          type: generated.type,
          widgetType: generated.widgetType,
        });
        if (result.ok) {
          showToast(`${tmpl.name} を挿入しました`, "success");
          await loadEditor(result.insertedIndex);
          pushHistory("insert_widget", `${tmpl.name} を挿入`);
        }
      } catch (err) {
        showToast(`エラー: ${err.message}`, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "挿入";
      }
    });

    card.appendChild(icon);
    card.appendChild(info);
    card.appendChild(btn);
    list.appendChild(card);
  });

  document.getElementById("widget-sidebar")?.classList.add("open");
}

// Note: modal close listeners for modal-add-block are handled by the generic data-close-modal handler above

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
      pushHistory("text_replace", "検索と置換");
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
        pushHistory("text_modify", `${blockReplacements.length}ブロック テキスト編集`);
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
      pushHistory("text_modify", "一括テキスト差し替え");
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

// ── Cloudflare Pages 公開 ────────────────────────────────

document.getElementById("btn-publish").addEventListener("click", async () => {
  if (!state.projectId) return;

  // Check if Cloudflare is configured
  try {
    const cfStatus = await window.API.getCloudflareStatus();
    if (!cfStatus.configured) {
      openModal("modal-cloudflare");
      return;
    }
  } catch {
    openModal("modal-cloudflare");
    return;
  }

  // Publish
  const btn = document.getElementById("btn-publish");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 公開中...';

  try {
    // Build first if needed
    if (state.projectData?.status !== "done") {
      await window.API.build(state.projectId);
    }

    const result = await window.API.publish(state.projectId);
    if (result.ok) {
      showToast("公開しました!", "success");
      // Show result modal
      const body = document.getElementById("publish-result-body");
      body.innerHTML = `
        <div class="panel-section">
          <div class="panel-section-title">公開URL</div>
          <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:12px;word-break:break-all;font-family:monospace;font-size:13px">
            <a href="${escapeHtml(result.url)}" target="_blank" rel="noopener" style="color:var(--accent)">${escapeHtml(result.url)}</a>
          </div>
        </div>
        <div class="panel-section">
          <div class="panel-section-title">Pages.dev URL（永続）</div>
          <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:12px;word-break:break-all;font-family:monospace;font-size:13px">
            <a href="${escapeHtml(result.pagesDevUrl)}" target="_blank" rel="noopener" style="color:var(--accent)">${escapeHtml(result.pagesDevUrl)}</a>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px">
            Cloudflareダッシュボードからカスタムドメインを紐付けられます
          </div>
        </div>`;
      document.getElementById("btn-open-published").href = result.pagesDevUrl;
      openModal("modal-publish-result");
    }
  } catch (err) {
    showToast(`公開エラー: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1v6m0 0l2.5-2.5M8 7L5.5 4.5M2 10v3h12v-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>公開</span>';
  }
});

// Save Cloudflare config
document.getElementById("btn-save-cloudflare").addEventListener("click", async () => {
  const accountId = document.getElementById("cf-account-id").value.trim();
  const apiToken = document.getElementById("cf-api-token").value.trim();

  if (!accountId || !apiToken) {
    showToast("両方の項目を入力してください", "error");
    return;
  }

  const btn = document.getElementById("btn-save-cloudflare");
  btn.disabled = true;
  btn.textContent = "検証中...";

  try {
    const result = await window.API.setCloudflareConfig({ accountId, apiToken });
    if (result.ok) {
      showToast("Cloudflare設定を保存しました", "success");
      closeModal("modal-cloudflare");
      // Trigger publish now
      document.getElementById("btn-publish").click();
    }
  } catch (err) {
    showToast(`設定エラー: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "保存";
  }
});

// ── Helpers ────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function closeEditPanel() {
  document.getElementById("edit-panel")?.classList.remove("open");
  document.getElementById("widget-sidebar")?.classList.remove("open");
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

// ── Sidebar Event Handlers ─────────────────────────────────

document.getElementById("sb-deploy")?.addEventListener("click", () => {
  document.getElementById("btn-publish")?.click();
});

document.getElementById("sb-history")?.addEventListener("click", () => {
  openHistorySidebar();
});

document.getElementById("sb-fav-widgets")?.addEventListener("click", () => {
  openWidgetSidebar();
});

document.getElementById("sb-link-manage")?.addEventListener("click", () => {
  openTextModifyModal();
});

document.getElementById("sb-tag-settings")?.addEventListener("click", () => {
  if (window.openTagSettingsModal) window.openTagSettingsModal();
});

document.getElementById("sb-exit-popup")?.addEventListener("click", () => {
  if (window.openExitPopupModal) window.openExitPopupModal();
});

document.getElementById("sb-undo")?.addEventListener("click", () => {
  undo();
});

document.getElementById("sb-redo")?.addEventListener("click", () => {
  redo();
});

document.getElementById("sb-settings")?.addEventListener("click", () => {
  openModal("modal-cloudflare");
});

// Init
checkStatus();

// ハッシュルーティング: エディター復帰 or ランディング
(async () => {
  const restored = await handleHashRoute();
  if (!restored) {
    urlInput.focus();
    loadProjectList();
  }
})();

// ブラウザバック/フォワード対応
window.addEventListener("hashchange", () => {
  handleHashRoute();
});
