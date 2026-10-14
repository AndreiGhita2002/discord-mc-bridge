FROM node:18-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY typings ./typings
COPY src ./src
RUN npm run build
COPY config.json /app/config.json
# secrets are not baked in: pass them at runtime with `docker run --env-file .env`
CMD ["npm", "run", "start"]
