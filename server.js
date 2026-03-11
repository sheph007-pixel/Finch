import { createServer } from 'node:http';
import { handleRequest } from './app-handler.js';

const PORT = process.env.PORT || 3000;

createServer((req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  handleRequest(req, res, `${protocol}://${host}`);
}).listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
