const speech = require('@google-cloud/speech');
const client = new speech.SpeechClient();

const defaultVocab = ['TelaHance'];
const request = {
  config: {
    encoding: 'MULAW',
    sampleRateHertz: 8000,
    languageCode: 'en-US',
    model: 'phone_call',
    enableWordTimeOffsets: true,
    enableAutomaticPunctuation: true,
  },
  interimResults: true,
};
const streamingLimit = 300000; // 5 minutes

class SpeechToText {
  constructor(role, cb, vocab) {
    this.role = role;
    this.cb = cb;
    this.stream = null;
    this.streamCreatedAt = null;
    this.lastTranscriptWasFinal = true;
    this.prevTranscript = '';
    this.restartCounter = 0;
    request.config.speechContexts = [{ phrases: defaultVocab.concat(vocab) }];
    this.startStream();
  }

  send = (payload) => {
    this.stream.write(payload);
  };

  startStream = () => {
    this.stream = client
      .streamingRecognize(request)
      .on('error', (err) => {
        // Filter out error code 11
        if (err.code !== 11) {
          console.error(err);
        }
      })
      .on('data', this.onData);

    // Restart stream when streamingLimit expires
    setTimeout(this.restartStream, streamingLimit);
  };

  restartStream = () => {
    console.log('[ SpeechToText ] Restarting stream');
    if (this.stream) {
      this.stream.end();
      this.stream.removeListener('data', this.onData);
      this.stream = null;
    }
    ++this.restartCounter;
    this.startStream();
  };

  onData = (data) => {
    const result = data.results[0];
    if (result === undefined || result.alternatives[0] === undefined) return;
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

    const offset = this.restartCounter * streamingLimit;

    this.cb(this.role, transcript.trim(), words, offset);
    this.lastTranscriptWasFinal = isFinal;
  };

  close = async (maxWaitTime = 5000) => {
    console.log(`[ SpeechToText | ${this.role} ] Starting close`);
    this.stream.end();
    return new Promise((resolve, reject) => {
      const errmsg = `[ SpeechToText | ${this.role} ] Failed to close`;
      const timeout = setTimeout(() => reject(errmsg), maxWaitTime);

      const interval = setInterval(() => {
        if (this.lastTranscriptWasFinal) {
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
  };
}

module.exports = SpeechToText;
