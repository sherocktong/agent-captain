import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  shims: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
