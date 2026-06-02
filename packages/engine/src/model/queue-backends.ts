// Phase 8.5 REACH-01 — queue-backend DATA layer (split from the overlay in queue-reachability.ts so
// adding a backend is a data-only edit, per the CONTEXT locked decision).
//
// Each backend declares its ENQUEUE call patterns (producer side — the handler hands the raw body
// off) and its CONSUMER-REGISTRATION call patterns (where signature verification becomes reachable in
// a worker). `classify()` maps a qualified call name (the same shape `model/reachability.ts` emits,
// e.g. `emailQueue.add`, `sqs.sendMessage`) to `{ backend, role }` or `null`.
//
// FP discipline (the load-bearing constraint — a bare `.add`/`.send` is extremely common): each
// pattern can require the RECEIVER (everything before `.method`) to match a regex. `.add` only counts
// as a bullmq enqueue when the receiver looks queue-like (`queue`/`bull`/bare `q`), so `Set.add`,
// `tags.add`, `arr.add` never classify. `.send` only counts as inngest when the receiver is inngest,
// so `res.send`/`socket.send`/`mailer.send` never classify. This is what protects the ≤5% corpus FP
// claim once the overlay (Plan 03) consumes it.
//
// Pure: no fs/http/net/process/fetch/node:* — string + regex classification only (engine purity D-01).

export type QueueBackendId = "bullmq" | "sqs" | "inngest" | "kafka";
export type QueueRole = "enqueue" | "consume";

export interface QueueCallPattern {
  /** The call's final segment, e.g. "add", "sendMessage", "createFunction". */
  readonly method: string;
  /** When set, the receiver (qualified name before `.method`, lower-cased) MUST match this. */
  readonly receiverPattern?: RegExp;
}

export interface QueueBackend {
  readonly id: QueueBackendId;
  readonly enqueue: ReadonlyArray<QueueCallPattern>;
  readonly consumerRegistration: ReadonlyArray<QueueCallPattern>;
}

// Receiver guards. `queue-like` matches names containing `queue`/`bull` or a bare `q` (covers
// `queue`, `emailQueue`, `q`, `bull`; excludes Set/Map/Array/`tags`/`arr` which contain none).
const QUEUE_LIKE = /queue|bull|^q$/i;
const INNGEST = /inngest/i;
const KAFKA_PRODUCER = /producer|kafka/i;
const KAFKA_CONSUMER = /consumer|kafka/i;

export const QUEUE_BACKENDS: ReadonlyArray<QueueBackend> = [
  {
    id: "bullmq",
    // `queue.add(jobName, payload)` — guard `.add` behind a queue-like receiver so Set/Map/Array .add
    // never classifies.
    enqueue: [{ method: "add", receiverPattern: QUEUE_LIKE }],
    // `new Worker('q', fn)` (callee `Worker`) + `queue.process(fn)`.
    consumerRegistration: [
      { method: "Worker" },
      { method: "process", receiverPattern: QUEUE_LIKE },
    ],
  },
  {
    id: "sqs",
    // `sqs.sendMessage(...)` / `sqs.sendMessageBatch(...)` — distinctive method names, no receiver guard.
    enqueue: [{ method: "sendMessage" }, { method: "sendMessageBatch" }],
    // `app.consume(...)` (sqs-consumer) + the `receiveMessage` poll loop.
    consumerRegistration: [{ method: "consume" }, { method: "receiveMessage" }],
  },
  {
    id: "inngest",
    // `inngest.send(...)` — `.send` is everywhere, so REQUIRE the inngest receiver.
    enqueue: [{ method: "send", receiverPattern: INNGEST }],
    consumerRegistration: [{ method: "createFunction", receiverPattern: INNGEST }],
  },
  {
    id: "kafka",
    // `producer.send(...)` (kafkajs) + `kafka.produce(...)` (node-rdkafka). `.produce` is distinctive;
    // `.send` requires a producer/kafka receiver.
    enqueue: [{ method: "produce" }, { method: "send", receiverPattern: KAFKA_PRODUCER }],
    // `consumer.run({ eachMessage })` + `consumer.subscribe(...)`.
    consumerRegistration: [
      { method: "run", receiverPattern: KAFKA_CONSUMER },
      { method: "subscribe", receiverPattern: KAFKA_CONSUMER },
    ],
  },
];

function matchPattern(receiver: string, method: string, pattern: QueueCallPattern): boolean {
  if (method !== pattern.method) return false;
  if (pattern.receiverPattern && !pattern.receiverPattern.test(receiver)) return false;
  return true;
}

/**
 * Classify a qualified call name to `{ backend, role }` or `null` for non-queue calls. Pure +
 * deterministic. Enqueue patterns are checked before consumer-registration so an ambiguous match
 * resolves producer-first (the overlay only cares that the handler enqueues).
 */
export function classify(
  qualifiedCallName: string | null | undefined,
): { readonly backend: QueueBackendId; readonly role: QueueRole } | null {
  if (!qualifiedCallName) return null;
  const lastDot = qualifiedCallName.lastIndexOf(".");
  const method = lastDot === -1 ? qualifiedCallName : qualifiedCallName.slice(lastDot + 1);
  const receiver = (lastDot === -1 ? "" : qualifiedCallName.slice(0, lastDot)).toLowerCase();
  if (!method) return null;

  for (const backend of QUEUE_BACKENDS) {
    for (const p of backend.enqueue) {
      if (matchPattern(receiver, method, p)) return { backend: backend.id, role: "enqueue" };
    }
  }
  for (const backend of QUEUE_BACKENDS) {
    for (const p of backend.consumerRegistration) {
      if (matchPattern(receiver, method, p)) return { backend: backend.id, role: "consume" };
    }
  }
  return null;
}
