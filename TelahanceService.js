const {
  Client,
  DynamoDB,
  Infermedica,
  SpeechToText,
  S3,
} = require('./handlers');
const BlockOrganizer = require('./util/BlockOrganizer');

function getRole(track) {
  return (
    {
      inbound: 'DOCTOR',
      outbound: 'PATIENT',
    }[track] || track
  );
}

class TelahanceService {
  constructor(connection, connectionId) {
    this.trackHandlers = {};
    this.blocks = [];
    this.currTrack = '';
    this.isUpdating = false;
    this.blockOrganizer = new BlockOrganizer();
    this.client = new Client(connectionId);
    connection.on('message', this.onMessage.bind(this));
    connection.on('close', () =>
      console.log('[ TelahanceService ] Connection received close event')
    );
  }

  getBlocksInfo() {
    const lastIdx = this.blocks.length - 1;
    const lastBlock = this.blocks[lastIdx];
    const lastRole = lastBlock.speaker;
    return { lastIdx, lastBlock, lastRole };
  }

  addBlock(block) {
    const role = block.speaker;

    // Merge consecutive blocks from same speaker.
    if (this.blocks.length > 0) {
      const { lastIdx, lastBlock, lastRole } = this.getBlocksInfo();

      if (role === lastRole) {
        lastBlock.fullText += ' ' + block.fullText;
        lastBlock.children = lastBlock.children.concat(block.children);
        return { idx: lastIdx, block: lastBlock };
      }
    }

    // Otherwise, get a new block index from the queue.
    this.blockOrganizer.assertNotEmpty(role);
    const idx = this.blockOrganizer.pop(role);
    this.blocks[idx] = block;
    return { idx, block };
  }

  async onTranscription(role, transcript, words) {
    this.isUpdating = true;
    const block = this.blockOrganizer.format(role, transcript, words);
    let data;
    if (words.length > 0) {
      data = this.addBlock(block);
      data.symptoms = await Infermedica.parse(this.age, transcript);
      DynamoDB.update(this.consultId, this.blocks, data.symptoms);
    } else {
      let idx = this.blockOrganizer.getIdx(role);
      if (this.blocks.length > 0) {
        const { lastIdx, lastBlock, lastRole } = this.getBlocksInfo();
        if (role === lastRole) {
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

    switch (event) {
      case 'start':
        console.log(`[ TelahanceService ] Call Started`);
        const {
          callSid,
          customParameters: { age, consult_id },
        } = start;
        this.age = age || 30;
        this.consultId = consult_id;
        this.callSid = callSid;
        DynamoDB.updateCallSid(consult_id, callSid);
        break;

      case 'media':
        const { track, payload } = media;
        const role = getRole(track);
        if (!this.trackHandlers[role]) {
          this.trackHandlers[role] = new SpeechToText(
            role,
            this.onTranscription.bind(this)
          );
          this.blockOrganizer.newQueue(role);
        }
        this.trackHandlers[role].send(payload);
        break;

      case 'stop':
        console.log(`[ TelahanceService ] Call Ended`);
        this.close();
        break;

      default:
        console.log('[ TelahanceService ] Event unhandled: ', event);
    }
  }

  async close(maxWaitTime = 5000) {
    // Wait for Google Speech to Text to finish transcribing.
    const tracks = Object.keys(this.trackHandlers);
    try {
      await Promise.all(
        tracks.map((track) => this.trackHandlers[track].close())
      );
      console.log('[ TelahanceService ] Successfully closed tracks');
    } catch (err) {
      console.error(
        '[ TelahanceService ] Error while closing tracks',
        err.message
      );
    }

    // Wait for last updates to be sent to Client and DynamoDB.
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

    // Disconnect client and upload recordings.
    await Promise.all([
      this.client.disconnect(),
      S3.uploadRecording(this.callSid),
    ]);
  }
}

module.exports = TelahanceService;
