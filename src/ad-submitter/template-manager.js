/**
 * template-manager.js - 広告テンプレートCRUD + JSONファイル永続化
 */
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { PROJECT_ROOT } from "../utils.js";

const TEMPLATES_PATH = path.join(PROJECT_ROOT, "data", "ad-templates.json");

function genTemplateId() {
  return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function loadTemplates() {
  try {
    if (existsSync(TEMPLATES_PATH)) {
      const raw = await readFile(TEMPLATES_PATH, "utf-8");
      return JSON.parse(raw);
    }
  } catch {}
  return [];
}

async function saveTemplates(templates) {
  const dir = path.dirname(TEMPLATES_PATH);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(TEMPLATES_PATH, JSON.stringify(templates, null, 2), "utf-8");
}

function createDefaultTemplate(overrides = {}) {
  return {
    id: genTemplateId(),
    name: "",
    platforms: ["google", "meta", "tiktok"],
    budget: {
      type: "daily",
      google: { amountYen: 3000, deliveryMethod: "STANDARD" },
      meta: { amountYen: 3000, bidStrategy: "LOWEST_COST_WITHOUT_CAP" },
      tiktok: { amountYen: 3000, bidType: "BID_TYPE_NO_BID" },
    },
    targeting: {
      ageMin: 25,
      ageMax: 54,
      gender: "ALL",
      locations: [{ type: "country", code: "JP" }],
      languages: ["ja"],
      google: { keywords: [], campaignType: "SEARCH" },
      meta: { objective: "OUTCOME_TRAFFIC", interests: [], optimizationGoal: "LINK_CLICKS" },
      tiktok: { objectiveType: "TRAFFIC", optimizationGoal: "CLICK" },
    },
    schedule: {
      startDate: "",
      endDate: "",
    },
    creative: {
      headlineSource: "auto",
      imageStrategy: "auto",
      google: { adType: "RESPONSIVE_SEARCH", path1: "", path2: "" },
      meta: { adFormat: "SINGLE_IMAGE", callToAction: "LEARN_MORE" },
      tiktok: { callToAction: "LEARN_MORE" },
    },
    naming: {
      campaignPattern: "{product}_{platform}_{date}",
      adGroupPattern: "{product}_{targeting}_{date}",
      variables: { product: "" },
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

export class TemplateManager {
  async list() {
    return loadTemplates();
  }

  async get(id) {
    const templates = await loadTemplates();
    return templates.find((t) => t.id === id) || null;
  }

  async create(data) {
    const templates = await loadTemplates();
    const template = createDefaultTemplate({
      ...data,
      id: genTemplateId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    templates.push(template);
    await saveTemplates(templates);
    return template;
  }

  async update(id, data) {
    const templates = await loadTemplates();
    const idx = templates.findIndex((t) => t.id === id);
    if (idx === -1) return null;

    // Deep merge: preserve nested objects
    const existing = templates[idx];
    const merged = deepMerge(existing, data);
    merged.id = id; // Ensure ID is not overwritten
    merged.updatedAt = Date.now();
    templates[idx] = merged;
    await saveTemplates(templates);
    return templates[idx];
  }

  async delete(id) {
    let templates = await loadTemplates();
    const before = templates.length;
    templates = templates.filter((t) => t.id !== id);
    if (templates.length === before) return false;
    await saveTemplates(templates);
    return true;
  }

  async duplicate(id) {
    const source = await this.get(id);
    if (!source) return null;
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = source;
    return this.create({ ...rest, name: source.name + " (コピー)" });
  }
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export const templateManager = new TemplateManager();
