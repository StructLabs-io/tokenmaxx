/**
 * Cloudflare Worker — rolling demo data refresher.
 *
 * Runs nightly at 00:30 UTC. Re-generates the demo events with `today` set
 * to the current date so the dashboard's 14-day window always shows
 * something fresh-looking. Writes the JSON output to a KV namespace that
 * the demo deployment reads at request time.
 *
 * Deploy: wrangler deploy demo/rolling-refresh.ts
 *   bindings: KV namespace TOKENMAXX_DEMO_KV
 *
 * wrangler.toml:
 *   name = "tokenmaxx-demo-refresh"
 *   main = "demo/rolling-refresh.ts"
 *   compatibility_date = "2026-01-01"
 *   kv_namespaces = [{ binding = "TOKENMAXX_DEMO_KV", id = "..." }]
 *   [triggers]
 *   crons = ["30 0 * * *"]
 */

import {
  generateDemoEvents,
  generateDemoProjects,
  generateDemoSubscriptions,
} from "./seed-demo-data";

interface Env {
  TOKENMAXX_DEMO_KV: KVNamespace;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env) {
    const events = generateDemoEvents(365, new Date());
    const projects = generateDemoProjects();
    const subscriptions = generateDemoSubscriptions();

    await env.TOKENMAXX_DEMO_KV.put("events", JSON.stringify(events));
    await env.TOKENMAXX_DEMO_KV.put("projects", JSON.stringify(projects));
    await env.TOKENMAXX_DEMO_KV.put("subscriptions", JSON.stringify(subscriptions));
    await env.TOKENMAXX_DEMO_KV.put("generated_at", new Date().toISOString());

    console.log(`tokenmaxx-demo: refreshed — ${events.length} events written`);
  },
  async fetch(req: Request, env: Env) {
    // Manual trigger via GET /refresh — useful for first deploy + debugging
    const url = new URL(req.url);
    if (url.pathname === "/refresh") {
      const events = generateDemoEvents(365, new Date());
      await env.TOKENMAXX_DEMO_KV.put("events", JSON.stringify(events));
      return new Response(`refreshed: ${events.length} events`);
    }
    if (url.pathname === "/status") {
      const generated = await env.TOKENMAXX_DEMO_KV.get("generated_at");
      const events = await env.TOKENMAXX_DEMO_KV.get("events");
      return Response.json({
        generated_at: generated,
        event_count: events ? JSON.parse(events).length : 0,
      });
    }
    return new Response("TokenMaxx demo refresher. GET /refresh or /status.", { status: 200 });
  },
};

// Type stubs (CF Workers types)
type KVNamespace = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string) => Promise<void>;
};
type ScheduledEvent = { scheduledTime: number; cron: string };
