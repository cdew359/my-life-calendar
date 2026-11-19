// Keep Electron's arithmetic and validation identical to the web and API.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/lib/timelines.ts"), "utf8");
fs.writeFileSync(
  path.join(root, "electron/timelines.cjs"),
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
);
// Birthday schema validation is also shared with Electron's main process.
fs.writeFileSync(
  path.join(root, "electron/birthdayRules.cjs"),
  ts.transpileModule(fs.readFileSync(path.join(root, "src/lib/birthdayRules.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
);

// Share AI batch validation with Electron without adding another implementation.
fs.writeFileSync(
  path.join(root, "electron/aiPlans.cjs"),
  ts.transpileModule(fs.readFileSync(path.join(root, "src/lib/aiPlans.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
);
