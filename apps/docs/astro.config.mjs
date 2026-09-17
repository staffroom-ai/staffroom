/**
 * The docs site.
 *
 * Served under /docs rather than at a root, because staffroom.so itself is the
 * landing page and the docs are a section of it. `base` has to match or every
 * internal link is right locally and broken in production.
 */
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://staffroom.so",
  base: "/docs",
  integrations: [
    starlight({
      title: "Staffroom",
      description: "An office of AI staff that work in files you own.",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/staffroom-ai/staffroom" },
      ],
      editLink: {
        baseUrl: "https://github.com/staffroom-ai/staffroom/edit/main/apps/docs/",
      },
      sidebar: [
        { label: "Start", items: [{ autogenerate: { directory: "start" } }] },
        { label: "Your office", items: [{ autogenerate: { directory: "office" } }] },
        { label: "Tools", items: [{ autogenerate: { directory: "tools" } }] },
        { label: "Models", items: [{ autogenerate: { directory: "models" } }] },
        { label: "Templates", items: [{ autogenerate: { directory: "templates" } }] },
        { label: "Safety", link: "/safety/" },
        // Generated from the schemas. Ordered by hand so the two most-read
        // pages are not buried under an alphabetical sort.
        {
          label: "Reference",
          items: [
            { label: "config.yaml keys", link: "/reference/config-keys/" },
            { label: "agents.yaml keys", link: "/reference/agents-keys/" },
            { label: "CLI", link: "/reference/cli/" },
            { label: "Errors", link: "/reference/errors/" },
            { label: "OfficeState", link: "/reference/office-state/" },
            { label: "WebSocket protocol", link: "/reference/ws-protocol/" },
          ],
        },
        { label: "Contributing", items: [{ autogenerate: { directory: "contributing" } }] },
      ],
    }),
  ],
});
