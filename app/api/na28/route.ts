import { NextResponse } from "next/server";

export const runtime = "nodejs";

const BASE = "https://www.die-bibel.de/en/bible/NA28/ACT.";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const chapter = searchParams.get("chapter");

  if (!chapter || !/^\d+$/.test(chapter)) {
    return NextResponse.json({ error: "Missing or invalid ?chapter=" }, { status: 400 });
  }

  const ch = Number(chapter);
  if (ch < 1 || ch > 28) {
    return NextResponse.json({ error: "Chapter must be 1..28" }, { status: 400 });
  }

  const url = BASE + ch;

  const res = await fetch(url, {
    // "server-side" fetch (no CORS issue)
    headers: {
      "User-Agent": "Mozilla/5.0"
    },
    cache: "no-store"
  });

  if (!res.ok) {
    return NextResponse.json({ error: `Upstream HTTP ${res.status}` }, { status: 502 });
  }

  const html = await res.text();
  // devolvemos HTML (lo parsea el navegador con DOMParser)
  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
