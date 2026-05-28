// Supabase Edge Function: maya-build
//
// The execution half of Maya. The dashboard calls this when Donna clicks
// "Build it" on a task. It dispatches the Claude Autonomous Task GitHub
// workflow with her (collaborated) prompt; Claude Code then builds the task
// and opens a PR. Donna directs, the AI executes.
//
// JWT required — only Donna triggers builds.
//
// Requires secret: GITHUB_DISPATCH_TOKEN — a fine-grained PAT on the repo
//   with Actions: read+write, Contents: read+write, Pull requests: write.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

// Target repo + workflow. The workflow file must already exist on the default
// branch for dispatch to succeed.
const REPO_OWNER = "sociallyinfluenceddd-spec";
const REPO_NAME = "executive-os";
const WORKFLOW_FILE = "claude-autonomous-task.yml";
const DEFAULT_BRANCH = "main";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const githubToken = Deno.env.get("GITHUB_DISPATCH_TOKEN");
  if (!supabaseUrl || !supabaseAnonKey) return json({ error: "Server not configured" }, 500);
  if (!githubToken) {
    return json({
      error: "not_configured",
      message: "GITHUB_DISPATCH_TOKEN secret isn't set. Add a fine-grained PAT in Lovable Cloud Secrets first.",
    }, 503);
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "Unauthorized" }, 401);

  let payload: { taskId?: string; prompt?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const prompt = (payload.prompt ?? "").trim();
  const taskId = (payload.taskId ?? "").trim();
  if (!prompt) return json({ error: "empty_prompt", message: "Nothing to build — the task prompt is empty." }, 400);

  const dispatchRes = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "executive-os-maya",
      },
      body: JSON.stringify({
        ref: DEFAULT_BRANCH,
        inputs: { task_prompt: prompt, ...(taskId && { task_id: taskId }) },
      }),
    },
  );

  if (!dispatchRes.ok) {
    const detail = await dispatchRes.text();
    console.error("workflow dispatch failed", dispatchRes.status, detail.slice(0, 300));
    // 404 here usually means the token can't see the repo/workflow or the
    // workflow file isn't on the default branch yet.
    return json({
      error: "dispatch_failed",
      status: dispatchRes.status,
      message: dispatchRes.status === 404
        ? "GitHub couldn't find the workflow. Make sure the workflow file is pushed to main and the token has Actions access to the repo."
        : `GitHub rejected the dispatch (${dispatchRes.status}).`,
    }, 502);
  }

  // 204 No Content on success. Point Donna at the Actions tab to watch it run.
  const actionsUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}`;
  return json({ ok: true, actions_url: actionsUrl });
});
