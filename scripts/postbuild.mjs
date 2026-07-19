// Copies the assets the standalone output needs but Next does not bundle.
// Replaces the previous `cp -r` shell calls so the build works on Windows too.
import { cpSync, existsSync } from "node:fs";

const standalone = ".next/standalone";

if (!existsSync(standalone)) {
  console.error(`[postbuild] ${standalone} not found — is output: "standalone" set in next.config.ts?`);
  process.exit(1);
}

cpSync(".next/static", `${standalone}/.next/static`, { recursive: true });
if (existsSync("public")) {
  cpSync("public", `${standalone}/public`, { recursive: true });
}

console.log("[postbuild] copied static assets into .next/standalone");
