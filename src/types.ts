export interface Ingredient {
  name: string;
  quantity: number | null;
}

export type RecipeType = "dish" | "noodle";

export interface Recipe {
  name: string;
  type: RecipeType;
  ingredients?: string[];
}

export interface DayPlan {
  day: number;
  lunch: {
    staple: "rice" | "noodle";
    dishes: string[];
    noodle?: string;
  };
  dinner: {
    staple: "rice";
    dishes: string[];
  };
}

export interface PlanResult {
  plan: DayPlan[];
}

export interface PlanRequest {
  ingredients: Ingredient[];
  recipes: Recipe[];
  days: number;
}
