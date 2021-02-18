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

class ClientHandler {
  constructor(connectionId) {
    this.connectionId = connectionId;
  }

  async updateClient(data) {
    if (typeof data !== 'string') data = JSON.stringify(data);
    return websocket.send(
      new PostToConnectionCommand({
        ConnectionId: this.connectionId,
        Data: data,
      })
    );
  }

  async disconnect() {
    return websocket.send(
      new DeleteConnectionCommand({
        ConnectionId: this.connectionId,
      })
    );
  }
}

module.exports = ClientHandler;
