// Renzo-curated client + project names for the public demo.
// Designed to evoke real consulting/dev work without identifying anyone.

export interface DemoClient {
  name: string;
  projects: string[];
}

export const DEMO_CLIENTS: DemoClient[] = [
  {
    name: "Forge Atelier",
    projects: ["Q3 Campaign Kit", "Onboarding Refresh", "Brand Spike v2"],
  },
  {
    name: "Vista Outdoors",
    projects: ["Inventory Sync", "POS Integration", "Catalog ETL"],
  },
  {
    name: "Sandwich Robotics",
    projects: ["RAG Indexer", "Voice Agent v0", "MCP Server"],
  },
  {
    name: "Heatherline Group",
    projects: ["Pelham Estates", "Birchwood HOA", "Twin Creeks"],
  },
  {
    name: "Atomic Lawn Care",
    projects: ["Scheduling Bot", "Quote Generator"],
  },
  {
    name: "Reed & Caswell PLLC",
    projects: ["Discovery Triage", "Brief Drafter", "Calendar Triage"],
  },
  {
    name: "Studio Petalwave",
    projects: ["Brand Audit", "Motion Sandbox", "Voice Memo Pipeline"],
  },
  {
    name: "Internal",
    projects: ["Marketing", "Operations", "Personal", "Learning"],
  },
];

// Flat list — useful for slug generation.
export const ALL_PROJECTS = DEMO_CLIENTS.flatMap((c) =>
  c.projects.map((p) => ({ client: c.name, project: p, slug: slugify(`${c.name}-${p}`) })),
);

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export const MODELS = [
  { id: "claude-opus-4-7", provider: "anthropic", input_per_m: 5, output_per_m: 25, cache_read_per_m: 0.5 },
  { id: "claude-sonnet-4-6", provider: "anthropic", input_per_m: 1, output_per_m: 5, cache_read_per_m: 0.1 },
  { id: "claude-haiku-4-5", provider: "anthropic", input_per_m: 0.25, output_per_m: 1.25, cache_read_per_m: 0.025 },
  { id: "gpt-5.5", provider: "openai-codex", input_per_m: 5, output_per_m: 30, cache_read_per_m: 0.5 },
  { id: "gpt-5.4", provider: "openai-codex", input_per_m: 2.5, output_per_m: 15, cache_read_per_m: 0.25 },
  { id: "gpt-5.3-codex", provider: "openai-codex", input_per_m: 1.75, output_per_m: 14, cache_read_per_m: 0.175 },
  { id: "gpt-5.4-mini", provider: "openai-codex", input_per_m: 0.75, output_per_m: 4.5, cache_read_per_m: 0.075 },
];
