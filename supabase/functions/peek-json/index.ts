const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { url, offset = 0, bytes = 4096 } = await req.json();
    const headers: Record<string, string> = {};
    headers["Range"] = `bytes=${offset}-${offset + bytes - 1}`;

    const res = await fetch(url, { headers });
    const text = await res.text();

    return new Response(JSON.stringify({ status: res.status, length: text.length, sample: text.substring(0, 4000) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
