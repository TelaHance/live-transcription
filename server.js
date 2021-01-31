"use strict";
require('dotenv').load();

const fs = require('fs');
const path = require('path');
const http = require('http');
const HttpDispatcher = require('httpdispatcher');
const WebSocketServer = require('websocket').server;
const TranscriptionService = require('./transcription-service');
const dispatcher = new HttpDispatcher();
const wsserver = http.createServer(handleRequest);
const aws = require("@aws-sdk/client-dynamodb");

const HTTP_SERVER_PORT = 8080;
// const docClient = new aws.DynamoDB.DocumentClient();

function log(message, ...args) {
  console.log(new Date(), message, ...args);
}

const mediaws = new WebSocketServer({
  httpServer: wsserver,
  autoAcceptConnections: true,
});

// function insertDB(){
//   const params = {
//     TableName: "MYTABLE",
//     Key: {
//       "id": "1"
//     },
//     UpdateExpression: "set variable1 = :x, #MyVariable = :y",
//     ExpressionAttributeNames: {
//       "#MyVariable": "variable23"
//     },
//     ExpressionAttributeValues: {
//       ":x": "hello2",
//       ":y": "dog"
//     }
//   };
//
//   docClient.update(params, function(err, data) {
//     if (err) console.log(err);
//     else console.log(data);
//   });
// }

function handleRequest(request, response){
  try {
    fs.writeFileSync("request.json", JSON.stringify(request));
    dispatcher.dispatch(request, response);
  } catch(err) {
    console.error(err);
  }
}

mediaws.on('connect', function(connection) {
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

  processMessage(message){
    if (message.type === 'utf8') {
      const data = JSON.parse(message.utf8Data);
      if (data.event === "start") {
        this.callSid = data.start.callSid;
      }
      if (data.event !== "media") {
        return;
      }
      const track = data.media.track;
      if (this.trackHandlers[track] === undefined) {
        const service = new TranscriptionService();
        service.on('transcription', (transcription) => {
          log(`Transcription (${track}): ${transcription}`);
        });
        this.trackHandlers[track] = service;
      }
      this.trackHandlers[track].send(data.media.payload);
    } else if (message.type === 'binary') {
      log('Media WS: binary message received (not supported)');
    }
  }

  close(){
    log('Media WS: closed');

    for (let track of Object.keys(this.trackHandlers)) {
      log(`Closing ${track} handler`);
      this.trackHandlers[track].close();
    }
  }
}

wsserver.listen(HTTP_SERVER_PORT, function(){
  console.log("Server listening on: http://localhost:%s", HTTP_SERVER_PORT);
});
