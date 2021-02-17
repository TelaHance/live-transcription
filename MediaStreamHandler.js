const fetch = require('isomorphic-unfetch');
const {
  DynamoDBClient,
  UpdateItemCommand,
  QueryCommand,
} = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const {
  ApiGatewayManagementApiClient,
  DeleteConnectionCommand,
  PostToConnectionCommand,
} = require('@aws-sdk/client-apigatewaymanagementapi');
const TranscriptionService = require('./transcription-service');

const SERVICE = 'f26oedtlj3';
const REGION = 'us-west-2';
const STAGE = 'dev';

const dbclient = new DynamoDBClient({ region: REGION });
const websocket = new ApiGatewayManagementApiClient({
  endpoint: `https://${SERVICE}.execute-api.${REGION}.amazonaws.com/${STAGE}`,
  region: REGION,
});
websocket.middlewareStack.add(
  (next) => async (args) => {
    args.request.path = STAGE + args.request.path;
    return await next(args);
  },
  { step: 'build' }
);

async function parseSymptoms(age, text) {
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
  const data = await response.json();
  console.log('[ INFERMEDICA PARSE ]', JSON.stringify(data));
  return data;
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
    this.isFirstSymptomsUpdate = true;
    connection.on('message', this.processMessage.bind(this));
    connection.on('close', this.close.bind(this));
  }

  addBlock(block) {
    // Merge new block with last block if coming from the same speaker.
    if (this.blocks.length > 0) {
      const idx = this.blocks.length - 1;
      const lastBlock = this.blocks[idx];
      if (block.speaker === lastBlock.speaker) {
        lastBlock.fullText = lastBlock.fullText + block.fullText;
        lastBlock.children = lastBlock.children.concat(block.children);
      }
      return { idx, block: lastBlock };
    }
    if (this.queues[block.speaker].length === 0)
      throw new Error('Index queue empty in MediaStreamHandler');
    const idx = this.queues[block.speaker].shift();
    this.blocks[idx] = block;
    return { idx, block };
  }

  async onTranscription(track, words, transcript) {
    console.log(
      `[ ${track} | ${words.length > 0 ? 'FULL' : 'PARTIAL'} ]`,
      transcript
    );
    if (words.length > 0) {
      const block = this.parseFull(track, transcript.trim(), words);
      const idx = this.addBlock(block);
      const data = await parseSymptoms(this.age, transcript.trim());
      const symptoms = data.mentions;
      this.updateDynamoDB(symptoms);
      this.updateClient({ idx, block, symptoms });
    } else {
      const block = this.parsePartial(track, transcript.trim());
      const idx = this.queues[track][0];
      this.updateClient({ idx, block });
    }
  }

  processMessage(message) {
    if (message.type !== 'utf8') {
      console.log(`Media WS: ${message.type} message received (not supported)`);
      return;
    }

    const { event, start, media } = JSON.parse(message.utf8Data);
    if (event === 'start') {
      const { callSid, customParameters } = start;
      this.callSid = callSid;
      this.age = customParameters.age || 30;
      this.consultId = customParameters.consult_id;
    }
    if (event === 'media') {
      const { track, payload } = media;
      if (!this.trackHandlers[track])
        this.trackHandlers[track] = new TranscriptionService(
          track,
          this.onTranscription.bind(this)
        );
      this.trackHandlers[track].send(payload);
    }
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

  parseFull(track, transcript, words) {
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

  async updateClient(data) {
    return websocket.send(
      new PostToConnectionCommand({
        ConnectionId: this.connectionId,
        Data: JSON.stringify(data),
      })
    );
  }

  async updateDynamoDB(symptoms) {
    const queryParams = {
      TableName: 'consults',
      ExpressionAttributeValues: marshall({
        ':c': this.consultId,
      }),
      KeyConditionExpression: 'consult_id = :c',
      ProjectionExpression: 'start_time',
    };
    const data = await dbclient.send(new QueryCommand(queryParams));
    const { start_time } = unmarshall(data.Items[0]);

    const updateParams = {
      TableName: 'consults',
      Key: marshall({
        consult_id: this.consultId,
        start_time,
      }),
      UpdateExpression: 'SET transcript = :t',
      ExpressionAttributeValues: marshall({ ':t': this.blocks }),
      ReturnValues: 'UPDATED_NEW',
    };

    if (symptoms) {
      if (this.isFirstSymptomsUpdate) {
        updateParams.UpdateExpression += ', symptoms = :s';
        this.isFirstSymptomsUpdate = false;
      } else {
        updateParams.UpdateExpression +=
          ', symptoms = list_append(symptoms, :s)';
      }
      updateParams.ExpressionAttributeValues = marshall({
        ':t': this.blocks,
        ':s': symptoms,
      });
    }
    return dbclient.send(new UpdateItemCommand(updateParams));
  }

  async close() {
    console.log('Closing Connection');
    for (let track of Object.keys(this.trackHandlers)) {
      console.log(`Closing ${track} handler`);
      this.trackHandlers[track].close();
    }
    return websocket.send(
      new DeleteConnectionCommand({
        ConnectionId: this.connectionId,
      })
    );
  }
}

module.exports = MediaStreamHandler;
