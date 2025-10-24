import { Client, Server } from 'node-osc';

const client = new Client('10.10.160.143', 8000);
client.send('/eos/subscribe=1', 200, () => {
  client.close();
});

var oscServer = new Server(8001, '0.0.0.0', () => {
  console.log('OSC Server is listening');
});

oscServer.on('message', function (msg) {
  console.log(`Message: ${msg}`);
});