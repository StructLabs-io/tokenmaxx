/**
 * GET /api/health
 *
 * Health check endpoint. Returns version, build number, and short SHA.
 * CF Workers compatible -- runtime="edge" removed because OpenNext on CF Workers
 * treats all routes as edge by default; explicit edge runtime declaration
 * requires a separate function config and breaks the OpenNext bundle.
 */

export async function GET() {
  return Response.json(
    {
      ok: true,
      version: process.env.TOKENMAXX_VERSION ?? "dev",
      buildNumber: process.env.TOKENMAXX_BUILD_NUMBER ?? "dev",
      sha: process.env.NEXT_PUBLIC_GIT_SHA ?? "dev",
      env: process.env.NODE_ENV ?? "unknown",
    },
    { status: 200 }
  );
}
