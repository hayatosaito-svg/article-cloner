/**
 * tag-settings.js - CodeMirror 6 動的ロード + タグ設定モーダルロジック
 */

let cmModules = null;
let editorInstances = {};

async function loadCodeMirror() {
  if (cmModules) return cmModules;

  const [
    { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, highlightActiveLine },
    { EditorState },
    { defaultKeymap, history, historyKeymap },
    { syntaxHighlighting, defaultHighlightStyle, bracketMatching },
    { autocompletion, closeBrackets, closeBracketsKeymap },
    { html },
    { javascript },
    { css },
    { oneDark },
  ] = await Promise.all([
    import("https://esm.sh/@codemirror/view@6.36.5"),
    import("https://esm.sh/@codemirror/state@6.5.2"),
    import("https://esm.sh/@codemirror/commands@6.8.1"),
    import("https://esm.sh/@codemirror/language@6.11.0"),
    import("https://esm.sh/@codemirror/autocomplete@6.18.6"),
    import("https://esm.sh/@codemirror/lang-html@6.4.9"),
    import("https://esm.sh/@codemirror/lang-javascript@6.2.3"),
    import("https://esm.sh/@codemirror/lang-css@6.3.1"),
    import("https://esm.sh/@codemirror/theme-one-dark@6.1.2"),
  ]);

  cmModules = {
    EditorView, EditorState, keymap, lineNumbers, highlightActiveLineGutter,
    highlightSpecialChars, drawSelection, highlightActiveLine,
    defaultKeymap, history, historyKeymap,
    syntaxHighlighting, defaultHighlightStyle, bracketMatching,
    autocompletion, closeBrackets, closeBracketsKeymap,
    html, javascript, css, oneDark,
  };
  return cmModules;
}

function createEditor(container, langType, initialValue = "") {
  const cm = cmModules;
  if (!cm) return null;

  const langExtension = langType === "css" ? cm.css()
    : langType === "javascript" ? cm.javascript()
    : cm.html();

  const darkTheme = cm.EditorView.theme({
    "&": { backgroundColor: "#1a1a2e", color: "#e2e8f0", height: "100%", fontSize: "13px" },
    ".cm-content": { caretColor: "#ec4899", fontFamily: "'SF Mono', 'Fira Code', monospace" },
    ".cm-cursor": { borderLeftColor: "#ec4899" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "rgba(236,72,153,0.2)" },
    ".cm-gutters": { backgroundColor: "#151528", color: "#4a5568", border: "none" },
    ".cm-activeLineGutter": { backgroundColor: "#1e1e3a" },
    ".cm-activeLine": { backgroundColor: "rgba(236,72,153,0.04)" },
  }, { dark: true });

  const view = new cm.EditorView({
    state: cm.EditorState.create({
      doc: initialValue,
      extensions: [
        cm.lineNumbers(),
        cm.highlightActiveLineGutter(),
        cm.highlightSpecialChars(),
        cm.drawSelection(),
        cm.highlightActiveLine(),
        cm.bracketMatching(),
        cm.closeBrackets(),
        cm.history(),
        cm.keymap.of([...cm.closeBracketsKeymap, ...cm.defaultKeymap, ...cm.historyKeymap]),
        langExtension,
        cm.syntaxHighlighting(cm.defaultHighlightStyle, { fallback: true }),
        darkTheme,
        cm.oneDark,
        cm.EditorView.lineWrapping,
      ],
    }),
    parent: container,
  });

  return view;
}

function destroyEditors() {
  for (const key of Object.keys(editorInstances)) {
    editorInstances[key]?.destroy();
  }
  editorInstances = {};
}

async function openTagSettingsModal() {
  // Load data first
  const projectId = window.state?.projectId;
  if (!projectId) return;

  window.openModal("modal-tag-settings");

  // Show loading state
  const containers = ["headTags", "bodyTags", "jsHead", "jsBody", "masterCss"];
  containers.forEach((id) => {
    const el = document.getElementById(`tag-editor-${id}`);
    if (el) el.innerHTML = '<div style="color:var(--text-muted);padding:20px;font-size:12px">エディタを読み込み中...</div>';
  });

  try {
    const [settings] = await Promise.all([
      window.API.getTagSettings(projectId),
      loadCodeMirror(),
    ]);

    // Destroy previous instances
    destroyEditors();

    // noindex toggle
    const noindexToggle = document.getElementById("tag-noindex-toggle");
    if (noindexToggle) noindexToggle.checked = settings.noindex || false;

    // Create editors
    const editorConfigs = [
      { id: "headTags", lang: "html", value: settings.headTags || "" },
      { id: "bodyTags", lang: "html", value: settings.bodyTags || "" },
      { id: "jsHead", lang: "javascript", value: settings.jsHead || "" },
      { id: "jsBody", lang: "javascript", value: settings.jsBody || "" },
      { id: "masterCss", lang: "css", value: settings.masterCss || "" },
    ];

    for (const cfg of editorConfigs) {
      const container = document.getElementById(`tag-editor-${cfg.id}`);
      if (container) {
        container.innerHTML = "";
        editorInstances[cfg.id] = createEditor(container, cfg.lang, cfg.value);
      }
    }
  } catch (err) {
    window.showToast?.(`タグ設定の読み込みエラー: ${err.message}`, "error");
  }
}

async function saveTagSettings() {
  const projectId = window.state?.projectId;
  if (!projectId) return;

  const data = {
    headTags: editorInstances.headTags?.state?.doc?.toString() || "",
    bodyTags: editorInstances.bodyTags?.state?.doc?.toString() || "",
    noindex: document.getElementById("tag-noindex-toggle")?.checked || false,
    jsHead: editorInstances.jsHead?.state?.doc?.toString() || "",
    jsBody: editorInstances.jsBody?.state?.doc?.toString() || "",
    masterCss: editorInstances.masterCss?.state?.doc?.toString() || "",
  };

  try {
    await window.API.saveTagSettings(projectId, data);
    window.showToast?.("タグ設定を保存しました", "success");
    window.closeModal("modal-tag-settings");
    window.loadPreview?.(true);
    window.pushHistory?.("tag_change", "タグ設定変更");
    destroyEditors();
  } catch (err) {
    window.showToast?.(`保存エラー: ${err.message}`, "error");
  }
}

// Nav button switching
document.querySelectorAll(".tag-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tag-nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tag-section").forEach((s) => s.classList.remove("active"));
    btn.classList.add("active");
    const section = document.getElementById(`tag-section-${btn.dataset.tagSection}`);
    if (section) section.classList.add("active");
  });
});

// Save button
document.getElementById("btn-save-tag-settings")?.addEventListener("click", saveTagSettings);

// Clean up on modal close
document.querySelectorAll('[data-close-modal="modal-tag-settings"]').forEach((btn) => {
  btn.addEventListener("click", destroyEditors);
});

window.openTagSettingsModal = openTagSettingsModal;
