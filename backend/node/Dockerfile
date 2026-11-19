# Construir desde la carpeta backend/:  docker build -f node/Dockerfile -t xuacha-api .
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY node ./node
COPY supabase/functions/_shared ./supabase/functions/_shared
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
USER node
CMD ["npx", "tsx", "node/server.ts"]
