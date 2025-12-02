import { serve } from "dev-browser";

const server = await serve({
  port: 9222,
  headless: false,
});

console.log(`Dev browser server started`);
console.log(`  HTTP API: http://localhost:${server.port}`);
console.log(`  WebSocket: ${server.wsEndpoint}`);
console.log(`\nPress Ctrl+C to stop`);

// Keep the process running
await new Promise(() => {});
