import { NextRequest, NextResponse } from "next/server";

const BACKEND_API_BASE_URL = process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8000";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const body = await request.json();
    const response = await fetch(`${BACKEND_API_BASE_URL}/portfolios/${id}`, {
      method: "PATCH",
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
