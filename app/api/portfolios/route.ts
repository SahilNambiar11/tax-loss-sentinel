import { NextRequest, NextResponse } from "next/server";

const BACKEND_API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspace_id");

  if (!workspaceId) {
    return NextResponse.json({ detail: "Missing required query param: workspace_id" }, { status: 400 });
  }

  try {
    const response = await fetch(
      `${BACKEND_API_BASE_URL}/portfolios?${new URLSearchParams({ workspace_id: workspaceId }).toString()}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const response = await fetch(`${BACKEND_API_BASE_URL}/portfolios`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const payload = await response.text();

    return new NextResponse(payload, {
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
