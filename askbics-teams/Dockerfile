FROM node:22-bookworm-slim AS build
WORKDIR /workspace
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY src ./src
COPY style ./style
WORKDIR /workspace/askbics-teams
COPY askbics-teams/package*.json ./
RUN npm ci --ignore-scripts
COPY askbics-teams/tsconfig.json ./
COPY askbics-teams/src ./src
COPY askbics-teams/app ./app
COPY askbics-teams/scripts ./scripts
COPY askbics-teams/tab ./tab
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY askbics-teams/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /workspace/askbics-teams/dist ./dist
COPY --from=build /workspace/askbics-teams/tab ./tab
COPY askbics-teams/config ./config
RUN mkdir -p /app/data/reports && chown -R node:node /app/data
USER node
EXPOSE 3978
CMD ["node", "dist/src/teams.js"]
