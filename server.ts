import { createServer } from "node:http";
import { parseArgs } from "node:util";
import next from "next";
import { attachRealtime } from "@/lib/realtime/server";

async function main() {
  const { values } = parseArgs({
    options: {
      dev: { type: "boolean", default: false },
      hostname: { type: "string", short: "H", default: process.env.POKER_HOST || "0.0.0.0" },
      port: { type: "string", short: "p", default: process.env.PORT || "3000" },
    },
  });
  const port = Number(values.port);
  const app = next({ dev: values.dev, hostname: values.hostname, port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = createServer(async (request, response) => {
    try {
      await handle(request, response);
    } catch (error) {
      console.error("Request failed", error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
  const realtime = attachRealtime(server);
  server.listen(port, values.hostname, () =>
    console.log(`Poker HTTP + WS ready on ${values.hostname}:${port}`),
  );
  const shutdown = () => {
    realtime.close();
    server.close(() => {
      void app.close().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
