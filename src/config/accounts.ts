// Centralized list of Donna's email accounts. This is a FALLBACK now —
// the Inbox widget derives its dropdown from accounts that actually have
// emails in exec_os_emails. Keeping this around for any code path that
// references account names without DB context.
//
// Updated 2026-05-21:
//   - ideafetti@gmail.com → hello@ideafetti.com (her real Ideafetti email)
//   - donna@dblankstyle.com removed (legacy account, not actively used)
export const ACCOUNTS = [
  "hello@donnabdicenso.com",
  "sociallyinfluenceddd@gmail.com",
  "sociallydonna@gmail.com",
  "hello@ideafetti.com",
] as const;

export type Account = (typeof ACCOUNTS)[number];
