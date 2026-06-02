// Phase 8.5 REACH-01 — queue-backend matcher tests.
//
// Positive: every backend's enqueue + consumer-registration FQN classifies to the right
// {backend, role}. Negative (mandatory, SOC2 evidence per [[feedback_negative_tests_required]]): the
// bare-`.add` / bare-`.send` false positives that would otherwise contaminate the corpus FP-rate —
// Set.add, tags.add, res.send, mailer.send — must classify to null. These FP guards are what protect
// the ≤5% claim once the overlay (Plan 03) consumes classify().

import { describe, expect, it } from "vitest";
import { classify, QUEUE_BACKENDS } from "../src/model/queue-backends.js";

describe("queue-backends classify() — enqueue (positive)", () => {
  it.each([
    ["emailQueue.add", "bullmq"],
    ["queue.add", "bullmq"],
    ["q.add", "bullmq"],
    ["sqs.sendMessage", "sqs"],
    ["client.sendMessageBatch", "sqs"],
    ["inngest.send", "inngest"],
    ["producer.send", "kafka"],
    ["kafka.produce", "kafka"],
  ])("%s → enqueue (%s)", (name, backend) => {
    expect(classify(name)).toEqual({ backend, role: "enqueue" });
  });
});

describe("queue-backends classify() — consumer registration (positive)", () => {
  it.each([
    ["Worker", "bullmq"],
    ["emailQueue.process", "bullmq"],
    ["app.consume", "sqs"],
    ["poller.receiveMessage", "sqs"],
    ["inngest.createFunction", "inngest"],
    ["consumer.run", "kafka"],
    ["consumer.subscribe", "kafka"],
  ])("%s → consume (%s)", (name, backend) => {
    expect(classify(name)).toEqual({ backend, role: "consume" });
  });
});

describe("queue-backends classify() — NEGATIVE FP guards", () => {
  it.each([
    "set.add", // Set.prototype.add
    "tags.add", // arbitrary collection
    "arr.add",
    "myMap.add",
    "res.send", // Express response — NOT inngest
    "socket.send",
    "mailer.send", // NOT a producer/kafka receiver
    "service.send",
  ])("%s does NOT classify", (name) => {
    expect(classify(name)).toBeNull();
  });

  it("returns null for empty / null / undefined / dotless-unknown input", () => {
    expect(classify("")).toBeNull();
    expect(classify(null)).toBeNull();
    expect(classify(undefined)).toBeNull();
    expect(classify("doSomething")).toBeNull();
  });

  it("a non-producer .produce-less .send stays unclassified even with a verb-y receiver", () => {
    expect(classify("notification.send")).toBeNull();
  });
});

describe("queue-backends data", () => {
  it("covers exactly the four locked backends with both sides populated", () => {
    expect(QUEUE_BACKENDS.map((b) => b.id).sort()).toEqual(["bullmq", "inngest", "kafka", "sqs"]);
    for (const b of QUEUE_BACKENDS) {
      expect(b.enqueue.length).toBeGreaterThan(0);
      expect(b.consumerRegistration.length).toBeGreaterThan(0);
    }
  });
});
