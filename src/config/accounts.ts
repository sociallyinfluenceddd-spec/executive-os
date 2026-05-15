// Centralized list of Donna's email accounts. Previously duplicated across
// today.tsx, EmailPanel.tsx (deleted), and supabase/functions/ingest-email
// (still duplicated there because Deno edge functions can't easily share
// with the Vite app — kept in sync manually for now).
export const ACCOUNTS = [
  "hello@donnabdicenso.com",
  "sociallyinfluenceddd@gmail.com",
  "sociallydonna@gmail.com",
  "ideafetti@gmail.com",
  "donna@dblankstyle.com",
] as const;

export type Account = (typeof ACCOUNTS)[number];
