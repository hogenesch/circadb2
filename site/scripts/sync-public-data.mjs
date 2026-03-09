import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(scriptDir, "..");
const projectRoot = resolve(siteRoot, "..");
const sourceDir = resolve(projectRoot, "public_data");
const targetDir = resolve(siteRoot, "public", "public_data");

if (!existsSync(sourceDir)) {
  throw new Error(
    `public_data directory not found at ${sourceDir}. Run the Python build first.`
  );
}

mkdirSync(resolve(siteRoot, "public"), { recursive: true });
rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });

console.log(`Synced ${sourceDir} -> ${targetDir}`);
