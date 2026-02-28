/**
 * exit-popup-builder.js - サーバー側ポップアップHTML+CSS+JS生成
 */

export function generateExitPopupHtml(config) {
  if (!config || !config.enabled) return "";

  const { trigger, mobileScrollUp, showOnce, minDelaySec, template, content, style, customHtml, customCss } = config;
  const c = content || {};
  const s = style || {};

  const popupId = "exit-popup-" + Date.now().toString(36);

  let popupBody;
  if (template === "custom" && customHtml) {
    popupBody = customHtml;
  } else {
    popupBody = buildTemplateHtml(template, c, s);
  }

  const animation = s.animation || "fadeIn";
  const overlayColor = s.overlayColor || "rgba(0,0,0,0.6)";
  const bgColor = s.bgColor || "#ffffff";
  const buttonColor = s.buttonColor || "#ec4899";
  const borderRadius = s.borderRadius || "12";

  const css = `
<style>
#${popupId}-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: ${overlayColor};
  z-index: 99999;
  justify-content: center;
  align-items: center;
  animation: ${popupId}-fadeOverlay 0.3s ease;
}
#${popupId}-overlay.active { display: flex; }
#${popupId}-box {
  background: ${bgColor};
  border-radius: ${borderRadius}px;
  max-width: 480px;
  width: 90%;
  padding: 32px 28px;
  text-align: center;
  position: relative;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  animation: ${popupId}-${animation} 0.4s ease;
}
#${popupId}-box h3 {
  margin: 0 0 12px;
  font-size: 22px;
  font-weight: 700;
  color: #1a1a1a;
  line-height: 1.4;
}
#${popupId}-box p {
  margin: 0 0 20px;
  font-size: 15px;
  color: #555;
  line-height: 1.6;
}
#${popupId}-box img {
  max-width: 100%;
  border-radius: 8px;
  margin-bottom: 16px;
}
#${popupId}-cta {
  display: inline-block;
  padding: 14px 40px;
  background: ${buttonColor};
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  border-radius: 8px;
  text-decoration: none;
  transition: opacity 0.2s;
  border: none;
  cursor: pointer;
}
#${popupId}-cta:hover { opacity: 0.85; }
#${popupId}-decline {
  display: block;
  margin-top: 14px;
  font-size: 13px;
  color: #999;
  cursor: pointer;
  background: none;
  border: none;
  text-decoration: underline;
}
#${popupId}-close {
  position: absolute;
  top: 10px;
  right: 14px;
  background: none;
  border: none;
  font-size: 24px;
  color: #aaa;
  cursor: pointer;
  line-height: 1;
}
@keyframes ${popupId}-fadeIn {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes ${popupId}-slideUp {
  from { opacity: 0; transform: translateY(60px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes ${popupId}-scaleIn {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes ${popupId}-fadeOverlay {
  from { opacity: 0; }
  to { opacity: 1; }
}
${customCss || ""}
</style>`;

  const htmlBlock = `
<div id="${popupId}-overlay">
  <div id="${popupId}-box">
    <button id="${popupId}-close">&times;</button>
    ${popupBody}
  </div>
</div>`;

  const triggerScript = buildTriggerScript(popupId, trigger, mobileScrollUp, showOnce, minDelaySec);

  return css + htmlBlock + triggerScript;
}

function buildTemplateHtml(template, c, s) {
  const title = escHtml(c.title || "");
  const body = escHtml(c.body || "");
  const imageUrl = c.imageUrl || "";
  const ctaText = escHtml(c.ctaText || "詳しく見る");
  const ctaLink = c.ctaLink || "#";
  const declineText = escHtml(c.declineText || "いいえ、結構です");

  const imageBlock = imageUrl ? `<img src="${escHtml(imageUrl)}" alt="">` : "";

  switch (template) {
    case "image":
      return `${imageBlock}<h3>${title}</h3><p>${body}</p><a href="${escHtml(ctaLink)}" id="${"__CTA__"}">${ctaText}</a><button class="__DECLINE__">${declineText}</button>`;
    case "coupon":
      return `<div style="background:#fff3cd;border:2px dashed #ffc107;border-radius:8px;padding:16px;margin-bottom:16px"><span style="font-size:28px;font-weight:900;color:#d63384">SPECIAL OFFER</span></div><h3>${title}</h3><p>${body}</p><a href="${escHtml(ctaLink)}" id="${"__CTA__"}">${ctaText}</a><button class="__DECLINE__">${declineText}</button>`;
    case "simple":
    default:
      return `<h3>${title}</h3><p>${body}</p>${imageBlock}<a href="${escHtml(ctaLink)}" id="${"__CTA__"}">${ctaText}</a><button class="__DECLINE__">${declineText}</button>`;
  }
}

function buildTriggerScript(popupId, trigger, mobileScrollUp, showOnce, minDelaySec) {
  return `
<script>
(function(){
  var shown = false;
  var startTime = Date.now();
  var minDelay = ${(minDelaySec || 5) * 1000};
  var showOnce = ${showOnce !== false};
  var storageKey = "${popupId}-shown";

  if (showOnce && localStorage.getItem(storageKey)) return;

  function showPopup() {
    if (shown) return;
    if (Date.now() - startTime < minDelay) return;
    shown = true;
    var overlay = document.getElementById("${popupId}-overlay");
    if (overlay) overlay.classList.add("active");
    if (showOnce) localStorage.setItem(storageKey, "1");
  }

  function hidePopup() {
    var overlay = document.getElementById("${popupId}-overlay");
    if (overlay) overlay.classList.remove("active");
  }

  // Close handlers
  var closeBtn = document.getElementById("${popupId}-close");
  if (closeBtn) closeBtn.addEventListener("click", hidePopup);

  var overlay = document.getElementById("${popupId}-overlay");
  if (overlay) overlay.addEventListener("click", function(e) {
    if (e.target === overlay) hidePopup();
  });

  var declines = document.querySelectorAll("#${popupId}-box .__DECLINE__, #${popupId}-decline");
  declines.forEach(function(d) { d.addEventListener("click", hidePopup); });

  // CTA link
  var cta = document.querySelector("#${popupId}-box a[href], #${popupId}-cta, #${popupId}-box .__CTA__");
  if (cta) {
    cta.id = "${popupId}-cta";
    cta.removeAttribute("class");
  }

  // Triggers
  ${trigger === "mouseout" ? `
  document.addEventListener("mouseout", function(e) {
    if (!e.relatedTarget && e.clientY < 10) showPopup();
  });` : ""}

  ${trigger === "back_button" ? `
  history.pushState(null, "", location.href);
  window.addEventListener("popstate", function() {
    history.pushState(null, "", location.href);
    showPopup();
  });` : ""}

  ${trigger === "idle_timer" ? `
  setTimeout(showPopup, minDelay);` : ""}

  ${mobileScrollUp ? `
  var lastScrollY = window.scrollY;
  var scrollUpCount = 0;
  window.addEventListener("scroll", function() {
    if (window.scrollY < lastScrollY - 50) {
      scrollUpCount++;
      if (scrollUpCount >= 2) showPopup();
    } else {
      scrollUpCount = 0;
    }
    lastScrollY = window.scrollY;
  }, { passive: true });` : ""}
})();
<\/script>`;
}

function escHtml(s) {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
