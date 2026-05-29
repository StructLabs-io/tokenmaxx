/**
 * GET /api/health
 *
 * Edge runtime health check endpoint.
 * Returns {ok: true, version} with 200.
 * CF Pages compatible -- no Node.js APIs used.
 */

export const runtime = "edge";

export async function GET() {
  return Response.json(
    {
      ok: true,
      version: "0.1.0",
      env: process.env.NODE_ENV ?? "unknown",
    },
    { status: 200 }
  );
}
