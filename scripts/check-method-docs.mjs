import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import javaPlugin from "prettier-plugin-java";

const sourceRoots = [
  "src",
  "server/src",
  "server/scripts",
  "server/tests",
  "server/deploy",
  "electron",
  "scripts",
  "tests",
  "cloud",
];
const ignoredDirectories = new Set(["node_modules", "target", "__pycache__", "state", "snapshots"]);
const generatedFiles = new Set([
  "electron/timelines.cjs",
  "electron/birthdayRules.cjs",
  "electron/aiPlans.cjs",
]);
const failures = [];
let checked = 0;

/** 递归收集手写代码文件，跳过依赖、构建结果、快照及服务器状态目录。 */
function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return [];
    const file = path.posix.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(file) : generatedFiles.has(file) ? [] : [file];
  });
}

/** 判断声明前是否紧邻 JSDoc，避免把其他方法或普通块注释误当作当前方法的说明。 */
function hasLeadingDoc(source, position) {
  const start = source.lastIndexOf("/**", position);
  if (start < 0) return false;
  const end = source.indexOf("*/", start + 3);
  return end >= 0 && end < position && source.slice(end + 2, position).trim() === "";
}

/** 记录具名方法的注释检查结果，失败时报告可直接定位的文件行号。 */
function checkDeclaration(file, source, position, line, name, documented = false) {
  checked++;
  if (!documented && !hasLeadingDoc(source, position)) {
    failures.push(`${file}:${line} ${name}`);
  }
}

/** 通过 TypeScript 语法树检查函数、构造方法、接口方法、箭头函数及具名 Hook 回调。 */
function checkTypeScript(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);

  /** 把声明及其注释所属节点转换为统一的检查记录。 */
  function check(node, anchor = node, name = node.name?.getText(ast) ?? "constructor") {
    const position = anchor.getStart(ast);
    checkDeclaration(
      file,
      source,
      position,
      ast.getLineAndCharacterOfPosition(position).line + 1,
      name,
      Boolean(anchor.jsDoc?.length),
    );
  }

  /** 递归检查具名声明；行内匿名回调交由其所属方法的说明解释。 */
  function visit(node) {
    if (ts.isFunctionDeclaration(node)) {
      check(node, node, node.name?.text ?? "default export");
    } else if (
      ts.isMethodDeclaration(node) ||
      ts.isMethodSignature(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isConstructorDeclaration(node)
    ) {
      check(node);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const value = node.initializer;
      if (
        ts.isArrowFunction(value) ||
        ts.isFunctionExpression(value) ||
        (ts.isCallExpression(value) && /(?:^|\.)useCallback$/.test(value.expression.getText(ast)))
      ) {
        check(
          node,
          ts.isVariableStatement(node.parent.parent) ? node.parent.parent : node,
          node.name.text,
        );
      }
    } else if (
      (ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      check(node);
    } else if (ts.isPropertySignature(node) && node.type && ts.isFunctionTypeNode(node.type)) {
      check(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(ast);
}

/** 使用与 Java 格式化工具相同的解析器，检查普通方法、构造方法及接口声明。 */
async function checkJava(file, source) {
  const ast = await javaPlugin.parsers.java.parse(source, {});

  /** 遍历 Java 声明，Javadoc 应位于方法注解和修饰符之前。 */
  function visit(node) {
    if (
      ["method_declaration", "constructor_declaration", "compact_constructor_declaration"].includes(
        node.type,
      )
    ) {
      const name =
        node.children.find((child) => child.fieldName === "name")?.value ?? "constructor";
      checkDeclaration(file, source, node.start.index, node.start.row + 1, name);
    }
    for (const child of node.children ?? []) visit(child);
  }

  visit(ast);
}

/** 检查 Shell 函数声明前是否有用途说明，忽略只有顺序命令的脚本。 */
function checkShell(file, source) {
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = /^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\s*\)\s*\{/.exec(line);
    if (!match) return;
    checked++;
    let previous = index - 1;
    while (previous >= 0 && !lines[previous].trim()) previous--;
    if (previous < 0 || !lines[previous].trim().startsWith("#"))
      failures.push(`${file}:${index + 1} ${match[1]}`);
  });
}

for (const file of [...sourceRoots.flatMap(collectFiles), "vite.config.ts"]) {
  const source = fs.readFileSync(file, "utf8");
  if (/\.(?:tsx?|[cm]js)$/.test(file)) checkTypeScript(file, source);
  else if (file.endsWith(".java")) await checkJava(file, source);
  else if (file.endsWith(".sh")) checkShell(file, source);
}

if (failures.length) {
  console.error("以下具名方法缺少用途注释：\n" + failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`方法注释检查通过：${checked} 个声明（Java / TypeScript / JavaScript / Shell）。`);
  console.log("Python 函数请另运行 npm run comments:check:python。");
}
