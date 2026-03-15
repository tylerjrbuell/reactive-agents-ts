import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

const INSTALL_DIR = join(homedir(), ".reactive-agents");
const INSTALL_ID_FILE = join(INSTALL_DIR, "install-id");

/**
 * Get or create a stable anonymous install ID.
 * Stored at ~/.reactive-agents/install-id.
 * Not tied to user identity — just a random UUID for grouping runs.
 */
export function getOrCreateInstallId(): string {
  try {
    if (existsSync(INSTALL_ID_FILE)) {
      const id = readFileSync(INSTALL_ID_FILE, "utf-8").trim();
      if (id.length > 0) return id;
    }
  } catch {
    /* fall through to create */
  }

  const id = randomUUID();
  try {
    if (!existsSync(INSTALL_DIR)) {
      mkdirSync(INSTALL_DIR, { recursive: true });
    }
    writeFileSync(INSTALL_ID_FILE, id, "utf-8");
  } catch {
    /* best effort — return in-memory ID if fs fails */
  }
  return id;
}
