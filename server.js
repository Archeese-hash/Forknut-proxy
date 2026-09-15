import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = Fastify({ logger: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await app.register(fastifyStatic, {
  root: path.join(__dirname, "public")
});

app.get("/", async (_, reply) => {
  return reply.sendFile("index.html");
});

const port = Number(process.env.PORT || 3000);

await app.listen({
  host: "0.0.0.0",
  port
});
