import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(".");

function filesIn(directory, extensions) {
  const output = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) output.push(...filesIn(path, extensions));
    else if (extensions.has(extname(path))) output.push(path);
  }
  return output;
}

const scriptFiles = [
  ...filesIn("scripts", new Set([".js", ".mjs"])),
  ...filesIn("tests", new Set([".js", ".mjs"]))
];

for (const file of scriptFiles) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}

const importPattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g;
for (const file of scriptFiles) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(importPattern)) {
    const imported = normalize(resolve(dirname(file), match[1]));
    if (!existsSync(imported)) throw new Error(`${file}: missing relative import ${match[1]}`);
  }
}

const manifest = JSON.parse(readFileSync("module.json", "utf8"));
if (!manifest.id || !manifest.version || !Array.isArray(manifest.esmodules)) {
  throw new Error("module.json: required manifest fields are missing");
}
for (const path of [...manifest.esmodules, ...(manifest.styles ?? [])]) {
  if (!existsSync(resolve(ROOT, path))) throw new Error(`module.json: referenced file does not exist: ${path}`);
}

const blockPattern = /{{[#/]([A-Za-z0-9_.-]+)\b[^}]*}}/g;
for (const file of filesIn("templates", new Set([".hbs"]))) {
  const source = readFileSync(file, "utf8");
  const stack = [];
  for (const match of source.matchAll(blockPattern)) {
    const token = match[0];
    const name = match[1];
    if (token.startsWith("{{#")) stack.push(name);
    else {
      const opened = stack.pop();
      if (opened !== name) throw new Error(`${file}: Handlebars block mismatch, opened ${opened ?? "nothing"}, closed ${name}`);
    }
  }
  if (stack.length) throw new Error(`${file}: unclosed Handlebars block(s): ${stack.join(", ")}`);
}

console.log(`Static checks passed for ${scriptFiles.length} scripts, manifest references, and Handlebars templates.`);
