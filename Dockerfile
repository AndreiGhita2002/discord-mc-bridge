FROM node:22-alpine AS build
WORKDIR /app
COPY package.json yarn.lock tsconfig.json ./
RUN yarn install --frozen-lockfile
COPY typings ./typings
COPY src ./src
RUN yarn build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean
COPY --from=build /app/build ./build
# config.json is mounted at /app/config.json and secrets come from the environment (env_file)
CMD ["node", "build/index.js"]
