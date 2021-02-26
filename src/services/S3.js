const axios = require('axios');
const { S3 } = require('aws-sdk');
const S3UploadStream = require('s3-upload-stream');
const Twilio = require('./Twilio');

function getUploadPath({ dateCreated, callSid }) {
  const recordingDate = new Date(dateCreated);
  const year = recordingDate.getFullYear();
  return `Recordings/${year}/${callSid}.mp3`;
}

async function transferRecording(fromUrl, toUrl) {
  console.log('[ S3 ] Beginning call audio transfer');
  const response = await axios({
    method: 'GET',
    url: fromUrl,
    responseType: 'stream',
  });
  response.data.pipe(toUrl);
  return new Promise((resolve, reject) => {
    toUrl.on('uploaded', () => {
      console.log('[ S3 ] Successfully uploaded call audio.');
      resolve();
    });
    toUrl.on('error', () => {
      console.error('[ S3 ] Failed to upload call audio.');
      reject();
    });
  });
}

async function uploadRecording(recordingSid, recordingUrl) {
  const recording = await Twilio.getCompletedRecording(recordingSid);

  const upload_path = getUploadPath(recording);
  const s3UploadStream = S3UploadStream(new S3()).upload({
    Bucket: 'teleconsults',
    Key: upload_path,
    ContentType: 'audio/mpeg',
  });
  try {
    await transferRecording(recordingUrl, s3UploadStream);
    Twilio.deleteRecording(recordingSid);
  } catch (err) {
    console.error(
      '[ S3 ] Error while transferring recordings: ',
      JSON.stringify(err)
    );
  }
}

module.exports = {
  uploadRecording,
};
