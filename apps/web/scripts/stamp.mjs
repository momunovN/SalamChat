// Writes .build-info.json so GET /healthz can tell which commit is live after a deploy.
// Never fails the build: without git or env it still records the build time.
import { execSync } from "child_process";
import { writeFileSync } from "fs";

let commit =
  process.env.SALAM_COMMIT ||
  process.env.SOURCE_COMMIT ||
  process.env.GIT_COMMIT ||
  process.env.COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  "";
if (!commit) {
  try {
    commit = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    commit = "";
  }
}
try {
  writeFileSync(".build-info.json", JSON.stringify({ commit: commit.slice(0, 12), built_at: new Date().toISOString() }));
} catch {
  /* read-only checkout: /healthz just shows no build info */
}
