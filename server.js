require('dotenv').load();
const fs = require('fs');
const https = require('https');
const WebSocketServer = require('websocket').server;
const { SQSClient, ReceiveMessageCommand } = require('@aws-sdk/client-sqs');
const TelahanceService = require('./TelahanceService');

const REGION = 'us-west-2';
const QUEUE_URL =
  'https://sqs.us-west-2.amazonaws.com/113657999858/WebsocketQueue.fifo';

const receieveParams = {
  MaxNumberOfMessages: 1,
  QueueUrl: QUEUE_URL,
  VisibilityTimeout: 10,
  WaitTimeSeconds: 0,
};

async function run() {
  const sqs = new SQSClient({ region: REGION });
  const response = await sqs.send(new ReceiveMessageCommand(receieveParams));
  if (response.Messages.length === 0) {
    throw new Error(
      'Error retrieving messages from the SQS Queue: Wait time (10 seconds) expired.'
    );
  }
  const { connectionId } = JSON.parse(response.Messages[0].Body);

  const wsserver = https.createServer({
    key: fs.readFileSync('./keys/privkey.pem'),
    cert: fs.readFileSync('./keys/cert.pem'),
  });

  const mediaws = new WebSocketServer({
    httpServer: wsserver,
    autoAcceptConnections: true,
  });

  // Close server if Twilio does not connect within 1 minute.
  const timeout = setTimeout(() => {
    console.log('[ Twilio ] Failed to connect... closing server');
    wsserver.close();
  }, 60000);

  mediaws.on('connect', function (connection) {
    clearTimeout(timeout);
    console.log('[ Twilio ] Connection accepted');
    new TelahanceService(connection, connectionId);
  });

  mediaws.on('close', function close() {
    console.log('[ Twilio ] Connection closed');
    wsserver.close();
  });

  const HTTP_SERVER_PORT = 443;
  wsserver.listen(HTTP_SERVER_PORT, () =>
    console.log(`Server listening on: http://localhost:${HTTP_SERVER_PORT}`)
  );
}

run();
