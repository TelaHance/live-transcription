const EventEmitter = require('events');
const Speech = require('@google-cloud/speech');
const speech = new Speech.SpeechClient();

class TranscriptionService extends EventEmitter {
  constructor() {
    super();
    this.stream = null;
    this.streamCreatedAt = null;
  }

  send(payload) {
    this.getStream().write(payload);
  }

  close() {
    if (this.stream) {
      this.stream.destroy();
    }
  }

  newStreamRequired() {
    if (!this.stream) {
      return true;
    } else {
      const now = new Date();
      const timeSinceStreamCreated = now - this.streamCreatedAt;
      return timeSinceStreamCreated / 1000 > 60;
    }
  }

  getStream() {
    if (this.newStreamRequired()) {
      if (this.stream) {
        this.stream.destroy();
      }

      var request = {
        config: {
          encoding: 'MULAW',
          sampleRateHertz: 8000,
          languageCode: 'en-US',
          audioChannelCount: 2,
          enableSeparateRecognitionPerChannel: true,
          enableWordTimeOffsets: true,
          enableAutomaticPunctuation: true
        },
        interimResults: true,
      };

      this.streamCreatedAt = new Date();
      this.stream = speech
        .streamingRecognize(request)
        .on('error', console.error)
        .on('data', (data) => {
          const result = data.results[0];
          if (result === undefined || result.alternatives[0] === undefined) {
            return;
          }
          this.emit('transcription', JSON.stringify(result.alternatives[0]));
        });
    }

    return this.stream;
  }

  async parse(text, age) {
    const response = await fetch('https://api.infermedica.com/v3/parse', {
      method: 'POST',
      headers: {
        'App-Id': env.INFERMEDICA_APP_ID,
        'App-Key': env.INFERMEDICA_APP_KEY,
      },
      body: JSON.stringify({
        age: { value: age },
        text,
      }),
    });
  }
}

module.exports = TranscriptionService;
