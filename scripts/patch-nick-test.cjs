const fs = require("fs");
const p = "server/tests/api.test.ts";
let s = fs.readFileSync(p, "utf8");
const from = `  // 账号列表接口
  const accountsRes = await fetch(\`\${base}/api/accounts\`, { headers: { authorization: \`Bearer \${token}\` } });
  const accounts = (await accountsRes.json()) as { usernames: string[] };
  assert.ok(accounts.usernames.includes("老咪") && accounts.usernames.includes("family"));`;
const to = `  // 账号列表接口（含昵称）+ 昵称修改
  const accountsRes = await fetch(\`\${base}/api/accounts\`, { headers: { authorization: \`Bearer \${token}\` } });
  const accounts = (await accountsRes.json()) as { users: Array<{ username: string; nickname: string | null }>; self: { username: string } };
  assert.ok(accounts.users.some((u) => u.username === "老咪") && accounts.users.some((u) => u.username === "family"));
  assert.equal(accounts.self.username, "老咪");
  const nick = await fetch(\`\${base}/api/profile\`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: \`Bearer \${token}\` },
    body: JSON.stringify({ nickname: "咪哥" }),
  });
  assert.equal(nick.status, 200);
  const accounts2 = (await (
    await fetch(\`\${base}/api/accounts\`, { headers: { authorization: \`Bearer \${token}\` } })
  ).json()) as { users: Array<{ username: string; nickname: string | null }> };
  assert.equal(accounts2.users.find((u) => u.username === "老咪")?.nickname, "咪哥");`;
if (!s.includes(from)) {
  console.error("target not found");
  process.exit(1);
}
fs.writeFileSync(p, s.replace(from, to));
console.log("test updated");
