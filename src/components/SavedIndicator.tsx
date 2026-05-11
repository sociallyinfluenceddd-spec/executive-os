import { Check } from "lucide-react";
import { useEffect, useState } from "react";

export function SavedIndicator({ stamp }: { stamp: number | null }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!stamp) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 2000);
    return () => clearTimeout(t);
  }, [stamp]);
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-[color:var(--sage)] transition-opacity ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <Check className="h-3 w-3" /> saved
    </span>
  );
}
