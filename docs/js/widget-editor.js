/**
 * widget-editor.js - Widget context menu, 3-pane HTML editor, quick edit, widget registration
 */

// ── State ─────────────────────────────────────────────────
let _ctxBlockIndex = null;
let _weBlockIndex = null;
let _weHtmlEditor = null;
let _weCssEditor = null;
let _weSplitMode = "split"; // "split" | "preview-only" | "code-only"
let _qeBlockIndex = null;
let _qeOriginalHtml = null;

// ── Context Menu ──────────────────────────────────────────

function showWidgetContextMenu(blockIndex, clientX, clientY) {
  _ctxBlockIndex = blockIndex;
  const menu = document.getElementById("widget-context-menu");
  if (!menu) return;

  // Position menu
  menu.style.left = Math.min(clientX, window.innerWidth - 260) + "px";
  menu.style.top = Math.min(clientY, window.innerHeight - 240) + "px";
  menu.classList.add("visible");

  // Close on outside click
  const closeHandler = (e) => {
    if (!menu.contains(e.target)) {
      menu.classList.remove("visible");
      document.removeEventListener("click", closeHandler);
    }
  };
  setTimeout(() => document.addEventListener("click", closeHandler), 10);
}

window.showWidgetContextMenu = showWidgetContextMenu;

// Context menu action handlers
document.getElementById("widget-context-menu")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".ctx-item");
  if (!btn) return;
  const action = btn.dataset.action;
  const menu = document.getElementById("widget-context-menu");
  menu.classList.remove("visible");

  switch (action) {
    case "openHtmlEditor":
      openWidgetHtmlEditor(_ctxBlockIndex);
      break;
    case "openQuickEdit":
      openQuickEdit(_ctxBlockIndex);
      break;
    case "duplicateBelow":
      duplicateWidgetBelow(_ctxBlockIndex);
      break;
    case "copyToClipboard":
      copyWidgetToClipboard(_ctxBlockIndex);
      break;
    case "deleteWidget":
      deleteWidgetBlock(_ctxBlockIndex);
      break;
  }
});

// ── Context Menu Actions ──────────────────────────────────

async function duplicateWidgetBelow(blockIndex) {
  const block = window.state.projectData?.blocks?.[blockIndex];
  if (!block) return;
  try {
    const result = await window.API.insertBlock(window.state.projectId, {
      afterIndex: blockIndex,
      html: block.html,
      type: "widget",
    });
    if (result.ok) {
      window.showToast("Widgetを複製しました", "success");
      await window.loadEditor(blockIndex + 1);
      window.pushHistory?.("insert_block", `ブロック ${blockIndex} を複製`);
    }
  } catch (err) {
    window.showToast(`複製エラー: ${err.message}`, "error");
  }
}

async function copyWidgetToClipboard(blockIndex) {
  const block = window.state.projectData?.blocks?.[blockIndex];
  if (!block) return;
  try {
    await navigator.clipboard.writeText(block.html || "");
    window.showToast("HTMLをクリップボードにコピーしました", "success");
  } catch {
    window.showToast("コピーに失敗しました", "error");
  }
}

async function deleteWidgetBlock(blockIndex) {
  if (!confirm(`ブロック ${blockIndex} を削除しますか？`)) return;
  try {
    const result = await window.API.deleteBlock(window.state.projectId, blockIndex);
    if (result.ok) {
      window.showToast("ブロックを削除しました", "success");
      await window.loadEditor();
      window.pushHistory?.("delete_block", `ブロック ${blockIndex} を削除`);
    }
  } catch (err) {
    window.showToast(`削除エラー: ${err.message}`, "error");
  }
}

// ── HTML/CSS Split Logic ──────────────────────────────────

function splitWidgetHtmlCss(fullHtml) {
  const doc = new DOMParser().parseFromString(fullHtml, "text/html");
  const styles = doc.querySelectorAll("style");
  let css = "";
  styles.forEach((s) => {
    css += s.textContent + "\n";
    s.remove();
  });
  return { html: doc.body.innerHTML.trim(), css: css.trim() };
}

function mergeWidgetHtmlCss(html, css) {
  if (css.trim()) {
    return `<style>${css}</style>\n${html}`;
  }
  return html;
}

// ── 3-Pane HTML Editor ────────────────────────────────────

async function openWidgetHtmlEditor(blockIndex) {
  _weBlockIndex = blockIndex;
  const block = window.state.projectData?.blocks?.[blockIndex];
  if (!block) {
    window.showToast("ブロックが見つかりません", "error");
    return;
  }

  const { html, css } = splitWidgetHtmlCss(block.html || "");

  // Update header info
  document.getElementById("we-description").textContent =
    block.widgetType || `ブロック ${blockIndex}`;
  const catEl = document.getElementById("we-category");
  catEl.textContent = block.type || "widget";

  // Destroy old editors
  destroyWidgetEditors();

  // Open modal
  window.openModal("modal-widget-editor");

  // Initialize CodeMirror editors
  try {
    const cm = await window.loadCodeMirror();

    const debouncePreview = debounce(() => updateWidgetPreview(), 300);

    const updateListener = cm.EditorView.updateListener.of((update) => {
      if (update.docChanged) debouncePreview();
    });

    _weHtmlEditor = new cm.EditorView({
      extensions: [cm.basicSetup, cm.html(), cm.javascript(), cm.oneDark, updateListener],
      parent: document.getElementById("we-html-editor"),
      doc: html,
    });

    _weCssEditor = new cm.EditorView({
      extensions: [cm.basicSetup, cm.css(), cm.oneDark, updateListener],
      parent: document.getElementById("we-css-editor"),
      doc: css,
    });

    // Initial preview
    updateWidgetPreview();
  } catch (err) {
    console.error("CodeMirror load error:", err);
    // Fallback: textarea
    const htmlContainer = document.getElementById("we-html-editor");
    const cssContainer = document.getElementById("we-css-editor");
    htmlContainer.innerHTML = `<textarea class="we-fallback-editor" id="we-html-fallback">${escapeHtml(html)}</textarea>`;
    cssContainer.innerHTML = `<textarea class="we-fallback-editor" id="we-css-fallback">${escapeHtml(css)}</textarea>`;

    const debouncePreview = debounce(() => updateWidgetPreview(), 300);
    document.getElementById("we-html-fallback")?.addEventListener("input", debouncePreview);
    document.getElementById("we-css-fallback")?.addEventListener("input", debouncePreview);
    updateWidgetPreview();
  }
}

window.openWidgetHtmlEditor = openWidgetHtmlEditor;

function destroyWidgetEditors() {
  if (_weHtmlEditor) { _weHtmlEditor.destroy(); _weHtmlEditor = null; }
  if (_weCssEditor) { _weCssEditor.destroy(); _weCssEditor = null; }
  // Clear containers
  const htmlC = document.getElementById("we-html-editor");
  const cssC = document.getElementById("we-css-editor");
  if (htmlC) htmlC.innerHTML = "";
  if (cssC) cssC.innerHTML = "";
}

function getEditorContent() {
  let html, css;
  if (_weHtmlEditor) {
    html = _weHtmlEditor.state.doc.toString();
    css = _weCssEditor ? _weCssEditor.state.doc.toString() : "";
  } else {
    html = document.getElementById("we-html-fallback")?.value || "";
    css = document.getElementById("we-css-fallback")?.value || "";
  }
  return { html, css };
}

function updateWidgetPreview() {
  const iframe = document.getElementById("we-preview-iframe");
  if (!iframe) return;
  const { html, css } = getEditorContent();
  const merged = mergeWidgetHtmlCss(html, css);
  const previewDoc = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:16px;font-family:-apple-system,"Hiragino Sans",sans-serif;}</style>
</head><body>${merged}</body></html>`;
  iframe.srcdoc = previewDoc;
}

// ── 3-Pane: Back / Update buttons ─────────────────────────

document.getElementById("we-back")?.addEventListener("click", () => {
  destroyWidgetEditors();
  window.closeModal("modal-widget-editor");
});

document.getElementById("we-update")?.addEventListener("click", async () => {
  if (_weBlockIndex == null) return;
  const { html, css } = getEditorContent();
  const merged = mergeWidgetHtmlCss(html, css);
  try {
    await window.API.updateBlock(window.state.projectId, _weBlockIndex, { html: merged });
    window.showToast("Widgetを更新しました", "success");
    destroyWidgetEditors();
    window.closeModal("modal-widget-editor");
    await window.loadEditor();
    window.pushHistory?.("edit_block", `Widget ${_weBlockIndex} を編集`);
  } catch (err) {
    window.showToast(`更新エラー: ${err.message}`, "error");
  }
});

// ── 3-Pane: Split Toggle ──────────────────────────────────

document.getElementById("we-split-toggle")?.addEventListener("click", () => {
  const body = document.querySelector(".we-body");
  if (!body) return;
  body.classList.remove("preview-only", "code-only");
  if (_weSplitMode === "split") {
    _weSplitMode = "preview-only";
    body.classList.add("preview-only");
  } else if (_weSplitMode === "preview-only") {
    _weSplitMode = "code-only";
    body.classList.add("code-only");
  } else {
    _weSplitMode = "split";
  }
  const labels = { split: "分割", "preview-only": "プレビュー", "code-only": "コード" };
  document.getElementById("we-split-toggle").textContent = labels[_weSplitMode];
});

// ── 3-Pane: Expand buttons ───────────────────────────────

document.querySelectorAll(".we-expand-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.target; // "html" or "css"
    const htmlSection = document.getElementById("we-html-section");
    const cssSection = document.getElementById("we-css-section");
    const divider = document.getElementById("we-divider-code");
    if (target === "html") {
      if (cssSection.style.display === "none") {
        cssSection.style.display = "";
        divider.style.display = "";
        htmlSection.style.flex = "";
      } else {
        cssSection.style.display = "none";
        divider.style.display = "none";
        htmlSection.style.flex = "1";
      }
    } else {
      if (htmlSection.style.display === "none") {
        htmlSection.style.display = "";
        divider.style.display = "";
        cssSection.style.flex = "";
      } else {
        htmlSection.style.display = "none";
        divider.style.display = "none";
        cssSection.style.flex = "1";
      }
    }
  });
});

// ── 3-Pane: Drag Resize (vertical divider) ────────────────

(function setupDragResize() {
  const mainDivider = document.getElementById("we-divider-main");
  const codeDivider = document.getElementById("we-divider-code");

  if (mainDivider) {
    let startX, startLeft;
    const preview = () => document.getElementById("we-preview-pane");
    const code = () => document.getElementById("we-code-pane");

    mainDivider.addEventListener("mousedown", (e) => {
      e.preventDefault();
      startX = e.clientX;
      startLeft = preview()?.getBoundingClientRect().width || 0;
      mainDivider.classList.add("dragging");
      const body = document.querySelector(".we-body");

      const onMove = (ev) => {
        const delta = ev.clientX - startX;
        const newWidth = Math.max(200, startLeft + delta);
        const total = body?.getBoundingClientRect().width || 1000;
        const pct = (newWidth / total) * 100;
        const p = preview();
        const c = code();
        if (p) p.style.flex = `0 0 ${pct}%`;
        if (c) c.style.flex = "1";
        if (c) c.style.width = "auto";
      };

      const onUp = () => {
        mainDivider.classList.remove("dragging");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  if (codeDivider) {
    let startY, startTop;
    const htmlSec = () => document.getElementById("we-html-section");
    const cssSec = () => document.getElementById("we-css-section");

    codeDivider.addEventListener("mousedown", (e) => {
      e.preventDefault();
      startY = e.clientY;
      startTop = htmlSec()?.getBoundingClientRect().height || 0;
      codeDivider.classList.add("dragging");
      const pane = document.getElementById("we-code-pane");

      const onMove = (ev) => {
        const delta = ev.clientY - startY;
        const newHeight = Math.max(80, startTop + delta);
        const total = pane?.getBoundingClientRect().height || 600;
        const pct = (newHeight / total) * 100;
        const h = htmlSec();
        const c = cssSec();
        if (h) h.style.flex = `0 0 ${pct}%`;
        if (c) c.style.flex = "1";
      };

      const onUp = () => {
        codeDivider.classList.remove("dragging");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }
})();

// ── 3-Pane: Toolbar commands ──────────────────────────────

document.getElementById("we-toolbar")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".we-tool-btn");
  if (!btn) return;
  const cmd = btn.dataset.cmd;
  if (!cmd) return;
  // Execute in preview iframe
  const iframe = document.getElementById("we-preview-iframe");
  try {
    iframe.contentDocument.execCommand(cmd, false, null);
  } catch {}
});

// Widget editor toolbar color buttons → ColorPicker
document.querySelectorAll("#we-toolbar .we-color-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const action = btn.dataset.action;
    const dot = btn.querySelector(".color-dot");
    const currentColor = dot?.style.background || (action === "foreColor" ? "#ec4899" : "#ffffff");
    if (!window.ColorPicker) return;
    window.ColorPicker.open({
      initialColor: currentColor,
      mode: action === "backColor" ? "bg-color" : "text-color",
      anchorEl: btn,
      onApply: (color) => {
        if (dot) dot.style.background = color;
        const iframe = document.getElementById("we-preview-iframe");
        try {
          iframe.contentDocument.execCommand(action, false, color);
        } catch {}
      },
    });
  });
});

// ── Quick Edit ────────────────────────────────────────────

function openQuickEdit(blockIndex) {
  _qeBlockIndex = blockIndex;
  const block = window.state.projectData?.blocks?.[blockIndex];
  if (!block) return;
  _qeOriginalHtml = block.html;

  const iframe = document.getElementById("preview-iframe");
  if (!iframe?.contentWindow) return;

  // Send message to iframe to enable contenteditable on the widget
  iframe.contentWindow.postMessage({
    type: "enableQuickEdit",
    blockIndex: blockIndex,
  }, "*");

  // Show quick edit bar
  const bar = document.getElementById("quick-edit-bar");
  if (bar) bar.style.display = "flex";
}

window.openQuickEdit = openQuickEdit;

// Quick edit bar commands
document.getElementById("quick-edit-bar")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".qe-btn");
  if (!btn) return;
  const cmd = btn.dataset.cmd;
  if (!cmd) return;
  const iframe = document.getElementById("preview-iframe");
  try {
    iframe.contentDocument.execCommand(cmd, false, null);
  } catch {}
});

// Quick edit bar color buttons → ColorPicker
["qe-fore-color", "qe-back-color"].forEach((id) => {
  document.getElementById(id)?.addEventListener("click", (e) => {
    e.preventDefault();
    const btn = document.getElementById(id);
    const action = btn?.dataset.action;
    const dot = btn?.querySelector(".color-dot");
    const currentColor = dot?.style.background || "#ec4899";
    if (!window.ColorPicker || !action) return;
    window.ColorPicker.open({
      initialColor: currentColor,
      mode: action === "backColor" ? "bg-color" : "text-color",
      anchorEl: btn,
      onApply: (color) => {
        if (dot) dot.style.background = color;
        const iframe = document.getElementById("preview-iframe");
        try {
          iframe.contentDocument.execCommand(action, false, color);
        } catch {}
      },
    });
  });
});

document.getElementById("qe-cancel")?.addEventListener("click", () => {
  closeQuickEdit(false);
});

document.getElementById("qe-save")?.addEventListener("click", () => {
  closeQuickEdit(true);
});

async function closeQuickEdit(save) {
  const bar = document.getElementById("quick-edit-bar");
  if (bar) bar.style.display = "none";

  const iframe = document.getElementById("preview-iframe");
  if (!iframe?.contentWindow) return;

  if (save && _qeBlockIndex != null) {
    // Get updated HTML from iframe
    iframe.contentWindow.postMessage({
      type: "getQuickEditHtml",
      blockIndex: _qeBlockIndex,
    }, "*");
  } else {
    // Restore original
    iframe.contentWindow.postMessage({
      type: "disableQuickEdit",
      blockIndex: _qeBlockIndex,
    }, "*");
  }

  _qeBlockIndex = null;
  _qeOriginalHtml = null;
}

// Listen for quick edit HTML response from iframe
window.addEventListener("message", (e) => {
  if (e.origin !== window.location.origin) return;
  if (e.data?.type === "quickEditHtml" && e.data.blockIndex != null) {
    const idx = e.data.blockIndex;
    const newHtml = e.data.html;
    if (window.state.projectId != null) {
      window.API.updateBlock(window.state.projectId, idx, { html: newHtml })
        .then(() => {
          const block = window.state.projectData?.blocks?.[idx];
          if (block) block.html = newHtml;
          window.showToast("クイック編集を保存しました", "success");
          window.loadPreview(true);
          window.pushHistory?.("edit_block", `ブロック ${idx} クイック編集`);
        })
        .catch((err) => {
          window.showToast(`保存エラー: ${err.message}`, "error");
        });
    }
  }
});

// ── Widget Registration ───────────────────────────────────

let _wrHtml = "";
let _wrCss = "";

document.getElementById("we-register")?.addEventListener("click", () => {
  const { html, css } = getEditorContent();
  _wrHtml = html;
  _wrCss = css;
  // Pre-fill from current widget info
  document.getElementById("wr-name").value = "";
  document.getElementById("wr-icon").value = "";
  document.getElementById("wr-description").value = "";
  document.getElementById("wr-favorite").checked = false;
  window.openModal("modal-widget-register");
});

document.getElementById("btn-widget-register-save")?.addEventListener("click", async () => {
  const name = document.getElementById("wr-name").value.trim();
  if (!name) {
    window.showToast("Widget名を入力してください", "error");
    return;
  }
  const data = {
    name,
    icon: document.getElementById("wr-icon").value.trim() || "W",
    category: document.getElementById("wr-category").value,
    description: document.getElementById("wr-description").value.trim(),
    html: _wrHtml,
    css: _wrCss,
    isFavorite: document.getElementById("wr-favorite").checked,
  };
  try {
    await window.API.saveWidgetTemplate(data);
    window.showToast(`Widget「${name}」を登録しました`, "success");
    window.closeModal("modal-widget-register");
    // Refresh templates
    if (window.loadUserWidgetTemplates) await window.loadUserWidgetTemplates();
  } catch (err) {
    window.showToast(`登録エラー: ${err.message}`, "error");
  }
});

// ── Helpers ───────────────────────────────────────────────

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
