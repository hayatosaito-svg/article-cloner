/**
 * google-ads.js - Google Ads API v18 クライアント
 *
 * OAuth2 Refresh Token でアクセストークンを取得し、
 * キャンペーン → 広告グループ → 広告 を作成する。
 */
import fetch from "node-fetch";

const GOOGLE_ADS_API_VERSION = "v18";
const GOOGLE_ADS_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
const OAUTH2_TOKEN_URL = "https://oauth2.googleapis.com/token";

// 円→マイクロ変換 (Google Ads は micro amounts)
const YEN_TO_MICROS = 1000000;

export class GoogleAdsClient {
  constructor(config) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.developerToken = config.developerToken;
    this.refreshToken = config.refreshToken;
    this.managerAccountId = config.managerAccountId;
    this.customerAccountId = config.customerAccountId;
    this.accessToken = null;
    this.tokenExpiry = 0;
  }

  static fromEnv() {
    return new GoogleAdsClient({
      clientId: process.env.GOOGLE_ADS_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET || "",
      developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
      refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN || "",
      managerAccountId: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID || "",
      customerAccountId: process.env.GOOGLE_ADS_CUSTOMER_ACCOUNT_ID || "",
    });
  }

  isConfigured() {
    return !!(this.clientId && this.clientSecret && this.developerToken && this.refreshToken);
  }

  async refreshAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }

    const resp = await fetch(OAUTH2_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Google OAuth2 トークン更新失敗: ${err}`);
    }

    const data = await resp.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
    return this.accessToken;
  }

  async apiRequest(method, endpoint, body = null) {
    const token = await this.refreshAccessToken();
    const customerId = (this.customerAccountId || this.managerAccountId).replace(/-/g, "");

    const headers = {
      Authorization: `Bearer ${token}`,
      "developer-token": this.developerToken,
      "Content-Type": "application/json",
    };
    if (this.managerAccountId) {
      headers["login-customer-id"] = this.managerAccountId.replace(/-/g, "");
    }

    const url = `${GOOGLE_ADS_BASE}/customers/${customerId}${endpoint}`;
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const resp = await fetch(url, options);
    const data = await resp.json();

    if (!resp.ok) {
      const errMsg = data.error?.message || JSON.stringify(data);
      throw new Error(`Google Ads API エラー (${resp.status}): ${errMsg}`);
    }
    return data;
  }

  async testConnection() {
    try {
      await this.refreshAccessToken();
      const customerId = (this.customerAccountId || this.managerAccountId).replace(/-/g, "");
      const resp = await this.apiRequest("POST", ":searchStream", {
        query: "SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1",
      });
      return { connected: true, customerName: resp[0]?.results?.[0]?.customer?.descriptiveName || customerId };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  }

  async createCampaign({ name, budgetAmountYen, startDate, endDate, campaignType, deliveryMethod }) {
    // 1. Create campaign budget
    const budgetOperation = {
      mutateOperations: [
        {
          campaignBudgetOperation: {
            create: {
              name: `${name}_budget`,
              amountMicros: String(budgetAmountYen * YEN_TO_MICROS),
              deliveryMethod: deliveryMethod || "STANDARD",
            },
          },
        },
      ],
    };

    const budgetResp = await this.apiRequest("POST", ":mutate", budgetOperation);
    const budgetResourceName = budgetResp.mutateOperationResponses[0].campaignBudgetResult.resourceName;

    // 2. Create campaign
    const networkSettings = campaignType === "SEARCH"
      ? { targetGoogleSearch: true, targetSearchNetwork: true, targetContentNetwork: false }
      : { targetGoogleSearch: false, targetSearchNetwork: false, targetContentNetwork: true };

    const campaignOperation = {
      mutateOperations: [
        {
          campaignOperation: {
            create: {
              name,
              advertisingChannelType: campaignType || "SEARCH",
              status: "PAUSED",
              campaignBudget: budgetResourceName,
              startDate: startDate?.replace(/-/g, "") || undefined,
              endDate: endDate?.replace(/-/g, "") || undefined,
              networkSettings,
              biddingStrategyType: "MAXIMIZE_CLICKS",
            },
          },
        },
      ],
    };

    const campaignResp = await this.apiRequest("POST", ":mutate", campaignOperation);
    return campaignResp.mutateOperationResponses[0].campaignResult.resourceName;
  }

  async createAdGroup({ campaignResourceName, name, cpcBidMicros }) {
    const operation = {
      mutateOperations: [
        {
          adGroupOperation: {
            create: {
              name,
              campaign: campaignResourceName,
              type: "SEARCH_STANDARD",
              status: "ENABLED",
              cpcBidMicros: String(cpcBidMicros || 100 * YEN_TO_MICROS),
            },
          },
        },
      ],
    };

    const resp = await this.apiRequest("POST", ":mutate", operation);
    return resp.mutateOperationResponses[0].adGroupResult.resourceName;
  }

  async addKeywords({ adGroupResourceName, keywords }) {
    const operations = keywords.map((kw) => ({
      adGroupCriterionOperation: {
        create: {
          adGroup: adGroupResourceName,
          keyword: {
            text: kw.text || kw,
            matchType: kw.matchType || "BROAD",
          },
          status: "ENABLED",
        },
      },
    }));

    return this.apiRequest("POST", ":mutate", { mutateOperations: operations });
  }

  async createResponsiveSearchAd({ adGroupResourceName, headlines, descriptions, finalUrl, path1, path2 }) {
    const headlineAssets = headlines.slice(0, 15).map((text, i) => ({
      text,
      pinnedField: i < 3 ? undefined : undefined,
    }));

    const descriptionAssets = descriptions.slice(0, 4).map((text) => ({ text }));

    const operation = {
      mutateOperations: [
        {
          adGroupAdOperation: {
            create: {
              adGroup: adGroupResourceName,
              status: "ENABLED",
              ad: {
                responsiveSearchAd: {
                  headlines: headlineAssets,
                  descriptions: descriptionAssets,
                  path1: path1 || undefined,
                  path2: path2 || undefined,
                },
                finalUrls: [finalUrl],
              },
            },
          },
        },
      ],
    };

    const resp = await this.apiRequest("POST", ":mutate", operation);
    return resp.mutateOperationResponses[0].adGroupAdResult.resourceName;
  }

  async submit({ template, creative, lpUrl, onProgress }) {
    const results = { campaignId: null, adGroupId: null, adId: null };

    try {
      // 1. Create campaign
      onProgress?.({ step: "campaign", status: "running", message: "キャンペーン作成中..." });
      const campaignName = resolveName(template.naming.campaignPattern, {
        ...template.naming.variables,
        platform: "google",
        date: new Date().toISOString().slice(0, 10),
      });

      results.campaignId = await this.createCampaign({
        name: campaignName,
        budgetAmountYen: template.budget.google.amountYen,
        startDate: template.schedule.startDate,
        endDate: template.schedule.endDate,
        campaignType: template.targeting.google.campaignType,
        deliveryMethod: template.budget.google.deliveryMethod,
      });
      onProgress?.({ step: "campaign", status: "done", resourceName: results.campaignId });

      // 2. Create ad group
      onProgress?.({ step: "adGroup", status: "running", message: "広告グループ作成中..." });
      const adGroupName = resolveName(template.naming.adGroupPattern, {
        ...template.naming.variables,
        platform: "google",
        targeting: `${template.targeting.ageMin}-${template.targeting.ageMax}`,
        date: new Date().toISOString().slice(0, 10),
      });

      results.adGroupId = await this.createAdGroup({
        campaignResourceName: results.campaignId,
        name: adGroupName,
      });
      onProgress?.({ step: "adGroup", status: "done", resourceName: results.adGroupId });

      // 3. Add keywords (Search campaigns)
      if (template.targeting.google.campaignType === "SEARCH" && template.targeting.google.keywords?.length) {
        onProgress?.({ step: "keywords", status: "running", message: "キーワード追加中..." });
        await this.addKeywords({
          adGroupResourceName: results.adGroupId,
          keywords: template.targeting.google.keywords,
        });
        onProgress?.({ step: "keywords", status: "done" });
      }

      // 4. Create ad
      onProgress?.({ step: "ad", status: "running", message: "広告作成中..." });
      results.adId = await this.createResponsiveSearchAd({
        adGroupResourceName: results.adGroupId,
        headlines: creative.headlines || [],
        descriptions: creative.descriptions || [],
        finalUrl: lpUrl,
        path1: template.creative.google.path1,
        path2: template.creative.google.path2,
      });
      onProgress?.({ step: "ad", status: "done", resourceName: results.adId });

      return { success: true, platform: "google", ...results };
    } catch (err) {
      return { success: false, platform: "google", error: err.message, ...results };
    }
  }
}

function resolveName(pattern, variables) {
  let name = pattern;
  for (const [key, val] of Object.entries(variables)) {
    name = name.replace(new RegExp(`\\{${key}\\}`, "g"), val || "");
  }
  return name;
}
