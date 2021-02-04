'use strict';
require('dotenv').load();

const http = require('http');
const WebSocketServer = require('websocket').server;
const {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} = require('@aws-sdk/client-sqs');
const MediaStreamHandler = require('./MediaStreamHandler');

const REGION = 'us-west-2';
const QUEUE_URL =
  'https://sqs.us-west-2.amazonaws.com/113657999858/WebsocketQueue.fifo';

const receieveParams = {
  MaxNumberOfMessages: 1,
  QueueUrl: QUEUE_URL,
  VisibilityTimeout: 20,
  WaitTimeSeconds: 0,
};

function log(message, ...args) {
  console.log(new Date(), message, ...args);
}

async function run() {
  const sqs = new SQSClient({ region: REGION });
  const data = await sqs.send(new ReceiveMessageCommand(receieveParams));
  log(data);

  const wsserver = http.createServer();

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

  const HTTP_SERVER_PORT = 80;
  wsserver.listen(HTTP_SERVER_PORT, () =>
    console.log(`Server listening on: http://localhost:${HTTP_SERVER_PORT}`)
  );
}

run();