import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const users = new Map();
const sessions = new Map();
const organizations = new Map();
const finchTokens = new Map(); // orgId → access_token

const FINCH_CLIENT_ID = process.env.FINCH_CLIENT_ID || '';
const FINCH_CLIENT_SECRET = process.env.FINCH_CLIENT_SECRET || '';
const FINCH_SANDBOX = process.env.FINCH_SANDBOX === 'true';
const FINCH_BASE_URL = FINCH_SANDBOX ? 'https://sandbox.tryfinch.com' : 'https://api.tryfinch.com';
const FINCH_REDIRECT_URI = process.env.FINCH_REDIRECT_URI || '';

const finchApi = async (accessToken, path) => {
  const res = await fetch(`${FINCH_BASE_URL}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, 'Finch-API-Version': '2020-09-17' }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Finch API ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
};

const finchApiPost = async (accessToken, path, body = {}) => {
  const res = await fetch(`${FINCH_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Finch-API-Version': '2020-09-17'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Finch API ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
};

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
    const hasToken = finchTokens.has(user.orgId);
    return sendJson(res, 200, {
      user: { fullName: user.fullName, email: user.email },
      organization: org,
      finchConnected: hasToken,
      finchModulesEnabled: hasToken
        ? ['Company', 'Directory', 'Individual', 'Employment', 'Payment', 'Pay Statement', 'Benefits']
        : []
    });
  }

  // Finch Connect – returns the URL the frontend should redirect to
  if (req.method === 'GET' && url.pathname === '/api/finch/connect') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (!FINCH_CLIENT_ID) {
      return sendJson(res, 500, { error: 'FINCH_CLIENT_ID not configured.' });
    }
    const redirectUri = FINCH_REDIRECT_URI || `${url.protocol}//${url.host}/api/finch/callback`;
    const products = 'company directory individual employment payment pay_statement benefits';
    const sandbox = FINCH_SANDBOX ? '&sandbox=true' : '';
    const connectUrl = `https://connect.tryfinch.com/authorize?client_id=${FINCH_CLIENT_ID}&products=${encodeURIComponent(products)}&redirect_uri=${encodeURIComponent(redirectUri)}${sandbox}`;
    return sendJson(res, 200, { url: connectUrl });
  }

  // Finch OAuth callback – exchanges code for access token
  if (req.method === 'GET' && url.pathname === '/api/finch/callback') {
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (error) {
      const errorDesc = url.searchParams.get('error_description') || error;
      res.writeHead(302, { Location: `/app?finch_error=${encodeURIComponent(errorDesc)}` });
      return res.end();
    }
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Missing authorization code.');
    }
    const user = getSessionUser(req);
    const redirectUri = FINCH_REDIRECT_URI || `${url.protocol}//${url.host}/api/finch/callback`;
    try {
      const tokenRes = await fetch(`${FINCH_BASE_URL}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: FINCH_CLIENT_ID,
          client_secret: FINCH_CLIENT_SECRET,
          code,
          redirect_uri: redirectUri
        })
      });
      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        console.error('Finch token exchange failed:', err);
        res.writeHead(302, { Location: `/app?finch_error=${encodeURIComponent('Token exchange failed. Check credentials.')}` });
        return res.end();
      }
      const { access_token } = await tokenRes.json();
      if (user) {
        finchTokens.set(user.orgId, access_token);
        const org = organizations.get(user.orgId);
        if (org) org.finchConnected = true;
      }
      // Redirect back to the app workspace
      res.writeHead(302, { Location: '/app' });
      return res.end();
    } catch (err) {
      console.error('Finch callback error:', err.message);
      res.writeHead(302, { Location: `/app?finch_error=${encodeURIComponent(err.message)}` });
      return res.end();
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/stripe/webhook') {
    return sendJson(res, 200, {
      received: true,
      note: 'Stripe webhook endpoint scaffolded. Add signature verification and event persistence next.'
    });
  }

  // Finch Sync – pull real company + directory data from Finch API
  if (req.method === 'POST' && url.pathname === '/api/finch/sync') {
    const user = requireAuth(req, res);
    if (!user) return;
    const accessToken = finchTokens.get(user.orgId);
    if (!accessToken) {
      return sendJson(res, 400, { error: 'Finch not connected. Complete Finch Connect first.' });
    }
    try {
      const [company, directory] = await Promise.all([
        finchApi(accessToken, '/employer/company'),
        finchApi(accessToken, '/employer/directory')
      ]);
      const org = organizations.get(user.orgId);
      if (org) {
        org.companyName = company.legal_name || company.entity?.legal_name || org.companyName;
        org.employeeCount = directory.individuals?.length || org.employeeCount;
        org.ein = company.ein;
        org.departments = company.departments;
      }
      return sendJson(res, 200, {
        ok: true,
        company,
        directory: directory.individuals || [],
        organization: org
      });
    } catch (err) {
      return sendJson(res, 502, { error: `Finch sync failed: ${err.message}` });
    }
  }

  // Finch Company – get company details
  if (req.method === 'GET' && url.pathname === '/api/finch/company') {
    const user = requireAuth(req, res);
    if (!user) return;
    const accessToken = finchTokens.get(user.orgId);
    if (!accessToken) return sendJson(res, 400, { error: 'Finch not connected.' });
    try {
      const company = await finchApi(accessToken, '/employer/company');
      return sendJson(res, 200, company);
    } catch (err) {
      return sendJson(res, 502, { error: err.message });
    }
  }

  // Finch Directory – list all employees
  if (req.method === 'GET' && url.pathname === '/api/finch/directory') {
    const user = requireAuth(req, res);
    if (!user) return;
    const accessToken = finchTokens.get(user.orgId);
    if (!accessToken) return sendJson(res, 400, { error: 'Finch not connected.' });
    try {
      const directory = await finchApi(accessToken, '/employer/directory');
      return sendJson(res, 200, directory);
    } catch (err) {
      return sendJson(res, 502, { error: err.message });
    }
  }

  // Finch Individual – get details for specific employees
  if (req.method === 'POST' && url.pathname === '/api/finch/individual') {
    const user = requireAuth(req, res);
    if (!user) return;
    const accessToken = finchTokens.get(user.orgId);
    if (!accessToken) return sendJson(res, 400, { error: 'Finch not connected.' });
    try {
      const { requests } = await parseJson(req);
      const data = await finchApiPost(accessToken, '/employer/individual', { requests });
      return sendJson(res, 200, data);
    } catch (err) {
      return sendJson(res, 502, { error: err.message });
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
};
