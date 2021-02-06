const AWS = require("aws-sdk");
const TranscriptionService = require('./transcription-service');
const dynamoDb = new AWS.DynamoDB.DocumentClient({
  region: "us-west-2",
});
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
  async updateDatabase(blocks){
    const updateParams = {
      TableName: "consults",
      Key: this.consultId,
      ExpressionAttributeNames: {
        '#transcript': "transcript",
      },
      ReturnValues: 'UPDATED_NEW',
    };
    updateParams.ExpressionAttributeValues = {
      ':t': blocks,
    };
    updateParams.UpdateExpression = 'set #transcript = :t';
    await dynamoDb.update(updateParams).promise();
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
        if(transcription.words && transcription.words.length !== 0){
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
          this.updateDatabase(this.blocks).then(r => console.log(r));
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
