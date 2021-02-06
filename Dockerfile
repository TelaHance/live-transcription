FROM node:current-alpine

# Additional sdk requirements not include in alpine Linux disto.
RUN apk update && apk add python make g++ && rm -rf /var/cache/apk/*

COPY package.json /usr/src/live-transcription/package.json
COPY yarn.lock /usr/src/live-transcription/yarn.lock
WORKDIR /usr/src/live-transcription
RUN ["yarn", "install"]

COPY . /usr/src/live-transcription

EXPOSE 443
CMD ["yarn", "start"]