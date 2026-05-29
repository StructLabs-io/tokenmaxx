/**
 * GET /api/health
 *
 * Health check endpoint.
 * Returns {ok: true, version} with 200.
 * CF Workers compatible -- runtime="edge" removed because OpenNext on CF Workers
 * treats all routes as edge by default; explicit edge runtime declaration
 * requires a separate function config and breaks the OpenNext bundle.
 */

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
