const { DynamoDB} = require("@aws-sdk/client-dynamodb");
const { marshall } = require("@aws-sdk/util-dynamodb");
const TranscriptionService = require('./transcription-service');
const client = new DynamoDB({ region: "us-west-2" });
const fetch = require('isomorphic-unfetch');

async function updateOutbound(blocks, symptoms, consultId){
  const scanParams = {
    TableName: "consults",
    ExpressionAttributeValues: marshall({
      ":c" : consultId,
    }),
    KeyConditionExpression: "consult_id = :c",
    ProjectionExpression:"start_time",
  };
  const data = await client.query(scanParams);
  const updateParams = {
    TableName: "consults",
    Key: marshall({
      primaryKey: consultId,
      secondaryKey: data.Items[0].start_time.N,
    }),
    UpdateExpression: "SET transcript = :t, SET symptoms = list_append(symptoms, :s)",
    ExpressionAttributeValues: marshall({
      ':t': blocks,
      ':s': symptoms,
    }),
    ReturnValues: "UPDATED_NEW",
  };
  await client.updateItem(updateParams);
}

async function updateInbound(blocks, consultId){
  const scanParams = {
    TableName: "consults",
    ExpressionAttributeValues: marshall({
      ":c" : consultId,
    }),
    KeyConditionExpression: "consult_id = :c",
    ProjectionExpression:"start_time",
  };
  const data = await client.query(scanParams);
  const updateParams = {
    TableName: "consults",
    Key: marshall({
      primaryKey: consultId,
      secondaryKey: data.Items[0].start_time.N,
    }),
    UpdateExpression: "SET transcript = :t",
    ExpressionAttributeValues: marshall({
      ':t': blocks,
    }),
    ReturnValues: "UPDATED_NEW",
  };
  await client.updateItem(updateParams);
}

async function parseSymptoms(text, age) {
  const response = await fetch('https://api.infermedica.com/v3/parse', {
    method: 'POST',
    headers: {
      "App-Id": process.env.INFERMEDICA_APP_ID,
      "App-Key": process.env.INFERMEDICA_APP_KEY,
      "Content-Type":"application/json"
    },
    body: JSON.stringify({
      age: { value: age },
      text: text,
    }),
  });
  if (response.status >= 400 && response.status < 600) {
    throw new Error(response);
  }
  return response;
}

class MediaStreamHandler {
  constructor(connection, connectionId) {
    this.connectionId = connectionId;
    this.callSid = null;
    this.consultId = null;
    this.age = null;
    this.trackHandlers = {};
    this.blocks = [];
    this.out_index = -1;
    this.in_index = -1;
    connection.on('message', this.processMessage.bind(this));
    connection.on('close', this.close.bind(this));
  }

  normalizeWord(currentWord) {
    const { startTime, word } = currentWord;
    const { seconds, nanos } = startTime;
    return {
      start: seconds * 1000 + nanos / 1000000,
      end: seconds * 1000 + nanos / 1000000,
      text: word.trim() + ' ',
    };
  }
  processMessage(message) {
    if (message.type !== 'utf8') {
      console.log(`Media WS: ${message.type} message received (not supported)`);
      return;
    }

    const data = JSON.parse(message.utf8Data);
    if (data.event === 'start') {
      this.callSid = data.start.callSid;
      this.age = data.start.customParameters.age;
      this.consultId = data.start.customParameters.consult_id;
    }
    if (data.event !== 'media') return;

    const { track } = data.media;
    if (this.trackHandlers[track] === undefined) {
      const service = new TranscriptionService();
      service.on('transcription', (transcription) => {
        transcription = JSON.parse(transcription);
        if (transcription.words.length > 0) {
          const newWords = [];
          transcription.words.forEach((word) => {
            newWords.push(this.normalizeWord(word));
          });
          const block = {
            start: newWords[0].start,
            fullText: transcription.transcript.trim() + ' ',
            type: 'message',
            children: newWords,
            speaker: track,
          };
          this.blocks.push(block);
          this.blocks.sort((a,b)=>(a.start > b.start) ? 1 : -1);
          //inbound is the doctor so we only process outbound messages through infermedica
          if(track === "outbound") {
            parseSymptoms(transcription.transcript.trim(), this.age).then(response => {
              response.json().then(r => {
                const symptoms = r.mentions;
                updateOutbound(this.blocks, symptoms, this.consultId).then(r => console.log(r));
              });
            });
          }else{
            updateInbound(this.blocks, this.consultId).then(r => console.log(r));
          }

        }
      });
      this.trackHandlers[track] = service;
    }
    this.trackHandlers[track].send(data.media.payload);
  }

  async updateClient() {
    
  }

  close() {
    for (let track of Object.keys(this.trackHandlers)) {
      console.log(`Closing ${track} handler`);
      this.trackHandlers[track].close();
    }
  }
}

module.exports = MediaStreamHandler;
