/**
 * panels.js - ブロック編集パネル（手動モード / AIモード対応）
 */

let currentMode = "manual"; // "manual" | "ai"

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

  if (currentMode === "ai" && (blockType === "text" || blockType === "heading")) {
    body.appendChild(buildAiTextPanel(projectId, blockIndex, block));
  } else {
    switch (blockType) {
      case "text":
      case "heading":
        body.appendChild(buildTextPanel(projectId, blockIndex, block));
        break;
      case "image":
        body.appendChild(buildImagePanel(projectId, blockIndex, block));
        break;
      case "cta_link":
        body.appendChild(buildCtaPanel(projectId, blockIndex, block));
        break;
      case "video":
        body.appendChild(buildVideoPanel(projectId, blockIndex, block));
        break;
      case "widget":
        body.appendChild(buildWidgetPanel(projectId, blockIndex, block));
        break;
      case "spacer":
        body.appendChild(buildSpacerPanel(block));
        break;
      default:
        body.innerHTML = `<div class="panel-section"><p>タイプ: ${blockType}</p></div>`;
    }
  }

  panel.classList.add("open");
}

window.openEditPanel = openEditPanel;

document.getElementById("edit-panel-close")?.addEventListener("click", () => {
  document.getElementById("edit-panel").classList.remove("open");
});

// ── AI テキスト編集パネル ──────────────────────────────────

function buildAiTextPanel(projectId, blockIndex, block) {
  const frag = document.createDocumentFragment();

  // AIプロバイダー選択
  const providerSection = createSection("AIプロバイダー");
  const providerRow = document.createElement("div");
  providerRow.style.cssText = "display:flex;gap:6px";
  const providerGemini = document.createElement("button");
  providerGemini.className = "panel-btn primary";
  providerGemini.textContent = "Gemini";
  providerGemini.dataset.provider = "gemini";
  const providerPixai = document.createElement("button");
  providerPixai.className = "panel-btn";
  providerPixai.textContent = "PixAI";
  providerPixai.dataset.provider = "pixai";
  providerPixai.style.opacity = "0.5";
  providerPixai.title = "準備中 — APIキー設定後に利用可能";
  let selectedProvider = "gemini";
  providerGemini.addEventListener("click", () => {
    selectedProvider = "gemini";
    providerGemini.className = "panel-btn primary";
    providerPixai.className = "panel-btn";
    providerPixai.style.opacity = "0.5";
  });
  providerPixai.addEventListener("click", () => {
    window.showToast("PixAI連携は準備中です。APIキーが設定され次第利用できます。", "info");
  });
  providerRow.appendChild(providerGemini);
  providerRow.appendChild(providerPixai);
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

  // 現在のテキスト表示
  const currentSection = createSection("現在のテキスト");
  const currentText = document.createElement("div");
  currentText.className = "ai-result-preview";
  currentText.textContent = block.text || "(テキストなし)";
  currentSection.appendChild(currentText);
  frag.appendChild(currentSection);

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
      const result = await window.API.aiRewrite(projectId, blockIndex, {
        instruction,
        text: block.text,
        designRequirements: window._designRequirements || "",
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
            if (block.text && result.rewritten) {
              newHtml = newHtml.replace(block.text, result.rewritten);
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
  let currentText = block.text || "";

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

  // ── プレビュー再構築関数 ──
  function rebuildPreview() {
    // テキスト更新
    let html = block.html || "";
    if (block.text && textarea.value !== block.text) {
      html = html.replace(block.text, textarea.value);
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

// ── 画像パネル ─────────────────────────────────────────────

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
  const imgProviderGemini = document.createElement("button");
  imgProviderGemini.className = "panel-btn primary";
  imgProviderGemini.textContent = "Gemini";
  const imgProviderPixai = document.createElement("button");
  imgProviderPixai.className = "panel-btn";
  imgProviderPixai.textContent = "PixAI";
  imgProviderPixai.style.opacity = "0.5";
  imgProviderPixai.title = "準備中 — APIキー設定後に利用可能";
  imgProviderGemini.addEventListener("click", () => {
    imgProviderGemini.className = "panel-btn primary";
    imgProviderPixai.className = "panel-btn";
    imgProviderPixai.style.opacity = "0.5";
  });
  imgProviderPixai.addEventListener("click", () => {
    window.showToast("PixAI連携は準備中です。APIキーが設定され次第利用できます。", "info");
  });
  imgProviderRow.appendChild(imgProviderGemini);
  imgProviderRow.appendChild(imgProviderPixai);
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

  // メインボタン
  const mainBtn = document.createElement("button");
  mainBtn.className = "oneclick-main-btn";
  mainBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2v14M2 9h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> AIで類似画像を生成';

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
      const result = await window.API.oneClickImage(projectId, blockIndex, { nuance, style, designRequirements: window._designRequirements || "" });
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
              window.showToast("画像を適用しました", "success");
              window.loadPreview(true);
              window.pushHistory?.("image_apply", `ブロック ${blockIndex} AI画像適用`);
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
      mainBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2v14M2 9h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> AIで類似画像を生成';
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
  uploadInput.accept = "image/*";
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
      const result = await window.API.describeImage(projectId, blockIndex);
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

// ── CTAパネル ──────────────────────────────────────────────

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

  frag.appendChild(buildSaveRow(projectId, blockIndex, () => ({
    html: codeArea.value,
    href: urlInput.value.trim(),
  })));

  return frag;
}

// ── 動画パネル ─────────────────────────────────────────────

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

// ── ウィジェットパネル ─────────────────────────────────────

function buildWidgetPanel(projectId, blockIndex, block) {
  const frag = document.createDocumentFragment();

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

  if (block.styles?.length > 0) {
    const cssSection = createSection("ウィジェットCSS");
    const cssArea = document.createElement("textarea");
    cssArea.className = "panel-code";
    cssArea.value = block.styles.join("\n\n");
    cssArea.rows = 6;
    cssSection.appendChild(cssArea);
    frag.appendChild(cssSection);
  }

  if (block.text) {
    const textSection = createSection("テキスト内容");
    const textarea = document.createElement("textarea");
    textarea.className = "panel-textarea";
    textarea.value = block.text;
    textarea.rows = 4;
    textSection.appendChild(textarea);
    frag.appendChild(textSection);
  }

  const htmlSection = createSection("HTMLソース");
  const codeArea = document.createElement("textarea");
  codeArea.className = "panel-code";
  codeArea.value = block.html || "";
  codeArea.rows = 8;
  htmlSection.appendChild(codeArea);
  frag.appendChild(htmlSection);

  frag.appendChild(buildSaveRow(projectId, blockIndex, () => ({ html: codeArea.value })));

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
