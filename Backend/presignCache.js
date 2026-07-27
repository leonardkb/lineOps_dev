// presignCache.js
// Wraps generatePresignedGetUrl so the SAME photo returns the SAME signed URL
// across requests within its lifetime. Without this, every list fetch signs a
// fresh URL (new signature => new browser cache key), forcing the browser to
// re-download identical images on every filter/refresh.
const { generatePresignedGetUrl } = require("./s3-raw");

const PRESIGN_TTL = 3600;            // seconds the S3 URL stays valid
const REFRESH_BEFORE = 300;         // re-sign this many seconds before expiry
const cache = new Map();            // photo_filename -> { url, expiresAt }

/**
 * Returns a cached presigned GET URL for a photo filename, or null.
 * Reuses the previously signed URL until it's within REFRESH_BEFORE of expiry.
 */
function getCachedPresignedUrl(filename) {
  if (!filename) return null;
  const now = Date.now();
  const hit = cache.get(filename);
  if (hit && hit.expiresAt - now > REFRESH_BEFORE * 1000) {
    return hit.url;
  }
  const url = generatePresignedGetUrl(filename, PRESIGN_TTL);
  cache.set(filename, { url, expiresAt: now + PRESIGN_TTL * 1000 });
  return url;
}

module.exports = { getCachedPresignedUrl };