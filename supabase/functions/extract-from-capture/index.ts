// Extract structured signals from a brain-dump capture using Lovable AI.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM = `You extract structured signals from an executive's brain-dump for a daily log.
Return ONLY fields explicitly mentioned. Do not infer or invent. If nothing fits a field, omit it.`;

const TOOL = {
  type: "function",
  function: {
    name: "extract_signals",
    description: "Extract structured executive log signals from raw text.",
    parameters: {
      type: "object",
      properties: {
        decisions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              category: {
                type: "string",
                enum: ["Hire", "Money", "Product", "Client", "Personal", "Other"],
              },
            },
            required: ["text"],
            additionalProperties: false,
          },
        },
        top_priority: { type: "string" },
        must_moves: { type: "array", items: { type: "string" }, maxItems: 3 },
        energy_level: { type: "integer", minimum: 1, maximum: 10 },
        mood: { type: "string" },
        blockers: { type: "string" },
        what_moved: { type: "string" },
        what_didnt: { type: "string" },
        tomorrow_seed: { type: "string" },
      },
      additionalProperties: false,
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text } = await req.json();
    if (!text || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "text required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: text },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "extract_signals" } },
      }),
    });

    if (!resp.ok) {
      if (resp.status === 429)
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      if (resp.status === 402)
        return new Response(JSON.stringify({ error: "Add credits to your Lovable workspace" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      const t = await resp.text();
      console.error("AI gateway error", resp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    let extracted: Record<string, unknown> = {};
    if (call?.function?.arguments) {
      try {
        extracted = JSON.parse(call.function.arguments);
      } catch (e) {
        console.error("parse args failed", e);
      }
    }

    return new Response(JSON.stringify({ extracted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-from-capture error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
