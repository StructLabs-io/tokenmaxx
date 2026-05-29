// @ts-check

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

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable Node.js-specific image optimization -- use <img> or CF Image Resizing
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
