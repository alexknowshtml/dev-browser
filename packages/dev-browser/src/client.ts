import { chromium, type Browser, type Page } from "playwright";
import type {
  GetPageRequest,
  ListPagesResponse,
  ServerInfoResponse,
} from "./types";

export interface DevBrowserClient {
  page: (name: string) => Promise<Page>;
  list: () => Promise<string[]>;
  close: (name: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

export async function connect(serverUrl: string): Promise<DevBrowserClient> {
  let browser: Browser | null = null;
  let wsEndpoint: string | null = null;

  async function ensureConnected(): Promise<Browser> {
    if (browser && browser.isConnected()) {
      return browser;
    }

    // Fetch wsEndpoint from server
    const res = await fetch(serverUrl);
    const info = (await res.json()) as ServerInfoResponse;
    wsEndpoint = info.wsEndpoint;

    // Connect to the browser
    browser = await chromium.connect(wsEndpoint);
    return browser;
  }

  async function findPage(b: Browser, name: string): Promise<Page | null> {
    for (const context of b.contexts()) {
      for (const page of context.pages()) {
        try {
          const pageName = await page.evaluate(() => (globalThis as any).__devBrowserPageName);
          if (pageName === name) {
            return page;
          }
        } catch {
          // Page might be closed or navigating
        }
      }
    }
    return null;
  }

  return {
    async page(name: string): Promise<Page> {
      // Request the page from server (creates if doesn't exist)
      const res = await fetch(`${serverUrl}/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name } satisfies GetPageRequest),
      });

      if (!res.ok) {
        throw new Error(`Failed to get page: ${await res.text()}`);
      }

      await res.json(); // consume response

      // Connect to browser
      const b = await ensureConnected();

      // Find the page
      const page = await findPage(b, name);
      if (!page) {
        throw new Error(`Page "${name}" not found in browser contexts`);
      }

      return page;
    },

    async list(): Promise<string[]> {
      const res = await fetch(`${serverUrl}/pages`);
      const data = (await res.json()) as ListPagesResponse;
      return data.pages;
    },

    async close(name: string): Promise<void> {
      const res = await fetch(`${serverUrl}/pages/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error(`Failed to close page: ${await res.text()}`);
      }
    },

    async disconnect(): Promise<void> {
      if (browser) {
        await browser.close();
        browser = null;
      }
    },
  };
}
