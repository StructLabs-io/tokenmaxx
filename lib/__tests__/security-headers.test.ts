import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config.mjs";

const EXPECTED: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

describe("security response headers", () => {
  it("does not advertise the framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("sends the baseline security headers on every path", async () => {
    expect(typeof nextConfig.headers).toBe("function");
    const rules = await nextConfig.headers!();
    const all = rules.find((rule) => rule.source === "/:path*");

    expect(all).toBeDefined();
    const sent = Object.fromEntries(all!.headers.map((h) => [h.key, h.value]));
    expect(sent).toEqual(EXPECTED);
  });

  it("does not ship a Content-Security-Policy yet", async () => {
    const rules = await nextConfig.headers!();
    const keys = rules.flatMap((rule) => rule.headers.map((h) => h.key.toLowerCase()));
    expect(keys).not.toContain("content-security-policy");
  });
});
