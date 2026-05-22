// @ts-check
import { defineConfig } from "astro/config";

// Marketing site for hookwarden — local-first webhook security audit CLI.
// Brand palette (locked, see project memory):
//   bg #0B0F14  text #E5E7EB  accent #6366F1 (indigo)  surface #1E293B
// Geist Sans + Geist Mono.

export default defineConfig({
  site: "https://hookwarden.dev",
  output: "static",
});
