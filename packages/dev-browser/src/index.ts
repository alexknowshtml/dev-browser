import { chromium, type BrowserServer, type Browser, type BrowserContext } from "playwright";
import type {
  ServeOptions,
  GetPageRequest,
  GetPageResponse,
  ListPagesResponse,
  ServerInfoResponse,
} from "./types";

export type { ServeOptions, GetPageResponse, ListPagesResponse, ServerInfoResponse };

export interface DevBrowserServer {
  wsEndpoint: string;
  port: number;
  stop: () => Promise<void>;
}

export async function serve(options: ServeOptions = {}): Promise<DevBrowserServer> {
  const port = options.port ?? 9222;
  const headless = options.headless ?? false;

  // Launch the browser server
  const browserServer: BrowserServer = await chromium.launchServer({
    headless,
  });
  const wsEndpoint = browserServer.wsEndpoint();

  // Connect to the browser for creating pages
  const browser: Browser = await chromium.connect(wsEndpoint);

  // Registry: name -> BrowserContext
  const registry = new Map<string, BrowserContext>();

  // HTTP server for bookkeeping
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const method = req.method;

      // GET / - server info
      if (method === "GET" && url.pathname === "/") {
        const response: ServerInfoResponse = { wsEndpoint };
        return Response.json(response);
      }

      // GET /pages - list all pages
      if (method === "GET" && url.pathname === "/pages") {
        const response: ListPagesResponse = {
          pages: Array.from(registry.keys()),
        };
        return Response.json(response);
      }

      // POST /pages - get or create page
      if (method === "POST" && url.pathname === "/pages") {
        const body = (await req.json()) as GetPageRequest;
        const { name } = body;

        if (!name) {
          return Response.json({ error: "name is required" }, { status: 400 });
        }

        // Check if page already exists
        if (!registry.has(name)) {
          // Create new context with init script
          const context = await browser.newContext();
          await context.addInitScript((pageName: string) => {
            (globalThis as any).__devBrowserPageName = pageName;
          }, name);
          await context.newPage();
          registry.set(name, context);
        }

        const response: GetPageResponse = { wsEndpoint, name };
        return Response.json(response);
      }

      // DELETE /pages/:name - close a page
      if (method === "DELETE" && url.pathname.startsWith("/pages/")) {
        const name = decodeURIComponent(url.pathname.slice("/pages/".length));
        const context = registry.get(name);

        if (context) {
          await context.close();
          registry.delete(name);
          return Response.json({ success: true });
        }

        return Response.json({ error: "page not found" }, { status: 404 });
      }

      return Response.json({ error: "not found" }, { status: 404 });
    },
  });

  return {
    wsEndpoint,
    port,
    async stop() {
      // Close all contexts
      for (const context of registry.values()) {
        await context.close();
      }
      registry.clear();

      // Close browser connection and server
      await browser.close();
      await browserServer.close();
      server.stop();
    },
  };
}
