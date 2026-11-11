import fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

/**
 * A Fastify app without its own logger (services log through `@ac/log`).
 * It also reads HTML form posts, so a page form and curl reach the same endpoint.
 */
export function createApp(): FastifyInstance {
  const app = fastify({ logger: false });
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    },
  );
  return app;
}

/** True when a browser form posted the request; false for curl and fetch with JSON. */
export function wantsHtml(request: FastifyRequest): boolean {
  return (request.headers.accept ?? "").includes("text/html");
}

export function escapeHtml(text: unknown): string {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** A small result page for form posts. `body` is HTML; escape what you put in it. */
export function htmlPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#111827}a{color:#1d4ed8}</style></head>
<body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
}
