export const dynamic = "force-dynamic";

/** GET /api/bridge/status?hash=0x...&from=56&to=1  Passes LI.FI's transfer status through, trimmed. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const hash = sp.get("hash") ?? "";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash) || !/^\d{1,6}$/.test(from) || !/^\d{1,6}$/.test(to)) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const headers: Record<string, string> = {};
  if (process.env.LIFI_API_KEY) headers["x-lifi-api-key"] = process.env.LIFI_API_KEY;
  try {
    const res = await fetch(`https://li.quest/v1/status?${new URLSearchParams({ txHash: hash, fromChain: from, toChain: to })}`, {
      headers, cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) return Response.json({ status: "UNKNOWN", detail: String(j?.message ?? res.status).slice(0, 120) });
    return Response.json({
      status: String(j.status ?? "UNKNOWN"),
      substatus: typeof j.substatus === "string" ? j.substatus : null,
      receivingTx: typeof j.receiving?.txHash === "string" ? j.receiving.txHash : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "UNKNOWN", detail: "Status check failed" });
  }
}
