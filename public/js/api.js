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

  async aiRewrite(projectId, idx, data) {
    return fetchJson(`/api/projects/${projectId}/ai-rewrite/${idx}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async build(projectId, config = {}) {
    return fetchJson(`/api/projects/${projectId}/build`, {
      method: "POST",
      body: JSON.stringify(config),
    });
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
