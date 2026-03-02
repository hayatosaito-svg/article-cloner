/**
 * ad-manager.js - 広告入稿マネージャー UI
 *
 * サイドナビ4セクション構成（tag-settingsパターン踏襲）
 * - プラットフォーム設定（認証情報管理）
 * - テンプレート管理（CRUD + バリデーション）
 * - 入稿実行（プレビュー + SSE進捗）
 * - ステータス（入稿履歴 + 詳細）
 *
 * モーダル（エディタ内）・スタンドアロン（/ad-manager）両対応
 */

const AdManager = {
  currentTab: "platforms",
  templates: [],
  editingTemplate: null,
  platformStatus: {},
  standalone: false,
  selectedProjectId: null,

  // ── 初期化 ─────────────────────────────────────
  async init() {
    this.standalone = document.body.classList.contains("ad-standalone");
    this.bindTabs();
    this.bindEvents();

    if (this.standalone) {
      // スタンドアロンモードは即座にプラットフォーム読み込み
      this.switchTab("platforms");
      this.loadPlatformStatus();
    }
  },

  open() {
    if (this.standalone) return; // standalone mode: always visible
    document.getElementById("modal-ad-manager")?.classList.add("active");
    this.switchTab("platforms");
    this.loadPlatformStatus();
  },

  close() {
    if (this.standalone) return;
    document.getElementById("modal-ad-manager")?.classList.remove("active");
  },

  // ── プロジェクトID取得 ──────────────────────────
  getProjectId() {
    if (this.standalone) {
      return this.selectedProjectId || $("ad-submit-project")?.value || null;
    }
    return window.state?.projectId || null;
  },

  // ── ナビ切替 ───────────────────────────────────
  bindTabs() {
    document.querySelectorAll("[data-ad-tab]").forEach((btn) => {
      btn.addEventListener("click", () => this.switchTab(btn.dataset.adTab));
    });
  },

  switchTab(tabName) {
    this.currentTab = tabName;
    document.querySelectorAll("[data-ad-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.adTab === tabName);
    });
    document.querySelectorAll(".ad-tab-content").forEach((el) => {
      el.classList.toggle("active", el.dataset.tabContent === tabName);
    });

    if (tabName === "platforms") this.loadPlatformStatus();
    if (tabName === "templates") this.loadTemplates();
    if (tabName === "submit") this.loadSubmitTab();
    if (tabName === "status") this.loadSubmissions();
    if (tabName === "auto") this.loadAutoTab();
  },

  bindEvents() {
    on("btn-new-ad-template", "click", () => this.showTemplateForm());
    on("btn-save-ad-template", "click", () => this.saveTemplate());
    on("btn-cancel-ad-template", "click", () => this.hideTemplateForm());
    on("btn-ad-preview", "click", () => this.previewSubmission());
    on("btn-ad-submit", "click", () => this.executeSubmission());

    // Standalone: project selector change
    on("ad-submit-project", "change", () => {
      this.selectedProjectId = getVal("ad-submit-project") || null;
    });
  },

  // ═══════════════════════════════════════════════════
  // Tab1: プラットフォーム設定
  // ═══════════════════════════════════════════════════
  async loadPlatformStatus() {
    const container = $("ad-platform-cards");
    if (!container) return;
    container.innerHTML = '<div class="ad-loading">接続状態を確認中...</div>';

    try {
      this.platformStatus = await API.getAdPlatformStatus();
      this.renderPlatformCards();
    } catch (err) {
      container.innerHTML = `<div class="ad-error">${esc(err.message)}</div>`;
    }
  },

  renderPlatformCards() {
    const container = $("ad-platform-cards");
    if (!container) return;

    const platforms = [
      { key: "google", name: "Google Ads", icon: "G", color: "#4285f4", desc: "検索・ディスプレイ・P-MAX",
        fields: [
          { key: "clientId", label: "OAuth2 Client ID", type: "text" },
          { key: "clientSecret", label: "Client Secret", type: "password" },
          { key: "developerToken", label: "Developer Token", type: "text" },
          { key: "refreshToken", label: "Refresh Token", type: "password" },
          { key: "managerAccountId", label: "Manager Account ID", type: "text", hint: "XXX-XXX-XXXX" },
          { key: "customerAccountId", label: "Customer Account ID", type: "text", hint: "XXX-XXX-XXXX" },
        ]},
      { key: "meta", name: "Meta (Facebook / Instagram)", icon: "M", color: "#1877f2", desc: "フィード・ストーリーズ・リール",
        fields: [
          { key: "appId", label: "App ID", type: "text" },
          { key: "appSecret", label: "App Secret", type: "password" },
          { key: "accessToken", label: "System User Token", type: "password", hint: "Business Managerで発行（永久有効推奨）" },
          { key: "adAccountId", label: "Ad Account ID", type: "text", hint: "act_XXXXXXXXX" },
          { key: "pageId", label: "Facebook Page ID", type: "text" },
        ]},
      { key: "tiktok", name: "TikTok Ads", icon: "T", color: "#010101", desc: "インフィード・TopView",
        fields: [
          { key: "appId", label: "App ID", type: "text" },
          { key: "appSecret", label: "App Secret", type: "password" },
          { key: "accessToken", label: "Access Token", type: "password", hint: "24h有効。Refresh Tokenで自動更新" },
          { key: "refreshToken", label: "Refresh Token", type: "password" },
          { key: "advertiserId", label: "Advertiser ID", type: "text" },
        ]},
    ];

    container.innerHTML = platforms.map((p) => {
      const s = this.platformStatus[p.key] || {};
      const statusClass = s.connected ? "connected" : s.configured ? "configured" : "disconnected";
      const accountInfo = s.details?.customerName || s.details?.accountName || s.details?.advertiserName || "";
      const statusText = s.connected
        ? `接続済み${accountInfo ? ` — ${accountInfo}` : ""}`
        : s.configured
        ? "認証情報あり（接続未確認）"
        : "未設定";

      return `
      <div class="ad-platform-card ${statusClass}">
        <div class="ad-platform-header">
          <div class="ad-platform-icon" style="background:${p.color}">${p.icon}</div>
          <div class="ad-platform-info">
            <div class="ad-platform-name">${p.name}</div>
            <div class="ad-platform-status">
              <span class="ad-status-dot ${statusClass}"></span>
              <span class="status-${statusClass}">${statusText}</span>
            </div>
          </div>
          <button class="btn-toggle-creds" onclick="AdManager.toggleCredForm('${p.key}')">
            ${s.configured ? "編集" : "設定する"}
          </button>
        </div>
        <div class="ad-cred-form" id="ad-cred-form-${p.key}" style="display:none">
          ${p.fields.map((f) => `
            <div class="ad-form-group">
              <label>${f.label}</label>
              <input type="${f.type}" id="ad-cred-${p.key}-${f.key}" class="form-input" placeholder="${f.hint || ""}" autocomplete="off" spellcheck="false">
              ${f.hint ? `<span class="ad-form-hint">${f.hint}</span>` : ""}
            </div>
          `).join("")}
          <div class="ad-form-actions" style="border-top:none;margin-top:8px;padding-top:0">
            <button class="btn-primary" onclick="AdManager.saveCredentials('${p.key}')">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5L12 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              保存して接続テスト
            </button>
          </div>
        </div>
      </div>`;
    }).join("");
  },

  toggleCredForm(platform) {
    const form = $(`ad-cred-form-${platform}`);
    if (!form) return;
    const isHidden = form.style.display === "none";
    // Close all others first
    document.querySelectorAll(".ad-cred-form").forEach((f) => f.style.display = "none");
    if (isHidden) form.style.display = "block";
  },

  async saveCredentials(platform) {
    const fieldMap = {
      google: ["clientId", "clientSecret", "developerToken", "refreshToken", "managerAccountId", "customerAccountId"],
      meta: ["appId", "appSecret", "accessToken", "adAccountId", "pageId"],
      tiktok: ["appId", "appSecret", "accessToken", "refreshToken", "advertiserId"],
    };
    const data = {};
    for (const field of fieldMap[platform] || []) {
      const v = $(`ad-cred-${platform}-${field}`)?.value?.trim();
      if (v) data[field] = v;
    }
    if (!Object.keys(data).length) return this.toast("認証情報を入力してください", "error");

    const btn = document.querySelector(`#ad-cred-form-${platform} .btn-primary`);
    const orig = btn?.innerHTML;
    if (btn) btn.innerHTML = '<span class="ad-loading" style="padding:0;font-size:12px"></span> 接続中...';

    try {
      const result = await API.saveAdCredentials(platform, data);
      this.toast(result.connected ? `${platform} 接続成功` : "設定を保存しました", result.connected ? "success" : "info");
      await this.loadPlatformStatus();
    } catch (err) {
      this.toast(err.message, "error");
    } finally {
      if (btn) btn.innerHTML = orig;
    }
  },

  // ═══════════════════════════════════════════════════
  // Tab2: テンプレート管理
  // ═══════════════════════════════════════════════════
  async loadTemplates() {
    const container = $("ad-template-list");
    if (!container) return;
    container.innerHTML = '<div class="ad-loading">読み込み中...</div>';
    try {
      const { templates } = await API.getAdTemplates();
      this.templates = templates;
      this.renderTemplateList();
    } catch (err) {
      container.innerHTML = `<div class="ad-error">${esc(err.message)}</div>`;
    }
  },

  renderTemplateList() {
    const container = $("ad-template-list");
    if (!container) return;

    if (!this.templates.length) {
      container.innerHTML = `
        <div class="ad-empty">
          <p>テンプレートがありません。</p>
          <button class="btn-primary" onclick="AdManager.showTemplateForm()">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            最初のテンプレートを作成
          </button>
        </div>`;
      return;
    }

    container.innerHTML = this.templates.map((t) => `
      <div class="ad-template-item">
        <div class="ad-template-item-info">
          <div class="ad-template-item-name">${esc(t.name)}</div>
          <div class="ad-template-item-meta">
            ${(t.platforms || []).map((p) => `<span class="ad-badge ad-badge-${p}">${({google:"Google",meta:"Meta",tiktok:"TikTok"})[p]||p}</span>`).join("")}
            <span class="ad-template-budget">&yen;${((t.budget?.google?.amountYen||0)).toLocaleString()}/日</span>
          </div>
        </div>
        <div class="ad-template-item-actions">
          <button class="btn-sm" onclick="AdManager.editTemplate('${t.id}')">編集</button>
          <button class="btn-sm" onclick="AdManager.validateTemplate('${t.id}')">検証</button>
          <button class="btn-sm btn-danger-sm" onclick="AdManager.deleteTemplate('${t.id}')">削除</button>
        </div>
      </div>`).join("");
  },

  showTemplateForm(template = null) {
    this.editingTemplate = template;
    const form = $("ad-template-form");
    const list = $("ad-template-list-wrapper");
    if (form) form.style.display = "block";
    if (list) list.style.display = "none";
    // Hide the "new" button in header
    const btn = $("btn-new-ad-template");
    if (btn) btn.style.display = "none";

    const t = template || defaultTemplate();
    setVal("ad-tpl-name", t.name);
    setChecked("ad-tpl-platform-google", t.platforms?.includes("google"));
    setChecked("ad-tpl-platform-meta", t.platforms?.includes("meta"));
    setChecked("ad-tpl-platform-tiktok", t.platforms?.includes("tiktok"));
    setVal("ad-tpl-budget-type", t.budget?.type || "daily");
    setVal("ad-tpl-budget-google", t.budget?.google?.amountYen || 3000);
    setVal("ad-tpl-budget-meta", t.budget?.meta?.amountYen || 3000);
    setVal("ad-tpl-budget-tiktok", t.budget?.tiktok?.amountYen || 3000);
    setVal("ad-tpl-age-min", t.targeting?.ageMin || 25);
    setVal("ad-tpl-age-max", t.targeting?.ageMax || 54);
    setVal("ad-tpl-gender", t.targeting?.gender || "ALL");
    setVal("ad-tpl-google-campaign-type", t.targeting?.google?.campaignType || "SEARCH");
    setVal("ad-tpl-google-keywords", (t.targeting?.google?.keywords || []).join(", "));
    setVal("ad-tpl-meta-objective", t.targeting?.meta?.objective || "OUTCOME_TRAFFIC");
    setVal("ad-tpl-tiktok-objective", t.targeting?.tiktok?.objectiveType || "TRAFFIC");
    setVal("ad-tpl-start-date", t.schedule?.startDate || "");
    setVal("ad-tpl-end-date", t.schedule?.endDate || "");
    setVal("ad-tpl-headline-source", t.creative?.headlineSource || "auto");
    setVal("ad-tpl-meta-cta", t.creative?.meta?.callToAction || "LEARN_MORE");
    setVal("ad-tpl-tiktok-cta", t.creative?.tiktok?.callToAction || "LEARN_MORE");
    setVal("ad-tpl-google-path1", t.creative?.google?.path1 || "");
    setVal("ad-tpl-google-path2", t.creative?.google?.path2 || "");
    setVal("ad-tpl-campaign-pattern", t.naming?.campaignPattern || "{product}_{platform}_{date}");
    setVal("ad-tpl-adgroup-pattern", t.naming?.adGroupPattern || "{product}_{targeting}_{date}");
    setVal("ad-tpl-product-name", t.naming?.variables?.product || "");
  },

  hideTemplateForm() {
    this.editingTemplate = null;
    const form = $("ad-template-form");
    const list = $("ad-template-list-wrapper");
    if (form) form.style.display = "none";
    if (list) list.style.display = "block";
    const btn = $("btn-new-ad-template");
    if (btn) btn.style.display = "";
  },

  async saveTemplate() {
    const platforms = [];
    if (getChecked("ad-tpl-platform-google")) platforms.push("google");
    if (getChecked("ad-tpl-platform-meta")) platforms.push("meta");
    if (getChecked("ad-tpl-platform-tiktok")) platforms.push("tiktok");

    const keywords = getVal("ad-tpl-google-keywords").split(",").map((k) => k.trim()).filter(Boolean);

    const data = {
      name: getVal("ad-tpl-name"),
      platforms,
      budget: {
        type: getVal("ad-tpl-budget-type"),
        google: { amountYen: int(getVal("ad-tpl-budget-google"), 3000), deliveryMethod: "STANDARD" },
        meta: { amountYen: int(getVal("ad-tpl-budget-meta"), 3000), bidStrategy: "LOWEST_COST_WITHOUT_CAP" },
        tiktok: { amountYen: int(getVal("ad-tpl-budget-tiktok"), 3000), bidType: "BID_TYPE_NO_BID" },
      },
      targeting: {
        ageMin: int(getVal("ad-tpl-age-min"), 25),
        ageMax: int(getVal("ad-tpl-age-max"), 54),
        gender: getVal("ad-tpl-gender"),
        locations: [{ type: "country", code: "JP" }],
        languages: ["ja"],
        google: { keywords, campaignType: getVal("ad-tpl-google-campaign-type") },
        meta: { objective: getVal("ad-tpl-meta-objective"), optimizationGoal: "LINK_CLICKS" },
        tiktok: { objectiveType: getVal("ad-tpl-tiktok-objective"), optimizationGoal: "CLICK" },
      },
      schedule: { startDate: getVal("ad-tpl-start-date"), endDate: getVal("ad-tpl-end-date") },
      creative: {
        headlineSource: getVal("ad-tpl-headline-source"), imageStrategy: "auto",
        google: { adType: "RESPONSIVE_SEARCH", path1: getVal("ad-tpl-google-path1"), path2: getVal("ad-tpl-google-path2") },
        meta: { adFormat: "SINGLE_IMAGE", callToAction: getVal("ad-tpl-meta-cta") },
        tiktok: { callToAction: getVal("ad-tpl-tiktok-cta") },
      },
      naming: {
        campaignPattern: getVal("ad-tpl-campaign-pattern"),
        adGroupPattern: getVal("ad-tpl-adgroup-pattern"),
        variables: { product: getVal("ad-tpl-product-name") },
      },
    };

    if (!data.name.trim()) return this.toast("テンプレート名を入力してください", "error");

    try {
      if (this.editingTemplate) {
        await API.updateAdTemplate(this.editingTemplate.id, data);
        this.toast("テンプレートを更新しました", "success");
      } else {
        await API.createAdTemplate(data);
        this.toast("テンプレートを作成しました", "success");
      }
      this.hideTemplateForm();
      this.loadTemplates();
    } catch (err) {
      this.toast(err.message, "error");
    }
  },

  async editTemplate(id) {
    const t = this.templates.find((t) => t.id === id);
    if (t) this.showTemplateForm(t);
  },

  async validateTemplate(id) {
    try {
      const result = await API.validateAdTemplate(id);
      if (result.valid) {
        this.toast("バリデーション OK — 全項目クリア", "success");
      } else {
        this.toast(result.errors.map((e) => e.message).join("\n"), "error");
      }
    } catch (err) { this.toast(err.message, "error"); }
  },

  async deleteTemplate(id) {
    if (!confirm("このテンプレートを削除しますか？")) return;
    try {
      await API.deleteAdTemplate(id);
      this.toast("削除しました", "success");
      this.loadTemplates();
    } catch (err) { this.toast(err.message, "error"); }
  },

  // ═══════════════════════════════════════════════════
  // Tab3: 入稿実行
  // ═══════════════════════════════════════════════════
  async loadSubmitTab() {
    // テンプレート一覧を読み込み
    const select = $("ad-submit-template");
    if (!select) return;
    try {
      const { templates } = await API.getAdTemplates();
      select.innerHTML = '<option value="">テンプレートを選択...</option>' +
        templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("");
    } catch {}

    if (this.standalone) {
      // スタンドアロン: プロジェクト一覧を読み込み
      await this.loadProjectSelector();
    } else {
      // モーダル: 既存のプロジェクトURLをデフォルトに
      const lpInput = $("ad-submit-lp-url");
      if (lpInput && !lpInput.value && window.state?.currentProject?.url) {
        lpInput.value = window.state.currentProject.url;
      }
    }
  },

  async loadProjectSelector() {
    const select = $("ad-submit-project");
    if (!select) return;
    try {
      const { projects } = await API.listProjects();
      select.innerHTML = '<option value="">プロジェクトを選択...</option>' +
        projects.map((p) => `<option value="${p.id}">${esc(p.title || p.url || p.id)}</option>`).join("");
      // 既に選択済みがあれば保持
      if (this.selectedProjectId) select.value = this.selectedProjectId;
    } catch {}
  },

  async previewSubmission() {
    const templateId = getVal("ad-submit-template");
    const lpUrl = getVal("ad-submit-lp-url");
    const projectId = this.getProjectId();
    if (!templateId || !projectId) return this.toast("テンプレートとプロジェクトを選択してください", "error");

    const area = $("ad-submit-preview");
    if (area) area.innerHTML = '<div class="ad-loading">プレビュー生成中...</div>';

    try {
      const preview = await API.adSubmitPreview(projectId, { templateId, lpUrl });
      this.renderPreview(preview);
    } catch (err) {
      if (area) area.innerHTML = `<div class="ad-error">${esc(err.message)}</div>`;
    }
  },

  renderPreview(preview) {
    const area = $("ad-submit-preview");
    if (!area) return;
    let html = '<div class="ad-preview-cards">';
    for (const [platform, data] of Object.entries(preview.platforms || {})) {
      html += `
        <div class="ad-preview-card">
          <h4>${platformLabel(platform)}</h4>
          <div class="ad-preview-row"><span>キャンペーン名</span> <strong>${esc(data.campaignName)}</strong></div>
          <div class="ad-preview-row"><span>広告グループ名</span> <strong>${esc(data.adGroupName)}</strong></div>
          <div class="ad-preview-row"><span>予算</span> <strong>&yen;${(data.budget?.amountYen||0).toLocaleString()}/日</strong></div>
          <div class="ad-preview-row"><span>ターゲット</span> <strong>${data.targeting?.ageRange} / ${data.targeting?.gender}</strong></div>
          <div class="ad-preview-row"><span>LP URL</span> <strong>${esc(data.lpUrl)}</strong></div>
          ${renderCreativePreview(platform, data.creative)}
        </div>`;
    }
    html += "</div>";
    area.innerHTML = html;
  },

  async executeSubmission() {
    const templateId = getVal("ad-submit-template");
    const lpUrl = getVal("ad-submit-lp-url");
    const projectId = this.getProjectId();
    if (!templateId || !projectId) return this.toast("テンプレートとプロジェクトを選択してください", "error");

    const platforms = [];
    if (getChecked("ad-submit-google")) platforms.push("google");
    if (getChecked("ad-submit-meta")) platforms.push("meta");
    if (getChecked("ad-submit-tiktok")) platforms.push("tiktok");
    if (!platforms.length) return this.toast("少なくとも1つの媒体を選択してください", "error");
    if (!confirm(`${platforms.map(platformLabel).join(" / ")} に入稿します。よろしいですか？`)) return;

    const progressArea = $("ad-submit-progress");
    if (progressArea) { progressArea.style.display = "block"; progressArea.innerHTML = '<div class="ad-progress-header">入稿処理中...</div>'; }
    const btn = $("btn-ad-submit");
    if (btn) { btn.disabled = true; btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite"></span> 入稿中...'; }

    API.connectAdSubmitSSE(projectId, { templateId, platforms, lpUrl }, {
      onProgress: (data) => this.updateProgress(data),
      onComplete: (submission) => {
        this.toast("入稿処理が完了しました", "success");
        resetBtn(btn);
        this.renderSubmissionResult(submission);
      },
      onError: (data) => { this.toast(`入稿エラー: ${data.message}`, "error"); resetBtn(btn); },
      onClose: () => resetBtn(btn),
    });

    function resetBtn(b) {
      if (!b) return;
      b.disabled = false;
      b.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5L12 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> 入稿開始';
    }
  },

  updateProgress(data) {
    const area = $("ad-submit-progress");
    if (!area) return;
    const existing = area.querySelector(`[data-platform="${data.platform}"]`);
    const label = platformLabel(data.platform);

    if (data.type === "platform_start" || data.type === "platform_progress") {
      const msg = data.message || `${label} 処理中...`;
      if (existing) {
        existing.innerHTML = `<span class="ad-progress-dot running"></span> ${msg}`;
      } else {
        area.insertAdjacentHTML("beforeend", `<div class="ad-progress-item" data-platform="${data.platform}"><span class="ad-progress-dot running"></span> ${msg}</div>`);
      }
    } else if (data.type === "platform_done") {
      if (existing) existing.innerHTML = `<span class="ad-progress-dot done"></span> ${label} 完了`;
    } else if (data.type === "platform_error") {
      const errMsg = `${label} エラー: ${esc(data.error)}`;
      if (existing) existing.innerHTML = `<span class="ad-progress-dot error"></span> ${errMsg}`;
      else area.insertAdjacentHTML("beforeend", `<div class="ad-progress-item" data-platform="${data.platform}"><span class="ad-progress-dot error"></span> ${errMsg}</div>`);
    }
  },

  renderSubmissionResult(submission) {
    const area = $("ad-submit-progress");
    if (!area) return;
    let html = `<div class="ad-progress-header">入稿結果 — ${new Date(submission.createdAt).toLocaleString("ja-JP")}</div>`;
    for (const [platform, info] of Object.entries(submission.platforms || {})) {
      const dotClass = info.status === "pending_review" || info.status === "approved" ? "done" : "error";
      html += `<div class="ad-progress-item"><span class="ad-progress-dot ${dotClass}"></span> ${platformLabel(platform)}: ${statusLabel(info.status)}`;
      if (info.error) html += ` <small>${esc(info.error)}</small>`;
      html += `</div>`;
    }
    area.innerHTML = html;
  },

  // ═══════════════════════════════════════════════════
  // Tab4: ステータス
  // ═══════════════════════════════════════════════════
  async loadSubmissions() {
    const container = $("ad-submissions-list");
    if (!container) return;
    const projectId = this.getProjectId();
    if (!projectId) {
      if (this.standalone) {
        // スタンドアロン: プロジェクト選択ドロップダウンを表示
        container.innerHTML = `
          <div class="ad-empty">
            <p>プロジェクトを選択してからステータスを確認してください。</p>
            <div class="ad-form-group" style="max-width:300px;margin:0 auto">
              <select id="ad-status-project" class="form-input" onchange="AdManager.onStatusProjectChange(this.value)">
                <option value="">プロジェクトを選択...</option>
              </select>
            </div>
          </div>`;
        this.loadStatusProjectSelector();
      } else {
        container.innerHTML = '<div class="ad-empty"><p>プロジェクトを選択してください。</p></div>';
      }
      return;
    }
    container.innerHTML = '<div class="ad-loading">読み込み中...</div>';

    try {
      const { submissions } = await API.getAdSubmissions(projectId);
      if (!submissions.length) { container.innerHTML = '<div class="ad-empty"><p>入稿履歴はまだありません。</p></div>'; return; }

      container.innerHTML = `
        <table class="ad-submissions-table">
          <thead><tr><th>日時</th><th>テンプレート</th><th>Google</th><th>Meta</th><th>TikTok</th><th></th></tr></thead>
          <tbody>${submissions.map((s) => `
            <tr>
              <td>${new Date(s.createdAt).toLocaleString("ja-JP", {month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}</td>
              <td>${esc(s.templateName || "-")}</td>
              <td>${renderBadge(s.platforms?.google)}</td>
              <td>${renderBadge(s.platforms?.meta)}</td>
              <td>${renderBadge(s.platforms?.tiktok)}</td>
              <td><button class="btn-sm" onclick="AdManager.showSubmissionDetail('${s.id}')">詳細</button></td>
            </tr>`).join("")}
          </tbody>
        </table>`;
    } catch (err) {
      container.innerHTML = `<div class="ad-error">${esc(err.message)}</div>`;
    }
  },

  async loadStatusProjectSelector() {
    const select = $("ad-status-project");
    if (!select) return;
    try {
      const { projects } = await API.listProjects();
      select.innerHTML = '<option value="">プロジェクトを選択...</option>' +
        projects.map((p) => `<option value="${p.id}">${esc(p.title || p.url || p.id)}</option>`).join("");
    } catch {}
  },

  onStatusProjectChange(projectId) {
    if (projectId) {
      this.selectedProjectId = projectId;
      // 入稿タブのプロジェクトセレクタも同期
      const submitSelect = $("ad-submit-project");
      if (submitSelect) submitSelect.value = projectId;
      this.loadSubmissions();
    }
  },

  async showSubmissionDetail(submissionId) {
    const projectId = this.getProjectId();
    if (!projectId) return;
    try {
      const s = await API.getAdSubmission(projectId, submissionId);
      const detail = $("ad-submission-detail");
      if (!detail) return;

      let html = `<div class="ad-detail-header"><h4>入稿詳細 — ${new Date(s.createdAt).toLocaleString("ja-JP")}</h4>
        <button class="btn-sm" onclick="document.getElementById('ad-submission-detail').style.display='none'">閉じる</button></div>`;
      for (const [platform, info] of Object.entries(s.platforms || {})) {
        html += `<div class="ad-detail-platform"><h5>${platformLabel(platform)} — ${statusLabel(info.status)}</h5>
          ${info.result ? `<pre>${JSON.stringify(info.result, null, 2)}</pre>` : ""}
          ${info.error ? `<div class="ad-error">${esc(info.error)}</div>` : ""}
        </div>`;
      }
      detail.innerHTML = html;
      detail.style.display = "block";
    } catch (err) { this.toast(err.message, "error"); }
  },

  // ═══════════════════════════════════════════════════
  // Tab5: 自動運用エンジン
  // ═══════════════════════════════════════════════════
  autoConfig: null,

  async loadAutoTab() {
    try {
      const config = await API.getAutoOperatorConfig();
      this.autoConfig = config;
      setVal("op-daily-budget", config.dailyBudgetLimit || 100000);
      setVal("op-target-cpa", config.targetCPA || 5000);
      setVal("op-max-cpa", config.maxCPA || 10000);
      setVal("op-target-roas", config.targetROAS || 200);
      setVal("op-interval", config.intervalMinutes || 15);
      setChecked("op-platform-tiktok", config.platforms?.tiktok?.enabled !== false);
      setChecked("op-platform-meta", config.platforms?.meta?.enabled !== false);
      setChecked("op-platform-google", config.platforms?.google?.enabled !== false);
      setChecked("op-platform-line", config.platforms?.line?.enabled !== false);
    } catch {}

    this.refreshAutoStatus();
    this.loadAutoLogs();
  },

  async saveAutoConfig() {
    const config = {
      dailyBudgetLimit: int(getVal("op-daily-budget"), 100000),
      targetCPA: int(getVal("op-target-cpa"), 5000),
      maxCPA: int(getVal("op-max-cpa"), 10000),
      targetROAS: int(getVal("op-target-roas"), 200),
      intervalMinutes: int(getVal("op-interval"), 15),
      platforms: {
        tiktok: { enabled: getChecked("op-platform-tiktok"), initialBudget: int(getVal("op-target-cpa"), 5000) * 2 },
        meta: { enabled: getChecked("op-platform-meta"), initialBudget: int(getVal("op-target-cpa"), 5000) * 2 },
        google: { enabled: getChecked("op-platform-google"), initialBudget: int(getVal("op-target-cpa"), 5000) * 2 },
        line: { enabled: getChecked("op-platform-line"), initialBudget: int(getVal("op-target-cpa"), 5000) * 2 },
      },
    };
    try {
      await API.saveAutoOperatorConfig(config);
      this.toast("運用パラメータを保存しました", "success");
    } catch (err) {
      this.toast(err.message, "error");
    }
  },

  async toggleAutoOperator() {
    const btn = $("btn-auto-toggle");
    try {
      const status = await API.getAutoOperatorStatus();
      if (status.running) {
        await API.stopAutoOperator();
        this.toast("自動運用を停止しました", "info");
      } else {
        // 最新の設定を保存してから開始
        await this.saveAutoConfig();
        await API.startAutoOperator();
        this.toast("自動運用を開始しました", "success");
      }
      this.refreshAutoStatus();
    } catch (err) {
      this.toast(err.message, "error");
    }
  },

  async autoExecuteNow() {
    const btn = $("btn-auto-execute");
    if (btn) { btn.disabled = true; btn.textContent = "実行中..."; }
    try {
      await this.saveAutoConfig();
      const result = await API.autoExecuteNow();
      this.toast(`判定完了: ${result.decisions?.length || 0}件のアクション`, "success");
      this.loadAutoLogs();
      this.refreshAutoStatus();
    } catch (err) {
      this.toast(err.message, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 3l7 4-7 4V3z" fill="currentColor"/></svg> 今すぐ実行'; }
    }
  },

  async refreshAutoStatus() {
    try {
      const status = await API.getAutoOperatorStatus();
      const dot = document.querySelector("#op-status-indicator .op-status-dot");
      const text = $("op-status-text");
      const lastRun = $("op-last-run");
      const btn = $("btn-auto-toggle");

      if (status.running) {
        if (dot) { dot.className = "op-status-dot running"; }
        if (text) text.textContent = "稼働中";
        if (btn) { btn.textContent = "停止"; btn.className = "btn-secondary"; btn.style.background = "rgba(239,68,68,0.08)"; btn.style.color = "var(--red)"; btn.style.borderColor = "rgba(239,68,68,0.3)"; }
      } else {
        if (dot) { dot.className = "op-status-dot stopped"; }
        if (text) text.textContent = "停止中";
        if (btn) { btn.textContent = "開始"; btn.className = "btn-primary"; btn.style = ""; }
      }
      if (lastRun && status.lastRun) {
        lastRun.textContent = `最終実行: ${new Date(status.lastRun).toLocaleString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
      }
    } catch {}
  },

  async loadAutoLogs() {
    const container = $("op-log-list");
    if (!container) return;
    try {
      const { logs } = await API.getAutoOperatorLogs();
      if (!logs || !logs.length) {
        container.innerHTML = '<div class="ad-empty"><p>ログはまだありません</p></div>';
        return;
      }
      const platformColors = { tiktok: "#010101", meta: "#1877f2", google: "#4285f4", line: "#06c755", system: "#8b5cf6" };
      const platformLetters = { tiktok: "T", meta: "M", google: "G", line: "L", system: "S" };

      container.innerHTML = logs.slice(-100).reverse().map((log) => {
        const t = new Date(log.timestamp);
        const time = t.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
        const color = platformColors[log.platform] || "#888";
        const letter = platformLetters[log.platform] || "?";
        const action = log.data?.action || "system";
        return `<div class="op-log-entry">
          <span class="op-log-time">${time}</span>
          <span class="op-log-platform" style="background:${color}">${letter}</span>
          <span class="op-log-message"><span class="op-log-action ${action}">${action}</span>${esc(log.message)}</span>
        </div>`;
      }).join("");
    } catch (err) {
      container.innerHTML = `<div class="ad-error">${esc(err.message)}</div>`;
    }
  },

  // ── ユーティリティ ─────────────────────────────
  toast(message, type = "info") {
    if (typeof window.showToast === "function") {
      window.showToast(message, type);
    } else {
      // スタンドアロン用の簡易トースト
      const container = document.getElementById("toast-container");
      if (!container) { alert(message); return; }
      const toast = document.createElement("div");
      toast.className = `toast ${type}`;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);
    }
  },
};

// ── ヘルパー ─────────────────────────────────────
function $(id) { return document.getElementById(id); }
function on(id, ev, fn) { $(id)?.addEventListener(ev, fn); }
function esc(s) { return s ? String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;") : ""; }
function getVal(id) { return $(id)?.value || ""; }
function setVal(id, v) { const el = $(id); if (el) el.value = v ?? ""; }
function getChecked(id) { return $(id)?.checked || false; }
function setChecked(id, v) { const el = $(id); if (el) el.checked = !!v; }
function int(s, def) { const n = parseInt(s); return isNaN(n) ? def : n; }

function platformLabel(p) { return ({google:"Google Ads",meta:"Meta (FB/IG)",tiktok:"TikTok Ads"})[p] || p; }
function statusLabel(s) { return ({preparing:"準備中",submitting:"入稿中",pending_review:"審査待ち",approved:"承認済み",rejected:"不承認",error:"エラー"})[s] || s; }

function renderBadge(info) {
  if (!info) return '<span class="ad-badge ad-badge-none">-</span>';
  const cls = (info.status==="pending_review"||info.status==="approved") ? "success" : info.status==="error" ? "error" : "pending";
  return `<span class="ad-badge ad-badge-${cls}">${statusLabel(info.status)}</span>`;
}

function renderCreativePreview(platform, creative) {
  if (!creative) return "";
  if (platform === "google") {
    const hl = (creative.headlines||[]).slice(0,3).map(esc).join(" | ");
    const desc = esc((creative.descriptions||[])[0] || "");
    return `<div class="ad-preview-creative"><div class="ad-preview-label">広告プレビュー</div><div class="ad-google-preview"><div class="ad-google-headline">${hl}</div><div class="ad-google-desc">${desc}</div></div></div>`;
  }
  if (platform === "meta") {
    return `<div class="ad-preview-creative"><div class="ad-preview-label">クリエイティブ</div><div style="font-size:13px">${esc(creative.headline)}</div><div style="font-size:12px;color:var(--text-muted);margin-top:4px">${esc(creative.primaryText)}</div></div>`;
  }
  if (platform === "tiktok") {
    return `<div class="ad-preview-creative"><div class="ad-preview-label">広告文</div><div style="font-size:13px">${esc(creative.adText)}</div></div>`;
  }
  return "";
}

function defaultTemplate() {
  return {
    name: "", platforms: ["google","meta","tiktok"],
    budget: { type:"daily", google:{amountYen:3000}, meta:{amountYen:3000}, tiktok:{amountYen:3000} },
    targeting: { ageMin:25, ageMax:54, gender:"ALL", locations:[{type:"country",code:"JP"}], languages:["ja"],
      google:{keywords:[],campaignType:"SEARCH"}, meta:{objective:"OUTCOME_TRAFFIC",optimizationGoal:"LINK_CLICKS"}, tiktok:{objectiveType:"TRAFFIC",optimizationGoal:"CLICK"} },
    schedule: { startDate:"", endDate:"" },
    creative: { headlineSource:"auto", imageStrategy:"auto",
      google:{adType:"RESPONSIVE_SEARCH",path1:"",path2:""}, meta:{adFormat:"SINGLE_IMAGE",callToAction:"LEARN_MORE"}, tiktok:{callToAction:"LEARN_MORE"} },
    naming: { campaignPattern:"{product}_{platform}_{date}", adGroupPattern:"{product}_{targeting}_{date}", variables:{product:""} },
  };
}

// ── API ラッパー（スタンドアロン用 inline API） ──────
const API = window.API || (() => {
  async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timeoutMs = options.timeout || 120000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const { timeout: _, ...fetchOpts } = options;
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        ...fetchOpts,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    listProjects: () => fetchJson("/api/projects"),
    getAdTemplates: () => fetchJson("/api/ad-templates"),
    createAdTemplate: (data) => fetchJson("/api/ad-templates", { method: "POST", body: JSON.stringify(data) }),
    updateAdTemplate: (id, data) => fetchJson(`/api/ad-templates/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteAdTemplate: (id) => fetchJson(`/api/ad-templates/${id}`, { method: "DELETE" }),
    validateAdTemplate: (id) => fetchJson(`/api/ad-templates/${id}/validate`),
    saveAdCredentials: (platform, data) => fetchJson(`/api/ad-platforms/${platform}/credentials`, { method: "POST", body: JSON.stringify(data) }),
    getAdPlatformStatus: () => fetchJson("/api/ad-platforms/status"),
    extractCreatives: (projectId) => fetchJson(`/api/projects/${projectId}/extract-creatives`, { method: "POST" }),
    adSubmitPreview: (projectId, data) => fetchJson(`/api/projects/${projectId}/ad-submit/preview`, { method: "POST", body: JSON.stringify(data) }),
    connectAdSubmitSSE(projectId, data, handlers) {
      const controller = new AbortController();
      fetch(`/api/projects/${projectId}/ad-submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal: controller.signal,
      }).then(async (resp) => {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const eventData = JSON.parse(line.slice(6));
                if (eventData.type === "done") handlers.onComplete?.(eventData.submission);
                else if (eventData.type === "error") handlers.onError?.(eventData);
                else handlers.onProgress?.(eventData);
              } catch {}
            }
          }
        }
        handlers.onClose?.();
      }).catch((err) => {
        if (err.name !== "AbortError") handlers.onError?.({ message: err.message });
      });
      return { abort: () => controller.abort() };
    },
    getAdSubmissions: (projectId) => fetchJson(`/api/projects/${projectId}/ad-submissions`),
    getAdSubmission: (projectId, sid) => fetchJson(`/api/projects/${projectId}/ad-submissions/${sid}`),
    // 自動運用
    getAutoOperatorConfig: () => fetchJson("/api/auto-operator/config"),
    saveAutoOperatorConfig: (data) => fetchJson("/api/auto-operator/config", { method: "PUT", body: JSON.stringify(data) }),
    startAutoOperator: () => fetchJson("/api/auto-operator/start", { method: "POST" }),
    stopAutoOperator: () => fetchJson("/api/auto-operator/stop", { method: "POST" }),
    getAutoOperatorStatus: () => fetchJson("/api/auto-operator/status"),
    autoExecuteNow: () => fetchJson("/api/auto-operator/execute-now", { method: "POST" }),
    getAutoOperatorLogs: (date) => fetchJson(`/api/auto-operator/logs${date ? "?date=" + date : ""}`),
  };
})();

window.AdManager = AdManager;
document.addEventListener("DOMContentLoaded", () => AdManager.init());
