import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { generatePlan } from "../src/planner";

const ingredientSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().nullable()
});

const recipeSchema = z.object({
  name: z.string().min(1),
  type: z.union([z.literal("dish"), z.literal("noodle")]),
  ingredients: z.array(z.string().min(1)).optional()
});

const requestSchema = z.object({
  ingredients: z.array(ingredientSchema),
  recipes: z.array(recipeSchema).min(1),
  days: z.number().int().min(2).max(5)
});

export default function handler(req: VercelRequest, res: VercelResponse): void {
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

  const { ingredients, recipes, days } = parsed.data;
  const result = generatePlan(ingredients, recipes, { days });

  res.status(200).json(result);
}
