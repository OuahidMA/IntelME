const express = (await import("express")).default;
const cors = (await import("cors")).default;
const http = await import("node:http");

async function probe(label, configure, headers = {}) {
  const app = express();
  configure(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address();

  const out = await new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/", method: "GET", headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(`${res.statusCode} len=${data.length}`));
    });
    req.on("error", (e) => resolve(`ERR ${e.message}`));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve("TIMEOUT");
    });
    req.end();
  });

  server.close();
  process.stdout.write(`${label.padEnd(40)} ${out}\n`);
}

await probe("cors: no Origin header", (a) => {
  a.use(cors({ origin: () => true, credentials: true }));
  a.get("/", (_q, r) => r.send("hi"));
});

await probe("cors: Origin localhost:5173", (a) => {
  a.use(cors({ origin: () => true, credentials: true }));
  a.get("/", (_q, r) => r.send("hi"));
}, { Origin: "http://localhost:5173" });

process.exit(0);
