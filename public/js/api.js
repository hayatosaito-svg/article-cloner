/**
 * api.js - Fetch wrapper + SSE connection
 */

export const API = {
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

  async describeImage(projectId, idx) {
    return fetchJson(`/api/projects/${projectId}/describe-image/${idx}`, {
      method: "POST",
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
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      ...options,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

window.API = API;
