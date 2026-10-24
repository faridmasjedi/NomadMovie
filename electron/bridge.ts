import { net, session } from "electron";
import http from "node:http";
import { Readable } from "node:stream";

/*
 * How the window reaches the engine without a network port.
 *
 * The editor page keeps the address it has always had (projects saved inside the app are tied to it), but nothing
 * listens on that address: Electron answers the window's requests itself and passes them to the engine over a
 * private socket, with a secret token. Requests to any other http address go out to the network as usual.
 */

const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer"]);

export function serveEditor(origin: string, socket: string, token: string) {
  session.defaultSession.protocol.handle("http", (req) =>
    new URL(req.url).origin === origin ? forward(req, socket, token) : net.fetch(req, { bypassCustomProtocolHandlers: true }),
  );
}

function forward(req: Request, socket: string, token: string): Promise<Response> {
  const u = new URL(req.url);
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k)) headers[k] = v;
  });
  headers.host = u.host;
  headers["x-nomad-token"] = token;
  return new Promise((resolve) => {
    const out = http.request({ socketPath: socket, method: req.method, path: u.pathname + u.search, headers }, (res) => {
      const h = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (v === undefined || HOP_BY_HOP.has(k)) continue;
        for (const x of Array.isArray(v) ? v : [v]) h.append(k, x);
      }
      const status = res.statusCode ?? 502;
      const empty = req.method === "HEAD" || status === 204 || status === 304;
      if (empty) res.resume();
      resolve(new Response(empty ? null : (Readable.toWeb(res) as ReadableStream), { status, statusText: res.statusMessage, headers: h }));
    });
    out.on("error", (e) => resolve(new Response(JSON.stringify({ error: `The engine is not responding: ${e.message}` }), { status: 502, headers: { "Content-Type": "application/json" } })));
    if (req.body) Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0]).pipe(out);
    else out.end();
  });
}
