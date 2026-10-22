import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";

const apiUrl = `http://127.0.0.1:${process.env.PORT || 4317}`;

async function waitForApi() {
  const deadline = Date.now() + 45_000;
  console.log(`Waiting for the backend at ${apiUrl} ...`);

  while (Date.now() < deadline) {
    let response;
    try {
      response = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(5_000) });
    } catch {
      await delay(300);
      continue;
    }

    const health = await response.json().catch(() => null);
    if (!response.ok || !health?.ok) {
      throw new Error(health?.error || `Backend health check failed (${response.status}).`);
    }
    console.log(`Backend ready; clinic MCP ${health.mcp?.connected ? "connected" : "unavailable"}. Starting the dashboard ...`);
    return;
  }

  throw new Error(`Backend did not become ready at ${apiUrl} within 45 seconds. Check the [api] output above.`);
}

try {
  await waitForApi();
  const server = await createServer();
  await server.listen();
  server.printUrls();
  console.log("Frontend and backend are running. Open the URL above; Ctrl+C stops both.");
} catch (error) {
  console.error(`Could not start the dashboard: ${error instanceof Error ? error.message : error}`);
  console.error("Start both services together with: npm run dev");
  process.exit(1);
}
