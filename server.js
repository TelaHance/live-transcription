'use strict';
require('dotenv').load();

const fs = require('fs');
const https = require('https');
const fetch = require('isomorphic-unfetch');
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

async function run() {
  const sqs = new SQSClient({ region: REGION });
  const response = await sqs.send(new ReceiveMessageCommand(receieveParams));
  const data = JSON.parse(response);
  const { connectionId } = data.Messages[0].Body;
  console.log(connectionId);

  const wsserver = https.createServer({
    key: fs.readFileSync('./keys/privkey.pem'),
    cert: fs.readFileSync('./keys/cert.pem'),
  });

  const mediaws = new WebSocketServer({
    httpServer: wsserver,
    autoAcceptConnections: true,
  });

  mediaws.on('connect', function (connection) {
    console.log('Media WS: Connection accepted');
    new MediaStreamHandler(connection, connectionId);
  });

  mediaws.on('close', function close() {
    console.log('Media WS: Connection closed');
    wsserver.close();
  });

  const HTTP_SERVER_PORT = 443;
  wsserver.listen(HTTP_SERVER_PORT, () =>
    console.log(`Server listening on: http://localhost:${HTTP_SERVER_PORT}`)
  );
}

run();
