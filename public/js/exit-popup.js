/**
 * exit-popup.js - 離脱ポップアップモーダル + クライアント側プレビュー生成
 */

let currentExitConfig = null;

function generateExitPopupPreviewHtml(config) {
  if (!config) return "";
  const c = config.content || {};
  const s = config.style || {};
  const template = config.template || "simple";

  const bgColor = s.bgColor || "#ffffff";
  const buttonColor = s.buttonColor || "#ec4899";
  const overlayColor = s.overlayColor || "rgba(0,0,0,0.6)";
  const borderRadius = s.borderRadius || "12";
  const animation = s.animation || "fadeIn";

  let popupBody;
  if (template === "custom" && config.customHtml) {
    popupBody = config.customHtml;
  } else {
    const title = escHtml(c.title || "");
    const body = escHtml(c.body || "");
    const imageUrl = c.imageUrl || "";
    const ctaText = escHtml(c.ctaText || "詳しく見る");
    const ctaLink = c.ctaLink || "#";
    const declineText = escHtml(c.declineText || "いいえ、結構です");
    const imgBlock = imageUrl ? `<img src="${escHtml(imageUrl)}" alt="" style="max-width:100%;border-radius:8px;margin-bottom:16px">` : "";

    if (template === "image") {
      popupBody = `${imgBlock}<h3>${title}</h3><p>${body}</p><a href="${escHtml(ctaLink)}" class="ep-cta">${ctaText}</a><button class="ep-decline">${declineText}</button>`;
    } else if (template === "coupon") {
      popupBody = `<div style="background:#fff3cd;border:2px dashed #ffc107;border-radius:8px;padding:16px;margin-bottom:16px"><span style="font-size:28px;font-weight:900;color:#d63384">SPECIAL OFFER</span></div><h3>${title}</h3><p>${body}</p><a href="${escHtml(ctaLink)}" class="ep-cta">${ctaText}</a><button class="ep-decline">${declineText}</button>`;
    } else {
      popupBody = `<h3>${title}</h3><p>${body}</p>${imgBlock}<a href="${escHtml(ctaLink)}" class="ep-cta">${ctaText}</a><button class="ep-decline">${declineText}</button>`;
    }
  }

  return `<!DOCTYPE html>
<html><head><style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, "Hiragino Sans", sans-serif; }
.ep-overlay {
  display: flex;
  position: fixed;
  inset: 0;
  background: ${overlayColor};
  z-index: 99999;
  justify-content: center;
  align-items: center;
}
.ep-box {
  background: ${bgColor};
  border-radius: ${borderRadius}px;
  max-width: 480px;
  width: 90%;
  padding: 32px 28px;
  text-align: center;
  position: relative;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  animation: epAnim 0.4s ease;
}
.ep-box h3 { margin: 0 0 12px; font-size: 22px; font-weight: 700; color: #1a1a1a; line-height: 1.4; }
.ep-box p { margin: 0 0 20px; font-size: 15px; color: #555; line-height: 1.6; }
.ep-cta {
  display: inline-block;
  padding: 14px 40px;
  background: ${buttonColor};
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  border-radius: 8px;
  text-decoration: none;
  border: none;
  cursor: pointer;
}
.ep-decline {
  display: block;
  margin: 14px auto 0;
  font-size: 13px;
  color: #999;
  cursor: pointer;
  background: none;
  border: none;
  text-decoration: underline;
}
.ep-close {
  position: absolute;
  top: 10px;
  right: 14px;
  background: none;
  border: none;
  font-size: 24px;
  color: #aaa;
  cursor: pointer;
}
@keyframes epAnim {
  from { opacity: 0; transform: ${animation === "scaleIn" ? "scale(0.8)" : animation === "slideUp" ? "translateY(60px)" : "translateY(20px)"}; }
  to { opacity: 1; transform: ${animation === "scaleIn" ? "scale(1)" : "translateY(0)"}; }
}
${config.customCss || ""}
</style></head>
<body>
<div class="ep-overlay">
  <div class="ep-box">
    <button class="ep-close">&times;</button>
    ${popupBody}
  </div>
</div>
</body></html>`;
}

function renderExitPreview() {
  const iframe = document.getElementById("exit-popup-preview-iframe");
  if (!iframe || !currentExitConfig) return;
  const html = generateExitPopupPreviewHtml(currentExitConfig);
  iframe.srcdoc = html;
}

function buildExitPopupForm(config) {
  const settings = document.getElementById("exit-popup-settings");
  if (!settings) return;

  const c = config.content || {};
  const s = config.style || {};

  settings.innerHTML = `
    <div class="ep-section">
      <div class="ep-section-title">有効/無効</div>
      <div class="ep-form-row">
        <label class="toggle-switch">
          <input type="checkbox" id="ep-enabled" ${config.enabled ? "checked" : ""}>
          <span class="toggle-slider"></span>
        </label>
        <span class="toggle-label">離脱ポップアップを有効にする</span>
      </div>
    </div>

    <div class="ep-section">
      <div class="ep-section-title">トリガー</div>
      <div class="ep-form-row">
        <span class="ep-form-label">トリガー条件</span>
        <select class="ep-form-select" id="ep-trigger">
          <option value="mouseout" ${config.trigger === "mouseout" ? "selected" : ""}>マウスアウト（PC）</option>
          <option value="back_button" ${config.trigger === "back_button" ? "selected" : ""}>戻るボタン</option>
          <option value="idle_timer" ${config.trigger === "idle_timer" ? "selected" : ""}>アイドルタイマー</option>
        </select>
      </div>
      <div class="ep-form-row">
        <label class="toggle-switch" style="transform:scale(0.8)">
          <input type="checkbox" id="ep-mobile-scroll" ${config.mobileScrollUp !== false ? "checked" : ""}>
          <span class="toggle-slider"></span>
        </label>
        <span style="font-size:12px;color:var(--text-secondary)">モバイルスクロールアップで表示</span>
      </div>
      <div class="ep-form-row">
        <label class="toggle-switch" style="transform:scale(0.8)">
          <input type="checkbox" id="ep-show-once" ${config.showOnce !== false ? "checked" : ""}>
          <span class="toggle-slider"></span>
        </label>
        <span style="font-size:12px;color:var(--text-secondary)">一度だけ表示</span>
      </div>
      <div class="ep-form-row">
        <span class="ep-form-label">最小待機秒数</span>
        <input type="number" class="ep-form-input" id="ep-min-delay" value="${config.minDelaySec || 5}" min="0" max="120" style="width:80px">
        <span style="font-size:12px;color:var(--text-muted)">秒</span>
      </div>
    </div>

    <div class="ep-section">
      <div class="ep-section-title">テンプレート</div>
      <div class="ep-template-grid">
        <div class="ep-template-card ${config.template === "simple" ? "active" : ""}" data-template="simple">
          <div class="ep-template-card-icon">📝</div>
          <div class="ep-template-card-name">シンプル</div>
        </div>
        <div class="ep-template-card ${config.template === "image" ? "active" : ""}" data-template="image">
          <div class="ep-template-card-icon">🖼️</div>
          <div class="ep-template-card-name">画像付き</div>
        </div>
        <div class="ep-template-card ${config.template === "coupon" ? "active" : ""}" data-template="coupon">
          <div class="ep-template-card-icon">🎟️</div>
          <div class="ep-template-card-name">クーポン</div>
        </div>
        <div class="ep-template-card ${config.template === "custom" ? "active" : ""}" data-template="custom">
          <div class="ep-template-card-icon">🔧</div>
          <div class="ep-template-card-name">カスタム</div>
        </div>
      </div>
    </div>

    <div class="ep-section" id="ep-content-section">
      <div class="ep-section-title">コンテンツ</div>
      <div class="ep-form-row">
        <span class="ep-form-label">タイトル</span>
        <input type="text" class="ep-form-input" id="ep-title" value="${escHtml(c.title || "")}">
      </div>
      <div class="ep-form-row" style="align-items:flex-start">
        <span class="ep-form-label" style="padding-top:8px">本文</span>
        <textarea class="ep-form-textarea" id="ep-body">${escHtml(c.body || "")}</textarea>
      </div>
      <div class="ep-form-row">
        <span class="ep-form-label">画像URL</span>
        <input type="text" class="ep-form-input" id="ep-image-url" value="${escHtml(c.imageUrl || "")}" placeholder="https://...">
      </div>
      <div class="ep-form-row">
        <span class="ep-form-label">CTAテキスト</span>
        <input type="text" class="ep-form-input" id="ep-cta-text" value="${escHtml(c.ctaText || "")}">
      </div>
      <div class="ep-form-row">
        <span class="ep-form-label">CTAリンク</span>
        <input type="text" class="ep-form-input" id="ep-cta-link" value="${escHtml(c.ctaLink || "")}" placeholder="https://...">
      </div>
      <div class="ep-form-row">
        <span class="ep-form-label">辞退テキスト</span>
        <input type="text" class="ep-form-input" id="ep-decline-text" value="${escHtml(c.declineText || "")}">
      </div>
    </div>

    <div class="ep-section">
      <div class="ep-section-title">スタイル</div>
      <div class="ep-form-row">
        <span class="ep-form-label">背景色</span>
        <input type="color" class="ep-form-color" id="ep-bg-color" value="${s.bgColor || "#ffffff"}">
        <input type="text" class="ep-form-input" id="ep-bg-color-text" value="${s.bgColor || "#ffffff"}" style="width:100px">
      </div>
      <div class="ep-form-row">
        <span class="ep-form-label">ボタン色</span>
        <input type="color" class="ep-form-color" id="ep-button-color" value="${s.buttonColor || "#ec4899"}">
        <input type="text" class="ep-form-input" id="ep-button-color-text" value="${s.buttonColor || "#ec4899"}" style="width:100px">
      </div>
      <div class="ep-form-row">
        <span class="ep-form-label">角丸 (px)</span>
        <input type="number" class="ep-form-input" id="ep-border-radius" value="${s.borderRadius || "12"}" min="0" max="50" style="width:80px">
      </div>
      <div class="ep-form-row">
        <span class="ep-form-label">アニメーション</span>
        <select class="ep-form-select" id="ep-animation">
          <option value="fadeIn" ${s.animation === "fadeIn" ? "selected" : ""}>フェードイン</option>
          <option value="slideUp" ${s.animation === "slideUp" ? "selected" : ""}>スライドアップ</option>
          <option value="scaleIn" ${s.animation === "scaleIn" ? "selected" : ""}>スケールイン</option>
        </select>
      </div>
    </div>

    <div class="ep-section" id="ep-custom-section" style="display:${config.template === "custom" ? "block" : "none"}">
      <div class="ep-section-title">カスタムHTML / CSS</div>
      <div style="margin-bottom:10px">
        <span class="ep-form-label">カスタムHTML</span>
        <textarea class="ep-form-textarea" id="ep-custom-html" rows="6" style="font-family:var(--font-mono);font-size:12px">${escHtml(config.customHtml || "")}</textarea>
      </div>
      <div>
        <span class="ep-form-label">カスタムCSS</span>
        <textarea class="ep-form-textarea" id="ep-custom-css" rows="4" style="font-family:var(--font-mono);font-size:12px">${escHtml(config.customCss || "")}</textarea>
      </div>
    </div>
  `;

  // Template card selection
  settings.querySelectorAll(".ep-template-card").forEach((card) => {
    card.addEventListener("click", () => {
      settings.querySelectorAll(".ep-template-card").forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      currentExitConfig.template = card.dataset.template;
      const customSection = document.getElementById("ep-custom-section");
      const contentSection = document.getElementById("ep-content-section");
      if (customSection) customSection.style.display = card.dataset.template === "custom" ? "block" : "none";
      if (contentSection) contentSection.style.display = card.dataset.template === "custom" ? "none" : "block";
      renderExitPreview();
    });
  });

  // Live preview updates on input change
  const liveInputs = [
    "ep-title", "ep-body", "ep-image-url", "ep-cta-text", "ep-cta-link", "ep-decline-text",
    "ep-bg-color", "ep-button-color", "ep-border-radius", "ep-animation",
    "ep-custom-html", "ep-custom-css",
  ];

  let previewTimer = null;
  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      syncConfigFromForm();
      renderExitPreview();
    }, 300);
  }

  liveInputs.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", schedulePreview);
  });

  // Color picker sync
  const colorPairs = [["ep-bg-color", "ep-bg-color-text"], ["ep-button-color", "ep-button-color-text"]];
  colorPairs.forEach(([picker, text]) => {
    document.getElementById(picker)?.addEventListener("input", (e) => {
      const textEl = document.getElementById(text);
      if (textEl) textEl.value = e.target.value;
      schedulePreview();
    });
    document.getElementById(text)?.addEventListener("input", (e) => {
      const pickerEl = document.getElementById(picker);
      if (pickerEl && /^#[0-9a-f]{6}$/i.test(e.target.value)) pickerEl.value = e.target.value;
      schedulePreview();
    });
  });
}

function syncConfigFromForm() {
  if (!currentExitConfig) return;
  currentExitConfig.enabled = document.getElementById("ep-enabled")?.checked || false;
  currentExitConfig.trigger = document.getElementById("ep-trigger")?.value || "mouseout";
  currentExitConfig.mobileScrollUp = document.getElementById("ep-mobile-scroll")?.checked ?? true;
  currentExitConfig.showOnce = document.getElementById("ep-show-once")?.checked ?? true;
  currentExitConfig.minDelaySec = parseInt(document.getElementById("ep-min-delay")?.value || "5", 10);

  const activeTemplate = document.querySelector(".ep-template-card.active");
  if (activeTemplate) currentExitConfig.template = activeTemplate.dataset.template;

  currentExitConfig.content = {
    title: document.getElementById("ep-title")?.value || "",
    body: document.getElementById("ep-body")?.value || "",
    imageUrl: document.getElementById("ep-image-url")?.value || "",
    ctaText: document.getElementById("ep-cta-text")?.value || "",
    ctaLink: document.getElementById("ep-cta-link")?.value || "",
    declineText: document.getElementById("ep-decline-text")?.value || "",
  };

  currentExitConfig.style = {
    bgColor: document.getElementById("ep-bg-color")?.value || "#ffffff",
    buttonColor: document.getElementById("ep-button-color")?.value || "#ec4899",
    overlayColor: currentExitConfig.style?.overlayColor || "rgba(0,0,0,0.6)",
    borderRadius: document.getElementById("ep-border-radius")?.value || "12",
    animation: document.getElementById("ep-animation")?.value || "fadeIn",
  };

  currentExitConfig.customHtml = document.getElementById("ep-custom-html")?.value || "";
  currentExitConfig.customCss = document.getElementById("ep-custom-css")?.value || "";
}

async function openExitPopupModal() {
  const projectId = window.state?.projectId;
  if (!projectId) return;

  window.openModal("modal-exit-popup");

  try {
    currentExitConfig = await window.API.getExitPopup(projectId);
    buildExitPopupForm(currentExitConfig);
    renderExitPreview();
  } catch (err) {
    window.showToast?.(`離脱POP設定の読み込みエラー: ${err.message}`, "error");
  }
}

async function saveExitPopup() {
  const projectId = window.state?.projectId;
  if (!projectId) return;

  syncConfigFromForm();

  try {
    await window.API.saveExitPopup(projectId, currentExitConfig);
    window.showToast?.("離脱ポップアップ設定を保存しました", "success");
    window.closeModal("modal-exit-popup");
    window.loadPreview?.(true);
    window.pushHistory?.("exit_popup_change", "離脱ポップアップ設定変更");
  } catch (err) {
    window.showToast?.(`保存エラー: ${err.message}`, "error");
  }
}

document.getElementById("btn-save-exit-popup")?.addEventListener("click", saveExitPopup);

function escHtml(s) {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

window.openExitPopupModal = openExitPopupModal;
