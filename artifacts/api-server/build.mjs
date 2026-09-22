import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, cp, readdir } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
const require = createRequire(import.meta.url);
globalThis.require = require;

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      {
        name: "workspace-resolver",
        setup(build) {
          build.onResolve({ filter: /^@workspace\// }, (args) => {
            if (args.path === "@workspace/api-zod") {
              return { path: path.resolve(artifactDir, "../../lib/api-zod/src/index.ts") };
            }
            if (args.path === "@workspace/db") {
              return { path: path.resolve(artifactDir, "../../lib/db/src/index.ts") };
            }
            if (args.path === "@workspace/db/schema") {
              return { path: path.resolve(artifactDir, "../../lib/db/src/schema/index.ts") };
            }
          });
        },
      },
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  // Copy PGlite wasm, data, and archive assets into dist for standalone execution
  try {
    const pglitePkgPath = require.resolve("@electric-sql/pglite");
    const pgliteDir = path.dirname(pglitePkgPath);
    const files = await readdir(pgliteDir);
    for (const file of files) {
      if (file.endsWith(".wasm") || file.endsWith(".data") || file.endsWith(".tar.gz")) {
        await cp(path.join(pgliteDir, file), path.join(distDir, file), { force: true }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn("Could not copy pglite assets directly:", err.message);
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
