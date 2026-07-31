/**
 * MoodBot Update Server — Cloudflare Worker
 * ──────────────────────────────────────────
 * Proxies requests to Cloudflare R2 bucket "moodbot-releases".
 * Serves latest.yml, latest-mac.yml, and installer binaries.
 *
 * electron-updater fetches:
 *   GET /latest.yml          → checks current version
 *   GET /MoodBot Setup x.y.z.exe → downloads installer
 */

export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const key  = url.pathname.replace(/^\//, ''); // strip leading /

    if (!key) {
      return new Response('MoodBot Update Server', { status: 200 });
    }

    // Only allow GET
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Fetch from R2
    const object = await env.RELEASES.get(key);

    if (!object) {
      return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);

    // Cache yml files for 60s, binaries for 1 hour
    const isYml = key.endsWith('.yml') || key.endsWith('.yaml');
    headers.set('Cache-Control', isYml ? 'public, max-age=60' : 'public, max-age=3600');

    return new Response(object.body, { headers });
  },
};
