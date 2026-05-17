import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Sparkles } from "lucide-react";

// Public lead-magnet page. No auth required. Reads from
// public.exec_os_public_profile + public.public_revenue_monthly view, both
// of which RLS-gate behind the user's opt-in share_* flags.

// Tables aren't in generated types until `supabase gen types typescript` is rerun
// post-migration 20260517130000_public_open.sql.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdb = supabase as any;

type Profile = {
  user_id: string;
  display_name: string;
  tagline: string | null;
  cta_label: string | null;
  cta_url: string | null;
  share_revenue: boolean;
  share_content: boolean;
  share_clients: boolean;
};

type RevenueMonth = {
  user_id: string;
  month: string; // YYYY-MM-01
  amount_cents: number;
  entries: number;
};

const NAVY = "#083D77";
const SAGE = "#A4B494";
const FOREST = "#355834";
const YELLOW = "#FFC100";
const CREAM = "#F5F2EC";

function formatUSDFull(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function monthLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
}

function OpenPage() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [months, setMonths] = useState<RevenueMonth[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // First publicly opted-in profile. Donna is currently the only user; this
      // grabs hers. When/if we add team members, we'll add a slug-based lookup.
      const { data: profileRows } = await pdb
        .from("exec_os_public_profile")
        .select(
          "user_id, display_name, tagline, cta_label, cta_url, share_revenue, share_content, share_clients",
        )
        .limit(1);
      if (cancelled) return;
      const p = (profileRows?.[0] ?? null) as Profile | null;
      setProfile(p);
      if (p?.share_revenue) {
        const { data: rev } = await pdb
          .from("public_revenue_monthly")
          .select("user_id, month, amount_cents, entries")
          .eq("user_id", p.user_id)
          .order("month", { ascending: true });
        if (!cancelled) setMonths((rev ?? []) as RevenueMonth[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Stats
  const last6 = useMemo(() => months.slice(-6), [months]);
  const thisMonthCents = last6[last6.length - 1]?.amount_cents ?? 0;
  const lastMonthCents = last6[last6.length - 2]?.amount_cents ?? 0;
  const sixMonthTotalCents = last6.reduce((s, m) => s + m.amount_cents, 0);
  const sixMonthAvgCents = last6.length > 0 ? Math.round(sixMonthTotalCents / last6.length) : 0;
  const maxMonthCents = Math.max(1, ...last6.map((m) => m.amount_cents));

  const deltaPct =
    lastMonthCents > 0
      ? Math.round(((thisMonthCents - lastMonthCents) / lastMonthCents) * 100)
      : null;

  // ----- Render states -----
  if (profile === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: CREAM }}>
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-6"
        style={{ background: CREAM }}
      >
        <div className="max-w-xl text-center">
          <h1
            className="text-3xl font-semibold mb-3"
            style={{ color: NAVY, fontFamily: "Cambria, Georgia, serif" }}
          >
            This page is private (for now).
          </h1>
          <p className="text-sm" style={{ color: "#555" }}>
            The owner hasn't opted in to share their numbers publicly yet. Check back later.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: CREAM, color: "#1A1A1A" }}>
      {/* HEADER */}
      <header
        className="px-6 py-10 md:px-12 md:py-14 border-b"
        style={{ background: NAVY, color: "white", borderColor: NAVY }}
      >
        <div className="max-w-5xl mx-auto">
          <div
            className="text-[11px] font-semibold tracking-[0.3em] mb-3"
            style={{ color: YELLOW }}
          >
            OPEN · LIVE METRICS
          </div>
          <h1
            className="text-4xl md:text-5xl font-bold leading-tight"
            style={{ fontFamily: "Cambria, Georgia, serif" }}
          >
            {profile.display_name}
          </h1>
          {profile.tagline && (
            <p className="mt-3 text-base md:text-lg italic" style={{ color: "#CADCFC" }}>
              {profile.tagline}
            </p>
          )}
          <p className="mt-4 text-xs" style={{ color: SAGE }}>
            Last updated{" "}
            {new Date().toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
            . Numbers refreshed live from the same dashboard the owner uses every day.
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 md:px-12 md:py-14 space-y-12">
        {/* TILE: REVENUE */}
        {profile.share_revenue && (
          <section>
            <div
              className="text-[11px] font-semibold tracking-[0.3em] mb-3"
              style={{ color: NAVY }}
            >
              01 · REVENUE
            </div>
            <h2
              className="text-2xl md:text-3xl font-bold"
              style={{ color: NAVY, fontFamily: "Cambria, Georgia, serif" }}
            >
              Revenue across all streams
            </h2>
            <p className="text-sm mt-1" style={{ color: "#555" }}>
              Stripe, Gumroad, CMO retainers, TikTok creator income, and sponsorships — combined.
            </p>

            {/* HERO NUMBERS */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6">
              <div className="bg-white border border-[#D9D4C9] p-5">
                <div className="text-[10px] uppercase tracking-[0.2em] text-[#6B6B6B]">
                  This month
                </div>
                <div
                  className="text-3xl md:text-4xl font-bold mt-1 tabular-nums"
                  style={{ color: NAVY, fontFamily: "Cambria, Georgia, serif" }}
                >
                  {formatUSDFull(thisMonthCents)}
                </div>
                {deltaPct !== null && (
                  <div
                    className="text-xs mt-1 font-medium"
                    style={{ color: deltaPct >= 0 ? FOREST : "#B85042" }}
                  >
                    {deltaPct >= 0 ? "▲" : "▼"} {Math.abs(deltaPct)}% vs. last month
                  </div>
                )}
              </div>

              <div className="bg-white border border-[#D9D4C9] p-5">
                <div className="text-[10px] uppercase tracking-[0.2em] text-[#6B6B6B]">
                  6-month avg
                </div>
                <div
                  className="text-3xl md:text-4xl font-bold mt-1 tabular-nums"
                  style={{ color: NAVY, fontFamily: "Cambria, Georgia, serif" }}
                >
                  {formatUSDFull(sixMonthAvgCents)}
                </div>
                <div className="text-xs mt-1 text-[#6B6B6B]">per month</div>
              </div>

              <div className="bg-white border border-[#D9D4C9] p-5 col-span-2 md:col-span-1">
                <div className="text-[10px] uppercase tracking-[0.2em] text-[#6B6B6B]">
                  Trailing 6 months
                </div>
                <div
                  className="text-3xl md:text-4xl font-bold mt-1 tabular-nums"
                  style={{ color: NAVY, fontFamily: "Cambria, Georgia, serif" }}
                >
                  {formatUSDFull(sixMonthTotalCents)}
                </div>
                <div className="text-xs mt-1 text-[#6B6B6B]">total revenue</div>
              </div>
            </div>

            {/* BAR CHART */}
            {last6.length > 0 ? (
              <div className="mt-8 bg-white border border-[#D9D4C9] p-5 md:p-7">
                <div className="text-xs font-medium text-[#6B6B6B] mb-4">
                  Monthly revenue · last {last6.length} months
                </div>
                <div className="flex items-end gap-3 md:gap-5 h-48">
                  {last6.map((m) => {
                    const heightPct = (m.amount_cents / maxMonthCents) * 100;
                    return (
                      <div key={m.month} className="flex-1 flex flex-col items-center min-w-0">
                        <div
                          className="text-[10px] tabular-nums mb-1 truncate w-full text-center"
                          style={{ color: NAVY }}
                        >
                          {formatUSDFull(m.amount_cents)}
                        </div>
                        <div
                          className="w-full transition-all"
                          style={{
                            height: `${Math.max(2, heightPct)}%`,
                            background: NAVY,
                            minHeight: "3px",
                          }}
                        />
                        <div className="text-[10px] text-[#6B6B6B] mt-2 truncate w-full text-center">
                          {monthLabel(m.month)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="mt-8 bg-white border border-[#D9D4C9] p-6 text-center">
                <p className="text-sm text-[#6B6B6B]">
                  No revenue data yet for this period.
                </p>
              </div>
            )}
          </section>
        )}

        {/* TILE: CONTENT (placeholder until exec_os_content_metrics exists) */}
        {profile.share_content && (
          <section className="bg-white border border-[#D9D4C9] p-6">
            <Sparkles className="h-5 w-5 mb-2" style={{ color: YELLOW }} />
            <p className="text-sm text-[#6B6B6B] italic">
              Content metrics coming online soon.
            </p>
          </section>
        )}

        {/* TILE: CLIENTS (placeholder until exec_os_cmo_clients exists) */}
        {profile.share_clients && (
          <section className="bg-white border border-[#D9D4C9] p-6">
            <Sparkles className="h-5 w-5 mb-2" style={{ color: YELLOW }} />
            <p className="text-sm text-[#6B6B6B] italic">
              Active CMO client roster coming online soon.
            </p>
          </section>
        )}

        {/* CTA */}
        {profile.cta_url && (
          <section
            className="mt-10 p-8 md:p-10"
            style={{ background: NAVY, color: "white" }}
          >
            <div
              className="text-[11px] font-semibold tracking-[0.3em] mb-3"
              style={{ color: YELLOW }}
            >
              WANT THE SAME FOR YOUR BUSINESS?
            </div>
            <h3
              className="text-2xl md:text-3xl font-bold leading-tight"
              style={{ fontFamily: "Cambria, Georgia, serif" }}
            >
              I build executive dashboards + AI lead conversion systems for fractional CMOs.
            </h3>
            <p className="mt-3 text-sm md:text-base" style={{ color: "#CADCFC" }}>
              The same operating system that runs the numbers on this page — built for your
              practice. $7,500 build + ongoing retainer.
            </p>
            <a
              href={profile.cta_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-6 px-6 py-3 font-medium text-sm transition-all hover:scale-[1.02]"
              style={{ background: YELLOW, color: NAVY }}
            >
              {profile.cta_label || "Book a discovery call"}
              <ArrowRight className="h-4 w-4" />
            </a>
          </section>
        )}

        <footer
          className="text-[11px] text-[#6B6B6B] pt-8 border-t border-[#D9D4C9] flex flex-wrap items-center justify-between gap-2"
        >
          <span>
            Numbers update live from {profile.display_name}'s Executive OS. No screenshots, no
            cherry-picking.
          </span>
          <span>Powered by Executive OS</span>
        </footer>
      </main>
    </div>
  );
}

export const Route = createFileRoute("/open")({
  component: OpenPage,
});
