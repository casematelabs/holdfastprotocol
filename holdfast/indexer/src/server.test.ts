import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest, type Server, type IncomingMessage } from "node:http";
import { EventStore } from "./store.js";
import { createApiServer, MAX_BODY_BYTES } from "./server.js";

// Well-known valid Solana pubkeys (System Program + Token Program).
const ESCROW_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const REQUESTER = "11111111111111111111111111111111";

let server: Server;
let port: number;

before(async () => {
  const store = new EventStore(":memory:");
  server = createApiServer(store);
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (typeof addr === "object" && addr !== null) {
    port = addr.port;
  }
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

function doRequest(
  path: string,
  method: string,
  body: Buffer,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const r = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body.length,
        },
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) });
          } catch {
            resolve({ status: res.statusCode ?? 0, json: null });
          }
        });
      },
    );
    r.on("error", reject);
    r.write(body);
    r.end();
  });
}

const CANCEL_PATH = `/v1/escrows/${ESCROW_ID}/cancel-intent`;

// Body exactly 1 byte over the limit (not valid JSON — that's fine, 413 fires before parse).
const OVERSIZE_BODY = Buffer.alloc(MAX_BODY_BYTES + 1, 0x78); // 'x' * 65537

test("POST cancel-intent with body exceeding size limit returns 413", async () => {
  const { status } = await doRequest(CANCEL_PATH, "POST", OVERSIZE_BODY);
  assert.equal(status, 413);
});

test("DELETE cancel-intent with body exceeding size limit returns 413", async () => {
  const { status } = await doRequest(CANCEL_PATH, "DELETE", OVERSIZE_BODY);
  assert.equal(status, 413);
});

test("POST cancel-intent with body exactly at size limit is not rejected as too large", async () => {
  // Body at the limit — not valid JSON so expect 400, but crucially not 413.
  const atLimitBody = Buffer.alloc(MAX_BODY_BYTES, 0x78);
  const { status } = await doRequest(CANCEL_PATH, "POST", atLimitBody);
  assert.notEqual(status, 413);
});

test("POST cancel-intent with valid body succeeds", async () => {
  const body = Buffer.from(JSON.stringify({ requestedBy: REQUESTER }));
  const { status } = await doRequest(CANCEL_PATH, "POST", body);
  assert.equal(status, 200);
});

test("DELETE cancel-intent with valid body succeeds", async () => {
  const body = Buffer.from(JSON.stringify({ requestedBy: REQUESTER }));
  const { status } = await doRequest(CANCEL_PATH, "DELETE", body);
  assert.equal(status, 200);
});
