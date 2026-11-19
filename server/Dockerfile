# 构建上下文必须是项目根目录（calendar/），因为要共用 src/lib 的校验模块：
#   cd calendar && docker build -f server/Dockerfile -t calendar-sync .
FROM node:22-alpine

WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/tsconfig.json ./
COPY server/src ./src
COPY server/scripts ./scripts
COPY src/lib /app/src/lib

ENV NODE_ENV=production
EXPOSE 8788

CMD ["npx", "--no-install", "tsx", "src/index.ts"]
