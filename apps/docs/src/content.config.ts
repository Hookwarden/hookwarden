import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

// Astro 6 requires the docs collection to be declared with Starlight's loader.
// Without this, the `docs` collection resolves empty and only 404.html builds.
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
