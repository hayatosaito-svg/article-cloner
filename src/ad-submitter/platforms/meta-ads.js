/**
 * meta-ads.js - Meta Marketing API v21 クライアント
 *
 * System User Token (永久有効) でキャンペーン → 広告セット → 広告を作成。
 * 画像アップロード（multipart）対応。
 */
import fetch from "node-fetch";
import { readFile } from "fs/promises";
import path from "path";

const META_API_VERSION = "v21.0";
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export class MetaAdsClient {
  constructor(config) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.accessToken = config.accessToken;
    this.adAccountId = config.adAccountId; // act_XXXXXXXXX
  }

  static fromEnv() {
    return new MetaAdsClient({
      appId: process.env.META_APP_ID || "",
      appSecret: process.env.META_APP_SECRET || "",
      accessToken: process.env.META_ACCESS_TOKEN || "",
      adAccountId: process.env.META_AD_ACCOUNT_ID || "",
    });
  }

  isConfigured() {
    return !!(this.accessToken && this.adAccountId);
  }

  get accountId() {
    return this.adAccountId.startsWith("act_") ? this.adAccountId : `act_${this.adAccountId}`;
  }

  async apiRequest(method, endpoint, params = {}) {
    const url = new URL(`${META_API_BASE}${endpoint}`);

    const options = { method, headers: {} };

    if (method === "GET") {
      url.searchParams.set("access_token", this.accessToken);
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : v);
      }
    } else {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify({ ...params, access_token: this.accessToken });
    }

    const resp = await fetch(url.toString(), options);
    const data = await resp.json();

    if (data.error) {
      throw new Error(`Meta API エラー: ${data.error.message} (code: ${data.error.code})`);
    }
    return data;
  }

  async testConnection() {
    try {
      const data = await this.apiRequest("GET", `/${this.accountId}`, {
        fields: "name,account_status,currency",
      });
      const statusMap = { 1: "ACTIVE", 2: "DISABLED", 3: "UNSETTLED", 7: "PENDING_RISK_REVIEW", 100: "PENDING_CLOSURE" };
      return {
        connected: true,
        accountName: data.name,
        status: statusMap[data.account_status] || "UNKNOWN",
        currency: data.currency,
      };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  }

  async createCampaign({ name, objective, status, dailyBudget, lifetimeBudget, budgetType, bidStrategy, startTime, endTime }) {
    const params = {
      name,
      objective: objective || "OUTCOME_TRAFFIC",
      status: status || "PAUSED",
      special_ad_categories: [],
      bid_strategy: bidStrategy || "LOWEST_COST_WITHOUT_CAP",
    };

    if (budgetType === "lifetime" && lifetimeBudget) {
      params.lifetime_budget = lifetimeBudget * 100; // 円→セント相当 (JPY)
    } else if (dailyBudget) {
      params.daily_budget = dailyBudget * 100;
    }

    if (startTime) params.start_time = new Date(startTime).toISOString();
    if (endTime) params.end_time = new Date(endTime).toISOString();

    const data = await this.apiRequest("POST", `/${this.accountId}/campaigns`, params);
    return data.id;
  }

  async createAdSet({ campaignId, name, optimizationGoal, targeting, startTime, endTime, dailyBudget, billingEvent }) {
    const params = {
      campaign_id: campaignId,
      name,
      optimization_goal: optimizationGoal || "LINK_CLICKS",
      billing_event: billingEvent || "IMPRESSIONS",
      status: "PAUSED",
      targeting: buildMetaTargeting(targeting),
    };

    if (dailyBudget) params.daily_budget = dailyBudget * 100;
    if (startTime) params.start_time = new Date(startTime).toISOString();
    if (endTime) params.end_time = new Date(endTime).toISOString();

    const data = await this.apiRequest("POST", `/${this.accountId}/adsets`, params);
    return data.id;
  }

  async uploadImage(imagePath) {
    const imageBuffer = await readFile(imagePath);
    const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);

    const parts = [];
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n${this.accessToken}`);
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="filename"; filename="${path.basename(imagePath)}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    );

    const body = Buffer.concat([
      Buffer.from(parts[0] + "\r\n"),
      Buffer.from(parts[1]),
      imageBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const resp = await fetch(`${META_API_BASE}/${this.accountId}/adimages`, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });

    const data = await resp.json();
    if (data.error) throw new Error(`Meta画像アップロードエラー: ${data.error.message}`);

    const images = data.images || {};
    const imageData = Object.values(images)[0];
    return imageData?.hash || null;
  }

  async createAdCreative({ name, pageId, imageHash, imageUrl, headline, primaryText, description, linkUrl, callToAction }) {
    const params = {
      name,
      object_story_spec: {
        page_id: pageId || process.env.META_PAGE_ID,
        link_data: {
          link: linkUrl,
          message: primaryText || "",
          name: headline || "",
          description: description || "",
          call_to_action: { type: callToAction || "LEARN_MORE" },
        },
      },
    };

    if (imageHash) {
      params.object_story_spec.link_data.image_hash = imageHash;
    } else if (imageUrl) {
      params.object_story_spec.link_data.picture = imageUrl;
    }

    const data = await this.apiRequest("POST", `/${this.accountId}/adcreatives`, params);
    return data.id;
  }

  async createAd({ adSetId, creativeId, name, status }) {
    const params = {
      adset_id: adSetId,
      creative: { creative_id: creativeId },
      name: name || "Ad",
      status: status || "PAUSED",
    };

    const data = await this.apiRequest("POST", `/${this.accountId}/ads`, params);
    return data.id;
  }

  async submit({ template, creative, lpUrl, onProgress }) {
    const results = { campaignId: null, adSetId: null, creativeId: null, adId: null };

    try {
      // 1. Create campaign
      onProgress?.({ step: "campaign", status: "running", message: "Metaキャンペーン作成中..." });
      const campaignName = resolveName(template.naming.campaignPattern, {
        ...template.naming.variables,
        platform: "meta",
        date: new Date().toISOString().slice(0, 10),
      });

      results.campaignId = await this.createCampaign({
        name: campaignName,
        objective: template.targeting.meta.objective,
        dailyBudget: template.budget.type === "daily" ? template.budget.meta.amountYen : undefined,
        lifetimeBudget: template.budget.type === "lifetime" ? template.budget.meta.amountYen : undefined,
        budgetType: template.budget.type,
        bidStrategy: template.budget.meta.bidStrategy,
        startTime: template.schedule.startDate,
        endTime: template.schedule.endDate,
      });
      onProgress?.({ step: "campaign", status: "done", id: results.campaignId });

      // 2. Create ad set
      onProgress?.({ step: "adSet", status: "running", message: "広告セット作成中..." });
      const adSetName = resolveName(template.naming.adGroupPattern, {
        ...template.naming.variables,
        platform: "meta",
        targeting: `${template.targeting.ageMin}-${template.targeting.ageMax}`,
        date: new Date().toISOString().slice(0, 10),
      });

      results.adSetId = await this.createAdSet({
        campaignId: results.campaignId,
        name: adSetName,
        optimizationGoal: template.targeting.meta.optimizationGoal,
        targeting: template.targeting,
        startTime: template.schedule.startDate,
        endTime: template.schedule.endDate,
        dailyBudget: template.budget.type === "daily" ? template.budget.meta.amountYen : undefined,
      });
      onProgress?.({ step: "adSet", status: "done", id: results.adSetId });

      // 3. Upload image if available
      let imageHash = null;
      if (creative.imagePath) {
        onProgress?.({ step: "image", status: "running", message: "画像アップロード中..." });
        imageHash = await this.uploadImage(creative.imagePath);
        onProgress?.({ step: "image", status: "done" });
      }

      // 4. Create ad creative
      onProgress?.({ step: "creative", status: "running", message: "広告クリエイティブ作成中..." });
      results.creativeId = await this.createAdCreative({
        name: `${campaignName}_creative`,
        imageHash,
        imageUrl: creative.imageUrl || undefined,
        headline: creative.headline || "",
        primaryText: creative.primaryText || "",
        description: creative.description || "",
        linkUrl: lpUrl,
        callToAction: template.creative.meta.callToAction,
      });
      onProgress?.({ step: "creative", status: "done", id: results.creativeId });

      // 5. Create ad
      onProgress?.({ step: "ad", status: "running", message: "広告作成中..." });
      results.adId = await this.createAd({
        adSetId: results.adSetId,
        creativeId: results.creativeId,
        name: `${campaignName}_ad`,
      });
      onProgress?.({ step: "ad", status: "done", id: results.adId });

      return { success: true, platform: "meta", ...results };
    } catch (err) {
      return { success: false, platform: "meta", error: err.message, ...results };
    }
  }
}

function buildMetaTargeting(targeting) {
  const result = {
    geo_locations: { countries: [] },
    age_min: targeting.ageMin || 18,
    age_max: targeting.ageMax || 65,
    locales: [],
  };

  // Locations
  if (targeting.locations) {
    for (const loc of targeting.locations) {
      if (loc.type === "country") {
        result.geo_locations.countries.push(loc.code);
      }
    }
  }
  if (result.geo_locations.countries.length === 0) {
    result.geo_locations.countries.push("JP");
  }

  // Gender
  if (targeting.gender === "MALE") result.genders = [1];
  else if (targeting.gender === "FEMALE") result.genders = [2];

  // Languages
  const langMap = { ja: 6, en: 24 };
  if (targeting.languages) {
    result.locales = targeting.languages.map((l) => langMap[l]).filter(Boolean);
  }

  // Interests
  if (targeting.meta?.interests?.length) {
    result.interests = targeting.meta.interests.map((i) =>
      typeof i === "string" ? { id: i } : i
    );
  }

  return result;
}

function resolveName(pattern, variables) {
  let name = pattern;
  for (const [key, val] of Object.entries(variables)) {
    name = name.replace(new RegExp(`\\{${key}\\}`, "g"), val || "");
  }
  return name;
}
