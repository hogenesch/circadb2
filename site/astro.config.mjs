import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

const rawBase = process.env.SITE_BASE ?? "/";
const normalizedBase =
  rawBase === "/" ? "/" : `/${rawBase.replace(/^\/+|\/+$/g, "")}/`;

export default defineConfig({
  output: "static",
  base: normalizedBase,
  integrations: [tailwind()],
  build: {
    format: "directory",
  },
});
