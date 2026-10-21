import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getDataset } from "./data.js";
import { createClinicMcpServer, newToolState } from "./clinic-mcp.js";

const dataset = await getDataset();
const server = createClinicMcpServer(dataset, newToolState(dataset));
await server.connect(new StdioServerTransport());
