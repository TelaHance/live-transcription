const {
  ApiGatewayManagementApiClient,
  DeleteConnectionCommand,
  PostToConnectionCommand,
} = require('@aws-sdk/client-apigatewaymanagementapi');

const { SERVICE, REGION, STAGE } = process.env;
const websocket = new ApiGatewayManagementApiClient({
  endpoint: `https://${SERVICE}.execute-api.${REGION}.amazonaws.com/${STAGE}`,
  region: REGION,
});
// Fix for issue related to including the STAGE in the endpoint.
websocket.middlewareStack.add(
  (next) => async (args) => {
    args.request.path = STAGE + args.request.path;
    return await next(args);
  },
  { step: 'build' }
);

class Client {
  constructor(connectionId) {
    this.connectionId = connectionId;
  }

  async update(data) {
    if (typeof data !== 'string') data = JSON.stringify(data);
    try {
      await websocket.send(
        new PostToConnectionCommand({
          ConnectionId: this.connectionId,
          Data: data,
        })
      );
    } catch (err) {
      console.log(
        '[ Client ] Failed to send update message to client. If user closed the connection themselves, or navigated away from the page, this is expected.'
      );
      console.error(err.name, err.message);
    }
  }

  async disconnect() {
    try {
      await websocket.send(
        new DeleteConnectionCommand({
          ConnectionId: this.connectionId,
        })
      );
      console.log('[ Client ] Websocket successfully disconnected.');
    } catch (err) {
      console.log(
        '[ Client ] Failed to disconnect the websocket. If user closed the connection themselves, or navigated away from the page, this is expected.'
      );
      console.error(err.name, err.message);
    }
  }
}

module.exports = Client;
