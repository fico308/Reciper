import type { VercelRequest, VercelResponse } from "@vercel/node";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

const ingredientSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().nullable()
});

const recipeSchema = z.object({
  name: z.string().min(1),
  type: z.union([z.literal("dish"), z.literal("noodle")]),
  ingredients: z.array(z.string().min(1)).optional()
});

const stateSchema = z.object({
  ingredients: z.array(ingredientSchema).default([]),
  recipes: z.array(recipeSchema).default([]),
  menu: z.unknown().nullable().default(null)
});

const STATE_FILE_PATH = process.env.STATE_FILE_PATH || "/tmp/menu-planner-state.json";

async function readStateFromFile(): Promise<z.infer<typeof stateSchema>> {
  try {
    const raw = await fs.readFile(STATE_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const validated = stateSchema.safeParse(parsed);
    if (!validated.success) {
      return { ingredients: [], recipes: [], menu: null };
    }
    return validated.data;
  } catch {
    return { ingredients: [], recipes: [], menu: null };
  }
}

async function writeStateToFile(state: z.infer<typeof stateSchema>): Promise<void> {
  const dir = path.dirname(STATE_FILE_PATH);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(STATE_FILE_PATH, JSON.stringify(state, null, 2), "utf8");
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === "GET") {
    const state = await readStateFromFile();
    res.status(200).json(state);
    return;
  }

  if (req.method === "POST") {
    const parsed = stateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request body",
        details: parsed.error.flatten()
      });
      return;
    }

    await writeStateToFile(parsed.data);
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: "Method Not Allowed" });
}
