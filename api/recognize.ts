import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";

const ingredientSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().nullable()
});

const recognizeRequestSchema = z.object({
  imageDataUrl: z.string().min(10),
  mode: z.union([z.literal("receipt"), z.literal("fridge")]).default("fridge"),
  existingIngredients: z.array(ingredientSchema).default([])
});

const recognizedIngredientSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().nullable().optional(),
  confidence: z.number().min(0).max(1).optional()
});

const recognizedArraySchema = z.array(recognizedIngredientSchema);

const ARK_BASE_URL = process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const DOUBAO_MODEL = process.env.DOUBAO_MODEL || "";

function normalizeName(name: string): string {
  const raw = name.trim();
  const synonyms: Record<string, string> = {
    番茄: "西红柿",
    蕃茄: "西红柿",
    马铃薯: "土豆"
  };
  return synonyms[raw] || raw;
}

function extractJsonArray(text: string): string {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error("模型未返回 JSON 数组");
  }
  return match[0];
}

function mergeIngredients(
  existing: Array<{ name: string; quantity: number | null }>,
  recognized: Array<{ name: string; quantity: number | null }>
): Array<{ name: string; quantity: number | null }> {
  const map = new Map<string, number | null>();

  for (const item of existing) {
    const key = normalizeName(item.name);
    if (!key) continue;
    map.set(key, item.quantity ?? null);
  }

  for (const item of recognized) {
    const key = normalizeName(item.name);
    if (!key) continue;
    const oldQty = map.get(key);
    if (oldQty === null || oldQty === undefined) {
      map.set(key, item.quantity ?? oldQty ?? null);
      continue;
    }
    if (item.quantity === null || item.quantity === undefined) {
      map.set(key, oldQty);
      continue;
    }
    map.set(key, oldQty + item.quantity);
  }

  return Array.from(map.entries()).map(([name, quantity]) => ({ name, quantity }));
}

function buildPrompt(mode: "receipt" | "fridge"): string {
  if (mode === "receipt") {
    return `你是食材提取助手。请识别这张超市小票/购物清单中的食材，并返回 JSON 数组。
严格要求：
1) 只返回 JSON 数组，不要 markdown，不要额外解释。
2) 每项结构为 {"name": string, "quantity": number, "confidence": number}
3) name 必须是食材，不要品牌、门店、促销词，并简化为最基础的食材名，例如水果洋葱简化为洋葱，杭茄简化为茄子, 罗莎绿生菜简化为生菜。
4) quantity 尽量提取数字，无法判断时用 1。
5) confidence 范围 0-1。`;
  }

  return `你是食材识别助手。请识别图片中可见食材，并返回 JSON 数组。
严格要求：
1) 只返回 JSON 数组，不要 markdown，不要额外解释。
2) 每项结构为 {"name": string, "quantity": number, "confidence": number}
3) name 必须是常见中文食材名，不要容器或厨房用品，简化为最基础的食材名，例如水果洋葱简化为洋葱，杭茄简化为茄子。
4) quantity 无法判断时用 1
5) confidence 范围 0-1。`;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const parsed = recognizeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten()
    });
    return;
  }

  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Missing ARK_API_KEY" });
    return;
  }
  if (!DOUBAO_MODEL) {
    res.status(500).json({ error: "Missing DOUBAO_MODEL" });
    return;
  }

  const { imageDataUrl, mode, existingIngredients } = parsed.data;
  const prompt = buildPrompt(mode);

  try {
    const llmResp = await fetch(`${ARK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: DOUBAO_MODEL,
        temperature: 0.2,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageDataUrl } }
            ]
          }
        ]
      })
    });

    if (!llmResp.ok) {
      const text = await llmResp.text();
      res.status(llmResp.status).json({
        error: "Doubao request failed",
        details: text
      });
      return;
    }

    const llmJson = (await llmResp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = llmJson.choices?.[0]?.message?.content ?? "";
    const jsonText = extractJsonArray(content);
    const raw = JSON.parse(jsonText);
    const validated = recognizedArraySchema.safeParse(raw);
    if (!validated.success) {
      res.status(502).json({
        error: "Model output validation failed",
        details: validated.error.flatten()
      });
      return;
    }

    const recognized = validated.data
      .filter((x) => (x.confidence ?? 1) >= 0.5)
      .map((x) => ({
        name: normalizeName(x.name),
        quantity: x.quantity ?? null,
        confidence: x.confidence ?? 1
      }));

    const mergedIngredients = mergeIngredients(
      existingIngredients.map((x) => ({ name: normalizeName(x.name), quantity: x.quantity })),
      recognized.map((x) => ({ name: x.name, quantity: x.quantity }))
    );

    res.status(200).json({
      recognizedIngredients: recognized,
      mergedIngredients
    });
  } catch (error) {
    res.status(500).json({
      error: "Recognize failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
