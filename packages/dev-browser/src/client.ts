import { chromium, type Browser, type Page } from "playwright";
import type {
  GetPageRequest,
  GetPageResponse,
  ListPagesResponse,
  ServerInfoResponse,
  GetLLMTreeResponse,
  GetSelectorResponse,
} from "./types";

export interface DevBrowserClient {
  page: (name: string) => Promise<Page>;
  list: () => Promise<string[]>;
  close: (name: string) => Promise<void>;
  disconnect: () => Promise<void>;
  /**
   * Get LLM-friendly DOM tree for a page
   * Updates the server's selector map for the page
   */
  getLLMTree: (name: string) => Promise<GetLLMTreeResponse>;
  /**
   * Get CSS selector for an element by its index from the last getLLMTree call
   */
  getSelectorForID: (name: string, index: number) => Promise<string>;
}

export async function connect(serverUrl: string): Promise<DevBrowserClient> {
  let browser: Browser | null = null;
  let wsEndpoint: string | null = null;
  let connectingPromise: Promise<Browser> | null = null;

  async function ensureConnected(): Promise<Browser> {
    // Return existing connection if still active
    if (browser && browser.isConnected()) {
      return browser;
    }

    // If already connecting, wait for that connection (prevents race condition)
    if (connectingPromise) {
      return connectingPromise;
    }

    // Start new connection with mutex
    connectingPromise = (async () => {
      try {
        // Fetch wsEndpoint from server
        const res = await fetch(serverUrl);
        if (!res.ok) {
          throw new Error(`Server returned ${res.status}: ${await res.text()}`);
        }
        const info = (await res.json()) as ServerInfoResponse;
        wsEndpoint = info.wsEndpoint;

        // Connect to the browser via CDP
        browser = await chromium.connectOverCDP(wsEndpoint);
        return browser;
      } finally {
        connectingPromise = null;
      }
    })();

    return connectingPromise;
  }

  // Find page by CDP targetId - more reliable than JS globals
  async function findPageByTargetId(b: Browser, targetId: string): Promise<Page | null> {
    for (const context of b.contexts()) {
      for (const page of context.pages()) {
        let cdpSession;
        try {
          cdpSession = await context.newCDPSession(page);
          const { targetInfo } = await cdpSession.send("Target.getTargetInfo");
          if (targetInfo.targetId === targetId) {
            return page;
          }
        } catch (err) {
          // Only ignore "target closed" errors, log unexpected ones
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("Target closed") && !msg.includes("Session closed")) {
            console.warn(`Unexpected error checking page target: ${msg}`);
          }
        } finally {
          if (cdpSession) {
            try {
              await cdpSession.detach();
            } catch {
              // Ignore detach errors - session may already be closed
            }
          }
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

      const { targetId } = (await res.json()) as GetPageResponse;

      // Connect to browser
      const b = await ensureConnected();

      // Find the page by targetId
      const page = await findPageByTargetId(b, targetId);
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
      // Just disconnect the CDP connection - pages persist on server
      if (browser) {
        await browser.close();
        browser = null;
      }
    },

    async getLLMTree(name: string): Promise<GetLLMTreeResponse> {
      const res = await fetch(`${serverUrl}/pages/${encodeURIComponent(name)}/tree`, {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error(`Failed to get LLM tree: ${await res.text()}`);
      }

      return (await res.json()) as GetLLMTreeResponse;
    },

    async getSelectorForID(name: string, index: number): Promise<string> {
      const res = await fetch(`${serverUrl}/pages/${encodeURIComponent(name)}/selector/${index}`);

      if (!res.ok) {
        throw new Error(`Failed to get selector: ${await res.text()}`);
      }

      const data = (await res.json()) as GetSelectorResponse;
      return data.selector;
    },
  };
}
