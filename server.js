'use strict';
require('dotenv').load();

const http = require('http');
const WebSocketServer = require('websocket').server;
const TranscriptionService = require('./transcription-service');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');

const HTTP_SERVER_PORT = 8080;

const wsserver = http.createServer();
const dynamoDb = new DynamoDBClient();

function log(message, ...args) {
  console.log(new Date(), message, ...args);
}

const mediaws = new WebSocketServer({
  httpServer: wsserver,
  autoAcceptConnections: true,
});

mediaws.on('connect', function (connection) {
  log('Media WS: Connection accepted');
  new MediaStreamHandler(connection);
});

mediaws.on('close', function close() {
  log('Media WS: Connection closed');
  wsserver.close();
});

class MediaStreamHandler {
  constructor(connection) {
    this.callSid = null;
    this.consultId = null;
    this.trackHandlers = {};
    connection.on('message', this.processMessage.bind(this));
    connection.on('close', this.close.bind(this));
  }

  processMessage(message) {
    if (message.type !== 'utf8') {
      log(`Media WS: ${message.type} message received (not supported)`);
      return;
    }

    const data = JSON.parse(message.utf8Data);
    if (data.event === 'start') {
      this.callSid = data.start.callSid;
      this.consultId = data.start.customParameters.consult_id;
    }
    if (data.event !== 'media') return;

    const { track } = data.media;
    if (this.trackHandlers[track] === undefined) {
      const service = new TranscriptionService();
      service.on('transcription', (transcription) => {
        log(`Transcription (${track}): ${transcription}`);
      });
      this.trackHandlers[track] = service;
    }
    this.trackHandlers[track].send(data.media.payload);
  }

  close() {
    for (let track of Object.keys(this.trackHandlers)) {
      log(`Closing ${track} handler`);
      this.trackHandlers[track].close();
    }
  }
}

wsserver.listen(HTTP_SERVER_PORT, () =>
  console.log(`Server listening on: http://localhost:${HTTP_SERVER_PORT}`)
);
