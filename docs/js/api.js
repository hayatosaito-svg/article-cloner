/**
 * api.js - Fetch wrapper + SSE connection
 */

export const API = {
  async listProjects() {
    return fetchJson("/api/projects");
  },

  async createProject(url) {
    const res = await fetchJson("/api/projects", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
    return res;
  },

  async getProject(id) {
    return fetchJson(`/api/projects/${id}`);
  },

  async getBlock(projectId, idx) {
    return fetchJson(`/api/projects/${projectId}/blocks/${idx}`);
  },

  async updateBlock(projectId, idx, data) {
    return fetchJson(`/api/projects/${projectId}/blocks/${idx}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async describeImage(projectId, idx, data = {}) {
    return fetchJson(`/api/projects/${projectId}/describe-image/${idx}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async generateImage(projectId, idx, data) {
    return fetchJson(`/api/projects/${projectId}/generate-image/${idx}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async textModify(projectId, config) {
    return fetchJson(`/api/projects/${projectId}/text-modify`, {
      method: "POST",
      body: JSON.stringify(config),
    });
  },

  async oneClickImage(projectId, idx, data) {
    return fetchJson(`/api/projects/${projectId}/one-click-image/${idx}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async applyImage(projectId, idx, data) {
    return fetchJson(`/api/projects/${projectId}/apply-image/${idx}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async getTextBlocks(projectId) {
    return fetchJson(`/api/projects/${projectId}/text-blocks`);
  },

  async uploadImage(projectId, idx, data) {
    return fetchJson(`/api/projects/${projectId}/upload-image/${idx}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async uploadFree(projectId, data) {
    return fetchJson(`/api/projects/${projectId}/upload-free`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async aiFromReference(projectId, data) {
    return fetchJson(`/api/projects/${projectId}/ai-from-reference`, {
      method: "POST",
      body: JSON.stringify(data),
      timeout: 120000,
    });
  },

  async describeUploaded(projectId, data) {
    return fetchJson(`/api/projects/${projectId}/describe-uploaded`, {
      method: "POST",
      body: JSON.stringify(data),
      timeout: 60000,
    });
  },

  async composeImages(projectId, data) {
    return fetchJson(`/api/projects/${projectId}/compose-images`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async generateVideo(projectId, idx, data) {
    return fetchJson(`/api/projects/${projectId}/generate-video/${idx}`, {
      method: "POST",
      body: JSON.stringify(data),
      timeout: 200000,
    });
  },

  async describeVideo(projectId, idx, data = {}) {
    return fetchJson(`/api/projects/${projectId}/describe-video/${idx}`, {
      method: "POST",
      body: JSON.stringify(data),
      timeout: 30000,
    });
  },

  async uploadVideo(projectId, idx, data) {
    return fetchJson(`/api/projects/${projectId}/upload-video/${idx}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async insertBlock(projectId, data) {
    return fetchJson(`/api/projects/${projectId}/blocks/insert`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async deleteBlock(projectId, idx) {
    return fetchJson(`/api/projects/${projectId}/blocks/${idx}`, {
      method: "DELETE",
    });
  },

  async reorderBlock(projectId, data) {
    return fetchJson(`/api/projects/${projectId}/blocks/reorder`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async aiRewrite(projectId, idx, data) {
    return fetchJson(`/api/projects/${projectId}/ai-rewrite/${idx}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async getSnapshot(projectId) {
    return fetchJson(`/api/projects/${projectId}/snapshot`);
  },

  async restore(projectId, data) {
    return fetchJson(`/api/projects/${projectId}/restore`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async getTagSettings(projectId) {
    return fetchJson(`/api/projects/${projectId}/tag-settings`);
  },

  async saveTagSettings(projectId, data) {
    return fetchJson(`/api/projects/${projectId}/tag-settings`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async getExitPopup(projectId) {
    return fetchJson(`/api/projects/${projectId}/exit-popup`);
  },

  async saveExitPopup(projectId, data) {
    return fetchJson(`/api/projects/${projectId}/exit-popup`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async getWidgetTemplates() {
    return fetchJson("/api/widget-templates");
  },

  async saveWidgetTemplate(data) {
    return fetchJson("/api/widget-templates", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updateWidgetTemplate(id, data) {
    return fetchJson(`/api/widget-templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async deleteWidgetTemplate(id) {
    return fetchJson(`/api/widget-templates/${id}`, {
      method: "DELETE",
    });
  },

  async build(projectId, config = {}) {
    return fetchJson(`/api/projects/${projectId}/build`, {
      method: "POST",
      body: JSON.stringify(config),
    });
  },

  async publish(projectId) {
    return fetchJson(`/api/projects/${projectId}/publish`, {
      method: "POST",
      timeout: 60000,
    });
  },

  async setCloudflareConfig(data) {
    return fetchJson("/api/set-cloudflare", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async getCloudflareStatus() {
    return fetchJson("/api/cloudflare-status");
  },

  getExportUrl(projectId) {
    return `/api/projects/${projectId}/export`;
  },

  getPreviewUrl(projectId) {
    return `/api/projects/${projectId}/preview`;
  },

  async extractElements(projectId, idx) {
    return fetchJson(`/api/projects/${projectId}/extract-elements/${idx}`, {
      method: "POST",
      timeout: 60000,
    });
  },

  async cropLayers(projectId, idx, data) {
    return fetchJson(`/api/projects/${projectId}/crop-layers/${idx}`, {
      method: "POST",
      body: JSON.stringify(data),
      timeout: 60000,
    });
  },

  async layerEdit(projectId, idx, data) {
    return fetchJson(`/api/projects/${projectId}/layer-edit/${idx}`, {
      method: "POST",
      body: JSON.stringify(data),
      timeout: 120000,
    });
  },

  async removeText(projectId, idx, textRegions) {
    return fetchJson(`/api/projects/${projectId}/remove-text/${idx}`, {
      method: "POST",
      body: JSON.stringify({ textRegions }),
      timeout: 120000,
    });
  },

  async decomposeLayers(projectId, idx, data = {}) {
    return fetchJson(`/api/projects/${projectId}/decompose-layers/${idx}`, {
      method: "POST",
      body: JSON.stringify(data),
      timeout: 300000,
    });
  },

  async ocrLayer(projectId, imageUrl) {
    return fetchJson(`/api/projects/${projectId}/ocr-layer`, {
      method: "POST",
      body: JSON.stringify({ imageUrl }),
      timeout: 60000,
    });
  },

  async exportLayers(projectId, idx, data) {
    return fetchJson(`/api/projects/${projectId}/export-layers/${idx}`, {
      method: "POST",
      body: JSON.stringify(data),
      timeout: 120000,
    });
  },

  async searchImages(query, source) {
    return fetchJson("/api/search-images", {
      method: "POST",
      body: JSON.stringify({ query, source }),
    });
  },

  async autoKeywords(projectId, idx) {
    return fetchJson(`/api/projects/${projectId}/auto-keywords/${idx}`, {
      method: "POST",
      timeout: 30000,
    });
  },

  async getProjectImages(projectId) {
    return fetchJson(`/api/projects/${projectId}/images`);
  },

  async getUsageStats() {
    return fetchJson("/api/usage-stats");
  },

  // ── 広告テンプレートCRUD ──────────────────────────
  async getAdTemplates() {
    return fetchJson("/api/ad-templates");
  },

  async createAdTemplate(data) {
    return fetchJson("/api/ad-templates", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updateAdTemplate(id, data) {
    return fetchJson(`/api/ad-templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async deleteAdTemplate(id) {
    return fetchJson(`/api/ad-templates/${id}`, {
      method: "DELETE",
    });
  },

  async validateAdTemplate(id) {
    return fetchJson(`/api/ad-templates/${id}/validate`);
  },

  // ── 広告プラットフォーム認証 ──────────────────────
  async saveAdCredentials(platform, data) {
    return fetchJson(`/api/ad-platforms/${platform}/credentials`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async getAdPlatformStatus() {
    return fetchJson("/api/ad-platforms/status");
  },

  // ── 広告入稿 ────────────────────────────────
  async extractCreatives(projectId) {
    return fetchJson(`/api/projects/${projectId}/extract-creatives`, {
      method: "POST",
    });
  },

  async adSubmitPreview(projectId, data) {
    return fetchJson(`/api/projects/${projectId}/ad-submit/preview`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  connectAdSubmitSSE(projectId, data, handlers) {
    // SSE via POST (using EventSource polyfill pattern with fetch)
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
              if (eventData.type === "done") {
                handlers.onComplete?.(eventData.submission);
              } else if (eventData.type === "error") {
                handlers.onError?.(eventData);
              } else {
                handlers.onProgress?.(eventData);
              }
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

  async getAdSubmissions(projectId) {
    return fetchJson(`/api/projects/${projectId}/ad-submissions`);
  },

  async getAdSubmission(projectId, submissionId) {
    return fetchJson(`/api/projects/${projectId}/ad-submissions/${submissionId}`);
  },

  // ── 自動運用エンジン ───────────────────────────
  async getAutoOperatorConfig() {
    return fetchJson("/api/auto-operator/config");
  },

  async saveAutoOperatorConfig(data) {
    return fetchJson("/api/auto-operator/config", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async startAutoOperator() {
    return fetchJson("/api/auto-operator/start", { method: "POST" });
  },

  async stopAutoOperator() {
    return fetchJson("/api/auto-operator/stop", { method: "POST" });
  },

  async getAutoOperatorStatus() {
    return fetchJson("/api/auto-operator/status");
  },

  async autoExecuteNow() {
    return fetchJson("/api/auto-operator/execute-now", { method: "POST" });
  },

  async getAutoOperatorLogs(date) {
    return fetchJson(`/api/auto-operator/logs${date ? "?date=" + date : ""}`);
  },

  connectSSE(projectId, handlers) {
    const es = new EventSource(`/api/projects/${projectId}/sse`);

    es.addEventListener("progress", (e) => {
      try {
        const data = JSON.parse(e.data);
        handlers.onProgress?.(data);
      } catch {}
    });

    es.addEventListener("ready", (e) => {
      try {
        const data = JSON.parse(e.data);
        handlers.onReady?.(data);
      } catch {}
      es.close();
    });

    es.addEventListener("error", (e) => {
      if (e.data) {
        try {
          const data = JSON.parse(e.data);
          handlers.onError?.(data);
        } catch {}
      }
      es.close();
    });

    es.onerror = () => {};

    return es;
  },
};

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

window.API = API;
