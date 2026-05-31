// Talos n8n n8mare MITIGATED fixture — custom-node webhook handler that verifies the configured
// auth header BEFORE the agent/tool call. The header comparison (getHeaderData + timingSafeEqual)
// runs first; only a verified request reaches the agent sink.
//
// Detector #2 (n8n/agent-tool-acts-on-unverified-payload) and the n8n baselines must STAY SILENT.
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from "n8n-workflow";

declare const chain: { invoke(input: unknown): Promise<unknown> };

export class InboundAgent implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Inbound Agent",
    name: "inboundAgent",
    group: ["trigger"],
    version: 1,
    description: "Receives an inbound webhook, verifies it, then runs an agent.",
    defaults: { name: "Inbound Agent" },
    inputs: [],
    outputs: ["main"],
    webhooks: [
      {
        name: "default",
        httpMethod: "POST",
        responseMode: "onReceived",
        path: "inbound",
      },
    ],
    properties: [],
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    // VERIFY FIRST: read the configured header and compare it against the credential in
    // constant time. This runs BEFORE any payload reaches the agent sink.
    const headers = this.getHeaderData() as Record<string, string>;
    const credentials = await this.getCredentials("httpHeaderAuth");
    const provided = Buffer.from(String(headers["x-webhook-token"] ?? ""));
    const expected = Buffer.from(String(credentials.value ?? ""));
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return { workflowData: [[]] };
    }
    // Only a verified request reaches the agent.
    const body = this.getBodyData();
    const result = await chain.invoke(body);
    return { workflowData: [[{ json: { result } }]] };
  }
}
