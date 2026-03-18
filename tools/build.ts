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

const clientOpts: BuildOptions = {
  ...opts,
  entryPoints: ["src/client/splash.ts"],
  format: "iife",
  outfile: "public/splash.js",
  platform: "browser",
};

if (watch) {
  const [serverCtx, clientCtx] = await Promise.all([
    esbuild.context(serverOpts),
    esbuild.context(clientOpts),
  ]);
  await Promise.all([serverCtx.watch(), clientCtx.watch()]);
} else {
  const [server, client] = await Promise.all([
    esbuild.build(serverOpts),
    esbuild.build(clientOpts),
  ]);
  if (server.metafile)
    fs.writeFileSync("dist/server.meta.json", JSON.stringify(server.metafile));
  if (client.metafile)
    fs.writeFileSync("dist/client.meta.json", JSON.stringify(client.metafile));
}
