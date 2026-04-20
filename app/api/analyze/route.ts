import { NextRequest, NextResponse } from "next/server";

const BACKEND_API_BASE_URL = process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8000";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const ticker = search.get("ticker");
  const buyPrice = search.get("buy_price");
  const sessionId = search.get("session_id");

  if (!ticker || !buyPrice) {
    return NextResponse.json(
      { detail: "Missing required query params: ticker and buy_price" },
      { status: 400 },
    );
  }

  const params = new URLSearchParams({
    ticker,
    buy_price: buyPrice,
  });

  if (sessionId) {
    params.set("session_id", sessionId);
  }

  try {
    const response = await fetch(`${BACKEND_API_BASE_URL}/analyze?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
    });

    const body = await response.text();

    return new NextResponse(body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return NextResponse.json(
      {
        detail: `Unable to reach backend at ${BACKEND_API_BASE_URL}. Start the FastAPI server with "python3 main.py" or set BACKEND_API_BASE_URL to the correct backend origin.`,
      },
      { status: 502 },
    );
  }
}
