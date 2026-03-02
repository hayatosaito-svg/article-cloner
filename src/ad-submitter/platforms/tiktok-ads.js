/**
 * tiktok-ads.js - TikTok Marketing API v1.3 クライアント
 *
 * Access Token (OAuth2) + Advertiser ID でキャンペーン → 広告グループ → 広告作成。
 * トークン24h期限→リフレッシュ対応。
 */
import fetch from "node-fetch";
import { readFile } from "fs/promises";
import path from "path";

const TIKTOK_API_BASE = "https://business-api.tiktok.com/open_api/v1.3";

export class TikTokAdsClient {
  constructor(config) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.advertiserId = config.advertiserId;
    this.tokenExpiry = config.tokenExpiry || 0;
  }

  static fromEnv() {
    return new TikTokAdsClient({
      appId: process.env.TIKTOK_APP_ID || "",
      appSecret: process.env.TIKTOK_APP_SECRET || "",
      accessToken: process.env.TIKTOK_ACCESS_TOKEN || "",
      refreshToken: process.env.TIKTOK_REFRESH_TOKEN || "",
      advertiserId: process.env.TIKTOK_ADVERTISER_ID || "",
    });
  }

  isConfigured() {
    return !!(this.accessToken && this.advertiserId);
  }

  async refreshAccessToken() {
    if (!this.refreshToken || !this.appId || !this.appSecret) {
      return this.accessToken; // リフレッシュ不可、既存トークン使用
    }

    if (this.tokenExpiry && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }

    const resp = await fetch(`${TIKTOK_API_BASE}/oauth2/refresh_token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: this.appId,
        secret: this.appSecret,
        refresh_token: this.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const data = await resp.json();
    if (data.code !== 0) {
      console.warn(`[tiktok] トークンリフレッシュ失敗: ${data.message}`);
      return this.accessToken;
    }

    this.accessToken = data.data.access_token;
    this.refreshToken = data.data.refresh_token;
    this.tokenExpiry = Date.now() + (data.data.expires_in || 86400) * 1000;
    return this.accessToken;
  }

  async apiRequest(method, endpoint, params = {}) {
    const token = await this.refreshAccessToken();
    const url = `${TIKTOK_API_BASE}${endpoint}`;

    const options = {
      method,
      headers: {
        "Access-Token": token,
        "Content-Type": "application/json",
      },
    };

    if (method === "GET") {
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : v);
      }
      const fullUrl = searchParams.toString() ? `${url}?${searchParams}` : url;
      const resp = await fetch(fullUrl, options);
      return this._handleResponse(resp);
    }

    options.body = JSON.stringify(params);
    const resp = await fetch(url, options);
    return this._handleResponse(resp);
  }

  async _handleResponse(resp) {
    const data = await resp.json();
    if (data.code !== 0) {
      throw new Error(`TikTok API エラー: ${data.message} (code: ${data.code})`);
    }
    return data.data;
  }

  async testConnection() {
    try {
      const data = await this.apiRequest("GET", "/advertiser/info/", {
        advertiser_ids: JSON.stringify([this.advertiserId]),
        fields: JSON.stringify(["name", "status", "currency"]),
      });
      const advertiser = data?.list?.[0];
      return {
        connected: true,
        advertiserName: advertiser?.name || this.advertiserId,
        status: advertiser?.status,
        currency: advertiser?.currency,
      };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  }

  async createCampaign({ name, objectiveType, budgetMode, budget }) {
    const params = {
      advertiser_id: this.advertiserId,
      campaign_name: name,
      objective_type: objectiveType || "TRAFFIC",
      budget_mode: budgetMode || "BUDGET_MODE_DAY",
      budget: budget || 0,
      operation_status: "DISABLE", // PAUSED相当
    };

    const data = await this.apiRequest("POST", "/campaign/create/", params);
    return data.campaign_id;
  }

  async createAdGroup({ campaignId, name, optimizationGoal, bidType, budget, targeting, startTime, endTime, placements }) {
    const params = {
      advertiser_id: this.advertiserId,
      campaign_id: campaignId,
      adgroup_name: name,
      placement_type: "PLACEMENT_TYPE_AUTOMATIC",
      optimization_goal: optimizationGoal || "CLICK",
      bid_type: bidType || "BID_TYPE_NO_BID",
      budget_mode: "BUDGET_MODE_DAY",
      budget: budget || 0,
      schedule_type: "SCHEDULE_START_END",
      schedule_start_time: startTime ? formatTikTokTime(startTime) : undefined,
      schedule_end_time: endTime ? formatTikTokTime(endTime) : undefined,
      operation_status: "DISABLE",
      ...buildTikTokTargeting(targeting),
    };

    if (placements) {
      params.placement_type = "PLACEMENT_TYPE_NORMAL";
      params.placements = placements;
    }

    const data = await this.apiRequest("POST", "/adgroup/create/", params);
    return data.adgroup_id;
  }

  async uploadImage(imagePath) {
    const token = await this.refreshAccessToken();
    const imageBuffer = await readFile(imagePath);
    const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
    const filename = path.basename(imagePath);

    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="advertiser_id"\r\n\r\n${this.advertiserId}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="upload_type"\r\n\r\nUPLOAD_BY_FILE`,
      `--${boundary}\r\nContent-Disposition: form-data; name="image_file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ];

    const body = Buffer.concat([
      Buffer.from(parts[0] + "\r\n"),
      Buffer.from(parts[1] + "\r\n"),
      Buffer.from(parts[2]),
      imageBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const resp = await fetch(`${TIKTOK_API_BASE}/file/image/ad/upload/`, {
      method: "POST",
      headers: {
        "Access-Token": token,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    const data = await resp.json();
    if (data.code !== 0) throw new Error(`TikTok画像アップロードエラー: ${data.message}`);
    return data.data.image_id;
  }

  async createAd({ adGroupId, name, adText, imageId, landingPageUrl, callToAction, displayName }) {
    const params = {
      advertiser_id: this.advertiserId,
      adgroup_id: adGroupId,
      creatives: [
        {
          ad_name: name,
          ad_text: adText || "",
          image_ids: imageId ? [imageId] : [],
          landing_page_url: landingPageUrl,
          call_to_action: callToAction || "LEARN_MORE",
          display_name: displayName || "",
          ad_format: "SINGLE_IMAGE",
        },
      ],
    };

    const data = await this.apiRequest("POST", "/ad/create/", params);
    return data.ad_ids?.[0];
  }

  async submit({ template, creative, lpUrl, onProgress }) {
    const results = { campaignId: null, adGroupId: null, adId: null };

    try {
      // 1. Create campaign
      onProgress?.({ step: "campaign", status: "running", message: "TikTokキャンペーン作成中..." });
      const campaignName = resolveName(template.naming.campaignPattern, {
        ...template.naming.variables,
        platform: "tiktok",
        date: new Date().toISOString().slice(0, 10),
      });

      results.campaignId = await this.createCampaign({
        name: campaignName,
        objectiveType: template.targeting.tiktok.objectiveType,
        budget: template.budget.tiktok.amountYen,
      });
      onProgress?.({ step: "campaign", status: "done", id: results.campaignId });

      // 2. Create ad group
      onProgress?.({ step: "adGroup", status: "running", message: "広告グループ作成中..." });
      const adGroupName = resolveName(template.naming.adGroupPattern, {
        ...template.naming.variables,
        platform: "tiktok",
        targeting: `${template.targeting.ageMin}-${template.targeting.ageMax}`,
        date: new Date().toISOString().slice(0, 10),
      });

      results.adGroupId = await this.createAdGroup({
        campaignId: results.campaignId,
        name: adGroupName,
        optimizationGoal: template.targeting.tiktok.optimizationGoal,
        bidType: template.budget.tiktok.bidType,
        budget: template.budget.tiktok.amountYen,
        targeting: template.targeting,
        startTime: template.schedule.startDate,
        endTime: template.schedule.endDate,
      });
      onProgress?.({ step: "adGroup", status: "done", id: results.adGroupId });

      // 3. Upload image
      let imageId = null;
      if (creative.imagePath) {
        onProgress?.({ step: "image", status: "running", message: "画像アップロード中..." });
        imageId = await this.uploadImage(creative.imagePath);
        onProgress?.({ step: "image", status: "done" });
      }

      // 4. Create ad
      onProgress?.({ step: "ad", status: "running", message: "広告作成中..." });
      results.adId = await this.createAd({
        adGroupId: results.adGroupId,
        name: `${campaignName}_ad`,
        adText: creative.adText || creative.headline || "",
        imageId,
        landingPageUrl: lpUrl,
        callToAction: template.creative.tiktok.callToAction,
      });
      onProgress?.({ step: "ad", status: "done", id: results.adId });

      return { success: true, platform: "tiktok", ...results };
    } catch (err) {
      return { success: false, platform: "tiktok", error: err.message, ...results };
    }
  }
}

function buildTikTokTargeting(targeting) {
  const result = {};

  // Location
  if (targeting.locations) {
    const countries = targeting.locations
      .filter((l) => l.type === "country")
      .map((l) => l.code);
    if (countries.length) result.location_ids = countries;
  }

  // Age
  const ageRanges = [];
  const ageMin = targeting.ageMin || 18;
  const ageMax = targeting.ageMax || 55;
  const ageBuckets = ["AGE_13_17", "AGE_18_24", "AGE_25_34", "AGE_35_44", "AGE_45_54", "AGE_55_100"];
  const ageMins = [13, 18, 25, 35, 45, 55];
  const ageMaxs = [17, 24, 34, 44, 54, 100];

  for (let i = 0; i < ageBuckets.length; i++) {
    if (ageMins[i] >= ageMin && ageMaxs[i] <= ageMax) {
      ageRanges.push(ageBuckets[i]);
    }
  }
  if (ageRanges.length) result.age_groups = ageRanges;

  // Gender
  if (targeting.gender === "MALE") result.gender = "GENDER_MALE";
  else if (targeting.gender === "FEMALE") result.gender = "GENDER_FEMALE";

  // Language
  if (targeting.languages) {
    const langMap = { ja: "ja", en: "en" };
    result.languages = targeting.languages.map((l) => langMap[l]).filter(Boolean);
  }

  return result;
}

function formatTikTokTime(dateStr) {
  // TikTok expects "YYYY-MM-DD HH:MM:SS"
  const d = new Date(dateStr);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function resolveName(pattern, variables) {
  let name = pattern;
  for (const [key, val] of Object.entries(variables)) {
    name = name.replace(new RegExp(`\\{${key}\\}`, "g"), val || "");
  }
  return name;
}
