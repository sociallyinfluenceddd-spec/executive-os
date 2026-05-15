import { useRef } from "react";
import { HexColorPicker } from "react-colorful";
import { toast } from "sonner";
import {
  BRAND_SWATCHES,
  DEFAULT_PERSONALIZATION,
  PERSONALIZATION_KEY,
  isDarkColor,
  usePersonalization,
  type Personalization,
  type PersonalizationMode,
} from "@/lib/personalization";

const MAX_BYTES = 4 * 1024 * 1024;

export function PersonalizationSettings() {
  const [p, setP] = usePersonalization();
  const fileRef = useRef<HTMLInputElement>(null);

  const setMode = (mode: PersonalizationMode) => {
    setP({ ...p, mode });
  };

  const handleFile = (file: File) => {
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      toast.error("Only JPEG or PNG images are supported");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image must be under 4 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setP({ ...p, imageDataUrl: String(reader.result), mode: "image" });
    };
    reader.onerror = () => toast.error("Could not read image");
    reader.readAsDataURL(file);
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

      <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5">
        {(["default", "color", "image"] as PersonalizationMode[]).map((m) => {
          const active = p.mode === m;
          const label = m === "color" ? "Solid color" : m.charAt(0).toUpperCase() + m.slice(1);
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-xs rounded-md transition ${
                active
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {p.mode === "color" && (
        <div className="space-y-4">
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

          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <HexColorPicker
              color={p.color ?? "#A4B494"}
              onChange={(color) => setP({ ...p, color })}
            />
            <div className="flex items-center gap-2 text-sm">
              <span
                className="h-8 w-8 rounded border border-border"
                style={{ backgroundColor: p.color ?? "transparent" }}
              />
              <code className="text-xs">{p.color ?? "—"}</code>
            </div>
          </div>

          <FullPageToggle
            value={p.applyFullPage}
            onChange={(v) => setP({ ...p, applyFullPage: v })}
          />
        </div>
      )}

      {p.mode === "image" && (
        <div className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-muted transition"
            >
              {p.imageDataUrl ? "Replace image" : "Choose image"}
            </button>
            <span className="text-xs text-muted-foreground">JPEG or PNG, up to 4 MB</span>
          </div>

          {p.imageDataUrl && (
            <div className="space-y-2">
              <div
                className="rounded-md border border-border overflow-hidden"
                style={{
                  width: 160,
                  height: 80,
                  backgroundImage: `url(${p.imageDataUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              />
              <button
                type="button"
                onClick={() => setP({ ...p, imageDataUrl: null })}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Remove image
              </button>
            </div>
          )}

          <FullPageToggle
            value={p.applyFullPage}
            onChange={(v) => setP({ ...p, applyFullPage: v })}
          />
        </div>
      )}
    </section>
  );
}

function FullPageToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4"
      />
      Apply to full page background
    </label>
  );
}
