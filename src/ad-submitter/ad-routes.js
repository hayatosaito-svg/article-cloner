/**
 * ad-routes.js - 広告入稿 Express Router
 *
 * /api/ad-* ルートを分離してserver.js肥大化防止。
 * テンプレートCRUD、認証情報管理、入稿実行、ステータス管理。
 */
import { Router } from "express";
import { templateManager } from "./template-manager.js";
import { validateTemplate } from "./validators.js";
import { adSubmitter } from "./index.js";

export function createAdRoutes(getProject) {
  const router = Router();

  // ── テンプレートCRUD ────────────────────────────

  router.get("/api/ad-templates", async (req, res) => {
    try {
      const templates = await templateManager.list();
      res.json({ templates });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/api/ad-templates", async (req, res) => {
    try {
      if (!req.body.name) {
        return res.status(400).json({ error: "テンプレート名は必須です" });
      }
      const template = await templateManager.create(req.body);
      res.json({ ok: true, template });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put("/api/ad-templates/:id", async (req, res) => {
    try {
      const template = await templateManager.update(req.params.id, req.body);
      if (!template) return res.status(404).json({ error: "テンプレートが見つかりません" });
      res.json({ ok: true, template });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete("/api/ad-templates/:id", async (req, res) => {
    try {
      const deleted = await templateManager.delete(req.params.id);
      if (!deleted) return res.status(404).json({ error: "テンプレートが見つかりません" });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/api/ad-templates/:id/validate", async (req, res) => {
    try {
      const template = await templateManager.get(req.params.id);
      if (!template) return res.status(404).json({ error: "テンプレートが見つかりません" });
      const result = validateTemplate(template);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 認証情報 ────────────────────────────────

  router.post("/api/ad-platforms/:platform/credentials", async (req, res) => {
    try {
      const { platform } = req.params;
      if (!["google", "meta", "tiktok"].includes(platform)) {
        return res.status(400).json({ error: "不明なプラットフォームです" });
      }
      await adSubmitter.saveCredentials(platform, req.body);

      // 接続テスト
      const client = adSubmitter.clients[platform];
      let testResult = { connected: false };
      if (client.isConfigured()) {
        testResult = await client.testConnection();
      }

      res.json({ ok: true, ...testResult });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/api/ad-platforms/status", async (req, res) => {
    try {
      const status = await adSubmitter.getPlatformStatus();
      res.json(status);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── クリエイティブ抽出 ─────────────────────────

  router.post("/api/projects/:id/extract-creatives", (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "プロジェクトが見つかりません" });

    try {
      const creatives = adSubmitter.extractCreatives(project);
      res.json(creatives);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 入稿プレビュー ─────────────────────────

  router.post("/api/projects/:id/ad-submit/preview", async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "プロジェクトが見つかりません" });

    try {
      const { templateId, lpUrl } = req.body;
      if (!templateId) return res.status(400).json({ error: "テンプレートIDは必須です" });

      const preview = await adSubmitter.preview(project, templateId, lpUrl || project.url);
      res.json(preview);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 入稿実行（SSE経由の非同期） ─────────────

  router.post("/api/projects/:id/ad-submit", async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "プロジェクトが見つかりません" });

    const { templateId, platforms, lpUrl } = req.body;
    if (!templateId) return res.status(400).json({ error: "テンプレートIDは必須です" });

    // SSEレスポンス
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(":\n\n");

    const sendEvent = (data) => {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {}
    };

    try {
      const submission = await adSubmitter.submit(project, {
        templateId,
        platforms,
        lpUrl: lpUrl || project.url,
        onProgress: sendEvent,
      });

      sendEvent({ type: "done", submission });
    } catch (err) {
      sendEvent({ type: "error", message: err.message });
    } finally {
      res.end();
    }
  });

  // ── 入稿履歴 ─────────────────────────────

  router.get("/api/projects/:id/ad-submissions", async (req, res) => {
    try {
      const submissions = await adSubmitter.getSubmissions(req.params.id);
      res.json({ submissions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/api/projects/:id/ad-submissions/:sid", async (req, res) => {
    try {
      const submission = await adSubmitter.getSubmission(req.params.id, req.params.sid);
      if (!submission) return res.status(404).json({ error: "入稿記録が見つかりません" });
      res.json(submission);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
