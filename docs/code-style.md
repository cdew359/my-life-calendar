# 代码格式与方法注释

项目统一使用 UTF-8 和 LF 换行。TypeScript / JavaScript 使用两空格、双引号和分号；Java / Python 使用四空格。Prettier 负责网页、桌面端、Node、Java、XML、YAML 和 Shell，Black 负责 Python。

## 常用命令

在 `calendar` 目录安装开发依赖后运行：

```sh
npm run format
npm run format:check
npm run comments:check
```

Python 辅助脚本需要 Python 3.10 或更高版本，先安装 `requirements-dev.txt`：

```sh
python -m pip install -r requirements-dev.txt
npm run format:python
npm run format:check:python
npm run comments:check:python
```

IDEA、VS Code 等编辑器可读取项目根目录的 `.editorconfig`。使用 Prettier 编辑器插件时，选择项目中的版本及 `.prettierrc.json`，避免全局配置产生另一套格式。

## 注释约定

- Java 方法、构造方法及接口方法使用 Javadoc，放在 `@Bean`、`@Override` 等方法注解之前。
- TypeScript / JavaScript 的具名函数、箭头函数、类方法、接口回调和具名 `useCallback` 回调使用 JSDoc。
- Python 函数使用函数体第一行的文档字符串；Shell 函数在声明前写用途说明。
- 注释解释方法的用途、返回结果及必要的约束。账号隔离、版本冲突、事务锁、同步兼容、跨天排程和索引补偿需要说明关键行为。
- 简单方法保留简短说明；复杂方法按需要添加参数、返回值和异常说明，避免重复类型声明或逐行翻译代码。
- `map`、事件绑定等行内匿名回调由所属方法说明覆盖，复杂分支再加局部注释。

检查范围包括网页端、Electron、Node 后端、Java 后端、测试及辅助脚本。依赖目录、构建产物、数据快照和私有配置不参与整理。`electron/timelines.cjs` 由 `src/lib/timelines.ts` 自动生成，修改源文件后通过构建更新，不直接维护生成文件。

## 本次验证

完成格式检查、714 个具名声明的注释检查、前端 91 项测试、Node 17 项本地测试、Java 11 项测试及 Python 内存保护 6 项测试，前后端类型检查和网页构建通过。Node 中依赖真实 PostgreSQL / MySQL / Elasticsearch 的 2 项集成测试在本地跳过。

对整理前已有的 123 个 Java / TypeScript / JavaScript 源文件进行了语法结构比对；忽略括号、属性名引号、Java 分隔逗号及 JSX 相邻文本的等价排版后，未发现逻辑变化。Python 注释插入前后也通过了语法树比对。
