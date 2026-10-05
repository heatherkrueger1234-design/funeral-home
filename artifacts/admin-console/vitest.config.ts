import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      /*
       * The suite reads the clock in Denver, where this product's homes are
       * and where the dates on these screens go wrong. A calendar date the
       * API stores as midnight UTC is the previous evening on a Mountain
       * clock, so reading one as an instant shows it a day early. In UTC,
       * which is where CI runs, the two readings agree, and that whole class
       * of bug would pass every test.
       */
      TZ: "America/Denver",
    },
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});
