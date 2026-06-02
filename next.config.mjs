// @ts-check
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Next.js configuration for Cloudflare deployment via @opennextjs/cloudflare.
 *
 * Key constraints for OpenNext on Cloudflare:
 * - All server-side code runs on the Edge runtime (Workers), not Node.js
 * - Node.js built-ins are available via the nodejs_compat compatibility flag
 * - ISR is not supported -- use static or dynamic
 * - Middleware must use Edge runtime
 * - Image optimization: disable or use Cloudflare Image Resizing
 *
 * See: https://opennext.js.org/cloudflare
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf-8"));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Version + build identity surfaced at build time. CI sets
  // TOKENMAXX_BUILD_NUMBER and NEXT_PUBLIC_GIT_SHA; locally they fall
  // back to 'dev' so `npm run dev` doesn't need any setup.
  env: {
    TOKENMAXX_VERSION: pkg.version,
    TOKENMAXX_BUILD_NUMBER: process.env.TOKENMAXX_BUILD_NUMBER ?? "dev",
    NEXT_PUBLIC_GIT_SHA: process.env.NEXT_PUBLIC_GIT_SHA ?? "dev",
  },
  // Disable Node.js-specific image optimization -- use <img> or CF Image Resizing
  images: {
    unoptimized: true,
  },
  // P8: standalone output for the Docker image that runs on n9c-server.
  // OpenNext for Cloudflare ignores this and reads its own build.
  output: "standalone",
};

export default nextConfig;
