/**
 * panels.js - ブロック編集パネル（手動モード / AIモード対応）
 */

let currentMode = "manual"; // "manual" | "ai"

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

function buildTextPanel(projectId, blockIndex, block) {
  const frag = document.createDocumentFragment();

  // ビジュアルプレビュー（実際の見た目で表示）
  const previewSection = createSection("プレビュー");
  const previewBox = document.createElement("div");
  previewBox.className = "visual-preview-box";
  previewBox.innerHTML = block.html || "";
  previewSection.appendChild(previewBox);

  // スタイル情報バッジ
  if (block.fontSize || block.hasStrong || block.hasColor) {
    const badges = document.createElement("div");
    badges.className = "style-badges";
    if (block.fontSize) {
      const b = document.createElement("span");
      b.className = "style-badge";
      b.innerHTML = `<span class="style-badge-icon">Aa</span> ${block.fontSize}px`;
      badges.appendChild(b);
    }
    if (block.hasStrong) {
      const b = document.createElement("span");
      b.className = "style-badge bold";
      b.innerHTML = `<b>B</b> 太字`;
      badges.appendChild(b);
    }
    if (block.hasColor) {
      const b = document.createElement("span");
      b.className = "style-badge color";
      b.innerHTML = `<span class="style-badge-dot"></span> カラー`;
      badges.appendChild(b);
    }
    previewSection.appendChild(badges);
  }
  frag.appendChild(previewSection);

  // テキスト編集（プレーンテキスト）
  const textSection = createSection("テキスト編集");
  const textarea = document.createElement("textarea");
  textarea.className = "panel-textarea";
  textarea.value = block.text || "";
  textarea.rows = 5;
  textSection.appendChild(textarea);
  frag.appendChild(textSection);

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
  codeArea.rows = 8;
  htmlContent.appendChild(codeArea);
  frag.appendChild(htmlContent);

  // テキスト変更時にプレビュー更新
  textarea.addEventListener("input", () => {
    // テキストを変えたらHTMLソース内のテキストも更新
    let newHtml = block.html;
    if (block.text) {
      newHtml = newHtml.replace(block.text, textarea.value);
    }
    codeArea.value = newHtml;
    // プレビュー更新
    previewBox.innerHTML = newHtml;
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
      const result = await window.API.oneClickImage(projectId, blockIndex, { nuance, style });
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
  const uploadInput = document.createElement("input");
  uploadInput.type = "file";
  uploadInput.accept = "image/*";
  uploadInput.className = "oneclick-file-input";
  uploadInput.addEventListener("change", async () => {
    const file = uploadInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      try {
        // For now, just show a preview - actual upload would need a separate endpoint
        window.showToast("画像をプレビュー中...", "info");
        // We can use the data URL directly for preview, but for apply we need server-side handling
        // For simplicity, show preview with apply option
        resultGrid.innerHTML = "";
        const card = document.createElement("div");
        card.className = "oneclick-variant-card";
        const img = document.createElement("img");
        img.src = dataUrl;
        card.appendChild(img);
        const label = document.createElement("div");
        label.style.cssText = "font-size:11px; color:var(--text-muted); text-align:center; padding:4px";
        label.textContent = file.name;
        card.appendChild(label);
        resultGrid.appendChild(card);
      } catch (err) {
        window.showToast(`エラー: ${err.message}`, "error");
      }
    };
    reader.readAsDataURL(file);
  });
  uploadSection.appendChild(uploadInput);
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

  const urlSection = createSection("遷移先URL");
  const preview = document.createElement("div");
  preview.className = "cta-preview";
  preview.textContent = block.href || "未設定";
  urlSection.appendChild(preview);

  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.className = "form-input";
  urlInput.value = block.href || "";
  urlInput.placeholder = "新しい遷移先URLを入力...";
  urlInput.style.marginTop = "8px";
  urlSection.appendChild(urlInput);
  frag.appendChild(urlSection);

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

  const htmlSection = createSection("HTMLソース");
  const codeArea = document.createElement("textarea");
  codeArea.className = "panel-code";
  codeArea.value = block.html || "";
  codeArea.rows = 6;
  htmlSection.appendChild(codeArea);
  frag.appendChild(htmlSection);

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
