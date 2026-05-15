import { useEffect, useState } from "react";

export type PersonalizationMode = "default" | "color" | "image";

export type Personalization = {
  mode: PersonalizationMode;
  color: string | null;
  imageDataUrl: string | null;
  applyFullPage: boolean;
};

export const PERSONALIZATION_KEY = "execOs.headerPersonalization.v1";
const EVENT = "execOs.headerPersonalization.changed";

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
  color: null,
  imageDataUrl: null,
  applyFullPage: false,
};

export function loadPersonalization(): Personalization {
  if (typeof window === "undefined") return DEFAULT_PERSONALIZATION;
  try {
    const raw = localStorage.getItem(PERSONALIZATION_KEY);
    if (!raw) return DEFAULT_PERSONALIZATION;
    const parsed = JSON.parse(raw) as Partial<Personalization>;
    return { ...DEFAULT_PERSONALIZATION, ...parsed };
  } catch {
    return DEFAULT_PERSONALIZATION;
  }
}

export function savePersonalization(p: Personalization) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PERSONALIZATION_KEY, JSON.stringify(p));
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

/** Relative luminance per WCAG; returns 0..1. */
export function luminance(hex: string): number {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  if (full.length !== 6) return 1;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const adj = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * adj(r) + 0.7152 * adj(g) + 0.0722 * adj(b);
}

export function isDarkColor(hex: string): boolean {
  return luminance(hex) < 0.5;
}
