# Executive OS — Dashboard Audit

Scope: dashboard (`/today`), widgets (non-advisor), config/persistence, auxiliary components, auth/supabase wiring, ingest edge functions, migrations. Phase-4 advisor surface intentionally excluded.

---

## TL;DR — 5-bullet executive summary

1. **No genuine "Critical" bugs found** — RLS is correctly applied on every in-scope table; secrets aren't leaked; auth flow works. The app is in safe shape to use.
2. **The biggest real problem is `today.tsx` itself: 2,004 lines** holding 9+ inline widget renderings, three caching/persistence schemes, three migration paths, two realtime channels, and the entire grid orchestration. It will hurt every time you touch it. (Top 5 #1.)
3. **Three "Connected" widgets are fakes**: MONEY ("Connecting Ideafetti DB…"), CONTENT PULSE ("Syncing Ideafetti content data…"), and PROJECTS (hardcoded `DEFAULT_PROJECTS` array — Ideafetti progress 62%, AI Lead 38%, etc., shown to you as if real). MONEY/CONTENT PULSE are labelled "needs setup" in the catalog but still ship as default-active and render permanent placeholders. PROJECTS is labelled "connected" and isn't.
4. **Race conditions in dashboard state**: `removeWidget`'s undo uses a `let prevActive = []` captured from inside two separate setState callbacks — the second setState reads `prevActive` before React has settled the first. Also the `locks` effect calls `saveDashboard` inside `setLayouts` which is then immediately overwritten on the next `onLayoutChange`. Layout state is the most-modified surface in the app and the most fragile.
5. **EmailPanel.tsx (351 LOC) is fully orphaned** — never imported. Same with `AUTO_APPEND_WIDGETS` migration logic, which has already run once for everyone and now just runs `JSON.parse`+localStorage on every load forever. Delete both.

---

## Top 5 things to fix first

1. **Reset Layout has no confirm** → button at bottom of `/today` wipes the entire grid + locks on a single click. Add a confirm dialog. `today.tsx:1477-1485` + `resetLayout` at `today.tsx:480-484`.
2. **MONEY / CONTENT PULSE widgets render forever-loading placeholders** → either pull them out of `DEFAULT_ACTIVE_WIDGETS`, or render a clearly disabled / "not set up" state with a CTA. Right now they look broken. `today.tsx:1166-1183`, `1214-1232`; `widgets.ts:28-39`.
3. **PROJECTS widget shows hardcoded fake data** → marked "connected" in the catalog but the array is literally `[{ name: "Ideafetti", progress: 62, ... }]`. Either gate behind "needs setup", or back it with `exec_os_daily.tomorrow_seed` / a new `exec_os_projects` table. `today.tsx:417-423`, `1234-1284`.
4. **`removeWidget` undo is racy** → `prevActive` / `prevLayouts` are read inside two separate setState callbacks; the second runs against the captured value from the first which may not match React's committed state in StrictMode or under concurrent updates. Pull both reads to the start of the function via the current state ref pattern. `today.tsx:512-539`.
5. **`today.tsx` is 2,004 lines** → at minimum, lift the seven inline widget renderings (INBOX, CALENDAR, TIMELINE, PROJECTS, MONEY, CONTENT PULSE, Wellness) into `src/components/widgets/*.tsx` files matching the existing pattern. The `Card`, `BigStat`, `EmptyState`, `DateNav`, `Timeline`, `Sparkline`, `EventDetailSheet`, `linkify`, `looksLikeAddress`, `formatRange` helpers belong in `src/components/dashboard/`.

---

## 🔴 Critical

_None._ Smoke test passed: RLS enabled on every in-scope user-data table (`exec_os_emails`, `exec_os_calendar_events`, `exec_os_daily`, `exec_os_captures`, `exec_os_decisions`, `exec_os_ai_usage`), service-role client server-only, edge functions gate on `X-Ingest-Token`, magic-link auth standard. Nothing is actively broken in a way that risks data.

---

## 🟠 High

- **H-1. Race condition in `removeWidget` undo** — `today.tsx:512-539`. Two separate setState callbacks each capture/mutate `prevActive` / `prevLayouts` in scope. The toast's `onClick` reads `prevActive` (closed over once) but the second setState body may not see committed values from the first. Move the snapshot to a `setActiveWidgets((cur) => { prevActive = cur; ... })` then read `prevActive` *after* both updates schedule.
- **H-2. `locks` effect calls `saveDashboard` inside `setLayouts`** — `today.tsx:462-472`. The functional updater triggers `saveDashboard(next, locks)` during render commit, then any subsequent `onLayoutChange` overwrites it. Move the save to a separate effect that depends on `[layouts, locks]`.
- **H-3. Calendar realtime channel doesn't filter by `user_id`** — `today.tsx:644-680`. It subscribes to all `exec_os_calendar_events` row events. RLS protects you from seeing other users' rows, but Supabase realtime fans out before RLS in some configurations, and you waste WebSocket frames. Same on `cockpit_emails` `today.tsx:616-642`. Add `filter: \`user_id=eq.${user.id}\``.
- **H-4. Calendar realtime: stale-day events sneak in** — `today.tsx:660-665`. When `selectedDate` changes, the dependency re-subscribes (good), but if a payload's `start_at` is null the check `if (!t || ...)` treats `t === 0` from `NaN` as falsy and drops valid rows on the floor. Use `Number.isNaN(t)` explicitly. (Minor edge case but fixes ambiguous `!t` behavior.)
- **H-5. Live clock re-renders the entire page every 1s** — `today.tsx:427-431`. `setNow(new Date())` ripples through `meetingsToday`, `nextMeeting`, `nextMeetingMinutes`, every memo that uses `now`. With 9 widgets re-rendering every second on every dashboard view, this is wasted work. Bump to 30s or 60s, or isolate the clock into a child component.
- **H-6. `:any` boundaries in FollowUps** — `follow_ups.tsx:19, 51, 92, 105, 109`. `raw: any` and `onOpenEvent: (event: any) => void` defeat the calendar-event type chain. Import `CalendarEventRow` or define a shared `widgets/types.ts`.
- **H-7. `recording` is stale in the close-cleanup effect** — `CaptureModal.tsx:57-64`. Effect dep array is `[open, recording]` so closing while recording works on the *latest* render, but if Mic stops itself (`r.onend = () => setRecording(false)`) between the user pressing close and the effect running, `recRef.current?.stop()` is called on an already-stopped recognizer. Cosmetic — won't crash, but the cleanup is dead-codey. Better: store `recRef` and call stop unconditionally in the unmount path.
- **H-8. `recRef` is `any` and recognizer can leak on unmount** — `CaptureModal.tsx:49`. If the modal unmounts mid-recording the SpeechRecognition object isn't explicitly stopped, will keep listening until GC. Cleanup in a `useEffect(() => () => recRef.current?.stop(), [])`.
- **H-9. localStorage keys aren't versioned consistently** — `widgets.ts:26,44` use `v1`/`v2`, `today.tsx:165,167,168,198` mix `v1`/`v1`/legacy/`v1`, `personalization.ts:12` is `v1`. There's no central registry, no schema check, and `JSON.parse` will silently return malformed data. If you ever change `Personalization` or `DashboardPersisted` shapes, existing users break with no migration path. Centralize keys + add a `_version` field per blob.
- **H-10. Empty `catch {}` everywhere swallows localStorage errors silently** — `today.tsx:189, 220, 239, 241, 250, 265, 481`. Safari private mode and Lovable preview's sandbox can both reject `setItem`. Right now the user gets nothing. At least one toast on first failure would help.
- **H-11. `selectedCalendar` localStorage key isn't namespaced** — `today.tsx:451, 455`. Raw key `"today.selectedCalendar"` doesn't follow the `execOs.*` pattern of every other key. Cosmetic but bites if you ever globally clear.
- **H-12. Layout state may desync between two effects + onLayoutChange** — `today.tsx:461, 473-476, 492-510`. `setLayouts` is called from 5+ places (init, locks effect, onLayoutChange, addWidget, removeWidget, resetLayout). `saveDashboard` is called from 4 of them, sometimes with `loadLocks()` (re-reads from disk) and sometimes with the in-memory `locks`. If localStorage is mid-write or disk has stale data, the saved blob can mismatch state. Treat localStorage as a derived sink, not a source.
- **H-13. `r.onerror = () => setRecording(false)` swallows the actual error** — `CaptureModal.tsx:95`, `capture.tsx:128`. User gets no feedback when SpeechRecognition fails (e.g. mic permission denied). Should `toast.error`.
- **H-14. `inbox` realtime payload type-cast unsafe** — `today.tsx:629, 658`. `payload.new as EmailRow` — Supabase realtime payloads aren't typed the same shape as your select (`account, kind, sender_name, ...`); they include all columns. If the schema gains a column you're casting wide. Fine but worth knowing.

---

## 🟡 Medium

- **M-1. `EmailPanel.tsx` is dead code (351 lines)** — only `grep` hit is its own file. Inbox is rendered inline in `today.tsx:1107-1163`. Delete.
- **M-2. `voice_capture` widget has no implementation** — `widgets/voice_capture.tsx` is 12 lines that say "Coming soon". The library catalog already correctly marks it `coming_soon`, but it's still consuming a grid slot in `LG_BASE` / `MD_BASE` / `MOBILE_ORDER` and `DEFAULT_WIDGET_SIZE`. Either implement or remove from defaults.
- **M-3. `done_today` widget is a duplicate / signpost for the floating button** — `widgets/done_today.tsx`. The actual button is `DoneForToday.tsx`. The widget literally says "Use the floating button at the bottom-right." Why is this a widget? Remove from `WIDGET_CATALOG` or merge.
- **M-4. `wellness` widget defined in layouts but missing from `WIDGET_CATALOG`** — `today.tsx:98, 113, 130` reference `wellness`, and rendering exists at `today.tsx:1285-1321`, but the library sheet (`widgets.ts:11-24`) doesn't list it. New users can never re-add it after removing. Either add to catalog or remove the inline render.
- **M-5. `top_priority` widget is duplicated** — appears in the sticky header (`today.tsx:884-900`) *and* as a grid widget (`today.tsx:1383-1400`). Two sources of truth for the same daily value. Pick one.
- **M-6. `AUTO_APPEND_WIDGETS` migration is permanent dead weight** — `widgets.ts:42-44`, `today.tsx:234-242`. Auto-append ran once via `AUTO_APPEND_KEY` flag. For every user past that flag (which is every user, including you, after first load), this code path is wasted CPU/parse work on every page load forever. Delete after a release window.
- **M-7. `bumpFollowUpsHeight` migration is permanent dead weight** — `today.tsx:198-202, 212-221`. Same pattern: one-time migration controlled by `FOLLOWUPS_BUMP_KEY`. Has run. Delete.
- **M-8. `ID_MIGRATIONS` (`followups→follow_ups`, `content→content_pulse`) is permanent dead weight** — `today.tsx:156-163`. Same. Delete.
- **M-9. Legacy localStorage key migration (`today_layouts_v1` / `today_locks_v1`)** — `today.tsx:167-191`. Same pattern: one-time. Delete unless you still have a user on a pre-migrated cache.
- **M-10. Inline component soup in `today.tsx`** — `Card` (`:1501`), `WidgetChrome` (`:1585`), `BigStat` (`:1611`), `EmptyState` (`:1624`), `DateNav` (`:1632`), `Timeline` (`:1677`), `Sparkline` (`:1772`), `EventDetailSheet` (`:1870`), `linkify`, `looksLikeAddress`, `formatRange`, `responseBadgeClass`, `responseLabel`. All belong in `src/components/dashboard/*` or `src/lib/dashboard-helpers.ts`.
- **M-11. Two near-identical `relTime` implementations** — `today.tsx:380-389` and `follow_ups.tsx:26-35` are similar but not identical (the second flips signs for future events). Both diverge from `SavedChip.tsx:4-13`'s `formatAgo`. Pick one.
- **M-12. Two near-identical `whenLabel` implementations** — `today.tsx:391-396` and `EmailPanel.tsx:57-75` (latter is dead, but if you keep helpers, merge).
- **M-13. `DEFAULT_PROJECTS` hardcoded fake data** — `today.tsx:417-423`. Five "real" project names with fake progress percentages shown to user as live data. See Top 5 #3.
- **M-14. `ACCOUNTS` array duplicated** — `today.tsx:308-314` and `EmailPanel.tsx:29-35` (dead but mirror). Also hardcoded in `supabase/functions/ingest-email/index.ts:5-11`. Three places. Move to `src/config/accounts.ts`.
- **M-15. `MOBILE_ORDER` references `wellness` which isn't in the catalog** — `today.tsx:129`. Will quietly skip-render if removed from active widgets but throws on `LG_BASE.find((l) => l.i === id)!` in `stackedLayout` (line 138) with the non-null assertion. A widget id missing from `LG_BASE` would crash on mobile.
- **M-16. `account` field on `EmailRow` queried but never sent by `ingest-email`** — the edge function inserts `account`, but RLS realtime returns rows with `account`. The today.tsx select includes `account` (line 560) and uses it for filtering — works, but `account` is missing from `exec_os_calendar_events` select in `loadAll` (line 578-580) even though the type/table both have it. Just inconsistency.
- **M-17. `feature_interest` table is readable by any authenticated user** — `supabase/migrations/20260515154619_*.sql:9`. You're the only user so it doesn't matter, but if you ever onboard one other person, they can read everyone's notify-me email signups. Tighten or accept.
- **M-18. `dailyLoadedAt` set but never used in the data freshness pill UX** — `today.tsx:439, 590, 760`. The pill source for "Pulse" exists but `daily` itself is loaded but rarely changes. Probably fine. Worth a comment that "loaded" means "last fetched" not "last changed".
- **M-19. `kind` on `exec_os_emails` is `string` in generated types but the migration has a CHECK constraint to 4 values** — `supabase/migrations/20260512164923_*.sql:5`. Type narrowing is lost. Reflects the Supabase type-gen limitation; you compensate locally with the `EmailRow` literal type, which is fine, but the `feature_interest` insert (`follow_ups.tsx:151-152`) trusts arbitrary strings.
- **M-20. `EmptyState` is used for "no data yet" AND "table contains no rows" with the same italic muted style** — visually `today.tsx:1180` ("No lead data yet. Connecting Ideafetti DB…") looks identical to `today.tsx:1052` ("Nothing on the calendar today"). User can't tell broken from empty. Differentiate.
- **M-21. `supabase` client is a Proxy that throws on first prop access if env vars are missing** — `client.ts:11-19, 34-39`. The throw is correct for local dev, but in Lovable preview a misconfigured env will surface as a cryptic error in console. Worth a friendlier message.
- **M-22. `getServerEntry`'s import-then-fallback dance** — `server.ts:14-16`. The cast `(m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)` is brittle if `@tanstack/react-start/server-entry` ever changes shape. Comment why.
- **M-23. Sticky header sets `z-30` outer and `z-10` inner via two classes on the same element** — `today.tsx:838`. Class list is `"relative z-10 sticky top-0 z-30 ..."` — Tailwind dedupes, last wins, so z-30 wins. Trim.
- **M-24. `personalization.imageDataUrl` stored in localStorage as base64** — can blow past the 5MB quota fast at 4MB+ image. `PersonalizationSettings.tsx:14` caps at 4MB, but localStorage quota is *total*, not per-key, and you already have layouts + active widgets + tab state in there. One user-uploaded 4MB image effectively kills localStorage on Safari.
- **M-25. `useIsMobile` returns `false` on first render (uses `!!undefined`)** — `use-mobile.tsx:4-19`. On mobile devices, the first paint will run as if desktop, then flicker to mobile on the effect. Visible as a layout jump. Initialize via `window.matchMedia(...).matches` in the `useState` initializer.

---

## 🟢 Low / Nice-to-have

- **L-1. `DEFAULT_PERSONALIZATION` object identity changes on re-import** — minor, no React renders depend on identity.
- **L-2. `linkify` doesn't escape URLs that contain `<` or `>`** — `today.tsx:1810`. React handles XSS via text nodes so this is safe; mention only because the regex `(https?:\/\/[^\s]+)` over-captures trailing punctuation (`.`, `)`, `,`).
- **L-3. `Timeline` shows hours 0–24 always** — `today.tsx:1688-1689`. A 24-hour band is mostly empty. Consider 6am–11pm default.
- **L-4. Sparkline doesn't render a final point when latest value is null** — `today.tsx:1781-1784`. Filter drops nulls, so a gap doesn't show; visually misleading "trend up" when middle days were skipped.
- **L-5. `looksLikeAddress` regex catches "12345 abc" as an address** — `today.tsx:1804-1808`. Edge case; user-facing impact minimal.
- **L-6. `formatAgo`/`relTime` round small values inconsistently** — `today.tsx:382` uses `Math.round`, `SavedChip.tsx:5` uses `Math.floor`. Cosmetic.
- **L-7. Confetti colors hardcoded** — `DoneForToday.tsx:12`. Don't match `BRAND_SWATCHES`. (Brand palette per your memory: sage `#A4B494`, navy `#083D77`, forest `#355834`, rose `#DB9C96`, yellow `#FFC100`, orange `#E97451`.)
- **L-8. `wide` prop on `AppShell` is a boolean container-class switcher** — `AppShell.tsx:36-38`. Fine. Could be derived from route.
- **L-9. `r.lang = "en-US"` hardcoded** — `CaptureModal.tsx:83`, `capture.tsx:116`. Fine for you.
- **L-10. ResponsiveGridLayout uses `compactType="vertical"`** — anchors items to top, so drag-and-drop reflows. That's correct, just note that "feels jumpy when dragging" complaints map here.
- **L-11. `floating Mic button` and `floating Done for today button` both fixed in the same bottom-right area** — `today.tsx:1466-1473` (left on mobile, right on desktop) vs `DoneForToday.tsx:36` (right always). On desktop they don't collide because Capture is bottom-left at lg; on mobile Capture is right + `bottom-20` and Done is right + `bottom-6` — they stack OK. Verify on Lovable preview.

---

## 🧠 Behavioral observations (not bugs, but worth Donna knowing)

- **B-1. Reset Layout button doesn't confirm** — `today.tsx:1477-1485`. One accidental click wipes every customization including locks. No undo.
- **B-2. MONEY widget says "No lead data yet. Connecting Ideafetti DB…" forever** — no actual sync exists. It's a permanent placeholder. The status pill correctly marks it `not connected` but the widget body lies.
- **B-3. CONTENT PULSE widget says "Syncing Ideafetti content data…" forever** — same.
- **B-4. PROJECTS widget shows 5 hardcoded projects with fake progress %** — Ideafetti 62%, AI Lead 38%, Skool 50%, Content/TikTok 71%, Executive OS 28%. These numbers don't update. They came from the developer at some point and are now displayed to you as if real.
- **B-5. VOICE CAPTURE widget renders "Coming soon"** — implementation lives at `CaptureModal.tsx` (mic-enabled brain dump). The standalone widget at `widgets/voice_capture.tsx:1-13` is a 12-line stub.
- **B-6. DONE FOR TODAY widget tells you to use a *different* button** — see M-3.
- **B-7. Wellness widget is rendered if its layout slot is in localStorage, but you can't re-add it after removing** — M-4.
- **B-8. Top priority appears twice** — in the sticky header *and* as a grid widget showing the same daily value.
- **B-9. The DASH redirects `/` → `/today`** — `routes/index.tsx`. Good. Login flow goes `/login` → `/today`. Settings sign-out goes to `/login`. `DoneForToday` button goes to `/`. Donna's tap of "Done for today" lands on the same `/today` page she was on, just with a confetti pop and "See you tomorrow" pill — there's no actual day-end gate.
- **B-10. `routes/index.tsx` is 5 lines and only contains `<Navigate to="/today" />`** — for a v1 single-user product, that's fine, but it means `/` doesn't show anything useful (no marketing page, no fallback).
- **B-11. `account: "@Lovable"` in the Twitter meta tag** — `__root.tsx:83`. Probably want to change.
- **B-12. The capture flow exists in two places** — modal (`CaptureModal.tsx`) launched from floating mic on `/today`, and full page (`/capture` route, 506 lines). Both do nearly identical AI extraction + apply-extracted. Drift risk: changes to one don't flow to the other. See M-11 / coverage gaps.
- **B-13. `ingest-email` calls `auth.admin.listUsers({ page: 1, perPage: 200 })` every webhook** — fine at 1 user; doesn't scale, but you're not scaling. The function lookup by email is O(N) per event.
- **B-14. Calendar realtime channel name is `"cockpit_calendar"`** — `today.tsx:648`. Old branding artifact ("cockpit" → "Executive OS").
- **B-15. The sticky header's `z-10` outer / `z-30` from class merging will mask the widget chrome's hover popovers when scrolling** — minor, but worth eyeballing.

---

## 📦 Coverage gaps (UI without backend, or backend without UI)

### UI exists, no backend / data path:
- **MONEY widget** → no Ideafetti DB sync. `today.tsx:1166-1183`.
- **CONTENT PULSE widget** → no content data source. `today.tsx:1214-1232`.
- **PROJECTS widget** → hardcoded `DEFAULT_PROJECTS` array. `today.tsx:417-423`.
- **VOICE CAPTURE widget** → stub; the real voice path is in `CaptureModal.tsx`. `widgets/voice_capture.tsx`.
- **TEXT / SOCIAL tabs in Follow-ups** → render a `<StubState>` with "Notify me when ready" button. `follow_ups.tsx:201-210`. The notify-me table (`feature_interest`) exists and works, but no follow-up flow consumes it.

### Backend exists, no UI consumer:
- **`exec_os_decisions`** — written to by `CaptureModal.applyExtracted` (`CaptureModal.tsx:139-146`) and `capture.tsx:178-186`. Has its own table and RLS policies (migration `20260511215119_*.sql`). Never rendered. No "Decisions" surface anywhere.
- **`exec_os_daily.what_moved`, `what_didnt`, `tomorrow_seed`, `blockers`** — written by capture flow but never displayed in `/today` or any widget. The dashboard surfaces `top_priority`, `energy_level`, `mood` only.
- **`exec_os_daily.must_move_1/2/3`** — written by capture, not displayed.
- **`exec_os_emails.kind === "invite"` and `kind === "meeting"`** — schema supports them (`migration 20260512164923_*.sql:5`), edge function accepts them (`ingest-email/index.ts:13`), `EmailPanel.tsx:37-42` had tabs for them, but `EmailPanel.tsx` is dead and `today.tsx` only displays `priority` + `needs_response`. Invites/meetings rows sit in the DB unused.
- **`exec_os_calendar_events.status === "needsAction"`** — Follow-ups widget treats these as follow-ups (`follow_ups.tsx:106`). Good. But the main CALENDAR widget at `today.tsx:1051-1102` doesn't visually distinguish them.
- **`feature_interest` table** — writes work (`follow_ups.tsx:150-155`), but no internal UI surfaces what features people care about. Single-user product, so fine.

### Documented as "needs setup" but rendered as live:
- `widgets.ts:17-18` correctly marks MONEY + CONTENT PULSE as `needs_setup`, and the library sheet shows a yellow dot. But `DEFAULT_ACTIVE_WIDGETS` (`widgets.ts:28-39`) ships them as active, so a fresh user sees them rendered with empty-state copy that looks like "loading…". The disconnect is the bug.

---

_Audit complete. ~30 findings total, weighted toward maintainability and behavioral surprises rather than security/correctness, which are largely sound._
