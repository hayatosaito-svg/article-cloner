/**
 * validators.js - 媒体別バリデーション（予算・ターゲ・文字数・画像サイズ）
 */

// ── 媒体別制約定数 ──────────────────────────────
const PLATFORM_LIMITS = {
  google: {
    budget: { minDaily: 100, maxDaily: 10000000 },
    headline: { maxLength: 30, minCount: 3, maxCount: 15 },
    description: { maxLength: 90, minCount: 2, maxCount: 4 },
    path: { maxLength: 15 },
    image: { minWidth: 600, minHeight: 314, maxFileSize: 5 * 1024 * 1024, formats: ["jpg", "png", "gif"] },
    age: { min: 18, max: 65 },
    campaignTypes: ["SEARCH", "DISPLAY", "PERFORMANCE_MAX"],
  },
  meta: {
    budget: { minDaily: 100, maxDaily: 10000000 },
    headline: { maxLength: 40 },
    primaryText: { maxLength: 125 },
    description: { maxLength: 30 },
    image: { minWidth: 1080, minHeight: 1080, maxFileSize: 30 * 1024 * 1024, formats: ["jpg", "png"], ratio: "1:1" },
    age: { min: 13, max: 65 },
    objectives: ["OUTCOME_TRAFFIC", "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_AWARENESS", "OUTCOME_ENGAGEMENT"],
    callToActions: ["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "SUBSCRIBE", "DOWNLOAD", "GET_OFFER", "CONTACT_US"],
    adFormats: ["SINGLE_IMAGE", "CAROUSEL", "VIDEO"],
  },
  tiktok: {
    budget: { minDaily: 2000, maxDaily: 10000000 },
    adText: { maxLength: 100 },
    appName: { maxLength: 40 },
    image: { minWidth: 1200, minHeight: 628, maxFileSize: 10 * 1024 * 1024, formats: ["jpg", "png"] },
    video: { maxDuration: 60, maxFileSize: 500 * 1024 * 1024, formats: ["mp4", "avi", "mov"] },
    age: { min: 13, max: 55 },
    objectiveTypes: ["TRAFFIC", "CONVERSIONS", "APP_INSTALL", "REACH", "VIDEO_VIEWS"],
    callToActions: ["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "SUBSCRIBE", "DOWNLOAD", "CONTACT_US", "APPLY_NOW"],
  },
};

// ── バリデーション関数 ──────────────────────────
export function validateTemplate(template) {
  const errors = [];

  // 基本情報
  if (!template.name || template.name.trim().length === 0) {
    errors.push({ field: "name", message: "テンプレート名は必須です" });
  }

  if (!template.platforms || template.platforms.length === 0) {
    errors.push({ field: "platforms", message: "少なくとも1つの媒体を選択してください" });
  }

  // 予算バリデーション
  if (template.budget) {
    for (const platform of template.platforms || []) {
      const budgetConfig = template.budget[platform];
      const limits = PLATFORM_LIMITS[platform]?.budget;
      if (budgetConfig && limits) {
        if (template.budget.type === "daily") {
          if (budgetConfig.amountYen < limits.minDaily) {
            errors.push({
              field: `budget.${platform}.amountYen`,
              message: `${platformLabel(platform)}の日予算は最低${limits.minDaily}円です`,
            });
          }
          if (budgetConfig.amountYen > limits.maxDaily) {
            errors.push({
              field: `budget.${platform}.amountYen`,
              message: `${platformLabel(platform)}の日予算は最大${limits.maxDaily.toLocaleString()}円です`,
            });
          }
        }
      }
    }
  }

  // ターゲティングバリデーション
  if (template.targeting) {
    const t = template.targeting;
    if (t.ageMin && t.ageMax && t.ageMin > t.ageMax) {
      errors.push({ field: "targeting.age", message: "最小年齢が最大年齢を超えています" });
    }

    for (const platform of template.platforms || []) {
      const limits = PLATFORM_LIMITS[platform]?.age;
      if (limits) {
        if (t.ageMin && t.ageMin < limits.min) {
          errors.push({
            field: "targeting.ageMin",
            message: `${platformLabel(platform)}の最小年齢は${limits.min}歳です`,
          });
        }
      }
    }

    // Google: キーワードチェック
    if (template.platforms?.includes("google") && t.google?.campaignType === "SEARCH") {
      if (!t.google.keywords || t.google.keywords.length === 0) {
        errors.push({ field: "targeting.google.keywords", message: "Google検索キャンペーンにはキーワードが必要です" });
      }
    }
  }

  // スケジュールバリデーション
  if (template.schedule) {
    const { startDate, endDate } = template.schedule;
    if (startDate && endDate) {
      if (new Date(startDate) > new Date(endDate)) {
        errors.push({ field: "schedule", message: "開始日が終了日より後になっています" });
      }
    }
  }

  // 命名規則バリデーション
  if (template.naming) {
    if (!template.naming.campaignPattern) {
      errors.push({ field: "naming.campaignPattern", message: "キャンペーン名パターンは必須です" });
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateCreative(creative, platform) {
  const errors = [];
  const limits = PLATFORM_LIMITS[platform];
  if (!limits) return { valid: true, errors: [] };

  if (platform === "google") {
    if (creative.headlines) {
      for (let i = 0; i < creative.headlines.length; i++) {
        if (creative.headlines[i].length > limits.headline.maxLength) {
          errors.push({
            field: `headlines[${i}]`,
            message: `見出し${i + 1}は${limits.headline.maxLength}文字以内にしてください（現在${creative.headlines[i].length}文字）`,
          });
        }
      }
      if (creative.headlines.length < limits.headline.minCount) {
        errors.push({ field: "headlines", message: `Google広告には最低${limits.headline.minCount}つの見出しが必要です` });
      }
    }
    if (creative.descriptions) {
      for (let i = 0; i < creative.descriptions.length; i++) {
        if (creative.descriptions[i].length > limits.description.maxLength) {
          errors.push({
            field: `descriptions[${i}]`,
            message: `説明文${i + 1}は${limits.description.maxLength}文字以内にしてください（現在${creative.descriptions[i].length}文字）`,
          });
        }
      }
    }
  }

  if (platform === "meta") {
    if (creative.headline && creative.headline.length > limits.headline.maxLength) {
      errors.push({
        field: "headline",
        message: `Meta見出しは${limits.headline.maxLength}文字以内にしてください`,
      });
    }
    if (creative.primaryText && creative.primaryText.length > limits.primaryText.maxLength) {
      errors.push({
        field: "primaryText",
        message: `メインテキストは${limits.primaryText.maxLength}文字以内にしてください`,
      });
    }
  }

  if (platform === "tiktok") {
    if (creative.adText && creative.adText.length > limits.adText.maxLength) {
      errors.push({
        field: "adText",
        message: `TikTok広告文は${limits.adText.maxLength}文字以内にしてください`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateImage(imageInfo, platform) {
  const errors = [];
  const limits = PLATFORM_LIMITS[platform]?.image;
  if (!limits) return { valid: true, errors: [] };

  if (imageInfo.width && imageInfo.width < limits.minWidth) {
    errors.push({ field: "image.width", message: `画像幅は最低${limits.minWidth}pxが必要です（現在${imageInfo.width}px）` });
  }
  if (imageInfo.height && imageInfo.height < limits.minHeight) {
    errors.push({ field: "image.height", message: `画像高さは最低${limits.minHeight}pxが必要です（現在${imageInfo.height}px）` });
  }
  if (imageInfo.fileSize && imageInfo.fileSize > limits.maxFileSize) {
    const maxMB = (limits.maxFileSize / (1024 * 1024)).toFixed(0);
    errors.push({ field: "image.fileSize", message: `画像サイズは最大${maxMB}MBです` });
  }

  return { valid: errors.length === 0, errors };
}

function platformLabel(platform) {
  const labels = { google: "Google Ads", meta: "Meta", tiktok: "TikTok" };
  return labels[platform] || platform;
}

export { PLATFORM_LIMITS };
