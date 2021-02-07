const fetch = require('isomorphic-unfetch');
const { DynamoDB } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} = require('@aws-sdk/client-apigatewaymanagementapi');
const TranscriptionService = require('./transcription-service');

const client = new DynamoDB({ region: 'us-west-2' });
const websocket = new ApiGatewayManagementApiClient({ region: 'us-west-2' });

async function updateDynamoDB(consultId, blocks, symptoms) {
  const queryParams = {
    TableName: 'consults',
    ExpressionAttributeValues: marshall({
      ':c': consultId,
    }),
    KeyConditionExpression: 'consult_id = :c',
    ProjectionExpression: 'start_time',
  };
  const data = await client.query(queryParams);

  console.log(unmarshall(data.Items[0]));

  const updateParams = {
    TableName: 'consults',
    Key: marshall({
      primaryKey: consultId,
      secondaryKey: data.Items[0].start_time.N,
    }),
    UpdateExpression:
      'SET transcript = :t, SET symptoms = list_append(symptoms, :s)',
    ExpressionAttributeValues: marshall({ ':t': blocks }),
    ReturnValues: 'UPDATED_NEW',
  };

  if (symptoms) {
    updateParams.UpdateExpression +=
      ', SET symptoms = list_append(symptoms, :s)';
    updateParams.ExpressionAttributeValues = marshall({
      ':t': blocks,
      ':s': symptoms,
    });
  }

  return client.updateItem(updateParams);
}

async function updateClient(connectionId, idx, block, symptoms) {
  const command = new PostToConnectionCommand({
    ConnectionId: connectionId,
    Data: JSON.stringify({ idx, block, symptoms }),
  });
  return websocket.send(command);
}

async function parseSymptoms(text, age) {
  const response = await fetch('https://api.infermedica.com/v3/parse', {
    method: 'POST',
    headers: {
      'App-Id': process.env.INFERMEDICA_APP_ID,
      'App-Key': process.env.INFERMEDICA_APP_KEY,
      'Content-Type': 'application/json',
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

function normalizeWord(currentWord) {
  const { startTime, word } = currentWord;
  const { seconds, nanos } = startTime;
  return {
    start: seconds * 1000 + nanos / 1000000,
    end: seconds * 1000 + nanos / 1000000,
    text: word.trim() + ' ',
  };
}

function transcriptToWords(transcript) {
  return transcript.split(' ').map((word) => {
    return {
      text: word + ' ',
    };
  });
}

class MediaStreamHandler {
  constructor(connection, connectionId) {
    this.connectionId = connectionId;
    this.callSid = null;
    this.consultId = null;
    this.age = null;
    this.trackHandlers = {};
    this.blocks = [];
    this.currTrack = '';
    this.counter = -1;
    this.queues = { inbound: [], outbound: [] };
    connection.on('message', this.processMessage.bind(this));
    connection.on('close', this.close.bind(this));
  }

  addBlock(block) {
    if (this.queues[block.speaker].length === 0)
      throw new Error('Index queue empty in MediaStreamHandler');
    const idx = this.queues[block.speaker].shift();
    this.blocks[idx] = block;
    return idx;
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
      service.on('transcription', async (transcription) => {
        const { words, transcript } = JSON.parse(transcription);
        if (words.length > 0) {
          const block = this.parseFull(words, transcript.trim());
          const idx = this.addBlock(block);
          //inbound is the doctor so we only process outbound messages through infermedica
          let symptoms;
          if (track === 'outbound') {
            const response = await parseSymptoms(transcript, this.age);
            symptoms = JSON.parse(response).mentions;
          }
          updateDynamoDB(this.consultId, this.blocks, symptoms);
          updateClient(this.connectionId, idx, block, symptoms);
        } else {
          const block = this.parsePartial(track, transcript.trim());
          const idx = this.queues[track][0];
          updateClient(this.connectionId, idx, block);
        }
      });
      this.trackHandlers[track] = service;
    }
    this.trackHandlers[track].send(data.media.payload);
  }

  parsePartial(track, transcript) {
    if (track !== this.prevTrack) {
      this.counter++;
      this.queues[track].push(this.counter);
      this.prevTrack = track;
    }
    return {
      fullText: transcript + ' ',
      type: 'message',
      children: transcriptToWords(transcript),
      speaker: track,
    };
  }

  parseFull(words, transcript) {
    const newWords = [];
    words.forEach((word) => {
      newWords.push(normalizeWord(word));
    });
    return {
      start: newWords[0].start,
      fullText: transcript + ' ',
      type: 'message',
      children: newWords,
      speaker: track,
    };
  }

  close() {
    for (let track of Object.keys(this.trackHandlers)) {
      console.log(`Closing ${track} handler`);
      this.trackHandlers[track].close();
    }
  }
}

module.exports = MediaStreamHandler;
