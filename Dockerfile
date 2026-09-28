FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data

COPY package.json server.js ./
COPY public/ public/

RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
