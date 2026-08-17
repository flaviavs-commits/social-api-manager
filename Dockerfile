FROM node:20-alpine

WORKDIR /app

# O container de produção nunca deve herdar o fallback de desenvolvimento do
# código caso a plataforma não injete NODE_ENV automaticamente.
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "src/server.js"]
