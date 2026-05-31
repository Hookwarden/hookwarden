// Talos n8n n8mare attack-surface fixture — custom-node webhook handler that pipes the
// UNVERIFIED inbound webhook body straight into an agent/LLM tool call. No header verification
// precedes the agent invocation, so an attacker who POSTs to the public webhook URL drives the
// agent with attacker-controlled input.
//
// Detector #2 (n8n/agent-tool-acts-on-unverified-payload, high) must fire here.
import type {
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from "n8n-workflow";

// Stand-in for a LangChain agent/tool chain the node was wired to. The engine's n8n catalog
// lists `chain.invoke` as an agentic sink call.
declare const chain: { invoke(input: unknown): Promise<unknown> };

export class InboundAgent implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Inbound Agent",
    name: "inboundAgent",
    group: ["trigger"],
    version: 1,
    description: "Receives an inbound webhook and runs an agent.",
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
    // SOURCE: the unverified inbound payload.
    const body = this.getBodyData();
    // SINK: the agent/tool is invoked on the unverified body with NO header check first.
    const result = await chain.invoke(body);
    return { workflowData: [[{ json: { result } }]] };
  }
}
