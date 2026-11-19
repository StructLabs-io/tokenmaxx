import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DEMO_CLIENTS, DEMO_USERS } from "../../demo/fictional-names";
import { generateDemoProjects } from "../../demo/seed-demo-data";

/**
 * Demo mode never uses the service-role client.
 *
 * The demo deployment shows fictional seed data to signed-out visitors. With
 * the demo flag on, no code path may build a service-role client, whatever
 * credentials are present in the environment, and every API route answers
 * from the seed dataset.
 */

const SENTINEL = "ROW-FROM-THE-DATABASE";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

/**
 * A stand-in database that answers every query with a recognisable row, so a
 * route that reaches it shows up in the response as well as in the call count.
 */
function databaseStandIn() {
  const row = {
    id: SENTINEL, slug: SENTINEL, display_name: SENTINEL, client: SENTINEL,
    model: SENTINEL, provider: SENTINEL, capture_method: SENTINEL,
    date_utc: "2026-01-01", captured_at: "2026-01-01T00:00:00Z",
    total_tokens: 1, input_tokens: 1, output_tokens: 0, cost_usd: 1,
    project_id: SENTINEL, user_id: SENTINEL, session_id: SENTINEL,
  };
  const result = { data: [row], error: null, count: 1 };
  const query: any = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
      if (prop === "single") return () => Promise.resolve({ data: row, error: null });
      return () => query;
    },
  });
  return { from: () => query, rpc: () => query };
}

function request(path: string) {
  return new NextRequest(`https://demo.example.test${path}`);
}

const demoProjects = generateDemoProjects();
const demoSlug = demoProjects[0].slug;

type Handler = (...args: any[]) => Promise<Response>;
const ROUTES: [string, string, (GET: Handler) => Promise<Response>][] = [
  ["/api/events", "../../app/api/events/route", (GET) => GET(request("/api/events"))],
  ["/api/meta", "../../app/api/meta/route", (GET) => GET()],
  ["/api/models", "../../app/api/models/route", (GET) => GET(request("/api/models"))],
  ["/api/projects", "../../app/api/projects/route", (GET) => GET(request("/api/projects"))],
  [
    "/api/projects/[id]",
    "../../app/api/projects/[id]/route",
    (GET) => GET(request(`/api/projects/${demoSlug}`), { params: Promise.resolve({ id: demoSlug }) }),
  ],
  ["/api/quota", "../../app/api/quota/route", (GET) => GET()],
  ["/api/reconcile", "../../app/api/reconcile/route", (GET) => GET()],
  ["/api/stats", "../../app/api/stats/route", (GET) => GET(request("/api/stats"))],
  ["/api/subscriptions", "../../app/api/subscriptions/route", (GET) => GET()],
  ["/api/usage-trend", "../../app/api/usage-trend/route", (GET) => GET(request("/api/usage-trend"))],
  ["/api/users", "../../app/api/users/route", (GET) => GET(request("/api/users"))],
  ["/api/wrap", "../../app/api/wrap/route", (GET) => GET()],
];

beforeEach(() => {
  vi.resetModules();
  mocks.createClient.mockReset();
  mocks.createClient.mockImplementation(databaseStandIn);
  // Credentials are present on purpose: the flag alone must be enough.
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-value");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-value");
  vi.stubEnv("NEXT_PUBLIC_TOKENMAXX_DEMO", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("demo mode never uses the service-role client", () => {
  it("covers every API route that reads data", () => {
    const root = resolve(process.cwd(), "app/api");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    const onDisk = walk(root)
      .filter((full) => full.endsWith("route.ts"))
      .map((full) => "/api/" + relative(root, full).split("\\").join("/").replace(/\/route\.ts$/, ""))
      .filter((path) => path !== "/api/health") // static build info, no data
      .sort();

    expect(ROUTES.map(([path]) => path).sort()).toEqual(onDisk);
  });

  it.each(ROUTES)("GET %s answers from seed data without a service-role client", async (_path, modulePath, call) => {
    const route = await import(modulePath);

    const res = await call(route.GET);
    const body = await res.text();

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(body).not.toContain(SENTINEL);
    expect(() => JSON.parse(body)).not.toThrow();
  });

  it("reports the service role as not configured", async () => {
    const { isServiceRoleConfigured } = await import("../supabase/client");
    expect(isServiceRoleConfigured()).toBe(false);
  });

  it("refuses to build a service-role client", async () => {
    const { getSupabaseServerClient } = await import("../supabase/client");
    expect(() => getSupabaseServerClient()).toThrow();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("demo routes serve the fictional dataset", () => {
  const demoUserNames = DEMO_USERS.map((u) => u.display_name);
  const demoClientNames = DEMO_CLIENTS.map((c) => c.name);
  const demoSlugs = demoProjects.map((p) => p.slug);

  it("/api/meta lists the demo users and models", async () => {
    const { GET } = await import("../../app/api/meta/route");
    const body = await (await GET()).json();

    expect(body.users.length).toBe(DEMO_USERS.length);
    for (const user of body.users) expect(demoUserNames).toContain(user.display_name);
    expect(body.models.length).toBeGreaterThan(0);
  });

  it("/api/projects lists the demo projects", async () => {
    const { GET } = await import("../../app/api/projects/route");
    const body = await (await GET(request("/api/projects"))).json();

    expect(body.length).toBe(demoProjects.length);
    for (const project of body) {
      expect(demoSlugs).toContain(project.slug);
      if (project.client) expect(demoClientNames).toContain(project.client);
    }
  });

  it("/api/projects/[id] returns a demo project and 404s an unknown slug", async () => {
    const { GET } = await import("../../app/api/projects/[id]/route");

    const found = await GET(request(`/api/projects/${demoSlug}`), { params: Promise.resolve({ id: demoSlug }) });
    expect(found.status).toBe(200);
    expect((await found.json()).project.slug).toBe(demoSlug);

    const missing = await GET(request("/api/projects/nope"), { params: Promise.resolve({ id: "nope" }) });
    expect(missing.status).toBe(404);
  });

  it("/api/wrap and /api/reconcile return the demo figures", async () => {
    const { demoWrapStats, demoUnattributedGroups } = await import("../../demo/demo-mode-flag");
    const wrap = await import("../../app/api/wrap/route");
    const reconcile = await import("../../app/api/reconcile/route");

    expect(await (await wrap.GET()).json()).toEqual(JSON.parse(JSON.stringify(demoWrapStats())));
    expect(await (await reconcile.GET()).json()).toEqual(demoUnattributedGroups());
  });
});

describe("a normal deployment is unaffected", () => {
  it("still builds a service-role client when the demo flag is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_TOKENMAXX_DEMO", "");
    const { isServiceRoleConfigured, getSupabaseServerClient } = await import("../supabase/client");

    expect(isServiceRoleConfigured()).toBe(true);
    getSupabaseServerClient();
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });
});

describe("one way in", () => {
  it("only lib/supabase/client.ts and lib/env.ts read the service-role credential", () => {
    const ROOT = process.cwd();
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (name === "node_modules" || name === "__tests__") return [];
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    const allowed = new Set(["lib/supabase/client.ts", "lib/env.ts"]);
    const offenders = ["app", "components", "demo", "lib"]
      .flatMap((dir) => walk(resolve(ROOT, dir)))
      .filter((full) => /\.(ts|tsx)$/.test(full) && !/\.test\.tsx?$/.test(full))
      .map((full) => relative(ROOT, full).split("\\").join("/"))
      .filter((file) => !allowed.has(file))
      .filter((file) => /SUPABASE_SERVICE_ROLE_KEY/.test(
        readFileSync(resolve(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""),
      ));

    expect(offenders).toEqual([]);
  });
});
