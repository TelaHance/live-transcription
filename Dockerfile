FROM node:current-alpine

# Additional sdk requirements not include in alpine Linux disto.
RUN apk update && apk add python make g++ && rm -rf /var/cache/apk/*

WORKDIR /usr/src/live-transcription
COPY . .
RUN ["yarn", "install"]

EXPOSE 80
CMD ["yarn", "start"]