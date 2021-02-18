function normalizeWord(currentWord) {
  const { startTime, word } = currentWord;
  const { seconds, nanos } = startTime;
  return {
    start: seconds * 1000 + nanos / 1000000,
    end: seconds * 1000 + nanos / 1000000,
    text: word.trim() + ' ',
  };
}

function transcriptToWords(transcript) {
  return transcript.split(' ').map((word) => {
    return {
      text: word + ' ',
    };
  });
}

class BlockOrganizer {
  constructor() {
    this.counter = -1;
    this.prevTrack = '';
    this.trackQueues = {};
  }

  format(track, transcript, words) {
    const block = {
      type: 'message',
      speaker: track,
    };
    if (words === undefined || words.length === 0) {
      if (track !== this.prevTrack) {
        this.counter++;
        this.trackQueues[track].push(this.counter);
        this.prevTrack = track;
      }
      block.fullText = transcript;
      block.children = transcriptToWords(transcript);
    } else {
      words = words.map(normalizeWord);
      block.start = words[0].start;
      block.fullText = transcript + ' ';
      block.children = words;
    }
    return block;
  }

  newQueue(track) {
    this.trackQueues[track] = [];
  }

  getIdx(track) {
    return this.trackQueues[track][0];
  }

  assertNotEmpty(track) {
    if (this.trackQueues[track].length === 0)
      throw new Error('Index queue empty in TelahanceService');
  }

  pop(track) {
    return this.trackQueues[track].shift();
  }
}

module.exports = BlockOrganizer;
