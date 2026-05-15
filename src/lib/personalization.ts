import { useEffect, useState } from "react";

export type PersonalizationMode = "default" | "solid" | "image";

export type Personalization = {
  mode: PersonalizationMode;
  color?: string;
  imageUrl?: string;
  fullPage?: boolean;
};

export const PERSONALIZATION_KEY = "execOs.personalization.v1";
const EVENT = "execOs.personalization.changed";

export const BRAND_SWATCHES: { name: string; value: string }[] = [
  { name: "Sage", value: "#A4B494" },
  { name: "Navy", value: "#083D77" },
  { name: "Forest", value: "#355834" },
  { name: "Rose", value: "#DB9C96" },
  { name: "Yellow", value: "#FFC100" },
  { name: "Orange", value: "#E97451" },
];

export const DEFAULT_PERSONALIZATION: Personalization = {
  mode: "default",
  color: "#A4B494",
  fullPage: false,
};

export function loadPersonalization(): Personalization {
  if (typeof window === "undefined") return DEFAULT_PERSONALIZATION;
  try {
    const raw = localStorage.getItem(PERSONALIZATION_KEY);
    if (!raw) return DEFAULT_PERSONALIZATION;
    return { ...DEFAULT_PERSONALIZATION, ...(JSON.parse(raw) as Personalization) };
  } catch {
    return DEFAULT_PERSONALIZATION;
  }
}

export function savePersonalization(p: Personalization) {
  if (typeof window === "undefined") return;
  try {
    if (p.mode === "default") {
      localStorage.removeItem(PERSONALIZATION_KEY);
    } else {
      localStorage.setItem(PERSONALIZATION_KEY, JSON.stringify(p));
    }
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {}
}

export function usePersonalization(): [Personalization, (p: Personalization) => void] {
  const [state, setState] = useState<Personalization>(() => loadPersonalization());
  useEffect(() => {
    const sync = () => setState(loadPersonalization());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const update = (p: Personalization) => {
    setState(p);
    savePersonalization(p);
  };
  return [state, update];
}

export function personalizationStyle(p: Personalization): React.CSSProperties | undefined {
  if (p.mode === "solid" && p.color) return { backgroundColor: p.color };
  if (p.mode === "image" && p.imageUrl)
    return {
      backgroundImage: `url(${p.imageUrl})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  return undefined;
}
