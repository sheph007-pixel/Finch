import { handleRequest } from '../app-handler.js';

export default async function handler(req, res) {
  const host = req.headers.host || 'localhost';
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  return handleRequest(req, res, `${protocol}://${host}`);
}
