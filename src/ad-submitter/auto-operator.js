/**
 * auto-operator.js - アドアフィ特化型 AI自動運用エンジン
 *
 * 媒体別・時間帯別の詳細運用ロジックに従い、
 * 予算増減・入札調整・広告ON/OFFを自律的に判定・実行する。
 */
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const PROJECT_ROOT = process.cwd();
const CONFIG_PATH = path.join(PROJECT_ROOT, "data", "operator-config.json");
const LOGS_DIR = path.join(PROJECT_ROOT, "data", "operator-logs");

// ── デフォルト設定 ─────────────────────────────────
const DEFAULT_CONFIG = {
  enabled: false,
  intervalMinutes: 15,
  dailyBudgetLimit: 100000,   // 本日の上限予算（円）
  targetCPA: 5000,            // 目標CPA（円）
  maxCPA: 10000,              // 撤退CPA（限界CPA）（円）
  targetROAS: 200,            // 目標ROAS（%）
  platforms: {
    tiktok:  { enabled: true, initialBudget: 10000 },
    meta:    { enabled: true, initialBudget: 10000 },
    google:  { enabled: true, initialBudget: 10000 },
    line:    { enabled: true, initialBudget: 10000 },
  },
};

// ── 自動運用エンジン ─────────────────────────────────
export class AutoOperator {
  constructor(platformClients = {}) {
    this.clients = platformClients; // { tiktok, meta, google, line }
    this.config = { ...DEFAULT_CONFIG };
    this.running = false;
    this.timer = null;
    this.lastRun = null;
    this.todayActions = []; // 本日の実行アクション
    this.todaySpend = 0;
  }

  // ── 設定管理 ──────────────────────────────────────
  async loadConfig() {
    try {
      if (existsSync(CONFIG_PATH)) {
        const raw = await readFile(CONFIG_PATH, "utf-8");
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      }
    } catch { /* use defaults */ }
    return this.config;
  }

  async saveConfig(updates) {
    this.config = { ...this.config, ...updates };
    await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify(this.config, null, 2));
    const check = this.validateBeforeRun();
    return { ...this.config, _validation: check };
  }

  getConfig() {
    return this.config;
  }

  // ── 安全バリデーション（上限未設定で配信不可） ──────
  validateBeforeRun() {
    const errors = [];
    const c = this.config;

    if (!c.dailyBudgetLimit || c.dailyBudgetLimit <= 0) {
      errors.push("本日の上限予算が設定されていません");
    }
    if (!c.targetCPA || c.targetCPA <= 0) {
      errors.push("目標CPAが設定されていません");
    }
    if (!c.maxCPA || c.maxCPA <= 0) {
      errors.push("撤退CPA（限界CPA）が設定されていません");
    }
    if (c.maxCPA && c.targetCPA && c.maxCPA < c.targetCPA) {
      errors.push("撤退CPAは目標CPA以上に設定してください");
    }
    if (!c.targetROAS || c.targetROAS <= 0) {
      errors.push("目標ROASが設定されていません");
    }
    if (c.dailyBudgetLimit && c.dailyBudgetLimit > 10000000) {
      errors.push("上限予算が1,000万円を超えています。意図的な場合は確認してください");
    }

    // 対象媒体が1つもない
    const anyEnabled = Object.values(c.platforms || {}).some(p => p?.enabled);
    if (!anyEnabled) {
      errors.push("対象媒体が1つも選択されていません");
    }

    return { valid: errors.length === 0, errors };
  }

  // ── スケジューラ ──────────────────────────────────
  async start() {
    await this.loadConfig();

    // 上限バリデーション（未設定なら起動拒否）
    const check = this.validateBeforeRun();
    if (!check.valid) {
      return { status: "error", errors: check.errors };
    }

    if (this.running) return { status: "already_running" };
    this.running = true;
    this.config.enabled = true;
    await this.saveConfig({ enabled: true });
    this.scheduleNext();
    this.log("system", `自動運用を開始しました（上限: ¥${this.config.dailyBudgetLimit.toLocaleString()} / 目標CPA: ¥${this.config.targetCPA.toLocaleString()} / 撤退CPA: ¥${this.config.maxCPA.toLocaleString()}）`, {});
    return { status: "started" };
  }

  stop() {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.config.enabled = false;
    this.saveConfig({ enabled: false }).catch(() => {});
    this.log("system", "自動運用を停止しました", {});
    return { status: "stopped" };
  }

  scheduleNext() {
    if (!this.running) return;
    const ms = (this.config.intervalMinutes || 15) * 60 * 1000;
    this.timer = setTimeout(() => this.runCycle(), ms);
  }

  getStatus() {
    return {
      running: this.running,
      lastRun: this.lastRun,
      config: this.config,
      todayActions: this.todayActions.slice(-50),
      todaySpend: this.todaySpend,
    };
  }

  // ── メイン判定サイクル ─────────────────────────────
  async runCycle() {
    const now = new Date();
    const jstHour = getJSTHour(now);
    this.lastRun = now.toISOString();
    const decisions = [];

    try {
      // 各媒体のパフォーマンスデータ取得 & ルール適用
      for (const platform of ["tiktok", "meta", "google", "line"]) {
        if (!this.config.platforms[platform]?.enabled) continue;
        const client = this.clients[platform];
        if (!client) continue;

        try {
          const campaigns = await this.getCampaignData(platform, client);
          const platformDecisions = this.evaluate(platform, campaigns, jstHour);
          decisions.push(...platformDecisions);
        } catch (err) {
          this.log(platform, `データ取得エラー: ${err.message}`, { error: true });
        }
      }

      // 予算上限チェック（絶対死守）
      this.enforceBudgetCeiling(decisions);

      // 判定を実行
      for (const d of decisions) {
        await this.executeDecision(d);
      }

      this.log("system", `判定サイクル完了: ${decisions.length}件のアクション`, { hour: jstHour, count: decisions.length });
    } catch (err) {
      this.log("system", `サイクルエラー: ${err.message}`, { error: true });
    }

    this.scheduleNext();
    return decisions;
  }

  // ── 媒体別データ取得 ──────────────────────────────
  async getCampaignData(platform, client) {
    // 各プラットフォームAPIから今日のキャンペーンデータを取得
    // 実装は各クライアントの getCampaigns / getStats メソッドに依存
    if (typeof client.getActiveCampaigns === "function") {
      return await client.getActiveCampaigns();
    }
    return [];
  }

  // ── 媒体別ルール評価 ──────────────────────────────
  evaluate(platform, campaigns, hour) {
    switch (platform) {
      case "tiktok": return this.evaluateTikTok(campaigns, hour);
      case "meta":   return this.evaluateMeta(campaigns, hour);
      case "google":  return this.evaluateGoogle(campaigns, hour);
      case "line":    return this.evaluateLINE(campaigns, hour);
      default: return [];
    }
  }

  // ═══════════════════════════════════════════════════════
  // TikTok / Pangle ルール
  // ═══════════════════════════════════════════════════════
  evaluateTikTok(campaigns, hour) {
    const decisions = [];
    const { targetCPA } = this.config;
    const initialBudget = this.config.platforms.tiktok?.initialBudget || targetCPA * 2;

    for (const c of campaigns) {
      const { id, name, spend = 0, conversions = 0, cpa, cpm, status, dailyBudget = 0 } = c;
      const actualCPA = conversions > 0 ? spend / conversions : Infinity;

      // [0:00-5:00] 配信OFF
      if (hour >= 0 && hour < 5) {
        if (status === "active") {
          decisions.push(this.decision("tiktok", id, name, "pause", "0:00-5:00 CVR低下リスク回避のため配信OFF"));
        }
        continue;
      }

      // [5:00-9:00] 配信ON、日予算リセット
      if (hour >= 5 && hour < 9) {
        if (status === "paused") {
          decisions.push(this.decision("tiktok", id, name, "resume", "5:00 配信再開"));
          decisions.push(this.decision("tiktok", id, name, "set_budget", `日予算を初期値 ¥${initialBudget.toLocaleString()} にリセット`, { budget: initialBudget }));
        }
        continue;
      }

      // [9:00-12:00] 勝負所
      if (hour >= 9 && hour < 12) {
        // CV発生で増額
        if (conversions >= 1 && dailyBudget < initialBudget * 3) {
          const newBudget = Math.min(dailyBudget + 10000, initialBudget * 3);
          decisions.push(this.decision("tiktok", id, name, "set_budget", `CV発生（${conversions}件） 日予算を ¥${newBudget.toLocaleString()} に増額`, { budget: newBudget }));
        }
        // 4000-5000円消化でCV=0 → 即停止
        if (spend >= 4000 && conversions === 0) {
          decisions.push(this.decision("tiktok", id, name, "pause", `¥${spend.toLocaleString()} 消化でCV=0 損切り停止`));
        }
        continue;
      }

      // [12:00-16:00] 増額ペース低下
      if (hour >= 12 && hour < 16) {
        const maxBudget = initialBudget * 2;
        if (dailyBudget > maxBudget && conversions > 0) {
          decisions.push(this.decision("tiktok", id, name, "set_budget", `16時に向け日予算を ¥${maxBudget.toLocaleString()} に抑制`, { budget: maxBudget }));
        }
        // CPM高騰チェック（搾取モード検出）
        if (cpm && cpm > 3000 && conversions === 0) {
          decisions.push(this.decision("tiktok", id, name, "pause", `CPM高騰 ¥${cpm} + CV=0 搾取モード検出 → 停止`));
        }
        continue;
      }

      // [16:00-19:00] 維持・増額禁止
      if (hour >= 16 && hour < 19) {
        // 搾取モード検出
        if (cpm && cpm > 3000 && actualCPA > targetCPA) {
          decisions.push(this.decision("tiktok", id, name, "reduce_budget", `CPM高騰+CPA悪化 マイナスシグナル送信`, { budget: Math.round(dailyBudget * 0.5) }));
        }
        continue;
      }

      // [19:00-24:00] 実CPA > tCPA なら即停止
      if (hour >= 19) {
        if (actualCPA > targetCPA) {
          decisions.push(this.decision("tiktok", id, name, "pause", `19時以降 実CPA ¥${Math.round(actualCPA).toLocaleString()} > 目標CPA ¥${targetCPA.toLocaleString()} 即停止`));
        }
        // 22時以降はギリギリでも停止
        if (hour >= 22 && actualCPA > targetCPA * 0.9) {
          decisions.push(this.decision("tiktok", id, name, "pause", `22時 実CPA ¥${Math.round(actualCPA).toLocaleString()} が目標に近接 停止推奨`));
        }
      }
    }
    return decisions;
  }

  // ═══════════════════════════════════════════════════════
  // Meta広告 ルール
  // ═══════════════════════════════════════════════════════
  evaluateMeta(campaigns, hour) {
    const decisions = [];
    const { targetCPA, maxCPA } = this.config;
    const halfTargetCPA = targetCPA / 2;

    for (const c of campaigns) {
      const { id, name, spend = 0, conversions = 0, cpm, cpc, dailyBudget = 0, yesterdayBudget = 0, status, campaignType } = c;
      const actualCPA = conversions > 0 ? spend / conversions : Infinity;

      // [0:00] 前日の20%以内で増額
      if (hour === 0 && status === "active" && yesterdayBudget > 0) {
        if (actualCPA <= targetCPA && conversions > 0) {
          const maxIncrease = Math.round(yesterdayBudget * 0.2);
          const newBudget = yesterdayBudget + maxIncrease;
          decisions.push(this.decision("meta", id, name, "set_budget", `0時 前日の20%増額 → ¥${newBudget.toLocaleString()}`, { budget: newBudget }));
        }
      }

      // 手動キャンペーン損切り
      // tCPAの半額消化でCV=0 → 即停止
      if (spend >= halfTargetCPA && conversions === 0) {
        decisions.push(this.decision("meta", id, name, "pause", `¥${spend.toLocaleString()} 消化（目標CPAの半額）でCV=0 損切り`));
        continue;
      }

      // 1日単位でMax CPA超過 → 即停止
      if (actualCPA > maxCPA) {
        decisions.push(this.decision("meta", id, name, "pause", `実CPA ¥${Math.round(actualCPA).toLocaleString()} > 撤退CPA ¥${maxCPA.toLocaleString()} 即停止`));
        continue;
      }

      // 搾取モード検出: CVR変化なし + CPM/CPC急騰
      if (cpm && cpm > 5000 && conversions === 0 && spend > targetCPA * 0.3) {
        decisions.push(this.decision("meta", id, name, "reduce_budget", `CPM ¥${cpm} 急騰 搾取モード → 予算50%削減`, { budget: Math.round(dailyBudget * 0.5) }));
      }

      // 夜間の予算上げ禁止（19時以降）
      // → 増額判定自体をスキップ
    }
    return decisions;
  }

  // ═══════════════════════════════════════════════════════
  // Google広告 ルール
  // ═══════════════════════════════════════════════════════
  evaluateGoogle(campaigns, hour) {
    const decisions = [];
    const { targetCPA } = this.config;

    for (const c of campaigns) {
      const { id, name, spend = 0, conversions = 0, dailyBudget = 0, status } = c;
      const actualCPA = conversions > 0 ? spend / conversions : Infinity;

      // CPA安定時の時間帯別予算倍率
      if (actualCPA <= targetCPA && conversions > 0 && spend > 0) {
        let multiplier = 1;
        if (hour >= 12 && hour < 14) multiplier = 3.5;
        else if (hour >= 14 && hour < 16) multiplier = 2.75;
        else if (hour >= 16 && hour < 18) multiplier = 2;
        else if (hour >= 18) multiplier = 1.5;

        if (multiplier > 1) {
          const maxBudget = Math.round(spend * multiplier);
          if (maxBudget > dailyBudget) {
            decisions.push(this.decision("google", id, name, "set_budget", `${hour}時 消化額の${multiplier}倍まで増額 → ¥${maxBudget.toLocaleString()}`, { budget: maxBudget }));
          }
        }
      }

      // CPA悪化時: 日予算30-50%削減
      if (actualCPA > targetCPA * 1.3 && conversions > 0) {
        const reducedBudget = Math.round(dailyBudget * 0.6);
        decisions.push(this.decision("google", id, name, "reduce_budget", `CPA悪化 ¥${Math.round(actualCPA).toLocaleString()} → 予算40%削減`, { budget: reducedBudget }));
      }

      // 目標CPAの1.5-2倍消化でCV=0 → 停止
      if (spend >= targetCPA * 1.5 && conversions === 0) {
        decisions.push(this.decision("google", id, name, "pause", `¥${spend.toLocaleString()} 消化（目標CPAの${(spend/targetCPA).toFixed(1)}倍）でCV=0 停止`));
      }
    }
    return decisions;
  }

  // ═══════════════════════════════════════════════════════
  // LINE広告 ルール
  // ═══════════════════════════════════════════════════════
  evaluateLINE(campaigns, hour) {
    const decisions = [];
    const { targetROAS } = this.config;

    for (const c of campaigns) {
      const { id, name, spend = 0, revenue = 0, conversions = 0, dailyBudget = 0, status, budgetChangesToday = 0 } = c;
      const roas = spend > 0 ? (revenue / spend) * 100 : 0;

      // [5:00-12:00] 最もCVRが高い。好調なら予算UP
      if (hour >= 5 && hour < 12) {
        if (roas >= targetROAS && conversions > 0) {
          // 予算UP回数上限3回チェック
          if (budgetChangesToday < 3) {
            let newBudget;
            if (dailyBudget <= 30000) {
              newBudget = dailyBudget * 2;  // 3万以下なら倍額
            } else {
              newBudget = Math.round(dailyBudget * 1.2); // 5万以上なら20%UP
            }
            decisions.push(this.decision("line", id, name, "set_budget", `午前好調 ROAS ${roas.toFixed(0)}% 予算UP → ¥${newBudget.toLocaleString()}`, { budget: newBudget }));
          }
        }
      }

      // [13:00-17:00] 死の時間帯 → 予算据え置きまたは抑制
      if (hour >= 13 && hour < 17) {
        // 増額禁止、悪化していたら削減
        if (roas < 100 && spend > 3000) {
          decisions.push(this.decision("line", id, name, "reduce_budget", `死の時間帯 ROAS ${roas.toFixed(0)}% < 100% 予算30%削減`, { budget: Math.round(dailyBudget * 0.7) }));
        }
      }

      // [19:00] 絶対ルール: 増額禁止 + ROAS 100%未満は即停止
      if (hour >= 19) {
        if (roas < 100 && spend > 0) {
          decisions.push(this.decision("line", id, name, "pause", `19時以降 ROAS ${roas.toFixed(0)}% < 100% 即停止`));
        }
      }
    }
    return decisions;
  }

  // ── 予算上限の絶対死守 ─────────────────────────────
  enforceBudgetCeiling(decisions) {
    const limit = this.config.dailyBudgetLimit;
    let projectedSpend = this.todaySpend;

    for (const d of decisions) {
      if (d.action === "set_budget" || d.action === "reduce_budget") {
        projectedSpend += (d.params?.budget || 0);
      }
    }

    if (projectedSpend > limit) {
      // 上限超過する増額判定を無効化
      for (let i = decisions.length - 1; i >= 0; i--) {
        if (decisions[i].action === "set_budget" && projectedSpend > limit) {
          decisions[i].action = "blocked";
          decisions[i].reason += ` [上限予算 ¥${limit.toLocaleString()} 超過のためブロック]`;
          projectedSpend -= (decisions[i].params?.budget || 0);
        }
      }
    }
  }

  // ── 判定オブジェクト生成 ──────────────────────────
  decision(platform, campaignId, campaignName, action, reason, params = {}) {
    return {
      timestamp: new Date().toISOString(),
      platform,
      campaignId,
      campaignName,
      action, // "pause" | "resume" | "set_budget" | "reduce_budget" | "blocked"
      reason,
      params,
    };
  }

  // ── 判定実行 ──────────────────────────────────────
  async executeDecision(d) {
    const client = this.clients[d.platform];
    if (!client || d.action === "blocked") {
      this.log(d.platform, `[${d.action}] ${d.campaignName}: ${d.reason}`, d);
      this.todayActions.push(d);
      return;
    }

    try {
      switch (d.action) {
        case "pause":
          if (typeof client.pauseCampaign === "function") {
            await client.pauseCampaign(d.campaignId);
          }
          break;
        case "resume":
          if (typeof client.resumeCampaign === "function") {
            await client.resumeCampaign(d.campaignId);
          }
          break;
        case "set_budget":
        case "reduce_budget":
          if (typeof client.setCampaignBudget === "function") {
            await client.setCampaignBudget(d.campaignId, d.params.budget);
          }
          break;
      }
      d.executed = true;
    } catch (err) {
      d.executed = false;
      d.error = err.message;
    }

    this.todayActions.push(d);
    this.log(d.platform, `[${d.action}] ${d.campaignName}: ${d.reason}`, d);
  }

  // ── ログ ──────────────────────────────────────────
  async log(platform, message, data) {
    const entry = { timestamp: new Date().toISOString(), platform, message, data };
    try {
      await mkdir(LOGS_DIR, { recursive: true });
      const today = new Date().toISOString().slice(0, 10);
      const logFile = path.join(LOGS_DIR, `${today}.json`);
      let logs = [];
      try {
        if (existsSync(logFile)) {
          logs = JSON.parse(await readFile(logFile, "utf-8"));
        }
      } catch {}
      logs.push(entry);
      await writeFile(logFile, JSON.stringify(logs, null, 2));
    } catch {}
    return entry;
  }

  async getLogs(date) {
    const d = date || new Date().toISOString().slice(0, 10);
    const logFile = path.join(LOGS_DIR, `${d}.json`);
    try {
      if (existsSync(logFile)) {
        return JSON.parse(await readFile(logFile, "utf-8"));
      }
    } catch {}
    return [];
  }

  // ── 手動実行（即時判定） ───────────────────────────
  async executeNow() {
    await this.loadConfig();
    const check = this.validateBeforeRun();
    if (!check.valid) {
      throw new Error(check.errors.join("、"));
    }
    return await this.runCycle();
  }
}

// ── ユーティリティ ──────────────────────────────────
function getJSTHour(date = new Date()) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.getUTCHours();
}

export default AutoOperator;
