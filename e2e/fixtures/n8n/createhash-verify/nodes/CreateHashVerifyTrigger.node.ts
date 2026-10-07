// FP repro fixture — faithful to n8n's HubspotTrigger (n8n@2.42.4, lines 456-463): the webhook()
// handler verifies INLINE by hashing secret+body with createHash('sha256') and comparing to a
// request header. It genuinely rejects a bad signature (returns {} -> no workflowData).
//
// The engine's verification recognition keys on createHmac / timingSafeEqual / getHeaderData but
// NOT createHash, so it reports `n8n/missing-signature-verification: not-verified` (critical) —
// a false positive: verification IS present. The accurate finding would be the real weaknesses of
// this shape (non-constant-time `!==` -> missing-timing-safe-equal; JSON.stringify(body) instead
// of the raw body -> raw-body-misuse), never "missing verification".
import { createHash } from "node:crypto";
import type {
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from "n8n-workflow";

export class CreateHashVerifyTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: "CreateHash Verify Trigger",
    name: "createHashVerifyTrigger",
    group: ["trigger"],
    version: 1,
    description: "Receives a webhook and verifies it inline with createHash before emitting.",
    defaults: { name: "CreateHash Verify Trigger" },
    inputs: [],
    outputs: ["main"],
    webhooks: [
      {
        name: "default",
        httpMethod: "POST",
        responseMode: "onReceived",
        path: "createhash-verify",
      },
    ],
    properties: [],
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const req = this.getRequestObject();
    const bodyData = req.body;
    const headerData = this.getHeaderData();

    // VERIFY — hand-rolled signature: sha256(secret + body) compared to the request header.
    const hash = `${"my-webhook-secret"}${JSON.stringify(bodyData)}`;
    const signature = createHash("sha256").update(hash).digest("hex");
    if (signature !== headerData["x-signature"]) {
      return {};
    }

    return { workflowData: [this.helpers.returnJsonArray(bodyData)] };
  }
}
