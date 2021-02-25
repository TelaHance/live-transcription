const axios = require('axios');
const { S3 } = require('aws-sdk');
const S3UploadStream = require('s3-upload-stream');
const { Twilio } = require('./');

function getUploadPath(recording) {
  const recordingDate = new Date(recording.dateCreated);
  const year = recordingDate.getFullYear();
  const callSid = recording.callSid;
  return `Recordings/${year}/${callSid}.mp3`;
}

async function transfer_recording(download_url, upload_stream) {
  console.log('[ S3 ] Beginning call audio transfer');
  const response = await axios({
    method: 'GET',
    url: download_url,
    responseType: 'stream',
  });
  response.data.pipe(upload_stream);
  return new Promise((resolve, reject) => {
    upload_stream.on('uploaded', () => {
      console.log('[ S3 ] Successfully uploaded call audio.');
      resolve();
    });
    upload_stream.on('error', () => {
      console.error('[ S3 ] Failed to upload call audio.');
      reject();
    });
  });
}

async function uploadRecording(callSid) {
  const recording = await Twilio.getRecording(callSid);
  const download_url = Twilio.getDownloadUrl(recording);
  const upload_path = getUploadPath(recording);
  let s3Stream = S3UploadStream(new S3());
  let upload_stream = s3Stream.upload({
    Bucket: 'teleconsults',
    Key: upload_path,
    ContentType: 'audio/mpeg',
  });
  try {
    await transfer_recording(download_url, upload_stream);
    Twilio.deleteRecording(recording.sid);
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
