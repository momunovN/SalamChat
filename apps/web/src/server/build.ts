import { execSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";

const startedAt = new Date().toISOString();

function stamp(): { commit: string; built_at: string | null } {
  let commit = "";
  let builtAt: string | null = null;
  try {
    const raw = JSON.parse(readFileSync(path.join(process.cwd(), ".build-info.json"), "utf8")) as {
      commit?: string;
      built_at?: string;
    };
    commit = raw.commit || "";
    builtAt = raw.built_at || null;
  } catch {
    /* not stamped (dev run) */
  }
  if (!commit) {
    try {
      commit = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().slice(0, 12);
    } catch {
      commit = "";
    }
  }
  return { commit, built_at: builtAt };
}

const info = stamp();

/** What /healthz reports so a deploy can be checked: the commit, when it was built and started. */
export function buildInfo() {
  return { commit: info.commit || null, built_at: info.built_at, started_at: startedAt };
}
