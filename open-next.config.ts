// open-next.config.ts — created for TokenMaxx v0.1 (seed-data only, no R2 cache)
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
// import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

export default defineCloudflareConfig({
	// For best results consider enabling R2 caching after R2 bucket is provisioned
	// See https://opennext.js.org/cloudflare/caching for more details
	// incrementalCache: r2IncrementalCache,
});
