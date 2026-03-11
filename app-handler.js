import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const users = new Map();
const sessions = new Map();
const organizations = new Map();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const parseJson = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const getSessionUser = (req) => {
  const cookie = req.headers.cookie || '';
  const pair = cookie.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith('sid='));
  if (!pair) return null;
  const sid = pair.split('=')[1];
  const userId = sessions.get(sid);
  if (!userId) return null;
  return users.get(userId) || null;
};

const requireAuth = (req, res) => {
  const user = getSessionUser(req);
  if (!user) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return null;
  }
  return user;
};

const serveStatic = async (res, filePath) => {
  const extension = extname(filePath);
  const contentType = mimeTypes[extension] || 'application/octet-stream';
  try {
    const data = await readFile(join(__dirname, 'public', filePath));
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
};

export const handleRequest = async (req, res, baseUrl = 'http://localhost:3000') => {
  const url = new URL(req.url || '/', baseUrl);

  if (req.method === 'GET' && url.pathname === '/') return serveStatic(res, 'index.html');
  if (req.method === 'GET' && url.pathname === '/signup') return serveStatic(res, 'signup.html');
  if (req.method === 'GET' && url.pathname === '/login') return serveStatic(res, 'login.html');
  if (req.method === 'GET' && url.pathname === '/admin') return serveStatic(res, 'admin.html');
  if (req.method === 'GET' && url.pathname === '/app') return serveStatic(res, 'app.html');
  if (req.method === 'GET' && url.pathname === '/styles.css') return serveStatic(res, 'styles.css');

  if (req.method === 'POST' && url.pathname === '/api/signup') {
    const { fullName, email, password, companyName } = await parseJson(req);
    if (!fullName || !email || !password || !companyName) {
      return sendJson(res, 400, { error: 'All fields are required.' });
    }
    if ([...users.values()].some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return sendJson(res, 409, { error: 'Email already exists.' });
    }

    const orgId = randomUUID();
    const userId = randomUUID();
    const sid = randomUUID();

    organizations.set(orgId, {
      id: orgId,
      companyName,
      employeeCount: 120,
      provider: 'Gusto',
      finchConnected: true,
      stripeSubscriptionStatus: 'trialing',
      billingPlan: 'Growth'
    });

    users.set(userId, {
      id: userId,
      fullName,
      email,
      password,
      role: users.size === 0 ? 'admin' : 'member',
      orgId,
      createdAt: new Date().toISOString()
    });

    sessions.set(sid, userId);
    res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`);
    return sendJson(res, 201, { ok: true, redirectTo: '/app' });
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    const { email, password } = await parseJson(req);
    const user = [...users.values()].find((u) => u.email.toLowerCase() === (email || '').toLowerCase());
    if (!user || user.password !== password) {
      return sendJson(res, 401, { error: 'Invalid credentials.' });
    }
    const sid = randomUUID();
    sessions.set(sid, user.id);
    res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`);
    return sendJson(res, 200, { ok: true, redirectTo: user.role === 'admin' ? '/admin' : '/app' });
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const cookie = req.headers.cookie || '';
    const pair = cookie.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith('sid='));
    if (pair) sessions.delete(pair.split('=')[1]);
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax');
    return sendJson(res, 200, { ok: true, redirectTo: '/' });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
    const user = requireAuth(req, res);
    if (!user) return;

    return sendJson(res, 200, {
      totalUsers: users.size,
      totalOrganizations: organizations.size,
      subscriptions: [...organizations.values()].map((org) => ({
        company: org.companyName,
        plan: org.billingPlan,
        status: org.stripeSubscriptionStatus
      }))
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/app/dashboard') {
    const user = requireAuth(req, res);
    if (!user) return;
    const org = organizations.get(user.orgId);
    return sendJson(res, 200, {
      user: { fullName: user.fullName, email: user.email },
      organization: org,
      finchModulesEnabled: ['Organization', 'Payroll', 'Deductions']
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/stripe/webhook') {
    return sendJson(res, 200, {
      received: true,
      note: 'Stripe webhook endpoint scaffolded. Add signature verification and event persistence next.'
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/finch/sync') {
    const user = requireAuth(req, res);
    if (!user) return;
    const org = organizations.get(user.orgId);
    org.employeeCount += 3;
    return sendJson(res, 200, {
      ok: true,
      message: 'Finch sync simulated. Replace with live /employer/company and /employer/directory calls.',
      organization: org
    });
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
};
