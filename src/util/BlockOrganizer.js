function normalizeWord(currentWord) {
  const { startTime, endTime, word } = currentWord;
  return {
    start: startTime.seconds * 1000 + startTime.nanos / 1000000,
    end: endTime.seconds * 1000 + endTime.nanos / 1000000,
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
    this.prevRole = '';
    this.roleQueues = {};
  }

  format(role, transcript, words) {
    const block = {
      type: 'message',
      speaker: role,
    };
    if (words === undefined || words.length === 0) {
      if (role !== this.prevRole) {
        this.counter++;
        this.roleQueues[role].push(this.counter);
        this.prevRole = role;
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

  newQueue(role) {
    this.roleQueues[role] = [];
  }

  getIdx(role) {
    return this.roleQueues[role][0];
  }

  assertNotEmpty(role) {
    if (this.roleQueues[role].length === 0)
      throw new Error('Index queue empty in TelahanceService');
  }

  pop(role) {
    return this.roleQueues[role].shift();
  }
}

module.exports = BlockOrganizer;