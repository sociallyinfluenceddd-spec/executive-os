import { HexColorPicker } from "react-colorful";
import {
  BRAND_SWATCHES,
  usePersonalization,
  type PersonalizationMode,
} from "@/lib/personalization";

export function PersonalizationSettings() {
  const [p, setP] = usePersonalization();

  const setMode = (mode: PersonalizationMode) => {
    if (mode === "default") {
      setP({ mode: "default", color: p.color, fullPage: false });
    } else {
      setP({ ...p, mode });
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-6 space-y-5">
      <div>
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          Personalization
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Customize the top header area of Today.
        </p>
      </div>

      {/* Segmented control */}
      <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5">
        {(["default", "solid", "image"] as PersonalizationMode[]).map((m) => {
          const active = p.mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-xs rounded-md capitalize transition ${
                active
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "solid" ? "Solid color" : m}
            </button>
          );
        })}
      </div>

      {p.mode === "solid" && (
        <div className="space-y-4">
          {/* Quick swatches */}
          <div className="flex flex-wrap gap-2">
            {BRAND_SWATCHES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setP({ ...p, color: s.value })}
                title={`${s.name} ${s.value}`}
                aria-label={s.name}
                className={`h-9 w-9 rounded-full border-2 transition ${
                  p.color?.toLowerCase() === s.value.toLowerCase()
                    ? "border-foreground scale-110"
                    : "border-border hover:border-foreground/40"
                }`}
                style={{ backgroundColor: s.value }}
              />
            ))}
          </div>

          {/* Color picker */}
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <HexColorPicker
              color={p.color ?? "#A4B494"}
              onChange={(color) => setP({ ...p, color })}
            />
            <div className="flex items-center gap-2 text-sm">
              <span
                className="h-8 w-8 rounded border border-border"
                style={{ backgroundColor: p.color }}
              />
              <code className="text-xs">{p.color}</code>
            </div>
          </div>

          {/* Full page toggle */}
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!p.fullPage}
              onChange={(e) => setP({ ...p, fullPage: e.target.checked })}
              className="h-4 w-4"
            />
            Apply to full page background
          </label>
        </div>
      )}

      {p.mode === "image" && (
        <div className="space-y-3">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">
            Image URL
          </label>
          <input
            type="url"
            value={p.imageUrl ?? ""}
            onChange={(e) => setP({ ...p, imageUrl: e.target.value })}
            placeholder="https://…"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!p.fullPage}
              onChange={(e) => setP({ ...p, fullPage: e.target.checked })}
              className="h-4 w-4"
            />
            Apply to full page background
          </label>
        </div>
      )}
    </section>
  );
}
