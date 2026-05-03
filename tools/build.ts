#!/usr/bin/env -S node --experimental-strip-types

// Bundles server and client sources.
//
// build.ts [--minify] [--watch]
// --minify    Minify output.
// --watch     Automatically rebuild whenever an input changes.

import fs from "node:fs";
import path from "node:path";
import type { BuildOptions, Plugin } from "esbuild";
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

const clientStaticFiles = ["src/client/index.html", "src/client/styles.css"];

const copyStaticPlugin: Plugin = {
  name: "copy-static",
  setup(build) {
    build.onEnd(() => {
      const outdir = build.initialOptions.outdir ?? "dist/client";
      fs.mkdirSync(outdir, { recursive: true });
      for (const src of clientStaticFiles) {
        const dest = path.join(outdir, path.basename(src));
        fs.copyFileSync(src, dest);
      }
    });
  },
};

const clientOpts: BuildOptions = {
  ...opts,
  entryPoints: ["src/client/index.tsx"],
  format: "esm",
  outdir: "dist/client",
  platform: "browser",
  jsx: "automatic",
  plugins: [copyStaticPlugin],
};

if (watch) {
  const serverCtx = await esbuild.context(serverOpts);
  const clientCtx = await esbuild.context(clientOpts);
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
