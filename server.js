require('dotenv').load();
const fs = require('fs');
const https = require('https');
const express = require('express');
const bodyParser = require('body-parser');
const WSServer = require('ws').Server;
const { SQS } = require('./handlers');
const TelahanceService = require('./TelahanceService');

const PORT = 443;
const CERT = {
  key: fs.readFileSync('./keys/privkey.pem', 'ascii'),
  cert: fs.readFileSync('./keys/fullchain.pem', 'ascii'),
};

const service = new TelahanceService();

// Create http server for Twilio call events

const app = express();

app.use(bodyParser.urlencoded({ extended: true }));

app.post('/events', (req, res) => {
  service.onCallEvent(req.body);
  res.status(200).send();
});

// Main function for application

async function run() {
  const connectionId = await SQS.getConnectionId();

  const server = https.createServer(CERT);
  const wss = new WSServer({ server });

  // Mount app for normal https requests.
  server.on('request', app);

  const waitTime = 5; // in minutes
  const timeout = setTimeout(() => {
    console.log(
      `[ Server ] Twilio connection not found... waited for ${waitTime} minutes`
    );
    console.log(
      `[ Server ] Probable cause: Call not started by client within ${waitTime} minutes after viewing appointments page`
    );
    console.log(`[ Server ] Closing server`);
    wss.close();
  }, waitTime * 60000);

  wss.on('connection', (ws) => {
    clearTimeout(timeout);
    console.log('[ Server ] Connected to Twilio Websocket');
    service.connect(ws, connectionId);
    ws.on('close', () => {
      console.log('[ Server ] Disconnected from Twilio Websocket');
      wss.close();
    });
  });

  server.listen(PORT, () => console.log(`[ Server ] Listening on ${PORT}...`));
}

run();
