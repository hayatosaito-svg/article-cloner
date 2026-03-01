/**
 * widgets.js - SB互換ウィジェットテンプレート
 */

function genId() {
  return Math.random().toString(36).slice(2, 7);
}

const WIDGET_TEMPLATES = [
  // ── 1. 点滅ドット×3 ──
  {
    id: "separator-dots",
    name: "点滅ドット区切り",
    icon: "●●●",
    description: "3つのドットが順番にフェードする区切り線",
    category: "区切り",
    generate() {
      const partId = "sb-part-" + genId();
      const customClass = "sb-custom-part-" + genId();
      const html = `<div><div class="sb-custom"><span><div id="${partId}" class="${customClass}">
<style>
#${partId}.${customClass} .dots-wrap{display:flex;justify-content:center;align-items:center;gap:12px;padding:24px 0}
#${partId}.${customClass} .dot{width:10px;height:10px;border-radius:50%;background:#ec4899;animation:dotPulse 1.5s ease-in-out infinite}
#${partId}.${customClass} .dot:nth-child(2){animation-delay:.3s}
#${partId}.${customClass} .dot:nth-child(3){animation-delay:.6s}
@keyframes dotPulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}
</style>
<div class="dots-wrap">
  <div class="dot"></div>
  <div class="dot"></div>
  <div class="dot"></div>
</div>
</div></span></div></div>`;
      return { html, type: "widget", widgetType: "separator-dots" };
    },
  },

  // ── 2. 矢印アニメーション ──
  {
    id: "arrow-flow",
    name: "矢印フローアニメ",
    icon: "▼▼▼",
    description: "下向き矢印が連続で流れるアニメーション区切り",
    category: "区切り",
    generate() {
      const partId = "sb-part-" + genId();
      const customClass = "sb-custom-part-" + genId();
      const html = `<div><div class="sb-custom"><span><div id="${partId}" class="${customClass}">
<style>
#${partId}.${customClass} .arrow-wrap{display:flex;flex-direction:column;align-items:center;padding:16px 0;overflow:hidden}
#${partId}.${customClass} .arrow-row{display:flex;gap:8px;animation:arrowDown 1.2s ease-in-out infinite}
#${partId}.${customClass} .arrow-row:nth-child(2){animation-delay:.2s;opacity:.7}
#${partId}.${customClass} .arrow-row:nth-child(3){animation-delay:.4s;opacity:.4}
#${partId}.${customClass} .arrow-item{width:0;height:0;border-left:12px solid transparent;border-right:12px solid transparent;border-top:14px solid #ec4899}
@keyframes arrowDown{0%{transform:translateY(-8px);opacity:0}50%{transform:translateY(0);opacity:1}100%{transform:translateY(8px);opacity:0}}
</style>
<div class="arrow-wrap">
  <div class="arrow-row"><div class="arrow-item"></div><div class="arrow-item"></div><div class="arrow-item"></div></div>
  <div class="arrow-row"><div class="arrow-item"></div><div class="arrow-item"></div><div class="arrow-item"></div></div>
  <div class="arrow-row"><div class="arrow-item"></div><div class="arrow-item"></div><div class="arrow-item"></div></div>
</div>
</div></span></div></div>`;
      return { html, type: "widget", widgetType: "arrow-flow" };
    },
  },

  // ── 3. アンケート（3問+紙吹雪） ──
  {
    id: "questionnaire",
    name: "アンケート（3問）",
    icon: "Q&A",
    description: "3問の質問に回答 → 紙吹雪演出で次セクションへ誘導",
    category: "インタラクティブ",
    generate() {
      const partId = "sb-part-" + genId();
      const customClass = "sb-custom-part-" + genId();
      const uid = genId();
      const html = `<div><div class="sb-custom"><span><div id="${partId}" class="${customClass}">
<style>
#${partId}.${customClass}{font-family:-apple-system,"Hiragino Sans",sans-serif}
#${partId}.${customClass} .q-container{max-width:400px;margin:0 auto;padding:20px 16px}
#${partId}.${customClass} .q-title{text-align:center;font-size:18px;font-weight:700;color:#1a1a2e;margin-bottom:16px}
#${partId}.${customClass} .q-step{display:none;animation:qFadeIn .3s ease}
#${partId}.${customClass} .q-step.active{display:block}
#${partId}.${customClass} .q-label{font-size:14px;font-weight:600;color:#4a4a68;margin-bottom:10px;text-align:center}
#${partId}.${customClass} .q-options{display:flex;flex-direction:column;gap:8px}
#${partId}.${customClass} .q-opt{padding:12px 16px;background:#fff;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;color:#1a1a2e;cursor:pointer;transition:all .2s;text-align:center}
#${partId}.${customClass} .q-opt:hover{border-color:#ec4899;background:#fdf2f8}
#${partId}.${customClass} .q-opt.selected{border-color:#ec4899;background:#fce7f3;color:#be185d;font-weight:600}
#${partId}.${customClass} .q-progress{display:flex;gap:6px;justify-content:center;margin-bottom:12px}
#${partId}.${customClass} .q-dot{width:8px;height:8px;border-radius:50%;background:#e5e7eb;transition:background .3s}
#${partId}.${customClass} .q-dot.done{background:#ec4899}
#${partId}.${customClass} .q-result{display:none;text-align:center;padding:24px 16px}
#${partId}.${customClass} .q-result.active{display:block;animation:qFadeIn .3s ease}
#${partId}.${customClass} .q-result-text{font-size:20px;font-weight:700;color:#ec4899;margin-bottom:8px}
#${partId}.${customClass} .q-result-sub{font-size:14px;color:#4a4a68}
#${partId}.${customClass} .confetti-container{position:relative;width:100%;height:0;overflow:visible;pointer-events:none}
#${partId}.${customClass} .confetti{position:absolute;width:8px;height:8px;border-radius:2px;animation:confettiFall 1.5s ease-out forwards;opacity:0}
@keyframes qFadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes confettiFall{0%{opacity:1;transform:translateY(0) rotate(0deg)}100%{opacity:0;transform:translateY(120px) rotate(720deg)}}
</style>
<div class="q-container">
  <div class="q-title">かんたんアンケート</div>
  <div class="q-progress">
    <span class="q-dot" id="qd1-${uid}"></span>
    <span class="q-dot" id="qd2-${uid}"></span>
    <span class="q-dot" id="qd3-${uid}"></span>
  </div>
  <div class="q-step active" id="qs1-${uid}">
    <div class="q-label">Q1. お悩みはどれですか？</div>
    <div class="q-options">
      <div class="q-opt" data-q="1" data-uid="${uid}">ダイエットが続かない</div>
      <div class="q-opt" data-q="1" data-uid="${uid}">肌の調子が気になる</div>
      <div class="q-opt" data-q="1" data-uid="${uid}">疲れやすい</div>
    </div>
  </div>
  <div class="q-step" id="qs2-${uid}">
    <div class="q-label">Q2. 普段の対策は？</div>
    <div class="q-options">
      <div class="q-opt" data-q="2" data-uid="${uid}">サプリを飲んでいる</div>
      <div class="q-opt" data-q="2" data-uid="${uid}">運動している</div>
      <div class="q-opt" data-q="2" data-uid="${uid}">特にしていない</div>
    </div>
  </div>
  <div class="q-step" id="qs3-${uid}">
    <div class="q-label">Q3. 理想の変化は？</div>
    <div class="q-options">
      <div class="q-opt" data-q="3" data-uid="${uid}">1ヶ月で実感したい</div>
      <div class="q-opt" data-q="3" data-uid="${uid}">じっくり取り組みたい</div>
      <div class="q-opt" data-q="3" data-uid="${uid}">まず試してみたい</div>
    </div>
  </div>
  <div class="q-result" id="qr-${uid}">
    <div class="confetti-container" id="qconf-${uid}"></div>
    <div class="q-result-text">あなたにピッタリです！</div>
    <div class="q-result-sub">回答ありがとうございました</div>
  </div>
</div>
<script>
(function(){
  var uid="${uid}";
  var step=0;
  document.querySelectorAll('.q-opt[data-uid="'+uid+'"]').forEach(function(opt){
    opt.addEventListener("click",function(){
      var q=parseInt(opt.dataset.q);
      opt.parentElement.querySelectorAll(".q-opt").forEach(function(o){o.classList.remove("selected")});
      opt.classList.add("selected");
      var dot=document.getElementById("qd"+q+"-"+uid);
      if(dot)dot.classList.add("done");
      setTimeout(function(){
        var cur=document.getElementById("qs"+q+"-"+uid);
        if(cur)cur.classList.remove("active");
        if(q<3){
          var next=document.getElementById("qs"+(q+1)+"-"+uid);
          if(next)next.classList.add("active");
        }else{
          var r=document.getElementById("qr-"+uid);
          if(r){r.classList.add("active");showConfetti(uid)}
        }
      },400);
    });
  });
  function showConfetti(uid){
    var c=document.getElementById("qconf-"+uid);
    if(!c)return;
    var colors=["#ec4899","#f472b6","#fbbf24","#34d399","#60a5fa"];
    for(var i=0;i<30;i++){
      var p=document.createElement("div");
      p.className="confetti";
      p.style.left=Math.random()*100+"%";
      p.style.background=colors[i%colors.length];
      p.style.animationDelay=Math.random()*0.5+"s";
      p.style.width=(6+Math.random()*6)+"px";
      p.style.height=(6+Math.random()*6)+"px";
      c.appendChild(p);
    }
  }
})();
</script>
</div></span></div></div>`;
      return { html, type: "widget", widgetType: "questionnaire" };
    },
  },

  // ── 4. パルスCTA ──
  {
    id: "pulse-cta",
    name: "パルスCTAボタン",
    icon: "CTA",
    description: "パルスアニメーション付きの目立つCTAボタン",
    category: "CTA",
    generate() {
      const partId = "sb-part-" + genId();
      const customClass = "sb-custom-part-" + genId();
      const html = `<div><div class="sb-custom"><span><div id="${partId}" class="${customClass}">
<style>
#${partId}.${customClass} .pulse-cta-wrap{display:flex;justify-content:center;padding:24px 16px}
#${partId}.${customClass} .pulse-cta-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;padding:16px 48px;background:linear-gradient(135deg,#ec4899,#db2777);color:#fff;font-size:18px;font-weight:700;border-radius:60px;text-decoration:none;cursor:pointer;transition:transform .2s,box-shadow .2s;box-shadow:0 4px 20px rgba(236,72,153,0.4)}
#${partId}.${customClass} .pulse-cta-btn:hover{transform:translateY(-2px);box-shadow:0 6px 28px rgba(236,72,153,0.5)}
#${partId}.${customClass} .pulse-cta-btn::before{content:"";position:absolute;inset:-4px;border-radius:64px;background:rgba(236,72,153,0.3);animation:ctaPulse 2s ease-in-out infinite;z-index:-1}
#${partId}.${customClass} .pulse-cta-btn::after{content:"▶";margin-left:8px;font-size:14px}
@keyframes ctaPulse{0%,100%{transform:scale(1);opacity:.6}50%{transform:scale(1.08);opacity:0}}
</style>
<div class="pulse-cta-wrap">
  <a href="#" class="pulse-cta-btn">今すぐチェックする</a>
</div>
</div></span></div></div>`;
      return { html, type: "widget", widgetType: "pulse-cta" };
    },
  },

  // ── 5. CHECKテキスト ──
  {
    id: "check-widget",
    name: "CHECKテキスト",
    icon: "CHECK",
    description: "チェックマーク付きの強調テキストブロック",
    category: "装飾",
    generate() {
      const partId = "sb-part-" + genId();
      const customClass = "sb-custom-part-" + genId();
      const html = `<div><div class="sb-custom"><span><div id="${partId}" class="${customClass}">
<style>
#${partId}.${customClass} .check-wrap{max-width:400px;margin:0 auto;padding:20px 16px}
#${partId}.${customClass} .check-header{display:flex;align-items:center;gap:8px;margin-bottom:12px}
#${partId}.${customClass} .check-badge{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;background:#ec4899;color:#fff;font-size:12px;font-weight:700;border-radius:4px;letter-spacing:1px}
#${partId}.${customClass} .check-badge::before{content:"\\2713";font-size:14px}
#${partId}.${customClass} .check-list{list-style:none;padding:0;margin:0}
#${partId}.${customClass} .check-list li{position:relative;padding:10px 12px 10px 36px;margin-bottom:6px;background:#fdf2f8;border-radius:8px;font-size:14px;color:#1a1a2e;line-height:1.6}
#${partId}.${customClass} .check-list li::before{content:"\\2713";position:absolute;left:12px;top:10px;color:#ec4899;font-weight:700;font-size:16px}
</style>
<div class="check-wrap">
  <div class="check-header">
    <span class="check-badge">CHECK</span>
  </div>
  <ul class="check-list">
    <li>ここにチェック項目1を入力</li>
    <li>ここにチェック項目2を入力</li>
    <li>ここにチェック項目3を入力</li>
  </ul>
</div>
</div></span></div></div>`;
      return { html, type: "widget", widgetType: "check-widget" };
    },
  },
];

let _userWidgetTemplates = [];

async function loadUserWidgetTemplates() {
  try {
    const result = await window.API.getWidgetTemplates();
    _userWidgetTemplates = (result.templates || []).map((t) => ({
      id: t.id,
      name: t.name,
      icon: t.icon || "W",
      description: t.description || "",
      category: t.category || "その他",
      isFavorite: t.isFavorite || false,
      isUserTemplate: true,
      generate() {
        const partId = "sb-part-" + genId();
        const customClass = "sb-custom-part-" + genId();
        let html = t.html || "";
        let css = t.css || "";
        // Wrap in SB structure
        if (css) {
          html = `<div><div class="sb-custom"><span><div id="${partId}" class="${customClass}"><style>${css}</style>${html}</div></span></div></div>`;
        } else {
          html = `<div><div class="sb-custom"><span><div id="${partId}" class="${customClass}">${html}</div></span></div></div>`;
        }
        return { html, type: "widget", widgetType: t.name };
      },
    }));
  } catch (err) {
    console.warn("Failed to load user widget templates:", err);
  }
}

function getAllWidgetTemplates(filter) {
  let all = [...WIDGET_TEMPLATES, ..._userWidgetTemplates];
  if (filter === "favorite") {
    all = all.filter((t) => t.isFavorite);
  }
  return all;
}

window.WIDGET_TEMPLATES = WIDGET_TEMPLATES;
window.loadUserWidgetTemplates = loadUserWidgetTemplates;
window.getAllWidgetTemplates = getAllWidgetTemplates;
