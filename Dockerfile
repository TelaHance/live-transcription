FROM node:current-alpine AS build

# additional sdk requirements not included in alpine linux disto.
RUN apk update && apk add curl bash python g++ make && rm -rf /var/cache/apk/*

WORKDIR /srv
COPY package.json yarn.lock tsconfig.json ./
RUN yarn --frozen-lockfile

# Use below if using Typescript (copy from ./dist in second layer)
# COPY ./src ./src
# create /dist folder from compiled .js and .ts in /src
# RUN yarn tsc

# remove development dependencies
RUN npm prune --production

# remove unnecessary files and folders in node_modules
RUN npx clean-modules --include "**/*.d.ts" --include "**/@types" --exclude "**/googleapis/**/docs/**" 

FROM node:current-alpine
WORKDIR /srv
COPY --from=build /srv/node_modules ./node_modules
COPY package.json .env google_creds.json ./
COPY ./keys ./keys
COPY ./src ./src

EXPOSE 443
CMD yarn start