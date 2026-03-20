import { Ingredient, PlanResult, Recipe } from "./types";

export interface PlannerOptions {
  days: number;
}

const MIN_DAYS = 2;
const MAX_DAYS = 5;

function clampDays(days: number): number {
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.floor(days)));
}

function buildInventory(ingredients: Ingredient[]): Record<string, number> {
  const inventory: Record<string, number> = {};
  for (const ingredient of ingredients) {
    const key = ingredient.name.trim();
    if (!key) continue;
    const qty = ingredient.quantity ?? 1;
    inventory[key] = (inventory[key] ?? 0) + Math.max(0, qty);
  }
  return inventory;
}

function calcRecipeScore(recipe: Recipe, inventory: Record<string, number>): number {
  const itemNames = recipe.ingredients ?? [];
  if (itemNames.length === 0) return 0;

  let matched = 0;
  for (const name of itemNames) {
    if ((inventory[name] ?? 0) > 0) matched += 1;
  }
  return matched / itemNames.length;
}

function normalizeIngredientName(name: string): string {
  const raw = name.trim();
  const synonyms: Record<string, string> = {
    番茄: "西红柿",
    蕃茄: "西红柿",
    马铃薯: "土豆"
  };
  return synonyms[raw] || raw;
}

function getIngredientSet(recipe: Recipe): Set<string> {
  const names = (recipe.ingredients ?? []).map((n) => normalizeIngredientName(n)).filter(Boolean);
  return new Set(names);
}

function isSimilarRecipe(a: Recipe, b: Recipe): boolean {
  if (a.name === b.name) return true;

  const setA = getIngredientSet(a);
  const setB = getIngredientSet(b);
  if (setA.size === 0 || setB.size === 0) return false;

  let overlap = 0;
  for (const name of setA) {
    if (setB.has(name)) overlap += 1;
  }

  const minSize = Math.min(setA.size, setB.size);
  return overlap / minSize >= 0.5;
}

function pickRecipe(
  pool: Recipe[],
  usedRecipeNames: Set<string>,
  inventory: Record<string, number>,
  daySelectedRecipes: Recipe[]
): Recipe | null {
  let best: Recipe | null = null;
  let bestScore = -1;

  for (const recipe of pool) {
    if (usedRecipeNames.has(recipe.name)) continue;
    const similarInDay = daySelectedRecipes.some((chosen) => isSimilarRecipe(chosen, recipe));
    if (similarInDay) continue;
    const score = calcRecipeScore(recipe, inventory);
    if (score > bestScore) {
      best = recipe;
      bestScore = score;
    }
  }
  return best;
}

function pickAndUseRecipe(
  pool: Recipe[],
  usedRecipeNames: Set<string>,
  inventory: Record<string, number>,
  daySelectedRecipes: Recipe[]
): Recipe | null {
  const recipe = pickRecipe(pool, usedRecipeNames, inventory, daySelectedRecipes);
  if (!recipe) return null;
  usedRecipeNames.add(recipe.name);
  daySelectedRecipes.push(recipe);
  consumeInventory(recipe, inventory);
  return recipe;
}

function consumeInventory(recipe: Recipe, inventory: Record<string, number>): void {
  for (const ing of recipe.ingredients ?? []) {
    if ((inventory[ing] ?? 0) > 0) {
      inventory[ing] -= 1;
    }
  }
}

function chooseLunchStaple(canRiceLunch: boolean, canNoodleLunch: boolean): "rice" | "noodle" | null {
  if (!canRiceLunch && !canNoodleLunch) return null;
  if (canRiceLunch && !canNoodleLunch) return "rice";
  if (!canRiceLunch && canNoodleLunch) return "noodle";
  return Math.random() < 0.7 ? "rice" : "noodle";
}

export function generatePlan(
  ingredients: Ingredient[],
  recipes: Recipe[],
  options: PlannerOptions
): PlanResult {
  const days = clampDays(options.days);
  const inventory = buildInventory(ingredients);
  const usedRecipeNames = new Set<string>();

  const dishPool = recipes.filter((r) => r.type === "dish");
  const noodlePool = recipes.filter((r) => r.type === "noodle");

  const plan: PlanResult["plan"] = [];

  for (let day = 1; day <= days; day += 1) {
    const daySelectedRecipes: Recipe[] = [];
    const remainingDishCount = dishPool.filter((r) => !usedRecipeNames.has(r.name)).length;
    const remainingNoodleCount = noodlePool.filter((r) => !usedRecipeNames.has(r.name)).length;

    const canRiceLunch = remainingDishCount >= 4;
    const canNoodleLunch = remainingDishCount >= 2 && remainingNoodleCount >= 1;
    const lunchStaple = chooseLunchStaple(canRiceLunch, canNoodleLunch);

    if (!lunchStaple) {
      break;
    }

    const lunchDishes: string[] = [];
    let lunchNoodle = "";
    const dinnerDishes: string[] = [];

    if (lunchStaple === "rice") {
      for (let i = 0; i < 2; i += 1) {
        const recipe = pickAndUseRecipe(dishPool, usedRecipeNames, inventory, daySelectedRecipes);
        if (!recipe) return { plan };
        lunchDishes.push(recipe.name);
      }
    } else {
      const noodleRecipe = pickAndUseRecipe(noodlePool, usedRecipeNames, inventory, daySelectedRecipes);
      if (!noodleRecipe) return { plan };
      lunchNoodle = noodleRecipe.name;
    }

    for (let i = 0; i < 2; i += 1) {
      const recipe = pickAndUseRecipe(dishPool, usedRecipeNames, inventory, daySelectedRecipes);
      if (!recipe) return { plan };
      dinnerDishes.push(recipe.name);
    }

    plan.push({
      day,
      lunch: {
        staple: lunchStaple,
        dishes: lunchStaple === "rice" ? lunchDishes : [],
        noodle: lunchStaple === "noodle" ? lunchNoodle : undefined
      },
      dinner: {
        staple: "rice",
        dishes: dinnerDishes
      }
    });
  }

  return { plan };
}
