const Speech = require('@google-cloud/speech');
const speech = new Speech.SpeechClient();

const defaultVocab = ['TelaHance'];

class SpeechToText {
  constructor(role, cb, vocab) {
    this.role = role;
    this.cb = cb;
    this.stream = null;
    this.streamCreatedAt = null;
    this.readyToClose = true;
    this.prevTranscript = '';
    this.request = {
      config: {
        encoding: 'MULAW',
        sampleRateHertz: 8000,
        languageCode: 'en-US',
        model: 'phone_call',
        audioChannelCount: 2,
        enableSeparateRecognitionPerChannel: true,
        enableWordTimeOffsets: true,
        enableAutomaticPunctuation: true,
        speechContexts: [
          {
            phrases: defaultVocab.concat(vocab),
          },
        ],
      },
      interimResults: true,
    };
  }

  send(payload) {
    this.getStream().write(payload);
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
        this.stream.end();
        this.stream.destroy();
      }
      this.streamCreatedAt = new Date();
      this.stream = speech
        .streamingRecognize(this.request)
        .on('error', (err) => {
          // Filter out error code 11
          if (err.code !== 11) {
            console.error(err);
          }
        })
        .on('data', (data) => {
          const result = data.results[0];
          if (result === undefined || result.alternatives[0] === undefined)
            return;
          const { isFinal } = result;
          const { words, transcript } = result.alternatives[0];

          // Only process new results
          if (this.prevTranscript === transcript && !isFinal) return;
          this.prevTranscript = transcript;

          console.log(
            `[ SpeechToText | ${this.role} | ${
              isFinal ? 'Final' : 'Interim'
            } ] ${transcript}`
          );

          this.cb(this.role, transcript.trim(), words);
          this.readyToClose = isFinal;
        });
    }

    return this.stream;
  }

  async close(maxWaitTime = 5000) {
    console.log(`[ SpeechToText | ${this.role} ] Starting close`);
    this.stream.end();
    return new Promise((resolve, reject) => {
      const errmsg = `[ SpeechToText | ${this.role} ] Failed to close`;
      const timeout = setTimeout(() => reject(errmsg), maxWaitTime);

      const interval = setInterval(() => {
        if (this.readyToClose) {
          clearTimeout(timeout);
          if (this.stream) {
            this.stream.destroy();
          }
          console.log(`[ SpeechToText | ${this.role} ] Successfully closed`);
          resolve(true);
          return clearInterval(interval);
        }
      }, 500);
    });
  }
}

module.exports = SpeechToText;
