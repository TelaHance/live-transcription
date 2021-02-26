FROM node:current-alpine AS build

WORKDIR /srv
COPY /keys /srv/keys/
COPY .env /srv/
COPY package*.json /srv/
RUN npm ci
COPY tsconfig.json /srv/
COPY src /srv/src/
RUN npm run tsc
RUN npm ci --production

FROM alpine:3
RUN apk add python make g++ nodejs --no-cache
WORKDIR /srv
COPY --from=build /srv/node_modules /srv/node_modules
COPY --from=build /srv/dist /srv/

CMD node index.js

# # Additional sdk requirements not include in alpine Linux disto.
# RUN apk update && apk add python make g++ && rm -rf /var/cache/apk/*

# COPY package.json /usr/src/live-transcription/package.json
# COPY yarn.lock /usr/src/live-transcription/yarn.lock
# WORKDIR /usr/src/live-transcription
# RUN ["yarn", "install"]

# COPY . /usr/src/live-transcription

# EXPOSE 443
# CMD ["yarn", "start"]