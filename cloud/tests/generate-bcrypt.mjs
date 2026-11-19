import fs from "node:fs";
import bcrypt from "../../server/node_modules/bcryptjs/index.js";
const passwords = ["ascii-password", "中文".repeat(20) + "密码", "a".repeat(71) + "中"];
const fixtures = passwords.map((password) => ({
  password,
  hash: bcrypt.hashSync(password, "$2b$10$abcdefghijklmnopqrstuu"),
}));
fs.mkdirSync("cloud/user-service/src/test/resources", { recursive: true });
fs.writeFileSync(
  "cloud/user-service/src/test/resources/bcrypt-compat.json",
  JSON.stringify(fixtures, null, 2) + "\n",
);
