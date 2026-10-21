import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDataset } from "./data.js";
import { evaluateDataset } from "./evaluate.js";
import { closeClinicMcpClient } from "./mcp-client.js";

const dataset = await getDataset();
const { results, evaluation } = await evaluateDataset(dataset);
const mode = [...new Set(results.map((result) => result.mode))].join(", ");
const report = { generated_at: new Date().toISOString(), data_source: dataset.dataSource, mode, model: process.env.OPENROUTER_MODEL || "local-rules", evaluation, results };
await mkdir(resolve(process.cwd(), "reports"), { recursive: true });
await writeFile(resolve(process.cwd(), "reports/evaluation.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ report: "reports/evaluation.json", generated_at: report.generated_at, data_source: report.data_source, mode, evaluation: { ...evaluation, perMessage: undefined } }, null, 2));
await closeClinicMcpClient();
