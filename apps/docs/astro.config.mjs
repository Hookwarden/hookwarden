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
            { label: "hookwarden fix", link: "/cli/fix/" },
            { label: "Safety levels", link: "/cli/safety-levels/" },
          ],
        },
      ],
      customCss: ["./src/styles/brand.css"],
    }),
  ],
});
