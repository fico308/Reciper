import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { RECIPE_WHITELIST, type WhitelistRecipe } from "../../src/recipeWhitelist";

const ingredientSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().nullable()
});

const requestSchema = z.object({
  ingredients: z.array(ingredientSchema).min(1)
});

const recipeSchema = z.object({
  name: z.string().min(1),
  type: z.union([z.literal("dish"), z.literal("noodle")]),
  ingredients: z.array(z.string().min(1)).min(1).optional()
});

const recipeArraySchema = z.array(recipeSchema).min(1);

const ARK_BASE_URL = process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const DOUBAO_CHAT_MODEL = process.env.DOUBAO_CHAT_MODEL || process.env.DOUBAO_MODEL || "";
const RECIPE_TIMEOUT_MS = Number(process.env.RECIPE_TIMEOUT_MS || 12000);
const CACHE_VERSION = "v2";

const recipeCache = new Map<string, z.infer<typeof recipeArraySchema>>();
const TARGET_RECIPE_COUNT = 14;
const WHITELIST_NAME_SET = new Set(RECIPE_WHITELIST.map((r) => r.name));
const WHITELIST_BY_NAME = new Map(RECIPE_WHITELIST.map((r) => [r.name, r] as const));

const PANTRY_INGREDIENTS = new Set([
  "盐",
  "糖",
  "生抽",
  "老抽",
  "料酒",
  "蚝油",
  "淀粉",
  "葱",
  "姜",
  "蒜",
  "食用油",
  "胡椒粉",
  "鸡精",
  "香油",
  "豆瓣酱"
]);

const PROTEIN_INGREDIENTS = new Set([
  "鸡腿肉",
  "鸡胸肉",
  "鸡肉",
  "牛肉",
  "猪肉",
  "里脊",
  "排骨",
  "虾",
  "鱼",
  "鸡蛋",
  "豆腐",
  "豆干"
]);

const STIR_FRY_FRIENDLY_INGREDIENTS = new Set([
  "青菜",
  "生菜",
  "油麦菜",
  "菠菜",
  "空心菜",
  "西兰花",
  "菜花",
  "土豆",
  "青椒",
  "洋葱",
  "豆芽",
  "白菜",
  "包菜",
  "黄瓜",
  "茄子"
]);

const FORBIDDEN_RECIPE_NAME_PATTERNS = [
  /清炒面包/,
  /清炒柚子/,
  /清炒西红柿/,
  /清炒鸡蛋/,
  /清炒牛肉/,
  /清炒鸡腿肉/,
  /清炒鸡胸肉/,
  /清炒豆干/,
  /清炒面条/
];

type RecipeItem = z.infer<typeof recipeSchema>;

function extractJsonArray(text: string): string {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error("模型未返回可解析的 JSON 数组");
  }
  return match[0];
}

function normalizeName(name: string): string {
  const raw = name.trim().toLowerCase();
  const map: Record<string, string> = {
    番茄: "西红柿",
    蕃茄: "西红柿",
    马铃薯: "土豆"
  };
  return map[raw] || raw;
}

function buildCacheKey(ingredients: Array<{ name: string }>): string {
  const names = ingredients.map((i) => normalizeName(i.name)).filter(Boolean).sort();
  return `${CACHE_VERSION}:${names.join("|")}`;
}

function getCoreIngredient(ingredients: string[]): string | null {
  for (const ing of ingredients) {
    const normalized = normalizeName(ing);
    if (!PANTRY_INGREDIENTS.has(normalized)) {
      return normalized;
    }
  }
  return null;
}

function buildFallbackRecipes(ingredients: Array<{ name: string }>): z.infer<typeof recipeArraySchema> {
  const stock = new Set(ingredients.map((i) => normalizeName(i.name)));
  const scored = RECIPE_WHITELIST.map((r) => {
    const list = r.ingredients.map((ing) => normalizeName(ing));
    const core = getCoreIngredient(list);
    let hit = 0;
    for (const ing of list) {
      if (stock.has(ing) || PANTRY_INGREDIENTS.has(ing)) hit += 1;
    }
    const score = list.length === 0 ? 0 : hit / list.length;
    const coreInStock = core ? stock.has(core) : false;
    return { recipe: r, score, coreInStock };
  })
    .filter((x) => x.coreInStock && x.score >= 0.5)
    .sort((a, b) => b.score - a.score);

  const selected: WhitelistRecipe[] = [];
  let noodleCount = 0;
  for (const item of scored) {
    if (selected.length >= TARGET_RECIPE_COUNT) break;
    if (item.recipe.type === "noodle") {
      if (noodleCount >= 4) continue;
      noodleCount += 1;
    }
    selected.push(item.recipe);
  }

  if (noodleCount < 2) {
    for (const noodle of RECIPE_WHITELIST.filter((r) => r.type === "noodle")) {
      if (selected.length >= TARGET_RECIPE_COUNT) break;
      if (selected.some((x) => x.name === noodle.name)) continue;
      selected.push(noodle);
      noodleCount += 1;
      if (noodleCount >= 2) break;
    }
  }

  return selected.map((r) => ({ name: r.name, type: r.type, ingredients: r.ingredients }));
}

function isPlausibleRecipeName(name: string): boolean {
  // 过滤明显造词和极短无意义名称
  if (name.length < 3) return false;
  if (/[A-Za-z]/.test(name)) return false;
  if (FORBIDDEN_RECIPE_NAME_PATTERNS.some((p) => p.test(name))) return false;
  return true;
}

function cleanRecipes(raw: RecipeItem[], ingredients: Array<{ name: string }>): RecipeItem[] {
  const stock = new Set(ingredients.map((i) => normalizeName(i.name)));
  const seenName = new Set<string>();
  const mainCount = new Map<string, number>();
  const cleaned: RecipeItem[] = [];

  for (const recipe of raw) {
    const normalizedName = recipe.name.trim();
    if (!isPlausibleRecipeName(normalizedName)) continue;
    if (!WHITELIST_NAME_SET.has(normalizedName)) continue;
    if (seenName.has(normalizedName)) continue;

    const canonical = WHITELIST_BY_NAME.get(normalizedName);
    if (!canonical) continue;
    const ingList = canonical.ingredients.map((x) => normalizeName(x)).filter(Boolean);
    if (ingList.length === 0) continue;
    const coreIngredient = getCoreIngredient(ingList);
    if (!coreIngredient || !stock.has(coreIngredient)) continue;

    if (canonical.type === "noodle" && !normalizedName.includes("面")) continue;

    const hasTooManyUnknown = ingList.filter((ing) => !stock.has(ing) && !PANTRY_INGREDIENTS.has(ing)).length > 1;
    if (hasTooManyUnknown) continue;

    const proteinCount = ingList.filter((ing) => PROTEIN_INGREDIENTS.has(ing)).length;
    if (proteinCount >= 2 && recipe.type === "dish") {
      // 过滤“鸡腿肉炒牛肉”这类双主蛋白组合
      continue;
    }

    const mainIngredient = ingList.find((ing) => !PANTRY_INGREDIENTS.has(ing)) || ingList[0];

    if (
      canonical.type === "dish" &&
      normalizedName.startsWith("清炒") &&
      !STIR_FRY_FRIENDLY_INGREDIENTS.has(mainIngredient)
    ) {
      continue;
    }

    const current = mainCount.get(mainIngredient) ?? 0;
    if (current >= 3) {
      // 限制同一主食材过度遍历
      continue;
    }

    seenName.add(normalizedName);
    mainCount.set(mainIngredient, current + 1);
    cleaned.push({
      name: normalizedName,
      type: canonical.type,
      ingredients: ingList
    });
  }

  return cleaned.slice(0, TARGET_RECIPE_COUNT);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten()
    });
    return;
  }

  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: "Missing ARK_API_KEY"
    });
    return;
  }
  if (!DOUBAO_CHAT_MODEL) {
    res.status(500).json({
      error: "Missing DOUBAO_CHAT_MODEL (or DOUBAO_MODEL)"
    });
    return;
  }

  const ingredientNames = parsed.data.ingredients.map((i) => i.name.trim()).filter(Boolean);
  const cacheKey = buildCacheKey(parsed.data.ingredients);
  const cached = recipeCache.get(cacheKey);
  if (cached) {
    res.status(200).json({ recipes: cached, cached: true });
    return;
  }

  const systemPrompt =
    "你是中文家常菜规划助手。只输出 JSON 数组，不要 markdown，不要解释，不要多余文字。";
  const userPrompt = `基于以下食材生成 12-18 个候选菜或者面条。
要求：
1) 每项结构必须是 {"name": string, "type": "dish"|"noodle", "ingredients": string[]}
2) 尽量优先使用给定食材，可补少量常见辅料。
3) 只能输出真实常见的中文家常菜名，禁止杜撰菜名。
4) 不要把同一个主食材遍历组合（如“鸡腿肉炒豆干/鸡腿肉炒西红柿/鸡腿肉炒牛肉”），同一主食材最多 3 道。
5) 避免不合理组合（如“鸡腿肉炒牛肉”这类肉炒肉）。
6) 不能生成配菜不存在的菜(如不提供“鲈鱼”则不能生成“清蒸鲈鱼”)
7) type: dish为米饭配菜; noodle为面条, 比如西红柿鸡蛋面、青菜肉丝面等。
8) 至少包含 2 个 noodle。
食材：${ingredientNames.join("、")}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RECIPE_TIMEOUT_MS);
    const llmResp = await fetch(`${ARK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: DOUBAO_CHAT_MODEL,
        temperature: 0.3,
        max_tokens: 900,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      }),
      signal: controller.signal
    }).finally(() => clearTimeout(timer));

    if (!llmResp.ok) {
      const text = await llmResp.text();
      const fallback = buildFallbackRecipes(parsed.data.ingredients);
      recipeCache.set(cacheKey, fallback);
      res.status(200).json({ recipes: fallback, fallback: true, reason: text.slice(0, 160) });
      return;
    }

    const llmJson = (await llmResp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = llmJson.choices?.[0]?.message?.content ?? "";
    const jsonText = extractJsonArray(content);
    const rawRecipes = JSON.parse(jsonText);
    const validated = recipeArraySchema.safeParse(rawRecipes);
    if (!validated.success) {
      const fallback = buildFallbackRecipes(parsed.data.ingredients);
      recipeCache.set(cacheKey, fallback);
      res.status(200).json({ recipes: fallback, fallback: true, reason: "validation_failed" });
      return;
    }

    const cleaned = cleanRecipes(validated.data, parsed.data.ingredients);
    const withFallback = cleaned.length < 8 ? [...cleaned, ...buildFallbackRecipes(parsed.data.ingredients)] : cleaned;
    const finalRecipes = withFallback
      .filter((r, idx, arr) => arr.findIndex((x) => x.name === r.name) === idx)
      .slice(0, TARGET_RECIPE_COUNT);

    recipeCache.set(cacheKey, finalRecipes);
    res.status(200).json({ recipes: finalRecipes });
  } catch (error) {
    const fallback = buildFallbackRecipes(parsed.data.ingredients);
    recipeCache.set(cacheKey, fallback);
    res.status(200).json({
      recipes: fallback,
      fallback: true,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}
