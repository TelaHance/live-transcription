const { Client, DynamoDB, Infermedica, SpeechToText } = require('./handlers');
const BlockOrganizer = require('./util/BlockOrganizer');

class TelahanceService {
  constructor(connection, connectionId) {
    this.trackHandlers = {};
    this.blocks = [];
    this.currTrack = '';
    this.isUpdating = false;
    this.blockOrganizer = new BlockOrganizer();
    this.client = new Client(connectionId);
    connection.on('message', this.onMessage.bind(this));
  }

  getBlocksInfo() {
    const lastIdx = this.blocks.length - 1;
    const lastBlock = this.blocks[lastIdx];
    const lastTrack = lastBlock.speaker;
    return { lastIdx, lastBlock, lastTrack };
  }

  addBlock(block) {
    const track = block.speaker;

    // Merge consecutive blocks from same speaker.
    if (this.blocks.length > 0) {
      const { lastIdx, lastBlock, lastTrack } = this.getBlocksInfo();

      if (track === lastTrack) {
        lastBlock.fullText += ' ' + block.fullText;
        lastBlock.children = lastBlock.children.concat(block.children);
        return { idx: lastIdx, block: lastBlock };
      }
    }

    // Otherwise, get a new block index from the queue.
    this.blockOrganizer.assertNotEmpty(track);
    const idx = this.blockOrganizer.pop(track);
    this.blocks[idx] = block;
    return { idx, block };
  }

  async onTranscription(track, transcript, words) {
    this.isUpdating = true;
    const block = this.blockOrganizer.format(track, transcript, words);
    let data;
    if (words.length > 0) {
      data = this.addBlock(block);
      data.symptoms = await Infermedica.parse(this.age, transcript);
      DynamoDB.update(this.consultId, this.blocks, data.symptoms);
    } else {
      let idx = this.blockOrganizer.getIdx(track);
      if (this.blocks.length > 0) {
        const { lastIdx, lastBlock, lastTrack } = this.getBlocksInfo();
        if (track === lastTrack) {
          idx = lastIdx;
          block.fullText = lastBlock.fullText + ' ' + block.fullText;
          block.children = lastBlock.children.concat(block.children);
        }
      }

      data = { idx, block };
    }
    this.client.update(data);
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
      if (!this.trackHandlers[track]) {
        this.trackHandlers[track] = new SpeechToText(
          track,
          this.onTranscription.bind(this)
        );
        this.blockOrganizer.newQueue(track);
      }
      this.trackHandlers[track].send(payload);
    }
    if (event === 'stop') {
      console.log(`[ TelahanceService ] Call Ended`);
      this.client.update({ callEnded: true });
      this.close();
    }
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
