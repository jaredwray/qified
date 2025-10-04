#!/usr/bin/env node

/**
 * ZeroMQ Proxy (Broker) - Forwarder Pattern
 *
 * This creates a message broker using SUB/PUB sockets that forwards messages
 * between publishers and subscribers. Both publishers and subscribers connect
 * to the same port (5555).
 */

const zmq = require('zeromq');

async function runProxy() {
  const frontend = new zmq.Subscriber();
  const backend = new zmq.Publisher();

  // Frontend receives from publishers
  await frontend.bind('tcp://*:5555');
  frontend.subscribe(''); // Subscribe to all topics

  // Backend sends to subscribers
  await backend.bind('tcp://*:5556');

  console.log('ZeroMQ Proxy started');
  console.log('Frontend (SUB) listening on tcp://*:5555 for publishers');
  console.log('Backend (PUB) listening on tcp://*:5556 for subscribers');

  // Forward all messages from frontend to backend
  for await (const [topic, msg] of frontend) {
    await backend.send([topic, msg]);
  }
}

runProxy().catch(err => {
  console.error('Proxy error:', err);
  process.exit(1);
});
