const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const output = path.resolve(__dirname, "../release/ai-rag");
app.setPath("userData", fs.mkdtempSync(path.join(require("node:os").tmpdir(), "calendar-ai-ui-")));
/** 在隔离窗口中轮询断言，超时返回明确失败，不改变真实客户端数据。 */
async function wait(win, expression) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("UI wait timed out: " + expression);
}
/** 利用真实输入事件更新 React 表单。 */
async function input(win, selector, value) {
  await win.webContents.executeJavaScript(
    `{ const el=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); }`,
  );
}
/** 通过可见文案点击按钮，避免依赖实现内的状态。 */
async function click(win, text) {
  await win.webContents.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`,
  );
}
/** 验证显式调用、草稿确认、引用跳转、故障保留与迟到响应丢弃。 */
async function run() {
  const win = new BrowserWindow({
    show: false,
    width: 1160,
    height: 980,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  const errors = [];
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") errors.push(details.message);
  });
  await win.loadURL("http://127.0.0.1:5188/tests/ui/ai.html");
  await click(win, "AI 小助手");
  await wait(win, "!!document.querySelector('dialog[open]')");
  await input(win, "textarea", "明天下午三点和小王开项目会，预计90分钟，晚上买牛奶");
  assert.equal(await win.webContents.executeJavaScript("window.aiFixture.calls"), 0);
  await win.webContents.executeJavaScript("document.querySelector('.ai-consent input').click()");
  await wait(
    win,
    "!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='生成计划草稿').disabled",
  );
  await click(win, "生成计划草稿");
  await wait(win, "document.querySelectorAll('.ai-card').length===2");
  assert.equal(
    await win.webContents.executeJavaScript(
      "document.querySelectorAll('.ai-card input[type=checkbox]:checked').length",
    ),
    1,
  );
  fs.writeFileSync(
    path.join(output, "ai-desktop.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  win.setSize(430, 900);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(
    await win.webContents.executeJavaScript(
      "document.querySelector('dialog').scrollWidth<=document.querySelector('dialog').clientWidth",
    ),
    true,
  );
  fs.writeFileSync(
    path.join(output, "ai-mobile.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  await win.webContents.executeJavaScript(
    "localStorage.setItem('calendar.sync.token','different-session')",
  );
  await click(win, "确认所选并保存计划");
  await wait(win, "document.body.textContent.includes('登录账号已变化')");
  assert.equal(await win.webContents.executeJavaScript("window.aiFixture.saved.length"), 0);
  await win.webContents.executeJavaScript(
    "localStorage.setItem('calendar.sync.token','fake-test-token')",
  );
  await click(win, "确认所选并保存计划");
  await wait(win, "window.aiFixture.saved.length===1");
  assert.equal(
    await win.webContents.executeJavaScript("window.aiFixture.saved[0].items.length"),
    1,
  );
  await click(win, "问问日记");
  await input(win, "textarea", "项目部署问题怎么解决的？");
  await input(win, ".ai-dialog > label input:not([type])", "项目 部署");
  await click(win, "查找并回答");
  await wait(win, "!!document.querySelector('.ai-result h3')");
  await click(win, "打开日记原文");
  await wait(win, "!document.querySelector('dialog[open]')");
  assert.equal(await win.webContents.executeJavaScript("window.aiFixture.opened"), "2026-11-18");
  await click(win, "AI 小助手");
  await click(win, "一句话写计划");
  await input(win, "textarea", "保留这条输入");
  await win.webContents.executeJavaScript("window.aiFixture.fail=true");
  await click(win, "生成计划草稿");
  await wait(win, "document.body.textContent.includes('模拟网络故障')");
  assert.equal(
    await win.webContents.executeJavaScript("document.querySelector('textarea').value"),
    "保留这条输入",
  );
  await win.webContents.executeJavaScript(
    "window.aiFixture.fail=false; window.aiFixture.delay=true",
  );
  await click(win, "生成计划草稿");
  await wait(win, "!!window.aiFixture.release");
  await win.webContents.executeJavaScript(
    "localStorage.setItem('calendar.sync.token','different-session'); window.aiFixture.release()",
  );
  await wait(win, "document.body.textContent.includes('登录账号已变化')");
  assert.equal(
    await win.webContents.executeJavaScript("document.querySelectorAll('.ai-card').length"),
    0,
  );
  await win.webContents.executeJavaScript("window.aiFixture.release=undefined");
  await click(win, "生成计划草稿");
  await wait(win, "!!window.aiFixture.release");
  await win.webContents.executeJavaScript(
    "document.querySelector('[aria-label=\"关闭 AI 助手\"]').click(); window.aiFixture.release()",
  );
  await wait(win, "!document.querySelector('dialog[open]')");
  assert.equal(
    await win.webContents.executeJavaScript("document.querySelectorAll('.ai-card').length"),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "AI UI passed: explicit calls, preview, batch save, sources, errors, session guard, mobile layout",
  );
  win.close();
}
app
  .whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
