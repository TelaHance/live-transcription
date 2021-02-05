const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const TranscriptionService = require('./transcription-service');

class MediaStreamHandler {
  constructor(connection) {
    this.callSid = null;
    this.consultId = null;
    this.trackHandlers = {};
    connection.on('message', this.processMessage.bind(this));
    connection.on('close', this.close.bind(this));
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
        console.log(`Transcription (${track}): ${transcription}`);
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