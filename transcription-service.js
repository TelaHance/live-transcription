const Speech = require('@google-cloud/speech');
const speech = new Speech.SpeechClient();

class TranscriptionService {
  constructor(track, callback) {
    this.track = track;
    this.callback = callback;
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
          enableAutomaticPunctuation: true,
        },
        interimResults: true,
      };

      this.streamCreatedAt = new Date();
      this.stream = speech
        .streamingRecognize(request)
        .on('error', console.error)
        .on('data', (data) => {
          const result = data.results[0];
          if (result === undefined || result.alternatives[0] === undefined)
            return;
          const { words, transcript } = result.alternatives[0];
          this.callback(this.track, words, transcript);
        });
    }

    return this.stream;
  }
}

module.exports = TranscriptionService;
