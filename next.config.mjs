// @ts-check

/**
 * Next.js configuration for Cloudflare Pages deployment.
 *
 * Key constraints for @cloudflare/next-on-pages:
 * - All server-side code runs on the Edge runtime (Workers), not Node.js
 * - Node.js built-ins are available only via the nodejs_compat compatibility flag
 * - ISR / PPR (Partial Prerendering) is not supported -- use static or dynamic
 * - Middleware must use Edge runtime
 * - Image optimization uses Cloudflare's image resizing (or disable)
 *
 * See: https://github.com/cloudflare/next-on-pages
 */

import { setupDevPlatform } from "@cloudflare/next-on-pages/next-dev";

// Only run in dev -- this enables the CF platform emulation
if (process.env.NODE_ENV === "development") {
  await setupDevPlatform();
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for @cloudflare/next-on-pages to work correctly
  // This tells Next.js to output in a way CF Pages can consume
  // The adapter handles the static export layout under .vercel/output/static

  // Disable Node.js-specific image optimization -- use <img> or CF image resizing
  images: {
    unoptimized: true,
  },

  // Experimental: force all server components onto the edge runtime
  // Remove this if you hit edge-runtime compat issues and need Node runtime locally
  experimental: {
    // ppr: false -- not supported on CF Pages
  },
};

export default nextConfig;
