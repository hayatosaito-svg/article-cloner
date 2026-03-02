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

  // テキスト/見出しのみデフォルトでAI編集タブ（画像/動画は手動モードも使える）
  const aiDefaultTypes = ["text", "heading"];
  const effectiveMode = aiDefaultTypes.includes(blockType) && currentMode === "manual"
    ? "ai" : currentMode;

  // モードボタンのアクティブ状態を更新
  document.querySelectorAll(".mode-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === effectiveMode);
  });

  if (effectiveMode === "ai") {
    // ── AI編集モード ──
    if (blockType === "text" || blockType === "heading") {
      body.appendChild(buildAiTextPanel(projectId, blockIndex, block));
    } else if (blockType === "image") {
      body.appendChild(buildImagePanel(projectId, blockIndex, block));
    } else if (blockType === "video") {
      body.appendChild(buildVideoPanel(projectId, blockIndex, block));
    } else {
      // その他のタイプはAIモードでもマニュアルパネルにフォール
      body.appendChild(buildManualPanelContent(projectId, blockIndex, block, blockType));
    }
  } else {
    // ── 手動編集モード（アニメーション + 3パネル統合） ──
    body.appendChild(buildManualPanelContent(projectId, blockIndex, block, blockType));
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
  switch (blockType) {
    case "text":
    case "heading":
      detailSec.body.appendChild(buildTextPanel(projectId, blockIndex, block));
      break;
    case "image":
      detailSec.body.appendChild(buildImageQuickPanel(projectId, blockIndex, block));
      break;
    case "video":
      detailSec.body.appendChild(buildVideoQuickPanel(projectId, blockIndex, block));
      break;
    case "cta_link":
      detailSec.body.appendChild(buildCtaPanel(projectId, blockIndex, block));
      break;
    case "widget":
      detailSec.body.appendChild(buildWidgetPanel(projectId, blockIndex, block));
      break;
    case "spacer":
      detailSec.body.appendChild(buildSpacerPanel(block));
      break;
    default:
      detailSec.body.innerHTML = `<p style="color:var(--text-muted)">タイプ: ${blockType}</p>`;
  }
  frag.appendChild(detailSec.wrapper);

  // ─── 折りたたみ3パネルビュー（CSS/テキスト/HTMLソース） ───
  frag.appendChild(buildCollapsible3Pane(projectId, blockIndex, block));

  return frag;
}

// 要素抽出 → 各要素にアニメーション設定
function buildExtractedElements(container, projectId, blockIndex, block, blockType, blockHtml) {
  const parsedDoc = new DOMParser().parseFromString(blockHtml, "text/html");

  // 要素を収集
  const elements = [];

  // テキスト要素
  const textEls = parsedDoc.querySelectorAll("p, h1, h2, h3, h4, h5, h6, span, strong, em, a, li, td, div");
  const seenText = new Set();
  textEls.forEach(el => {
    const text = el.textContent?.trim();
    if (text && text.length > 1 && text.length < 200 && !seenText.has(text) && el.children.length === 0) {
      seenText.add(text);
      elements.push({ type: "text", tag: el.tagName.toLowerCase(), content: text, icon: "📝" });
    }
  });

  // 画像要素
  const imgEls = parsedDoc.querySelectorAll("img");
  imgEls.forEach((img, i) => {
    const src = img.getAttribute("data-src") || img.getAttribute("src") || "";
    const alt = img.getAttribute("alt") || "";
    if (src) {
      elements.push({ type: "image", src, alt, index: i, icon: "🖼️", content: alt || `画像 ${i + 1}` });
    }
  });

  // 動画要素
  const videoEls = parsedDoc.querySelectorAll("video");
  videoEls.forEach((vid, i) => {
    elements.push({ type: "video", index: i, icon: "🎬", content: `動画 ${i + 1}` });
  });

  // リンク要素
  const linkEls = parsedDoc.querySelectorAll("a[href]");
  const seenHref = new Set();
  linkEls.forEach(a => {
    const href = a.getAttribute("href") || "";
    const text = a.textContent?.trim();
    if (href && text && !seenHref.has(href)) {
      seenHref.add(href);
      elements.push({ type: "link", href, content: text, icon: "🔗" });
    }
  });

  if (elements.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:16px">要素が見つかりませんでした</div>';
    return;
  }

  // ヘッダー
  const header = document.createElement("div");
  header.style.cssText = "font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:8px;display:flex;align-items:center;gap:6px";
  header.innerHTML = `<span>${elements.length}個の要素を検出</span>`;
  container.appendChild(header);

  // 各要素カード
  elements.forEach((el, elIdx) => {
    const card = document.createElement("div");
    card.style.cssText = "border:1px solid var(--border);border-radius:8px;margin-bottom:8px;overflow:hidden;transition:border-color 0.15s";

    // カードヘッダー（クリックで展開）
    const cardHeader = document.createElement("div");
    cardHeader.style.cssText = "display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;background:var(--bg-tertiary);font-size:12px;transition:background 0.15s";
    cardHeader.addEventListener("mouseenter", () => { cardHeader.style.background = "var(--bg-secondary)"; });
    cardHeader.addEventListener("mouseleave", () => { cardHeader.style.background = "var(--bg-tertiary)"; });

    // サムネイル
    if (el.type === "image" && el.src) {
      const thumb = document.createElement("img");
      thumb.src = el.src;
      thumb.style.cssText = "width:36px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0";
      thumb.onerror = () => { thumb.style.display = "none"; };
      cardHeader.appendChild(thumb);
    } else {
      const iconSpan = document.createElement("span");
      iconSpan.textContent = el.icon;
      iconSpan.style.cssText = "font-size:16px;flex-shrink:0;width:36px;text-align:center";
      cardHeader.appendChild(iconSpan);
    }

    // 要素名
    const nameSpan = document.createElement("span");
    nameSpan.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary);font-weight:500";
    nameSpan.textContent = el.content;
    cardHeader.appendChild(nameSpan);

    // タグバッジ
    const tagBadge = document.createElement("span");
    tagBadge.style.cssText = "font-size:9px;padding:1px 6px;background:rgba(236,72,153,0.1);color:#ec4899;border-radius:4px;font-weight:700;flex-shrink:0";
    tagBadge.textContent = el.type === "text" ? el.tag : el.type;
    cardHeader.appendChild(tagBadge);

    // 展開矢印
    const arrow = document.createElement("span");
    arrow.textContent = "▶";
    arrow.style.cssText = "font-size:10px;color:var(--text-muted);transition:transform 0.2s;flex-shrink:0";
    cardHeader.appendChild(arrow);

    card.appendChild(cardHeader);

    // カードボディ（アニメーション設定）- 初期非表示
    const cardBody = document.createElement("div");
    cardBody.style.cssText = "display:none;padding:10px 12px;border-top:1px solid var(--border)";

    // アニメーション選択UI
    buildElementAnimationUI(cardBody, blockIndex, elIdx, el);

    card.appendChild(cardBody);

    // トグル
    let isOpen = false;
    cardHeader.addEventListener("click", () => {
      isOpen = !isOpen;
      cardBody.style.display = isOpen ? "" : "none";
      arrow.style.transform = isOpen ? "rotate(90deg)" : "";
      card.style.borderColor = isOpen ? "#ec4899" : "";
    });

    container.appendChild(card);
  });

  // ブロック全体アニメーション
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
  const providers = window._availableProviders || [];
  const providerBtns = {};

  // PixAI
  const providerPixAI = document.createElement("button");
  providerPixAI.className = "panel-btn";
  providerPixAI.textContent = "PixAI";
  providerPixAI.dataset.provider = "pixai";
  if (!providers.includes("pixai")) { providerPixAI.style.opacity = "0.5"; providerPixAI.title = "PixAI APIキー未設定"; }
  providerBtns.pixai = providerPixAI;

  // Gemini
  const providerGemini = document.createElement("button");
  providerGemini.className = "panel-btn";
  providerGemini.textContent = "Gemini";
  providerGemini.dataset.provider = "gemini";
  if (!providers.includes("gemini")) { providerGemini.style.opacity = "0.5"; providerGemini.title = "Gemini APIキー未設定"; }
  providerBtns.gemini = providerGemini;

  // デフォルトプロバイダー: PixAI優先
  let selectedProvider = window._selectedProvider || (providers.includes("pixai") ? "pixai" : providers.includes("gemini") ? "gemini" : "gemini");
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
    if (!providers.includes("gemini")) { window.showToast("Gemini APIキーを設定してください", "info"); return; }
    selectedProvider = "gemini"; window._selectedProvider = "gemini"; updateProviderBtns();
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

  // 現在のテキスト表示
  const currentSection = createSection("現在のテキスト");
  const currentText = document.createElement("div");
  currentText.className = "ai-result-preview";
  currentText.textContent = block.text || "(テキストなし)";
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
        text: block.text,
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
  const imgProviders = window._availableProviders || [];

  const imgProviderPixai = document.createElement("button");
  imgProviderPixai.className = "panel-btn";
  imgProviderPixai.textContent = "PixAI";
  if (!imgProviders.includes("pixai")) { imgProviderPixai.style.opacity = "0.5"; imgProviderPixai.title = "PixAI APIキー未設定"; }

  const imgProviderGemini = document.createElement("button");
  imgProviderGemini.className = "panel-btn";
  imgProviderGemini.textContent = "Gemini";
  if (!imgProviders.includes("gemini")) { imgProviderGemini.style.opacity = "0.5"; imgProviderGemini.title = "Gemini APIキー未設定"; }

  // デフォルト: PixAI優先
  let imgSelectedProvider = window._selectedProvider || (imgProviders.includes("pixai") ? "pixai" : "gemini");
  function updateImgProviderBtns() {
    imgProviderPixai.className = imgSelectedProvider === "pixai" ? "panel-btn primary" : "panel-btn";
    imgProviderPixai.style.opacity = imgSelectedProvider === "pixai" || imgProviders.includes("pixai") ? "1" : "0.5";
    imgProviderGemini.className = imgSelectedProvider === "gemini" ? "panel-btn primary" : "panel-btn";
    imgProviderGemini.style.opacity = imgSelectedProvider === "gemini" || imgProviders.includes("gemini") ? "1" : "0.5";
  }
  updateImgProviderBtns();

  imgProviderPixai.addEventListener("click", () => {
    if (!imgProviders.includes("pixai")) { window.showToast("PixAI APIキーを設定してください", "info"); return; }
    imgSelectedProvider = "pixai"; window._selectedProvider = "pixai"; updateImgProviderBtns();
  });
  imgProviderGemini.addEventListener("click", () => {
    if (!imgProviders.includes("gemini")) { window.showToast("Gemini APIキーを設定してください", "info"); return; }
    imgSelectedProvider = "gemini"; window._selectedProvider = "gemini"; updateImgProviderBtns();
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
  refFileInput.accept = "image/*";
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
      const aiProvider = window._selectedProvider || "gemini";
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
      const result = await window.API.describeImage(projectId, blockIndex, { provider: window._selectedProvider || "gemini" });
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
        provider: window._selectedProvider || "gemini",
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
        genMode: "similar", provider: window._selectedProvider || "gemini",
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
              window.showToast("画像を適用しました", "success");
              window.loadPreview(true);
              window.pushHistory?.("image_apply", `ブロック ${blockIndex} AI画像適用`);
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
  uploadInput.type = "file"; uploadInput.accept = "image/*"; uploadInput.style.display = "none";
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

  // 画像内テキスト（OCR）
  const ocrArea = document.createElement("div");
  ocrArea.className = "bp-ocr-area";
  const ocrLabel = document.createElement("div");
  ocrLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin:10px 0 4px;font-weight:600";
  ocrLabel.textContent = "── 画像内テキスト（OCR）──";
  ocrArea.appendChild(ocrLabel);
  const ocrResults = document.createElement("div");
  ocrResults.style.cssText = "font-size:12px;color:var(--text-secondary);padding:6px 8px;background:var(--bg-tertiary);border-radius:6px;min-height:30px";
  ocrResults.textContent = "「OCR検出」ボタンで画像内テキストを抽出";
  ocrArea.appendChild(ocrResults);
  const ocrBtn = document.createElement("button");
  ocrBtn.className = "panel-btn";
  ocrBtn.style.cssText = "margin-top:6px;font-size:11px";
  ocrBtn.textContent = "OCR検出";
  ocrBtn.addEventListener("click", async () => {
    ocrBtn.disabled = true;
    ocrBtn.innerHTML = '<span class="spinner"></span> 検出中...';
    try {
      const resp = await fetch(`/api/projects/${projectId}/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockIndex }),
      });
      const data = await resp.json();
      if (data.texts && data.texts.length > 0) {
        ocrResults.innerHTML = "";
        data.texts.forEach(t => {
          const line = document.createElement("div");
          line.style.cssText = "padding:2px 0;border-bottom:1px solid var(--border)";
          line.textContent = t;
          ocrResults.appendChild(line);
        });
      } else {
        ocrResults.textContent = "テキストが検出されませんでした";
      }
    } catch (err) {
      ocrResults.textContent = "OCRエラー: " + err.message;
    } finally {
      ocrBtn.disabled = false;
      ocrBtn.textContent = "OCR検出";
    }
  });
  ocrArea.appendChild(ocrBtn);
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

    // AI画像生成（簡易版）
    const aiImgSection = createSection("AI画像生成");
    const aiGenModeRow = document.createElement("div");
    aiGenModeRow.style.cssText = "display:flex;gap:6px;margin-bottom:8px";
    let ai3PaneMode = "similar";
    ["similar", "tonmana", "new"].forEach(mode => {
      const labels = { similar: "類似生成", tonmana: "トンマナ変更", new: "新規生成" };
      const btn = document.createElement("button");
      btn.className = mode === "similar" ? "panel-btn primary" : "panel-btn";
      btn.textContent = labels[mode];
      btn.style.cssText = "font-size:11px;padding:5px 10px";
      btn.addEventListener("click", () => {
        ai3PaneMode = mode;
        aiGenModeRow.querySelectorAll(".panel-btn").forEach(b => b.className = "panel-btn");
        btn.className = "panel-btn primary";
      });
      aiGenModeRow.appendChild(btn);
    });
    aiImgSection.appendChild(aiGenModeRow);

    // スタイル選択
    const aiStyleRow = document.createElement("div");
    aiStyleRow.style.cssText = "display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap";
    let ai3PaneStyle = "photo";
    ["photo", "manga", "illustration", "flat"].forEach(s => {
      const labels = { photo: "写真風", manga: "漫画風", illustration: "イラスト", flat: "フラット" };
      const btn = document.createElement("button");
      btn.className = s === "photo" ? "oneclick-radio active" : "oneclick-radio";
      btn.textContent = labels[s];
      btn.style.cssText = "font-size:11px;padding:4px 8px;cursor:pointer";
      btn.addEventListener("click", () => {
        ai3PaneStyle = s;
        aiStyleRow.querySelectorAll(".oneclick-radio").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
      aiStyleRow.appendChild(btn);
    });
    aiImgSection.appendChild(aiStyleRow);

    // プロンプト入力
    const aiPromptInput = document.createElement("textarea");
    aiPromptInput.className = "panel-textarea";
    aiPromptInput.placeholder = "追加指示（任意）...";
    aiPromptInput.rows = 2;
    aiPromptInput.style.cssText = "min-height:auto;margin-bottom:8px";
    aiImgSection.appendChild(aiPromptInput);

    // 参考画像アップロード
    const refSection = document.createElement("div");
    refSection.style.cssText = "margin-bottom:8px";
    const refLabel = document.createElement("div");
    refLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin-bottom:4px";
    refLabel.textContent = "参考画像（ローカルからアップロード・任意）";
    refSection.appendChild(refLabel);
    const refRow = document.createElement("div");
    refRow.style.cssText = "display:flex;gap:8px;align-items:center";
    const refUploadBtn = document.createElement("button");
    refUploadBtn.className = "panel-btn";
    refUploadBtn.style.cssText = "font-size:11px;padding:5px 10px";
    refUploadBtn.textContent = "📁 参考画像を選択";
    const refInput = document.createElement("input");
    refInput.type = "file";
    refInput.accept = "image/*";
    refInput.style.display = "none";
    const refInfo = document.createElement("span");
    refInfo.style.cssText = "font-size:11px;color:var(--text-muted)";
    let refLocalPath = null;
    refUploadBtn.addEventListener("click", () => refInput.click());
    refInput.addEventListener("change", async () => {
      const file = refInput.files?.[0];
      if (!file) return;
      refUploadBtn.disabled = true;
      refUploadBtn.textContent = "アップロード中...";
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = await window.API.uploadFree(projectId, { imageData: reader.result, fileName: file.name });
          if (result.ok) {
            refLocalPath = result.localPath;
            refInfo.textContent = `✓ ${file.name}`;
            window.showToast("参考画像をアップロードしました", "success");
          }
        } catch (err) {
          window.showToast(`アップロードエラー: ${err.message}`, "error");
        } finally {
          refUploadBtn.disabled = false;
          refUploadBtn.textContent = "📁 参考画像を選択";
        }
      };
      reader.readAsDataURL(file);
    });
    refRow.appendChild(refUploadBtn);
    refRow.appendChild(refInput);
    refRow.appendChild(refInfo);
    refSection.appendChild(refRow);
    aiImgSection.appendChild(refSection);

    // 生成ボタン
    const aiGenBtn = document.createElement("button");
    aiGenBtn.className = "oneclick-main-btn";
    aiGenBtn.style.cssText = "font-size:13px;padding:10px";
    aiGenBtn.textContent = "AIで画像生成";
    const aiResultGrid = document.createElement("div");
    aiResultGrid.className = "oneclick-result-grid";

    aiGenBtn.addEventListener("click", async () => {
      aiGenBtn.disabled = true;
      aiGenBtn.innerHTML = '<span class="spinner"></span> 生成中...（約30秒）';
      aiResultGrid.innerHTML = "";
      try {
        let result;
        const prov3 = window._selectedProvider || "gemini";
        if (refLocalPath) {
          result = await window.API.aiFromReference(projectId, {
            localPath: refLocalPath,
            style: ai3PaneStyle,
            genMode: ai3PaneMode,
            customPrompt: aiPromptInput.value.trim(),
            designRequirements: window._designRequirements || "",
            provider: prov3,
          });
        } else {
          result = await window.API.oneClickImage(projectId, blockIndex, {
            nuance: "same",
            style: ai3PaneStyle,
            designRequirements: window._designRequirements || "",
            customPrompt: aiPromptInput.value.trim(),
            genMode: ai3PaneMode,
            provider: prov3,
          });
        }
        if (result.ok && result.images) {
          window.showToast(`${result.images.length}パターン生成しました`, "success");
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
            aiResultGrid.appendChild(card);
          });
        }
      } catch (err) {
        window.showToast(`エラー: ${err.message}`, "error");
      } finally {
        aiGenBtn.disabled = false;
        aiGenBtn.textContent = "AIで画像生成";
      }
    });

    aiImgSection.appendChild(aiGenBtn);
    aiImgSection.appendChild(aiResultGrid);
    frag.appendChild(aiImgSection);
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
