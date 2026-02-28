/**
 * panels.js - Block edit panels (text/image/cta/widget/video)
 */

async function openEditPanel(projectId, blockIndex, blockType) {
  const panel = document.getElementById("edit-panel");
  const body = document.getElementById("edit-panel-body");
  const typeEl = document.getElementById("edit-panel-type");
  const indexEl = document.getElementById("edit-panel-index");

  typeEl.textContent = blockType;
  typeEl.className = "edit-panel-type";
  indexEl.textContent = blockIndex;

  let block;
  try {
    block = await window.API.getBlock(projectId, blockIndex);
  } catch (err) {
    body.innerHTML = `<p style="color:var(--red)">Error: ${err.message}</p>`;
    panel.classList.add("open");
    return;
  }

  body.innerHTML = "";

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
      body.innerHTML = `<div class="panel-section"><p>Block type: ${blockType}</p></div>`;
  }

  panel.classList.add("open");
}

window.openEditPanel = openEditPanel;

document.getElementById("edit-panel-close")?.addEventListener("click", () => {
  document.getElementById("edit-panel").classList.remove("open");
});

// ── Resolve asset URL ──────────────────────────────────────

function assetUrl(projectId, asset) {
  if (!asset) return "";
  // If asset has a localFile via the project's asset catalog, use the API route
  // Otherwise use the original src
  return asset.src || asset.webpSrc || "";
}

// ── Text Panel ─────────────────────────────────────────────

function buildTextPanel(projectId, blockIndex, block) {
  const frag = document.createDocumentFragment();

  const textSection = createSection("Content");
  const textarea = document.createElement("textarea");
  textarea.className = "panel-textarea";
  textarea.value = block.text || "";
  textarea.rows = 6;
  textSection.appendChild(textarea);

  if (block.fontSize || block.hasStrong || block.hasColor) {
    const info = document.createElement("div");
    info.style.cssText = "font-size:11px; color:var(--text-muted); margin-top:6px";
    const parts = [];
    if (block.fontSize) parts.push(`font-size: ${block.fontSize}px`);
    if (block.hasStrong) parts.push("bold");
    if (block.hasColor) parts.push("colored");
    info.textContent = parts.join(" | ");
    textSection.appendChild(info);
  }
  frag.appendChild(textSection);

  const htmlSection = createSection("HTML Source");
  const codeArea = document.createElement("textarea");
  codeArea.className = "panel-code";
  codeArea.value = block.html || "";
  codeArea.rows = 8;
  htmlSection.appendChild(codeArea);
  frag.appendChild(htmlSection);

  frag.appendChild(buildSaveRow(projectId, blockIndex, () => ({
    html: codeArea.value,
    text: textarea.value,
  })));

  return frag;
}

// ── Image Panel ────────────────────────────────────────────

function buildImagePanel(projectId, blockIndex, block) {
  const frag = document.createDocumentFragment();
  const asset = block.assets?.[0];

  // Original image
  const previewSection = createSection("Original Image");
  if (asset) {
    const box = document.createElement("div");
    box.className = "image-preview-box";
    const img = document.createElement("img");
    img.src = assetUrl(projectId, asset);
    img.alt = "Original";
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

  // AI Description
  const descSection = createSection("AI Image Description");
  const descArea = document.createElement("textarea");
  descArea.className = "panel-textarea";
  descArea.placeholder = "Click 'Describe' to auto-generate...";
  descArea.rows = 3;
  descSection.appendChild(descArea);

  const descBtnRow = document.createElement("div");
  descBtnRow.className = "panel-btn-row";
  const descBtn = document.createElement("button");
  descBtn.className = "panel-btn";
  descBtn.textContent = "Describe";
  descBtn.addEventListener("click", async () => {
    descBtn.disabled = true;
    descBtn.innerHTML = '<span class="spinner"></span> Analyzing...';
    try {
      const result = await window.API.describeImage(projectId, blockIndex);
      descArea.value = result.description;
    } catch (err) {
      window.showToast(`Error: ${err.message}`, "error");
    } finally {
      descBtn.disabled = false;
      descBtn.textContent = "Describe";
    }
  });
  descBtnRow.appendChild(descBtn);
  descSection.appendChild(descBtnRow);
  frag.appendChild(descSection);

  // Generation prompt
  const promptSection = createSection("Generation Prompt");
  const promptArea = document.createElement("textarea");
  promptArea.className = "panel-textarea";
  promptArea.placeholder = "Enter prompt for new image generation...";
  promptArea.rows = 4;
  promptSection.appendChild(promptArea);

  const genBtnRow = document.createElement("div");
  genBtnRow.className = "panel-btn-row";
  const genBtn = document.createElement("button");
  genBtn.className = "panel-btn primary";
  genBtn.textContent = "Generate Image";

  const genContainer = document.createElement("div");
  genContainer.style.marginTop = "12px";

  genBtn.addEventListener("click", async () => {
    const prompt = promptArea.value.trim();
    const desc = descArea.value.trim();
    if (!prompt && !desc) {
      window.showToast("Enter a prompt or describe the image first", "error");
      return;
    }
    genBtn.disabled = true;
    genBtn.innerHTML = '<span class="spinner"></span> Generating...';
    try {
      const result = await window.API.generateImage(projectId, blockIndex, {
        prompt: prompt || undefined,
        description: desc || undefined,
      });
      if (result.ok) {
        window.showToast("Image generated!", "success");
        genContainer.innerHTML = "";
        const compare = document.createElement("div");
        compare.className = "image-compare";

        const beforeDiv = document.createElement("div");
        beforeDiv.innerHTML = '<div class="image-compare-label">Before</div>';
        const beforeImg = document.createElement("img");
        beforeImg.src = assetUrl(projectId, asset);
        beforeImg.style.cssText = "width:100%; border-radius:4px";
        beforeDiv.appendChild(beforeImg);

        const afterDiv = document.createElement("div");
        afterDiv.innerHTML = '<div class="image-compare-label">After</div>';
        const afterImg = document.createElement("img");
        afterImg.src = result.imageUrl;
        afterImg.style.cssText = "width:100%; border-radius:4px";
        afterDiv.appendChild(afterImg);

        compare.appendChild(beforeDiv);
        compare.appendChild(afterDiv);
        genContainer.appendChild(compare);
      }
    } catch (err) {
      window.showToast(`Error: ${err.message}`, "error");
    } finally {
      genBtn.disabled = false;
      genBtn.textContent = "Generate Image";
    }
  });

  genBtnRow.appendChild(genBtn);
  promptSection.appendChild(genBtnRow);
  promptSection.appendChild(genContainer);
  frag.appendChild(promptSection);

  // HTML source
  const htmlSection = createSection("HTML Source");
  const codeArea = document.createElement("textarea");
  codeArea.className = "panel-code";
  codeArea.value = block.html || "";
  codeArea.rows = 6;
  htmlSection.appendChild(codeArea);
  frag.appendChild(htmlSection);

  frag.appendChild(buildSaveRow(projectId, blockIndex, () => ({
    html: codeArea.value,
  })));

  return frag;
}

// ── CTA Panel ──────────────────────────────────────────────

function buildCtaPanel(projectId, blockIndex, block) {
  const frag = document.createDocumentFragment();

  const urlSection = createSection("CTA URL");
  const preview = document.createElement("div");
  preview.className = "cta-preview";
  preview.textContent = block.href || "No URL";
  urlSection.appendChild(preview);

  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.className = "form-input";
  urlInput.value = block.href || "";
  urlInput.placeholder = "https://...";
  urlInput.style.marginTop = "8px";
  urlSection.appendChild(urlInput);
  frag.appendChild(urlSection);

  // CTA image
  const asset = block.assets?.[0];
  if (asset) {
    const imgSection = createSection("CTA Image");
    const box = document.createElement("div");
    box.className = "image-preview-box";
    const img = document.createElement("img");
    img.src = assetUrl(projectId, asset);
    img.alt = "CTA";
    img.onerror = () => { img.style.display = "none"; };
    box.appendChild(img);
    imgSection.appendChild(box);
    frag.appendChild(imgSection);
  }

  // HTML source
  const htmlSection = createSection("HTML Source");
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

// ── Video Panel ────────────────────────────────────────────

function buildVideoPanel(projectId, blockIndex, block) {
  const frag = document.createDocumentFragment();

  const infoSection = createSection("Video Source");
  const info = document.createElement("div");
  info.style.cssText = "font-size:12px; color:var(--text-secondary); word-break:break-all";
  info.textContent = block.videoSrc || "No video source";
  infoSection.appendChild(info);

  if (block.width && block.height) {
    const dims = document.createElement("div");
    dims.style.cssText = "font-size:11px; color:var(--text-muted); margin-top:4px";
    dims.textContent = `${block.width} x ${block.height}`;
    infoSection.appendChild(dims);
  }
  frag.appendChild(infoSection);

  if (block.videoSrc) {
    const playerSection = createSection("Preview");
    const video = document.createElement("video");
    video.src = block.videoSrc;
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    video.style.cssText = "width:100%; border-radius:var(--radius-sm)";
    playerSection.appendChild(video);
    frag.appendChild(playerSection);
  }

  const htmlSection = createSection("HTML Source");
  const codeArea = document.createElement("textarea");
  codeArea.className = "panel-code";
  codeArea.value = block.html || "";
  codeArea.rows = 6;
  htmlSection.appendChild(codeArea);
  frag.appendChild(htmlSection);

  frag.appendChild(buildSaveRow(projectId, blockIndex, () => ({
    html: codeArea.value,
  })));

  return frag;
}

// ── Widget Panel ───────────────────────────────────────────

function buildWidgetPanel(projectId, blockIndex, block) {
  const frag = document.createDocumentFragment();

  const typeSection = createSection("Widget Type");
  const badge = document.createElement("span");
  badge.className = "widget-type-badge";
  badge.textContent = block.widgetType || "custom";
  typeSection.appendChild(badge);

  if (block.sbPartId) {
    const idInfo = document.createElement("div");
    idInfo.style.cssText = "font-size:11px; color:var(--text-muted); margin-top:6px; font-family:var(--font-mono)";
    idInfo.textContent = `${block.sbPartId} / ${block.sbCustomClass || ""}`;
    typeSection.appendChild(idInfo);
  }
  frag.appendChild(typeSection);

  if (block.styles?.length > 0) {
    const cssSection = createSection("Widget CSS");
    const cssArea = document.createElement("textarea");
    cssArea.className = "panel-code";
    cssArea.value = block.styles.join("\n\n");
    cssArea.rows = 6;
    cssSection.appendChild(cssArea);
    frag.appendChild(cssSection);
  }

  if (block.text) {
    const textSection = createSection("Text Content");
    const textarea = document.createElement("textarea");
    textarea.className = "panel-textarea";
    textarea.value = block.text;
    textarea.rows = 4;
    textSection.appendChild(textarea);
    frag.appendChild(textSection);
  }

  const htmlSection = createSection("HTML Source");
  const codeArea = document.createElement("textarea");
  codeArea.className = "panel-code";
  codeArea.value = block.html || "";
  codeArea.rows = 8;
  htmlSection.appendChild(codeArea);
  frag.appendChild(htmlSection);

  frag.appendChild(buildSaveRow(projectId, blockIndex, () => ({
    html: codeArea.value,
  })));

  return frag;
}

// ── Spacer Panel ───────────────────────────────────────────

function buildSpacerPanel(block) {
  const frag = document.createDocumentFragment();

  const section = createSection("Spacer Block");
  const info = document.createElement("div");
  info.style.cssText = "font-size:13px; color:var(--text-muted)";
  info.textContent = "Empty spacer / line break";
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

// ── Helpers ────────────────────────────────────────────────

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
  btn.textContent = "Save";

  const indicator = document.createElement("span");
  indicator.className = "save-indicator";
  indicator.textContent = "Saved!";

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      await window.API.updateBlock(projectId, blockIndex, getData());
      indicator.classList.add("show");
      setTimeout(() => indicator.classList.remove("show"), 2000);
      window.loadPreview();
    } catch (err) {
      window.showToast(`Save error: ${err.message}`, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save";
    }
  });

  row.appendChild(btn);
  row.appendChild(indicator);
  return row;
}
