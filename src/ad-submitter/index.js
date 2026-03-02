/**
 * index.js - AdSubmitter メインオーケストレーター
 *
 * テンプレート選択 → クリエイティブ抽出 → 媒体別バリデーション →
 * 並列入稿 → ステータス管理 のワークフローを統括。
 *
 * 将来のバナー自動生成・データ回収・自動運用との連携を前提としたインターフェース設計。
 */
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { PROJECT_ROOT } from "../utils.js";
import { templateManager } from "./template-manager.js";
import { validateTemplate, validateCreative } from "./validators.js";
import { extractCreatives, generatePreview } from "./creative-extractor.js";
import { GoogleAdsClient } from "./platforms/google-ads.js";
import { MetaAdsClient } from "./platforms/meta-ads.js";
import { TikTokAdsClient } from "./platforms/tiktok-ads.js";

const SUBMISSIONS_DIR = path.join(PROJECT_ROOT, "data", "ad-submissions");

// 入稿ステータス
const STATUS = {
  PREPARING: "preparing",
  SUBMITTING: "submitting",
  PENDING_REVIEW: "pending_review",
  APPROVED: "approved",
  REJECTED: "rejected",
  ERROR: "error",
};

export class AdSubmitter {
  constructor() {
    this.clients = {
      google: GoogleAdsClient.fromEnv(),
      meta: MetaAdsClient.fromEnv(),
      tiktok: TikTokAdsClient.fromEnv(),
    };
  }

  /** 各媒体の接続状態を取得 */
  async getPlatformStatus() {
    const status = {};
    for (const [name, client] of Object.entries(this.clients)) {
      status[name] = {
        configured: client.isConfigured(),
        connected: false,
        details: null,
      };
      if (client.isConfigured()) {
        try {
          const result = await client.testConnection();
          status[name].connected = result.connected;
          status[name].details = result;
        } catch (err) {
          status[name].details = { error: err.message };
        }
      }
    }
    return status;
  }

  /** 認証情報を保存 (.envファイルに書き込み) */
  async saveCredentials(platform, credentials) {
    const envPath = path.join(PROJECT_ROOT, ".env");
    let envContent = "";

    try {
      if (existsSync(envPath)) {
        envContent = await readFile(envPath, "utf-8");
      }
    } catch {}

    const keyMap = {
      google: {
        clientId: "GOOGLE_ADS_CLIENT_ID",
        clientSecret: "GOOGLE_ADS_CLIENT_SECRET",
        developerToken: "GOOGLE_ADS_DEVELOPER_TOKEN",
        refreshToken: "GOOGLE_ADS_REFRESH_TOKEN",
        managerAccountId: "GOOGLE_ADS_MANAGER_ACCOUNT_ID",
        customerAccountId: "GOOGLE_ADS_CUSTOMER_ACCOUNT_ID",
      },
      meta: {
        appId: "META_APP_ID",
        appSecret: "META_APP_SECRET",
        accessToken: "META_ACCESS_TOKEN",
        adAccountId: "META_AD_ACCOUNT_ID",
        pageId: "META_PAGE_ID",
      },
      tiktok: {
        appId: "TIKTOK_APP_ID",
        appSecret: "TIKTOK_APP_SECRET",
        accessToken: "TIKTOK_ACCESS_TOKEN",
        refreshToken: "TIKTOK_REFRESH_TOKEN",
        advertiserId: "TIKTOK_ADVERTISER_ID",
      },
    };

    const mapping = keyMap[platform];
    if (!mapping) throw new Error(`不明なプラットフォーム: ${platform}`);

    for (const [field, envKey] of Object.entries(mapping)) {
      if (credentials[field] !== undefined) {
        const val = credentials[field];
        // 既存の行を置き換え or 追加
        const regex = new RegExp(`^${envKey}=.*$`, "m");
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${envKey}=${val}`);
        } else {
          envContent += `\n${envKey}=${val}`;
        }
        // process.env にも反映
        process.env[envKey] = val;
      }
    }

    await writeFile(envPath, envContent.trim() + "\n", "utf-8");

    // クライアントを再初期化
    this.clients[platform] = {
      google: GoogleAdsClient.fromEnv,
      meta: MetaAdsClient.fromEnv,
      tiktok: TikTokAdsClient.fromEnv,
    }[platform]();

    return { ok: true };
  }

  /** プレビュー（ドライラン） */
  async preview(project, templateId, lpUrl) {
    const template = await templateManager.get(templateId);
    if (!template) throw new Error("テンプレートが見つかりません");

    const creatives = extractCreatives(project);
    return generatePreview(template, creatives, lpUrl);
  }

  /** クリエイティブ抽出 */
  extractCreatives(project) {
    return extractCreatives(project);
  }

  /** 入稿実行（非同期） */
  async submit(project, { templateId, platforms, lpUrl, onProgress }) {
    const template = await templateManager.get(templateId);
    if (!template) throw new Error("テンプレートが見つかりません");

    // バリデーション
    const validation = validateTemplate(template);
    if (!validation.valid) {
      throw new Error(`テンプレートバリデーションエラー: ${validation.errors.map((e) => e.message).join(", ")}`);
    }

    // クリエイティブ抽出
    const creatives = extractCreatives(project);

    // 入稿レコード作成
    const submissionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const submission = {
      id: submissionId,
      projectId: project.id,
      templateId,
      templateName: template.name,
      lpUrl,
      platforms: {},
      status: STATUS.SUBMITTING,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const targetPlatforms = platforms || template.platforms;
    for (const p of targetPlatforms) {
      submission.platforms[p] = { status: STATUS.PREPARING, result: null, error: null };
    }

    await this._saveSubmission(project.id, submission);
    onProgress?.({ type: "start", submissionId, platforms: targetPlatforms });

    // 各媒体に並列入稿
    const promises = targetPlatforms.map(async (platform) => {
      const client = this.clients[platform];
      if (!client?.isConfigured()) {
        submission.platforms[platform] = {
          status: STATUS.ERROR,
          error: `${platform}の認証情報が設定されていません`,
        };
        onProgress?.({ type: "platform_error", platform, error: submission.platforms[platform].error });
        return;
      }

      // 媒体別クリエイティブバリデーション
      const creativeData = creatives[platform];
      const creativeValidation = validateCreative(creativeData, platform);
      if (!creativeValidation.valid) {
        submission.platforms[platform] = {
          status: STATUS.ERROR,
          error: creativeValidation.errors.map((e) => e.message).join(", "),
        };
        onProgress?.({ type: "platform_error", platform, error: submission.platforms[platform].error });
        return;
      }

      submission.platforms[platform].status = STATUS.SUBMITTING;
      onProgress?.({ type: "platform_start", platform });

      try {
        const result = await client.submit({
          template,
          creative: {
            ...creativeData,
            imagePath: creatives.raw.images[0] || null,
            imageUrl: null,
          },
          lpUrl,
          onProgress: (stepData) => {
            onProgress?.({ type: "platform_progress", platform, ...stepData });
          },
        });

        if (result.success) {
          submission.platforms[platform] = {
            status: STATUS.PENDING_REVIEW,
            result,
            error: null,
          };
          onProgress?.({ type: "platform_done", platform, result });
        } else {
          submission.platforms[platform] = {
            status: STATUS.ERROR,
            result,
            error: result.error,
          };
          onProgress?.({ type: "platform_error", platform, error: result.error });
        }
      } catch (err) {
        submission.platforms[platform] = {
          status: STATUS.ERROR,
          error: err.message,
        };
        onProgress?.({ type: "platform_error", platform, error: err.message });
      }
    });

    await Promise.allSettled(promises);

    // 全体ステータス更新
    const statuses = Object.values(submission.platforms).map((p) => p.status);
    if (statuses.every((s) => s === STATUS.ERROR)) {
      submission.status = STATUS.ERROR;
    } else if (statuses.some((s) => s === STATUS.PENDING_REVIEW)) {
      submission.status = STATUS.PENDING_REVIEW;
    } else {
      submission.status = STATUS.ERROR;
    }

    submission.updatedAt = Date.now();
    await this._saveSubmission(project.id, submission);
    onProgress?.({ type: "complete", submission });

    return submission;
  }

  /** 入稿履歴の取得 */
  async getSubmissions(projectId) {
    const dirPath = path.join(SUBMISSIONS_DIR, projectId);
    if (!existsSync(dirPath)) return [];

    const { readdir } = await import("fs/promises");
    const files = await readdir(dirPath);
    const submissions = [];

    for (const file of files.sort().reverse()) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(path.join(dirPath, file), "utf-8");
        submissions.push(JSON.parse(raw));
      } catch {}
    }

    return submissions;
  }

  /** 入稿詳細の取得 */
  async getSubmission(projectId, submissionId) {
    const filePath = path.join(SUBMISSIONS_DIR, projectId, `${submissionId}.json`);
    if (!existsSync(filePath)) return null;
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw);
  }

  /** 入稿レコードの保存 */
  async _saveSubmission(projectId, submission) {
    const dirPath = path.join(SUBMISSIONS_DIR, projectId);
    if (!existsSync(dirPath)) await mkdir(dirPath, { recursive: true });
    const filePath = path.join(dirPath, `${submission.id}.json`);
    await writeFile(filePath, JSON.stringify(submission, null, 2), "utf-8");
  }
}

export const adSubmitter = new AdSubmitter();
