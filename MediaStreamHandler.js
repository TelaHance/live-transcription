const { DynamoDB} = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall} = require("@aws-sdk/util-dynamodb");
const TranscriptionService = require('./transcription-service');
const client = new DynamoDB({ region: "us-west-2" });

async function updateDatabase(blocks, consultId){
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
    UpdateExpression: "set transcript = :t",
    ExpressionAttributeValues: marshall({
      ':t': blocks,
    }),
    ReturnValues: "UPDATED_NEW",
  };
  await client.updateItem(updateParams);
}

class MediaStreamHandler {
  constructor(connection) {
    this.callSid = null;
    this.consultId = null;
    this.trackHandlers = {};
    this.blocks = [];
    connection.on('message', this.processMessage.bind(this));
    connection.on('close', this.close.bind(this));
  }
  normalizeWord(currentWord) {
    return {
      start: currentWord.startTime.seconds*1000+currentWord.startTime.nanos/1000000,
      end: currentWord.startTime.seconds*1000+currentWord.startTime.nanos/1000000,
      text: currentWord.word.trim(),
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
      this.consultId = data.start.customParameters.consult_id;
    }
    if (data.event !== 'media') return;

    const { track } = data.media;
    if (this.trackHandlers[track] === undefined) {
      const service = new TranscriptionService();
      service.on('transcription', (transcription) => {
        transcription = JSON.parse(transcription);
        if(transcription.words.length > 0){
          const newWords = [];
          transcription.words.forEach((word) =>{
            newWords.push(this.normalizeWord(word));
          });
          const block = {
            "start":newWords[0].start,
            "fullText":transcription.transcript.trim(),
            "type":"message",
            "children":newWords,
            "speaker":track
          };
          this.blocks.push(block);
          this.blocks.sort((a,b)=>(a.start > b.start) ? 1 : -1);
          updateDatabase(this.blocks, this.consultId).then(r => console.log(r));
        }
      });
      this.trackHandlers[track] = service;
    }
    this.trackHandlers[track].send(data.media.payload);
  }

  async update() {
    // Access DynamoDB and update consult
    // Send updated new back to client
  }

  close() {
    for (let track of Object.keys(this.trackHandlers)) {
      console.log(`Closing ${track} handler`);
      this.trackHandlers[track].close();
    }
  }
}

module.exports = MediaStreamHandler;
