#!/usr/bin/env node
/**
 * seed-dev.js
 *
 * Loads seed data from lib/seed-data.ts into a local Supabase Postgres instance.
 * Run after `supabase start` and `supabase db push`.
 *
 * Usage: npm run seed:dev
 *
 * Requires:
 *   NEXT_PUBLIC_SUPABASE_URL    (set in .env.local — local value is http://127.0.0.1:54321)
 *   SUPABASE_SERVICE_ROLE_KEY   (set in .env.local — printed by `supabase start`)
 */

"use strict";

const path = require("path");
const fs = require("fs");

// ── Load .env.local ──────────────────────────────────────────────────────────

const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local\n" +
      "Run `supabase start` and check the output for the local credentials."
  );
  process.exit(1);
}

// ── Import seed data (CommonJS-compatible shim) ──────────────────────────────
// seed-data.ts is ESM/TypeScript; we use the same data inline here to avoid
// a build step. Keep this in sync with lib/seed-data.ts.

const SEED_WORKSPACE = { slug: "default", display_name: "Local Dev", timezone: "UTC" };
const SEED_USERS = [
  { slug: "alice", display_name: "Alice", account_type: "human" },
  { slug: "bob", display_name: "Bob", account_type: "human" },
  { slug: "demo-server", display_name: "Demo Server", account_type: "service" },
];
const SEED_PROJECTS = [
  { slug: "alpha", name: "Project Alpha", color: "#6366f1" },
  { slug: "beta", name: "Project Beta", color: "#f59e0b" },
  { slug: "gamma", name: "Project Gamma", color: "#10b981" },
  { slug: "delta", name: "Project Delta", color: "#ef4444" },
  { slug: "infra", name: "Internal Infra", color: "#8b5cf6" },
];

// ── HTTP helper ──────────────────────────────────────────────────────────────

async function post(table, rows) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST ${table} failed (${res.status}): ${body}`);
  }
}

async function get(table, select = "*") {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`GET ${table} failed (${res.status})`);
  return res.json();
}

// ── Seed ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Seeding ${SUPABASE_URL} ...`);

  // Workspace
  await post("workspaces", [SEED_WORKSPACE]);
  const [ws] = await get("workspaces", "id,slug");
  const wsId = ws.id;
  console.log(`  workspace: ${wsId}`);

  // Users
  await post("users", SEED_USERS);
  const users = await get("users", "id,slug");
  const userMap = Object.fromEntries(users.map((u) => [u.slug, u.id]));
  console.log(`  users: ${Object.keys(userMap).join(", ")}`);

  // Workspace members
  const members = Object.values(userMap).map((uid) => ({
    workspace_id: wsId,
    user_id: uid,
    role: "member",
  }));
  await post("workspace_members", members);

  // Projects
  const projectRows = SEED_PROJECTS.map((p) => ({ ...p, workspace_id: wsId }));
  await post("projects", projectRows);
  const projects = await get("projects", "id,slug");
  const projMap = Object.fromEntries(projects.map((p) => [p.slug, p.id]));
  console.log(`  projects: ${Object.keys(projMap).join(", ")}`);

  // Usage events — 14 days x 10 per day
  const MODELS = [
    "claude-sonnet-4-5", "claude-haiku-3-5", "claude-opus-4",
    "gpt-4o", "codex-gpt-5-3",
  ];
  const SLUGS = Object.keys(projMap);
  const USER_IDS = Object.values(userMap);
  const PROJECT_IDS = Object.values(projMap);

  const events = [];
  for (let day = 0; day < 14; day++) {
    for (let seq = 0; seq < 10; seq++) {
      const i = day * 10 + seq;
      const d = new Date("2025-05-15T00:00:00Z");
      d.setDate(d.getDate() + day);
      d.setHours(8 + (seq % 10));
      const model = MODELS[i % MODELS.length];
      const inputTokens = 1000 + ((seq * 137 + day * 53) % 8000);
      const outputTokens = 200 + ((seq * 71 + day * 29) % 3000);
      events.push({
        workspace_id: wsId,
        user_id: USER_IDS[i % USER_IDS.length],
        project_id: i % 7 === 0 ? null : PROJECT_IDS[i % PROJECT_IDS.length],
        captured_at: d.toISOString(),
        date_utc: d.toISOString().slice(0, 10),
        provider: model.startsWith("claude") ? "anthropic" : "openai",
        model,
        capture_method: `${model.startsWith("claude") ? "anthropic" : "openai"}.claude_code.cli.session`,
        aggregation_grain: "session",
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        token_share_pct: 100.0,
        cost_usd: Math.round((inputTokens * 0.000003 + outputTokens * 0.000015) * 10000) / 10000,
      });
    }
  }

  // Insert in batches of 50
  for (let i = 0; i < events.length; i += 50) {
    await post("usage_events", events.slice(i, i + 50));
  }
  console.log(`  usage_events: ${events.length} rows`);

  console.log("Done. Open Studio at http://127.0.0.1:54323 to inspect.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
