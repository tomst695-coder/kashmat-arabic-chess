import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const outputDirectory = path.join(projectRoot, "dist");
const sourceEntries = ["index.html", "manifest.webmanifest", "sw.js", "src", "icons"];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
for (const entry of sourceEntries) {
  await cp(path.join(projectRoot, entry), path.join(outputDirectory, entry), { recursive: true });
}
process.stdout.write(`Built static app in ${outputDirectory}\n`);
