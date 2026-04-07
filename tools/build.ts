#!/usr/bin/env -S node --experimental-strip-types

// Bundles server and client sources.
//
// build.ts [--minify] [--watch]
// --minify    Minify output.
// --watch     Automatically rebuild whenever an input changes.

import fs from "node:fs";
import type { BuildOptions } from "esbuild";
import esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const minify = process.argv.includes("--minify");

const opts: BuildOptions = {
  bundle: true,
  logLevel: "info",
  metafile: true,
  sourcemap: "linked",
  target: "es2023",
  minify,
};

const serverOpts: BuildOptions = {
  ...opts,
  entryPoints: ["src/server/index.ts"],
  format: "cjs",
  outdir: "dist/server",
  platform: "node",
};

if (watch) {
  const serverCtx = await esbuild.context(serverOpts);
  await serverCtx.watch();
} else {
  const server = await esbuild.build(serverOpts);
  if (server.metafile)
    fs.writeFileSync("dist/server.meta.json", JSON.stringify(server.metafile));
}
