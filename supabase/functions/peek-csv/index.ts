const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const { url } = await req.json();
  const res = await fetch(url, { headers: { Range: "bytes=0-4095" } });
  const text = await res.text();
  const lines = text.split(/\r?\n/).slice(0, 5);
  return new Response(JSON.stringify({ lines }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
