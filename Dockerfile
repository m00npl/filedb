FROM oven/bun:1 as base
WORKDIR /usr/src/app

FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile

FROM base AS release
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
COPY --from=install /temp/prod/node_modules node_modules
COPY package.json .
COPY tsconfig.json .
COPY src/ ./src/
COPY public/ ./public/

RUN chmod -R 755 ./src ./public

USER bun
EXPOSE 3000/tcp
ENTRYPOINT [ "bun", "/usr/src/app/src/server.ts" ]