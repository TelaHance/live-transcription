const { Client, DynamoDB, Infermedica, SpeechToText } = require('./handlers');
const { normalizeWord, transcriptToWords } = require('./util/transform');

class TelahanceService {
  constructor(connection, connectionId) {
    this.trackHandlers = {};
    this.blocks = [];
    this.currTrack = '';
    this.counter = -1;
    this.queues = { inbound: [], outbound: [] };
    this.isUpdating = false;
    this.client = new Client(connectionId);
    connection.on('message', this.onMessage.bind(this));
    connection.on('close', () => console.log('[ Twilio ] Sent close event'));
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
      throw new Error('Index queue empty in TelahanceService');
    const idx = this.queues[block.speaker].shift();
    this.blocks[idx] = block;
    return { idx, block };
  }

  async onTranscription(track, words, transcript) {
    this.isUpdating = true;
    if (words.length > 0) {
      const block = this.parseFinal(track, transcript.trim(), words);
      const idx = this.addBlock(block);
      const symptoms = await Infermedica.parse(this.age, transcript.trim());
      DynamoDB.update(this.consultId, this.blocks, symptoms);
      this.client.update({ idx, block, symptoms });
    } else {
      const block = this.parseInterim(track, transcript.trim());
      const idx = this.queues[track][0];
      this.client.update({ idx, block });
    }
    this.isUpdating = false;
  }

  onMessage(message) {
    if (message.type !== 'utf8') {
      console.log(
        `[ TelahanceService ] ${message.type} message received (not supported)`
      );
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
        this.trackHandlers[track] = new SpeechToText(
          track,
          this.onTranscription.bind(this)
        );
      this.trackHandlers[track].send(payload);
    }
    if (event === 'stop') {
      console.log(`[ Twilio ] Received Stop Event`);
      this.client.update({ callEnded: true });
      this.close();
    }
  }

  parseInterim(track, transcript) {
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

  parseFinal(track, transcript, words) {
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

  async close(maxWaitTime = 5000) {
    const tracks = Object.keys(this.trackHandlers);
    try {
      await Promise.all(
        tracks.map((track) => this.trackHandlers[track].close())
      );
      console.log('[ TelahanceService ] Successfully closed tracks');
    } catch (err) {
      console.error(err.message);
    }

    try {
      await new Promise((resolve, reject) => {
        const errmsg = '[ TelahanceService ] Failed to close';
        const timeout = setTimeout(() => reject(errmsg), maxWaitTime);
        const interval = setInterval(() => {
          if (!this.isUpdating) {
            clearTimeout(timeout);
            console.log('[ TelahanceService ] Successfully closed');
            resolve(true);
            return clearInterval(interval);
          }
        }, 500);
      });
    } catch (err) {
      console.error(err.message);
    }

    console.log('[ TelahanceService ] Closing client websocket connection');

    try {
      await this.client.disconnect();
    } catch (err) {
      console.error(
        '[ TelahanceService ] Client websocket connection may already be closed'
      );
      console.error(`[ TelahanceService | ${err.name} ] ${err.message}`);
    }
  }
}

module.exports = TelahanceService;
