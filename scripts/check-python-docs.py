"""只解析源码，检查 Python 辅助函数的文档字符串；不会执行部署脚本。"""

import ast
from pathlib import Path


def check_functions(path):
    """检查指定源文件的所有同步与异步函数，返回数量及缺少文档的声明。"""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    functions = [
        node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]
    missing = [
        f"{path.as_posix()}:{node.lineno} {node.name}"
        for node in functions
        if not ast.get_docstring(node)
    ]
    return len(functions), missing


def main():
    """扫描项目内手写 Python 文件，报告遗漏并以退出码标识检查结果。"""
    root = Path(__file__).resolve().parents[1]
    paths = sorted((root / "cloud").rglob("*.py")) + sorted((root / "scripts").glob("*.py"))
    total = 0
    failures = []
    for path in paths:
        if any(
            part in {"__pycache__", "target", "node_modules", "state", "snapshots"}
            for part in path.parts
        ):
            continue
        count, missing = check_functions(path)
        total += count
        failures.extend(missing)
    if failures:
        raise SystemExit("以下 Python 函数缺少文档字符串：\n" + "\n".join(failures))
    print(f"Python 方法注释检查通过：{total} 个声明。")


if __name__ == "__main__":
    main()
