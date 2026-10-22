import "dotenv/config";
import { createServer } from "node:net";
import concurrently from "concurrently";

async function checkPort(port, service) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error) => {
      reject(new Error(error.code === "EADDRINUSE"
        ? `${service} port ${port} is already in use. Stop the previous dev terminal with Ctrl+C, then run npm run dev again.`
        : `Cannot use ${service} port ${port}: ${error.message}`));
    });
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}

try {
  const apiPort = Number(process.env.PORT || 4317);
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535 || apiPort === 5173) {
    throw new Error("PORT must be a valid backend port different from frontend port 5173 (default: 4317).");
  }
  await checkPort(apiPort, "Backend");
  await checkPort(5173, "Frontend");
  console.log("Starting Edvak backend and frontend. Ctrl+C stops both.");

  const { result } = concurrently([
    { command: "npm run dev:api", name: "api", prefixColor: "blue" },
    { command: "npm run dev:web", name: "web", prefixColor: "green" },
  ], { prefix: "name", killOthersOn: ["failure", "success"], killTimeout: 5_000 });
  await result;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Development servers stopped. Check the [api] and [web] output above.");
  process.exitCode = 1;
}
