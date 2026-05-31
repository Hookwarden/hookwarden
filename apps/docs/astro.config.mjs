// @ts-check

import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://docs.hookwarden.dev",
  integrations: [
    starlight({
      title: "hookwarden",
      description: "Local webhook signature-verification audit + auto-fix CLI.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/Hookwarden/hookwarden",
        },
      ],
      sidebar: [
        { label: "Home", link: "/" },
        {
          label: "CLI",
          items: [
            { label: "Continuous integration", link: "/cli/ci/" },
            { label: "hookwarden fix", link: "/cli/fix/" },
            { label: "Safety levels", link: "/cli/safety-levels/" },
          ],
        },
        {
          label: "MCP",
          items: [
            { label: "Getting started", link: "/mcp/getting-started/" },
            { label: "scan_handler tool", link: "/mcp/scan-handler/" },
            { label: "Drift detection", link: "/mcp/drift-detection/" },
          ],
        },
        {
          label: "Rules",
          items: [
            { label: "Coverage matrix", link: "/rules/" },
            { label: "Stripe", link: "/rules/stripe/" },
            { label: "GitHub", link: "/rules/github/" },
            { label: "Slack", link: "/rules/slack/" },
            { label: "Shopify", link: "/rules/shopify/" },
            { label: "Twilio", link: "/rules/twilio/" },
            { label: "Square", link: "/rules/square/" },
          ],
        },
        {
          label: "Agentic rulepacks",
          items: [{ label: "n8n", link: "/agentic-rulepacks/n8n/" }],
        },
      ],
      customCss: ["./src/styles/brand.css"],
    }),
  ],
});
