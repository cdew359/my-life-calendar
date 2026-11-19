import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const staged = process.argv.includes("--staged");
const args = staged
  ? ["ls-files", "--cached", "-z"]
  : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"];
const files = [
  ...new Set(execFileSync("git", args, { encoding: "utf8" }).split("\0").filter(Boolean)),
];
const published = new Set(files);
const findings = [];
const reviewedTestValues = new Set([
  "integration-only-secret-at-least-32-bytes",
  "migrate-pass-1",
  "shared-test-only-secret-32-characters",
  "wrong-password",
]);
const denied =
  /(?:^|\/)(?:node_modules|target|dist|release|data|data-dev|state|snapshots|backups|local)(?:\/|$)|(?:^|\/)(?:\.dev-token\.txt|accounts\.json|id_rsa[^/]*|id_ed25519[^/]*)$|\.(?:pem|key|p12|pfx|dump|sqlite3?|db|exe|msi|zip|jar|log|tar(?:\.gz)?)$/i;
const strongRules = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/g],
  ["provider-key", /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ["cloud-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g],
  ["url-credentials", /\b(?:mysql|postgres(?:ql)?|redis):\/\/[^\s:/]+:([^\s@]+)@/g],
];
/** 仅输出位置和规则，不把可疑秘密本身复制到日志。 */
function report(file, source, index, rule) {
  const line = source.slice(0, index).split("\n").length;
  findings.push(`${file}:${line} ${rule}`);
}
/** 测试与示例必须使用明确的虚构值，禁止用真实格式的提供商密钥冒充占位符。 */
function placeholder(value) {
  return (
    /^(?:test|unit|fake|sample|example|dev|local|change|placeholder|password|secret)(?:[-_: .]|$)/i.test(
      value,
    ) ||
    /^\$\{/.test(value) ||
    /^[<（填写与生成]/.test(value) ||
    value.includes("${")
  );
}
for (const file of files) {
  const example = /(?:^|\/)\.env\.example$|\.env\.example$/.test(file);
  if (denied.test(file) || (!example && /(?:^|\/)\.env(?:\.|$)|\.env$/.test(file))) {
    findings.push(`${file} forbidden-public-file`);
    continue;
  }
  const absolute = path.resolve(root, file);
  if (!staged && !fs.existsSync(absolute)) continue;
  const buffer = staged
    ? execFileSync("git", ["show", ":" + file], { maxBuffer: 8 * 1024 * 1024 })
    : fs.readFileSync(absolute);
  if (buffer.includes(0)) continue; // Binary screenshots/icons are reviewed separately.
  const source = buffer.toString("utf8");
  if (file.endsWith(".md")) {
    for (const link of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = link[1].replace(/^<|>$/g, "").split("#")[0];
      if (!target || /^(?:[a-z]+:|\/)/i.test(target)) continue;
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), decodeURIComponent(target)),
      );
      if (!published.has(resolved)) report(file, source, link.index, "unpublished-relative-link");
    }
  }
  for (const [name, pattern] of strongRules) {
    for (const match of source.matchAll(pattern)) {
      if (name === "url-credentials" && placeholder(match[1])) continue;
      report(file, source, match.index, name);
    }
  }
  const literal =
    /\b(?:api[-_]?key|password|secret|token|registerCode|token[-_]?secret|internal[-_]?key)\s*[:=]\s*(["'`])([^\r\n"'`]{12,})\1/gi;
  for (const match of source.matchAll(literal)) {
    const synthetic =
      /(?:^|\/)(?:tests?|src\/test)(?:\/|$)/.test(file) && reviewedTestValues.has(match[2]);
    if (!placeholder(match[2]) && !synthetic)
      report(file, source, match.index, "review-credential-literal");
  }
}
if (findings.length) {
  console.error("公开内容检查发现待处理项（仅列位置，不输出匹配正文）：\n" + findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `公开内容检查通过：${files.length} 个${staged ? "已暂存" : "候选"}文件；规则扫描不替代人工检查与平台秘密扫描。`,
  );
}
