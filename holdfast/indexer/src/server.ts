import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { PublicKey } from "@solana/web3.js";
import type { EventStore } from "./store.js";
import type { EscrowEventPage, HistoryPage, ProtocolEventPage } from "./types.js";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
export const MAX_BODY_BYTES = 64 * 1024; // 64 KiB — far exceeds any valid request payload

class BodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "BodyTooLargeError";
  }
}

const HEALTH_RE = /^\/health(\?.*)?$/;
const ROUTE_REP_HISTORY = /^\/v1\/agents\/([^/?]+)\/reputation\/history(\?.*)?$/;
const ROUTE_ESCROW_EVENTS = /^\/v1\/escrows\/([^/?]+)\/events(\?.*)?$/;
const ROUTE_PROTOCOL_EVENTS = /^\/events(\?.*)?$/;
const ROUTE_CANCEL_INTENT = /^\/v1\/escrows\/([^/?]+)\/cancel-intent(\?.*)?$/;

function parseQuery(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

function readBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    let received = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) {
        tooLarge = true;
        // Drop the chunk but continue draining so the response can still be sent.
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(new BodyTooLargeError());
      } else {
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    req.on("error", reject);
  });
}

function isValidPubkey(s: string): boolean {
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

export function createApiServer(store: EventStore): ReturnType<typeof createServer> {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // Health check (GET only).
    if (HEALTH_RE.test(url)) {
      if (method !== "GET") { sendError(res, 405, "Method Not Allowed"); return; }
      const dbOk = store.isHealthy();
      sendJson(res, dbOk ? 200 : 503, {
        status: dbOk ? "ok" : "degraded",
        db: dbOk ? "connected" : "error",
      });
      return;
    }

    // Reputation history route (GET only).
    const repMatch = ROUTE_REP_HISTORY.exec(url);
    if (repMatch !== null) {
      if (method !== "GET") { sendError(res, 405, "Method Not Allowed"); return; }
      handleReputationHistory(req, res, store, repMatch);
      return;
    }

    // Escrow events route (GET only).
    const evMatch = ROUTE_ESCROW_EVENTS.exec(url);
    if (evMatch !== null) {
      if (method !== "GET") { sendError(res, 405, "Method Not Allowed"); return; }
      handleEscrowEvents(req, res, store, evMatch);
      return;
    }

    // Dashboard protocol events route (GET only).
    const protocolEventsMatch = ROUTE_PROTOCOL_EVENTS.exec(url);
    if (protocolEventsMatch !== null) {
      if (method !== "GET") { sendError(res, 405, "Method Not Allowed"); return; }
      handleProtocolEvents(req, res, store, protocolEventsMatch);
      return;
    }

    // Cancel-intent routes (GET / POST / DELETE).
    const ciMatch = ROUTE_CANCEL_INTENT.exec(url);
    if (ciMatch !== null) {
      const escrowId = decodeURIComponent(ciMatch[1]!);
      if (!isValidPubkey(escrowId)) {
        sendError(res, 400, "Invalid escrow id");
        return;
      }
      void handleCancelIntent(req, res, store, escrowId, method);
      return;
    }

    sendError(res, 404, "Not Found");
  });
}

function handleReputationHistory(
  _req: IncomingMessage,
  res: ServerResponse,
  store: EventStore,
  match: RegExpExecArray,
): void {
  const pubkeyStr = decodeURIComponent(match[1]!);

  try {
    new PublicKey(pubkeyStr);
  } catch {
    sendError(res, 400, "Invalid agent pubkey");
    return;
  }

  const qs = parseQuery(match[2] ?? "");
  const rawLimit = parseInt(qs.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = isNaN(rawLimit) || rawLimit < 1
    ? DEFAULT_LIMIT
    : Math.min(rawLimit, MAX_LIMIT);

  const beforeStr = qs.get("before");
  const beforeId = beforeStr !== null ? parseInt(beforeStr, 10) : undefined;
  if (beforeId !== undefined && isNaN(beforeId)) {
    sendError(res, 400, "Invalid cursor");
    return;
  }

  let page: HistoryPage;
  try {
    page = store.getHistory(pubkeyStr, limit, beforeId);
  } catch (err) {
    console.error("[server] Store error:", err);
    sendError(res, 500, "Internal Server Error");
    return;
  }

  sendJson(res, 200, page);
}

function handleEscrowEvents(
  _req: IncomingMessage,
  res: ServerResponse,
  store: EventStore,
  match: RegExpExecArray,
): void {
  const escrowId = decodeURIComponent(match[1]!);
  if (!isValidPubkey(escrowId)) {
    sendError(res, 400, "Invalid escrow id");
    return;
  }

  const qs = parseQuery(match[2] ?? "");
  const rawLimit = parseInt(qs.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = isNaN(rawLimit) || rawLimit < 1
    ? DEFAULT_LIMIT
    : Math.min(rawLimit, MAX_LIMIT);

  const beforeStr = qs.get("before");
  const beforeId = beforeStr !== null ? parseInt(beforeStr, 10) : undefined;
  if (beforeId !== undefined && isNaN(beforeId)) {
    sendError(res, 400, "Invalid cursor");
    return;
  }

  let page: EscrowEventPage;
  try {
    page = store.getEscrowEvents(escrowId, limit, beforeId);
  } catch (err) {
    console.error("[server] Store error:", err);
    sendError(res, 500, "Internal Server Error");
    return;
  }

  sendJson(res, 200, page);
}

function handleProtocolEvents(
  _req: IncomingMessage,
  res: ServerResponse,
  store: EventStore,
  match: RegExpExecArray,
): void {
  const qs = parseQuery(match[1] ?? "");
  const rawLimit = parseInt(qs.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = isNaN(rawLimit) || rawLimit < 1
    ? DEFAULT_LIMIT
    : Math.min(rawLimit, MAX_LIMIT);

  const beforeStr = qs.get("before");
  const beforeId = beforeStr !== null ? parseInt(beforeStr, 10) : undefined;
  if (beforeId !== undefined && isNaN(beforeId)) {
    sendError(res, 400, "Invalid cursor");
    return;
  }

  let page: ProtocolEventPage;
  try {
    page = store.getProtocolEvents(limit, beforeId);
  } catch (err) {
    console.error("[server] Store error:", err);
    sendError(res, 500, "Internal Server Error");
    return;
  }

  sendJson(res, 200, page);
}

async function handleCancelIntent(
  req: IncomingMessage,
  res: ServerResponse,
  store: EventStore,
  escrowId: string,
  method: string,
): Promise<void> {
  try {
    if (method === "GET") {
      const intent = store.getCancelIntent(escrowId);
      sendJson(res, 200, intent ?? null);
      return;
    }

    if (method === "POST") {
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req));
      } catch (err) {
        if (err instanceof BodyTooLargeError) {
          sendError(res, 413, "Request body too large");
          return;
        }
        sendError(res, 400, "Invalid JSON body");
        return;
      }

      if (typeof body !== "object" || body === null) {
        sendError(res, 400, "Body must be a JSON object");
        return;
      }

      const { requestedBy } = body as Record<string, unknown>;
      if (typeof requestedBy !== "string" || !isValidPubkey(requestedBy)) {
        sendError(res, 400, "requestedBy must be a valid base58 pubkey");
        return;
      }

      const record = store.upsertCancelIntent(escrowId, requestedBy);
      sendJson(res, 200, record);
      return;
    }

    if (method === "DELETE") {
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req));
      } catch (err) {
        if (err instanceof BodyTooLargeError) {
          sendError(res, 413, "Request body too large");
          return;
        }
        sendError(res, 400, "Invalid JSON body");
        return;
      }

      if (typeof body !== "object" || body === null) {
        sendError(res, 400, "Body must be a JSON object");
        return;
      }

      const { requestedBy } = body as Record<string, unknown>;
      if (typeof requestedBy !== "string" || !isValidPubkey(requestedBy)) {
        sendError(res, 400, "requestedBy must be a valid base58 pubkey");
        return;
      }

      const removed = store.deleteCancelIntent(escrowId, requestedBy);
      sendJson(res, 200, { removed });
      return;
    }

    sendError(res, 405, "Method Not Allowed");
  } catch (err) {
    console.error("[server] Cancel-intent error:", err);
    sendError(res, 500, "Internal Server Error");
  }
}
