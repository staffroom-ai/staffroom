/**
 * Declares the docs collection.
 *
 * Astro stopped inferring collections from folder names, so without this the
 * site builds one 404 page and says the collection is empty — which looks like
 * the pages are broken rather than undeclared.
 */

import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
