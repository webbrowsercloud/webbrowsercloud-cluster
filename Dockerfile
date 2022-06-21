# ===== build ===== #
FROM node:16 as build

WORKDIR /app

# 拷贝 package 文件
COPY yarn.lock ./yarn.lock
COPY package.json ./package.json

# 安装依赖
RUN yarn install

# 拷贝并编译代码
COPY ./ ./
RUN yarn build

# ===== runtime ===== #
FROM node:16-alpine as runtime

# 设置环境变量
ENV NODE_ENV production

# 设置工作目录
WORKDIR /app

# 复制文件
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/dist/ ./dist/

# 暴露端口
EXPOSE 3000

CMD [ "npm", "start" ]
