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

module.exports = {
  normalizeWord,
  transcriptToWords,
};
