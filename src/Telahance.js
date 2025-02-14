const {
  Client,
  DynamoDB,
  Infermedica,
  Perspective,
  S3,
  SpeechToText,
} = require('./services');
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
  constructor(connectionId) {
    this.trackHandlers = {};
    this.blocks = [];
    this.currTrack = '';
    this.isUpdating = false;
    this.blockOrganizer = new BlockOrganizer();
    this.client = new Client(connectionId);
  }

  sendReady() {
    this.client.update({ status: 'ready' });
  }

  sendClose() {
    this.client.update({ status: 'closed' });
  }

  connect(connection) {
    connection.on('message', this.onMessage);
  }

  onCallEvent({ CallStatus, RecordingSid, RecordingUrl, RecordingDuration }) {
    console.log(`[ TelahanceService ] Call ${CallStatus}`);
    this.client.update({ status: CallStatus });
    if (CallStatus === 'in-progress') this.callInProgress = true;
    else if (CallStatus === 'completed') {
      this.recordingSid = RecordingSid;
      this.recordingUrl = `${RecordingUrl}.mp3`;
      this.recordingDuration = RecordingDuration;
      console.log(
        `[ TelahanceService ] Recorded for ${RecordingDuration} seconds.`
      );
    }
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

  onTranscription = (role, transcript, words, offset) => {
    this.isUpdating = true;
    const block = this.blockOrganizer.format(role, transcript, words, offset);
    if (words.length > 0) {
      // Parse final block data and strip away.
      const data = JSON.parse(JSON.stringify(this.addBlock(block)));
      this.dynamoDBClient.updateConsult({ blocks: this.blocks });

      // Strip away all but text for client updates.
      data.block.children = data.block.children.map(({ text }) => ({ text }));
      this.client.update(data);

      // Handle Infermedica separately from transcript data.
      this.infermedicaClient.parse(transcript).then((entities) => {
        this.dynamoDBClient.updateConsult({ entities });
        this.client.update({ symptoms: entities });
      });
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
      this.client.update({ idx, block });
    }
    this.isUpdating = false;
  };

  onMessage = async (message) => {
    const { event, start, media } = JSON.parse(message);

    switch (event) {
      case 'start':
        const {
          callSid,
          customParameters: { consult_id },
        } = start;

        this.dynamoDBClient = new DynamoDB();
        await this.dynamoDBClient.initialize(consult_id, callSid);

        const patient = await this.dynamoDBClient.getPatient();
        const doctor = await this.dynamoDBClient.getDoctor();
        this.infermedicaClient = new Infermedica(patient);

        this.vocab = [
          doctor.given_name,
          doctor.family_name,
          patient.given_name,
          patient.family_name,
        ];
        break;

      case 'media':
        const { track, payload } = media;
        const role = getRole(track);
        if (!this.callInProgress) break; // Wait for call to be answered before starting transcription service

        if (!this.trackHandlers[role]) {
          this.trackHandlers[role] = new SpeechToText(
            role,
            this.onTranscription,
            this.vocab
          );
          this.blockOrganizer.newQueue(role);
        }
        this.trackHandlers[role].send(payload);

        break;

      case 'stop':
        this.close();
        break;
    }
  };

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
        JSON.stringify(err)
      );
    }

    // Wait for Perspective API to add sentiment values
    try {
      const data = await Perspective.analyzeTranscript(this.blocks);
      this.dynamoDBClient.updateConsult(data);
    } catch (err) {
      console.error(
        '[ TelahanceService ] Failed to add sentiment',
        JSON.stringify(err)
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
      S3.uploadRecording(this.recordingSid, this.recordingUrl),
    ]);
  }
}

module.exports = TelahanceService;
