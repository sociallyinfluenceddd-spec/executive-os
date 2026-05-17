import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, ShoppingCart, Soup, BookOpen, Moon, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

// Kitchen tables aren't in the Supabase-generated types yet — they're added
// by migration 20260515132003_kitchen.sql. Until that's applied and types
// are regenerated, route the kitchen calls through this untyped alias.
// Remove once `exec_os_kitchen_recipes` + `exec_os_kitchen_shopping` appear
// in `src/integrations/supabase/types.ts`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const kdb = supabase as any;

type Tab = "shopping" | "meals" | "recipe" | "tonight";
type MealType = "breakfast" | "lunch" | "dinner" | "snack";

type Ingredient = {
  name: string;
  qty?: string;
  category?: string;
};

type RecipeRow = {
  id: string;
  user_id?: string;
  name: string;
  meal_type: MealType;
  ingredients: Ingredient[];
  steps: string[];
  prep_notes: string | null;
  scheduled_for: string | null; // ISO date YYYY-MM-DD
  source: string | null;
  created_at: string;
};

type ShoppingRow = {
  id: string;
  user_id?: string;
  item: string;
  qty: string | null;
  category: string;
  checked: boolean;
  source: string | null;
  recipe_id: string | null;
  created_at: string;
};

const TAB_KEY = "execOs.kitchen.activeTab.v1";
const SELECTED_RECIPE_KEY = "execOs.kitchen.selectedRecipe.v1";
const NAVY = "#083D77";
const ORANGE = "#E97451";

const CATEGORY_ORDER = ["Produce", "Protein", "Dairy", "Pantry", "Frozen", "Other"];
const CATEGORY_EMOJI: Record<string, string> = {
  Produce: "🥬",
  Protein: "🥩",
  Dairy: "🥛",
  Pantry: "🥫",
  Frozen: "🧊",
  Other: "📦",
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function guessCategory(name: string): string {
  const n = name.toLowerCase();
  if (/(chicken|beef|pork|fish|salmon|tofu|tempeh|egg|turkey|shrimp|bacon)/.test(n)) return "Protein";
  if (/(milk|yogurt|cheese|butter|cream|kefir)/.test(n)) return "Dairy";
  if (/(lettuce|spinach|tomato|onion|garlic|pepper|carrot|cucumber|kale|broccoli|berry|apple|banana|lemon|lime|herb|basil|cilantro|parsley)/.test(n)) return "Produce";
  if (/(frozen|ice|pop)/.test(n)) return "Frozen";
  if (/(rice|pasta|flour|sugar|oil|salt|spice|sauce|can|bean|lentil|cereal|bread)/.test(n)) return "Pantry";
  return "Other";
}

/* localStorage helpers (only used for active tab + selected recipe id) */
function loadLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return (JSON.parse(raw) as T) ?? fallback;
  } catch {
    return fallback;
  }
}
function saveLS<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* swallow */
  }
}

export function KitchenRecipesWidget() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>(() => loadLS<Tab>(TAB_KEY, "tonight"));
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(() =>
    loadLS<string | null>(SELECTED_RECIPE_KEY, null),
  );
  const [recipes, setRecipes] = useState<RecipeRow[] | null>(null);
  const [shopping, setShopping] = useState<ShoppingRow[] | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);

  useEffect(() => saveLS(TAB_KEY, tab), [tab]);
  useEffect(() => saveLS(SELECTED_RECIPE_KEY, selectedRecipeId), [selectedRecipeId]);

  const loadAll = useCallback(async () => {
    if (!user) return;
    const [{ data: r, error: rErr }, { data: s, error: sErr }] = await Promise.all([
      kdb
        .from("exec_os_kitchen_recipes")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      kdb
        .from("exec_os_kitchen_shopping")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),
    ]);
    // PostgREST returns code "42P01" when table is missing; surface a friendly setup state
    if (rErr?.code === "42P01" || sErr?.code === "42P01") {
      setSetupNeeded(true);
      setRecipes([]);
      setShopping([]);
      return;
    }
    setRecipes((r ?? []) as RecipeRow[]);
    setShopping((s ?? []) as ShoppingRow[]);
  }, [user]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  /* realtime — refresh on any change */
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("kitchen_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "exec_os_kitchen_recipes", filter: `user_id=eq.${user.id}` },
        () => loadAll(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "exec_os_kitchen_shopping", filter: `user_id=eq.${user.id}` },
        () => loadAll(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, loadAll]);

  if (setupNeeded) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center space-y-2">
        <div className="text-base">🍳 Set-up needed</div>
        <div>The kitchen tables aren’t in your Supabase yet.</div>
        <div className="text-xs">Apply migration <code className="px-1 py-0.5 rounded bg-muted">20260515_kitchen.sql</code> to enable this widget.</div>
      </div>
    );
  }

  if (!recipes || !shopping) {
    return (
      <div className="space-y-2 pt-2">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const selectedRecipe = recipes.find((r) => r.id === selectedRecipeId) ?? null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <Tabs
        tab={tab}
        setTab={setTab}
        recipeCount={recipes.length}
        shoppingCount={shopping.filter((s) => !s.checked).length}
        hasTonight={!!recipes.find((r) => r.meal_type === "dinner" && r.scheduled_for === todayISO())}
      />
      <div className="flex-1 overflow-auto pt-2">
        {tab === "shopping" && (
          <ShoppingTab
            items={shopping}
            onChange={loadAll}
            userId={user?.id}
          />
        )}
        {tab === "meals" && (
          <MealsTab
            recipes={recipes}
            onPick={(id) => {
              setSelectedRecipeId(id);
              setTab("recipe");
            }}
            onRefresh={loadAll}
            userId={user?.id}
          />
        )}
        {tab === "recipe" && (
          <RecipeTab
            recipe={selectedRecipe}
            onBackToMeals={() => setTab("meals")}
            onAddToShopping={() => loadAll()}
            userId={user?.id}
          />
        )}
        {tab === "tonight" && (
          <TonightTab
            recipes={recipes}
            onOpenRecipe={(id) => {
              setSelectedRecipeId(id);
              setTab("recipe");
            }}
          />
        )}
      </div>
    </div>
  );
}

function Tabs({
  tab,
  setTab,
  recipeCount,
  shoppingCount,
  hasTonight,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  recipeCount: number;
  shoppingCount: number;
  hasTonight: boolean;
}) {
  const Btn = ({ value, label, count, icon: Icon, dot }: { value: Tab; label: string; count?: number; icon: typeof Soup; dot?: boolean }) => {
    const active = tab === value;
    return (
      <button
        type="button"
        onClick={() => setTab(value)}
        className={`flex items-center gap-1.5 text-sm pb-1.5 border-b-2 transition-colors ${
          active ? "text-foreground border-current font-semibold" : "text-muted-foreground border-transparent hover:text-foreground"
        }`}
        style={active ? { color: NAVY } : undefined}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
        {typeof count === "number" && <span className="opacity-60">({count})</span>}
        {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ORANGE }} />}
      </button>
    );
  };
  return (
    <div className="flex gap-4 border-b border-border overflow-x-auto">
      <Btn value="shopping" label="Shopping" count={shoppingCount} icon={ShoppingCart} />
      <Btn value="meals" label="Meals" count={recipeCount} icon={Soup} />
      <Btn value="recipe" label="Recipe" icon={BookOpen} />
      <Btn value="tonight" label="Tonight" icon={Moon} dot={hasTonight} />
    </div>
  );
}

/* ------------------- Shopping tab ------------------- */

function ShoppingTab({
  items,
  onChange,
  userId,
}: {
  items: ShoppingRow[];
  onChange: () => void;
  userId: string | undefined;
}) {
  const [newItem, setNewItem] = useState("");

  const groups = useMemo(() => {
    const map = new Map<string, ShoppingRow[]>();
    items.forEach((it) => {
      const cat = it.category || "Other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(it);
    });
    return Array.from(map.entries()).sort(
      (a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]),
    );
  }, [items]);

  const checkedCount = items.filter((i) => i.checked).length;

  const addItem = async () => {
    if (!newItem.trim() || !userId) return;
    const category = guessCategory(newItem);
    const { error } = await kdb
      .from("exec_os_kitchen_shopping")
      .insert({ user_id: userId, item: newItem.trim(), category, source: "manual", checked: false });
    if (error) {
      toast.error(`Couldn’t add: ${error.message}`);
      return;
    }
    setNewItem("");
    onChange();
  };

  const toggleCheck = async (id: string, checked: boolean) => {
    const { error } = await kdb.from("exec_os_kitchen_shopping").update({ checked }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    onChange();
  };

  const clearChecked = async () => {
    if (!userId) return;
    const { error } = await kdb
      .from("exec_os_kitchen_shopping")
      .delete()
      .eq("user_id", userId)
      .eq("checked", true);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Cleared checked items");
    onChange();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addItem();
          }}
          placeholder="Add an item…"
          className="h-8 text-sm"
        />
        <Button size="sm" onClick={addItem} className="h-8" style={{ backgroundColor: NAVY }}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
        {checkedCount > 0 && (
          <Button size="sm" variant="ghost" onClick={clearChecked} className="h-8 px-2 text-xs">
            Clear {checkedCount}
          </Button>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">Shopping list is empty. Add an item or push one from a recipe.</div>
      ) : (
        groups.map(([cat, rows]) => {
          const unchecked = rows.filter((r) => !r.checked);
          const checked = rows.filter((r) => r.checked);
          return (
            <div key={cat} className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <span aria-hidden>{CATEGORY_EMOJI[cat] ?? "📦"}</span>
                {cat} <span className="opacity-60">({unchecked.length})</span>
              </div>
              <ul className="space-y-1">
                {unchecked.map((r) => (
                  <ShoppingRowItem key={r.id} row={r} onToggle={toggleCheck} />
                ))}
                {checked.length > 0 && (
                  <li>
                    <details>
                      <summary className="text-xs text-muted-foreground cursor-pointer py-1 select-none">
                        Checked ({checked.length})
                      </summary>
                      <ul className="space-y-1 pl-2">
                        {checked.map((r) => (
                          <ShoppingRowItem key={r.id} row={r} onToggle={toggleCheck} />
                        ))}
                      </ul>
                    </details>
                  </li>
                )}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}

function ShoppingRowItem({
  row,
  onToggle,
}: {
  row: ShoppingRow;
  onToggle: (id: string, checked: boolean) => void;
}) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={row.checked}
        onChange={(e) => onToggle(row.id, e.target.checked)}
        className="h-4 w-4 rounded border-border accent-current"
        style={{ accentColor: NAVY }}
      />
      <span className={row.checked ? "text-muted-foreground line-through" : ""}>
        {row.item}
        {row.qty ? <span className="text-muted-foreground"> · {row.qty}</span> : null}
      </span>
    </li>
  );
}

/* ------------------- Meals tab ------------------- */

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
};

function MealsTab({
  recipes,
  onPick,
  onRefresh,
  userId,
}: {
  recipes: RecipeRow[];
  onPick: (id: string) => void;
  onRefresh: () => void;
  userId: string | undefined;
}) {
  const grouped = useMemo(() => {
    const out: Record<MealType, RecipeRow[]> = { breakfast: [], lunch: [], dinner: [], snack: [] };
    recipes.forEach((r) => {
      if (r.meal_type in out) out[r.meal_type].push(r);
    });
    return out;
  }, [recipes]);

  const [adding, setAdding] = useState<MealType | null>(null);
  const [newName, setNewName] = useState("");

  const addRecipe = async (mealType: MealType) => {
    if (!newName.trim() || !userId) return;
    const { error } = await kdb.from("exec_os_kitchen_recipes").insert({
      user_id: userId,
      name: newName.trim(),
      meal_type: mealType,
      ingredients: [],
      steps: [],
      source: "manual",
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewName("");
    setAdding(null);
    onRefresh();
  };

  return (
    <div className="space-y-4">
      {(Object.keys(MEAL_LABELS) as MealType[]).map((mt) => (
        <section key={mt} className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{MEAL_LABELS[mt]}</div>
          {grouped[mt].length === 0 ? (
            <div className="text-sm text-muted-foreground italic">No {MEAL_LABELS[mt].toLowerCase()} yet.</div>
          ) : (
            <ul className="space-y-1">
              {grouped[mt].map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onPick(r.id)}
                    className="w-full flex items-center justify-between text-left text-sm rounded-md px-2 py-1.5 hover:bg-muted transition-colors group"
                  >
                    <span className="truncate">{r.name}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {r.scheduled_for ? <span>{r.scheduled_for}</span> : null}
                      <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {adding === mt ? (
            <div className="flex items-center gap-2 pt-1">
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addRecipe(mt);
                  if (e.key === "Escape") {
                    setAdding(null);
                    setNewName("");
                  }
                }}
                placeholder={`Name a ${MEAL_LABELS[mt].toLowerCase()}…`}
                className="h-8 text-sm"
              />
              <Button size="sm" onClick={() => addRecipe(mt)} className="h-8" style={{ backgroundColor: NAVY }}>
                Add
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAdding(mt);
                setNewName("");
              }}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <Plus className="h-3 w-3" /> Add recipe
            </button>
          )}
        </section>
      ))}
    </div>
  );
}

/* ------------------- Recipe tab ------------------- */

function RecipeTab({
  recipe,
  onBackToMeals,
  onAddToShopping,
  userId,
}: {
  recipe: RecipeRow | null;
  onBackToMeals: () => void;
  onAddToShopping: () => void;
  userId: string | undefined;
}) {
  if (!recipe) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center space-y-2">
        <div>Pick a recipe from the Meals tab.</div>
        <Button size="sm" variant="outline" onClick={onBackToMeals}>Go to Meals</Button>
      </div>
    );
  }

  const pushToShopping = async () => {
    if (!userId) return;
    const rows = (recipe.ingredients ?? []).map((ing) => ({
      user_id: userId,
      item: ing.name,
      qty: ing.qty ?? null,
      category: ing.category ?? guessCategory(ing.name),
      source: "recipe",
      recipe_id: recipe.id,
      checked: false,
    }));
    if (rows.length === 0) {
      toast.info("No ingredients on this recipe yet.");
      return;
    }
    const { error } = await kdb.from("exec_os_kitchen_shopping").insert(rows);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Added ${rows.length} item${rows.length === 1 ? "" : "s"} to shopping`);
    onAddToShopping();
  };

  const deleteRecipe = async () => {
    if (!recipe) return;
    const { error } = await kdb.from("exec_os_kitchen_recipes").delete().eq("id", recipe.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Recipe deleted");
    onBackToMeals();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold truncate">{recipe.name}</h3>
            <span
              className="text-[10px] uppercase tracking-wider font-semibold rounded px-1.5 py-0.5"
              style={{ color: NAVY, backgroundColor: `${NAVY}1a` }}
            >
              {recipe.meal_type}
            </span>
          </div>
          {recipe.scheduled_for && (
            <div className="text-xs text-muted-foreground mt-0.5">Planned for {recipe.scheduled_for}</div>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={deleteRecipe} className="h-7 px-2 text-muted-foreground" aria-label="Delete recipe">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {recipe.prep_notes && (
        <div
          className="rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: `${ORANGE}66`, backgroundColor: `${ORANGE}11`, color: ORANGE }}
        >
          🔔 {recipe.prep_notes}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Ingredients</div>
          {(!recipe.ingredients || recipe.ingredients.length === 0) ? (
            <div className="text-sm text-muted-foreground italic">No ingredients yet.</div>
          ) : (
            <ul className="space-y-1 text-sm">
              {recipe.ingredients.map((ing, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">{ing.name}</span>
                  {ing.qty && <span className="text-muted-foreground shrink-0">{ing.qty}</span>}
                </li>
              ))}
            </ul>
          )}
          <Button size="sm" variant="outline" onClick={pushToShopping} className="mt-2 h-7 text-xs">
            Add to shopping list
          </Button>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Steps</div>
          {(!recipe.steps || recipe.steps.length === 0) ? (
            <div className="text-sm text-muted-foreground italic">No steps yet.</div>
          ) : (
            <ol className="space-y-1 text-sm list-decimal list-inside">
              {recipe.steps.map((s, i) => (
                <li key={i} className="text-sm">{s}</li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------- Tonight tab ------------------- */

function TonightTab({
  recipes,
  onOpenRecipe,
}: {
  recipes: RecipeRow[];
  onOpenRecipe: (id: string) => void;
}) {
  const today = todayISO();
  const dinner = recipes.find((r) => r.meal_type === "dinner" && r.scheduled_for === today) ?? null;
  const prepTasks = useMemo(() => {
    return recipes
      .filter((r) => r.scheduled_for === today && r.prep_notes)
      .map((r) => ({ id: r.id, recipeName: r.name, note: r.prep_notes! }));
  }, [recipes, today]);

  if (!dinner && prepTasks.length === 0) {
    return (
      <div className="py-6 px-4 space-y-3">
        <div className="text-center space-y-1">
          <div className="text-base">🌙 Nothing planned for tonight.</div>
          <div className="text-xs text-muted-foreground">
            Add a recipe in the Meals tab and set its date to today.
          </div>
        </div>
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1.5">
          <div className="font-semibold text-foreground">How this widget gets data</div>
          <ul className="list-disc list-inside space-y-1">
            <li>Add recipes manually in the <strong>Meals</strong> tab.</li>
            <li>Items pushed to <strong>Shopping</strong> from recipes appear grouped by category.</li>
            <li>External tools (e.g. Cowork) can POST batches via the
              {" "}<code className="px-1 py-0.5 rounded bg-background">ingest-kitchen</code> edge function once deployed.</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {dinner && (
        <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: `${NAVY}33`, backgroundColor: `${NAVY}08` }}>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Tonight’s dinner</div>
          <div className="text-lg font-semibold">{dinner.name}</div>
          <Button size="sm" onClick={() => onOpenRecipe(dinner.id)} style={{ backgroundColor: NAVY }} className="h-8">
            Start cooking →
          </Button>
        </div>
      )}
      {prepTasks.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prep notes</div>
          <ul className="space-y-2">
            {prepTasks.map((p) => (
              <li
                key={p.id}
                className="rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-muted/40"
                style={{ borderColor: `${ORANGE}55`, backgroundColor: `${ORANGE}0d` }}
                onClick={() => onOpenRecipe(p.id)}
              >
                <div className="font-medium">{p.recipeName}</div>
                <div className="text-xs text-muted-foreground">{p.note}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
