import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // file:// 加载（Electron 打包后）需要相对路径资源引用
  base: "./",
  plugins: [react()],
  server: {
    proxy: {
      // 开发时把 /api 代理到本地同步服务器，前端永远用同源相对路径
      "/api": "http://localhost:8788",
    },
    // Windows 后台启动时文件事件监听偶发丢失（表现为改了代码页面不更新），轮询兜底
    watch: { usePolling: true },
  },
});
