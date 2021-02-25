const {
  SQSClient,
  DeleteMessageCommand,
  ReceiveMessageCommand,
} = require('@aws-sdk/client-sqs');

const REGION = 'us-west-2';
const QueueUrl =
  'https://sqs.us-west-2.amazonaws.com/113657999858/WebsocketQueue.fifo';

const receieveParams = {
  MaxNumberOfMessages: 1,
  QueueUrl,
  VisibilityTimeout: 10,
  WaitTimeSeconds: 0,
};

const sqs = new SQSClient({ region: REGION });

async function getConnectionId() {
  // Get SQS message (should already be in Queue)
  const response = await sqs.send(new ReceiveMessageCommand(receieveParams));
  if (!response.Messages || response.Messages.length === 0) {
    throw new Error(`[ SQS ] No message in ${QueueUrl}`);
  }

  const { Body, ReceiptHandle } = response.Messages[0];
  sqs.send(new DeleteMessageCommand({ QueueUrl, ReceiptHandle }));

  const { connectionId } = JSON.parse(Body);
  return connectionId;
}

module.exports = {
  getConnectionId,
};
