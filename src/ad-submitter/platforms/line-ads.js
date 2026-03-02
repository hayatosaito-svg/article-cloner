/**
 * line-ads.js - LINE広告 APIクライアント
 *
 * LINE Ads Platform API でキャンペーン管理・パフォーマンス取得。
 */
import fetch from "node-fetch";

const LINE_ADS_API_BASE = "https://ads.line.me/api/v3";

export class LineAdsClient {
  constructor(config) {
    this.accessToken = config.accessToken;
    this.accountId = config.accountId;
  }

  static fromEnv() {
    return new LineAdsClient({
      accessToken: process.env.LINE_ADS_ACCESS_TOKEN || "",
      accountId: process.env.LINE_ADS_ACCOUNT_ID || "",
    });
  }

  isConfigured() {
    return !!(this.accessToken && this.accountId);
  }

  async testConnection() {
    if (!this.isConfigured()) return { connected: false, error: "認証情報未設定" };
    try {
      const res = await this.apiGet(`/accounts/${this.accountId}`);
      return { connected: true, details: { accountName: res.name || res.accountId } };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  }

  // ── API通信 ────────────────────────────────────
  async apiGet(endpoint, params = {}) {
    const url = new URL(LINE_ADS_API_BASE + endpoint);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `LINE Ads API error ${res.status}`);
    return data;
  }

  async apiPost(endpoint, body) {
    const res = await fetch(LINE_ADS_API_BASE + endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `LINE Ads API error ${res.status}`);
    return data;
  }

  async apiPut(endpoint, body) {
    const res = await fetch(LINE_ADS_API_BASE + endpoint, {
      method: "PUT",
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `LINE Ads API error ${res.status}`);
    return data;
  }

  // ── キャンペーン管理 ───────────────────────────
  async getActiveCampaigns() {
    const res = await this.apiGet(`/accounts/${this.accountId}/campaigns`, { status: "ACTIVE" });
    const campaigns = res.campaigns || res.data || [];

    // 各キャンペーンの今日のパフォーマンスも取得
    const today = new Date().toISOString().slice(0, 10);
    const result = [];
    for (const c of campaigns) {
      let stats = { spend: 0, conversions: 0, revenue: 0 };
      try {
        const perf = await this.apiGet(`/accounts/${this.accountId}/campaigns/${c.campaignId}/stats`, {
          startDate: today, endDate: today,
        });
        stats = {
          spend: perf.cost || perf.spend || 0,
          conversions: perf.conversions || 0,
          revenue: perf.revenue || perf.conversionValue || 0,
        };
      } catch {}
      result.push({
        id: c.campaignId,
        name: c.campaignName || c.name,
        status: (c.status || "").toLowerCase() === "active" ? "active" : "paused",
        dailyBudget: c.dailyBudget || c.budget || 0,
        ...stats,
      });
    }
    return result;
  }

  async pauseCampaign(campaignId) {
    return this.apiPut(`/accounts/${this.accountId}/campaigns/${campaignId}`, { status: "PAUSED" });
  }

  async resumeCampaign(campaignId) {
    return this.apiPut(`/accounts/${this.accountId}/campaigns/${campaignId}`, { status: "ACTIVE" });
  }

  async setCampaignBudget(campaignId, budgetYen) {
    return this.apiPut(`/accounts/${this.accountId}/campaigns/${campaignId}`, { dailyBudget: budgetYen });
  }

  // ── キャンペーン作成（入稿用） ──────────────────
  async createCampaign(params) {
    return this.apiPost(`/accounts/${this.accountId}/campaigns`, {
      campaignName: params.name,
      objective: params.objective || "WEBSITE_TRAFFIC",
      dailyBudget: params.budgetYen,
      status: "PAUSED",
    });
  }

  async createAdGroup(campaignId, params) {
    return this.apiPost(`/accounts/${this.accountId}/adgroups`, {
      campaignId,
      adGroupName: params.name,
      bidAmount: params.bidAmount,
      targeting: params.targeting || {},
      status: "ACTIVE",
    });
  }

  async createAd(adGroupId, params) {
    return this.apiPost(`/accounts/${this.accountId}/ads`, {
      adGroupId,
      adName: params.name,
      title: params.title,
      description: params.description,
      landingPageUrl: params.lpUrl,
      status: "ACTIVE",
    });
  }

  async submit(project, template, creative, lpUrl) {
    const campaign = await this.createCampaign({
      name: template.naming?.campaignPattern || `${template.name}_line`,
      budgetYen: template.budget?.line?.amountYen || 3000,
    });

    const adGroup = await this.createAdGroup(campaign.campaignId, {
      name: template.naming?.adGroupPattern || `${template.name}_adgroup`,
      bidAmount: template.budget?.line?.bidAmount || 100,
    });

    const ad = await this.createAd(adGroup.adGroupId, {
      name: `${template.name}_ad`,
      title: creative.headline || creative.headings?.[0] || "",
      description: creative.description || creative.texts?.[0] || "",
      lpUrl,
    });

    return { campaignId: campaign.campaignId, adGroupId: adGroup.adGroupId, adId: ad.adId };
  }
}
