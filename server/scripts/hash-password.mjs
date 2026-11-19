// 用法：npm run hash -- 你的密码   →  输出 PASSWORD_HASH 环境变量值
import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password || password.length < 8) {
  console.error("用法: npm run hash -- <至少8位的密码>");
  process.exit(1);
}
console.log(bcrypt.hashSync(password, 12));
