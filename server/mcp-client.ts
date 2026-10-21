import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let clientPromise: Promise<Client> | undefined;
let availableTools: string[] = [];

export async function getClinicMcpClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const isCompiledApi = process.argv[1]?.replaceAll("\\", "/").includes("/dist/server/api.js") ?? false;
      const compiledServer = resolve(process.cwd(), "dist/server/mcp-stdio.js");
      const commandArgs = isCompiledApi && existsSync(compiledServer)
        ? [compiledServer]
        : [resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"), resolve(process.cwd(), "server/mcp-stdio.ts")];
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: commandArgs,
        cwd: process.cwd(),
        stderr: "inherit",
      });
      const client = new Client({ name: "edvak-front-desk-api", version: "1.0.0" });
      await client.connect(transport);
      const tools = await client.listTools();
      availableTools = tools.tools.map((tool) => tool.name);
      return client;
    })().catch((error) => { clientPromise = undefined; throw error; });
  }
  return clientPromise;
}

export async function getClinicMcpStatus() {
  try {
    await getClinicMcpClient();
    return { connected: true, transport: "stdio", tools: availableTools };
  } catch (error) {
    return { connected: false, transport: "stdio", tools: [], error: error instanceof Error ? error.message : "MCP server failed to start" };
  }
}

export async function closeClinicMcpClient() {
  if (!clientPromise) return;
  try { const client = await clientPromise; await client.close(); } finally { clientPromise = undefined; availableTools = []; }
}
