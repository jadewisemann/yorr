import { preview } from 'vite'

const server = await preview({
  preview: {
    host: '127.0.0.1',
    port: 4306,
    strictPort: true,
  },
})

async function shutdown() {
  await server.close()
  process.exit(0)
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
