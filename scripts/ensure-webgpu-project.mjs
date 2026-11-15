import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Editor 5.5.3 reads this flag when opening a project, but omits it on save.
// Restore the required renderer before generation or a full project reopen.
const projectPath = process.argv[2] ?? fileURLToPath(new URL("../project.bjseditor", import.meta.url));
const source = readFileSync(projectPath, "utf8");
const project = JSON.parse(source);
if (!project || typeof project !== "object" || Array.isArray(project)) {
  throw new Error("WebGPU project configuration must be a JSON object.");
}
if (project.isWebGPU !== true) {
  project.isWebGPU = true;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const indentation = source.match(/\r?\n([\t ]+)"/)?.[1] ?? "    ";
  writeFileSync(projectPath, `${JSON.stringify(project, null, indentation).replaceAll("\n", newline)}${newline}`);
  console.log("Restored the Editor WebGPU setting. Fully close and reopen the project to apply it.");
}
