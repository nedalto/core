# Nedalto

A local-first smart home hub built exclusively on the [Matter](https://buildwithmatter.com) protocol.

Nedalto runs entirely on your local network and works fully without any cloud service or subscription.
It exposes a [JSON-RPC 2.0](https://www.jsonrpc.org/specification) WebSocket API that any client can connect to: web apps, mobile apps, or custom integrations.

> [!WARNING]
> Early development.
> There are no releases yet and it is not usable.

## Contributing

External contributions are not being accepted at this stage.

## Development

Requirements: Node.js 26 and npm 11.

```sh
npm ci
npm run format
npm run lint
npm run --workspaces type
npm run --workspaces test
```

## License

[EUPL-1.2](LICENSE)
