/* Binance Pay history, read from Frankfurt (2026-11-22).

   The backend checks a buyer's Binance order against our own Pay history
   (backend apps/plans/binance.py). It runs on Railway in the US, and Binance
   answers every US, Dutch and Singapore server "Service unavailable from a
   restricted location" (HTTP 451, measured from production). This function
   runs on Vercel in Frankfurt and does only that one read:

     GET  ?health=1            whether Binance answers from here (no keys used)
     POST {startTime, endTime} with "Authorization: Bearer <BINANCE_RELAY_TOKEN>"
                               → Binance's own answer for GET /sapi/v1/pay/transactions

   Environment (Vercel, set by the owner): BINANCE_API_KEY and BINANCE_API_SECRET
   (a READ-ONLY key), BINANCE_RELAY_TOKEN (the password the backend sends). */

import crypto from "crypto";

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

const BINANCE = "https://api.binance.com";

function sameSecret(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function GET(request) {
  if (new URL(request.url).searchParams.get("health") !== "1") {
    return Response.json({ detail: "Not here." }, { status: 404 });
  }
  let binance = null;
  try {
    const res = await fetch(`${BINANCE}/api/v3/ping`, { cache: "no-store" });
    binance = res.status;
  } catch {
    binance = "unreachable";
  }
  return Response.json({
    region: process.env.VERCEL_REGION || "local",
    binance,
    configured: Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET && process.env.BINANCE_RELAY_TOKEN),
  });
}

export async function POST(request) {
  const token = process.env.BINANCE_RELAY_TOKEN;
  const key = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;
  if (!token || !key || !secret) return Response.json({ detail: "Not configured." }, { status: 503 });
  const auth = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!sameSecret(auth, token)) return Response.json({ detail: "Forbidden." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const now = Date.now();
  const endTime = Math.min(Number(body.endTime) || now, now + 60_000);
  const startTime = Math.max(Number(body.startTime) || endTime - 72 * 3600_000, endTime - 89 * 24 * 3600_000);
  const query = new URLSearchParams({
    startTime: String(Math.floor(startTime)), endTime: String(Math.floor(endTime)),
    limit: "100", recvWindow: "10000", timestamp: String(now),
  }).toString();
  const signature = crypto.createHmac("sha256", secret).update(query).digest("hex");
  try {
    const res = await fetch(`${BINANCE}/sapi/v1/pay/transactions?${query}&signature=${signature}`, {
      headers: { "X-MBX-APIKEY": key }, cache: "no-store",
    });
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ detail: "Binance unreachable." }, { status: 502 });
  }
}
