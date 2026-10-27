import express from 'express';
import { MongoClient } from 'mongodb';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, '.env');
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const app = express();
const PORT = Number(process.env.PORT || 4000);
const PASSWORD_MIN_LENGTH = 12;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = 'relieflink_session';
const ROLES = ['Administrator', 'NGO partner', 'Shelter manager', 'Donor', 'Volunteer', 'Person in need'];
const scryptAsync = promisify(scrypt);
const EMPTY = { incidents: [], needs: [], offers: [], pledges: [], beneficiaryRequests: [], ngoProfiles: [], userProfiles: [], updatedAt: null };
const COLLECTIONS = ['incidents', 'needs', 'offers', 'pledges', 'beneficiaryRequests', 'ngoProfiles', 'userProfiles'];
const OFFICIAL_SOURCES = [
  { id: 'ndma', name: 'National Disaster Management Authority', type: 'Disaster guidance', url: 'https://ndma.gov.in/', access: 'Official portal; public reference' },
  { id: 'ndem', name: 'National Database for Emergency Management (NRSC/ISRO)', type: 'Disaster information', url: 'https://ndem.nrsc.gov.in/', access: 'Official portal; some services may require access' },
  { id: 'imd', name: 'India Meteorological Department', type: 'Weather alerts', url: 'https://mausam.imd.gov.in/', access: 'Official portal; public alerts and forecasts' },
  { id: 'sachet', name: 'SACHET National Disaster Alert Portal', type: 'Public alerts', url: 'https://sachet.ndma.gov.in/', access: 'Official portal; service availability may vary' },
  { id: 'ngodarpan', name: 'NGO Darpan (NITI Aayog)', type: 'NGO registration lookup', url: 'https://ngodarpan.gov.in/', access: 'Official registry portal; this app does not query its private systems' },
  { id: 'datagov', name: 'Open Government Data Platform India', type: 'Open datasets / API', url: 'https://www.data.gov.in/', access: 'API access requires a registered key and a selected dataset' }
];

app.use(express.json({ limit: '12mb' }));
app.use((req, _res, next) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return next();
  try {
    req.body = JSON.parse(req.body.toString('utf8'));
    next();
  } catch {
    next(new SyntaxError('Invalid JSON.'));
  }
});
app.use(express.static(path.join(__dirname, 'public')));

if (!process.env.MONGODB_URI) {
  throw new Error('MONGODB_URI is required. Add it to .env beside server.js before starting the server.');
}

const mongoClient = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
let mongoDb;
try {
  await mongoClient.connect();
  mongoDb = mongoClient.db(process.env.MONGODB_DB_NAME || 'relieflink');
} catch (error) {
  console.error('Could not connect to MongoDB. Check MONGODB_URI, credentials, and Atlas network access.', error.message);
  await mongoClient.close();
  throw error;
}

function cleanState(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('Workspace must be a JSON object.');
  const state = { ...EMPTY };
  for (const key of COLLECTIONS) {
    if (body[key] !== undefined && !Array.isArray(body[key])) throw new TypeError(`${key} must be an array.`);
    state[key] = body[key] || [];
    const ids = new Set();
    for (const record of state[key]) {
      if (!record || typeof record !== 'object' || Array.isArray(record) || !['string', 'number'].includes(typeof record.id) || !String(record.id).trim()) {
        throw new TypeError(`Every ${key} record must have an id.`);
      }
      if (ids.has(String(record.id))) throw new TypeError(`${key} contains a duplicate record id.`);
      ids.add(String(record.id));
    }
  }
  return state;
}

function mergeChanges(state, changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new TypeError('Changes must be a JSON object.');
  for (const key of COLLECTIONS) {
    const change = changes[key];
    if (change === undefined) continue;
    if (!change || !Array.isArray(change.upsert) || !Array.isArray(change.delete) || !Array.isArray(change.order)) {
      throw new TypeError(`${key} changes must include upsert, delete, and order arrays.`);
    }
    const records = new Map(state[key].map(record => [String(record.id), record]));
    for (const id of change.delete) {
      if (typeof id !== 'string' || !id) throw new TypeError(`${key} delete IDs must be non-empty strings.`);
      records.delete(id);
    }
    for (const record of change.upsert) {
      if (!record || typeof record !== 'object' || Array.isArray(record) || !['string', 'number'].includes(typeof record.id) || !String(record.id).trim()) {
        throw new TypeError(`Every ${key} change must include a record id.`);
      }
      records.set(String(record.id), record);
    }
    const order = [];
    const seen = new Set();
    for (const id of change.order) {
      if (typeof id !== 'string' || seen.has(id)) continue;
      if (records.has(id)) order.push(id);
      seen.add(id);
    }
    for (const id of records.keys()) if (!seen.has(id)) order.push(id);
    state[key] = order.map(id => records.get(id));
  }
  state.updatedAt = new Date().toISOString();
  return state;
}

async function initializeMongoStorage() {
  const workspaceCollection = mongoDb.collection('workspace_state');
  if (await workspaceCollection.findOne({ _id: 'workspace' })) return;

  const state = structuredClone(EMPTY);
  const existingRecords = await mongoDb.collection('workspace_records').find().sort({ collection: 1, position: 1 }).toArray();
  for (const record of existingRecords) {
    if (COLLECTIONS.includes(record.collection)) state[record.collection].push(record.payload);
  }
  const metadata = await mongoDb.collection('workspace_meta').findOne({ _id: 'workspace' });
  state.updatedAt = metadata?.updatedAt || null;
  await workspaceCollection.updateOne(
    { _id: 'workspace' },
    { $setOnInsert: { ...state, revision: 0 } },
    { upsert: true }
  );
}

async function readMongoState() {
  const document = await mongoDb.collection('workspace_state').findOne({ _id: 'workspace' });
  if (!document) return structuredClone(EMPTY);
  return Object.fromEntries([...COLLECTIONS.map(key => [key, document[key] || []]), ['updatedAt', document.updatedAt || null]]);
}

async function getWorkspaceState() {
  return readMongoState();
}

async function saveWorkspaceState(state) {
  state.updatedAt = new Date().toISOString();
  await mongoDb.collection('workspace_state').updateOne(
    { _id: 'workspace' },
    { $set: state, $inc: { revision: 1 } },
    { upsert: true }
  );
  return state;
}

async function synchronizeWorkspaceChanges(changes) {
  const workspaceCollection = mongoDb.collection('workspace_state');
  for (let attempt = 0; attempt < 10; attempt++) {
    const current = await workspaceCollection.findOne({ _id: 'workspace' });
    if (!current) throw new Error('MongoDB workspace has not been initialized.');
    const updated = mergeChanges(
      Object.fromEntries([...COLLECTIONS.map(key => [key, current[key] || []]), ['updatedAt', current.updatedAt || null]]),
      changes
    );
    const result = await workspaceCollection.updateOne(
      { _id: 'workspace', revision: current.revision },
      { $set: updated, $inc: { revision: 1 } }
    );
    if (result.matchedCount === 1) return updated;
  }
  throw new Error('Could not synchronize workspace changes after repeated concurrent updates.');
}

await initializeMongoStorage();

const accounts = mongoDb.collection('accounts');
const sessions = mongoDb.collection('account_sessions');
await accounts.createIndex({ email: 1 }, { unique: true });
await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

function publicAccount(account) {
  return {
    name: account.name,
    email: account.email,
    role: account.role,
    verificationId: account.verificationId
  };
}

function sessionCookie(value, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

function readSessionToken(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookie = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`));
  return cookie ? cookie.slice(SESSION_COOKIE.length + 1) : '';
}

async function createSession(res, account) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
  await sessions.insertOne({
    tokenHash: createHash('sha256').update(token).digest('hex'),
    userId: account._id,
    expiresAt
  });
  res.setHeader('Set-Cookie', sessionCookie(token, Math.floor(SESSION_MAX_AGE_MS / 1000)));
}

async function findSessionAccount(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const session = await sessions.findOne({
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: { $gt: new Date() }
  });
  if (!session) return null;
  return accounts.findOne({ _id: session.userId });
}

async function requireAuth(req, res, next) {
  try {
    req.account = await findSessionAccount(req);
    if (!req.account) return res.status(401).json({ error: 'Sign in to access the workspace.' });
    next();
  } catch (error) {
    console.error('Could not validate account session:', error);
    res.status(500).json({ error: 'Could not validate your sign-in session.' });
  }
}

async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = await scryptAsync(password, salt, 64);
  return { salt, passwordHash: hash.toString('hex') };
}

async function verifyPassword(password, account) {
  const hash = await scryptAsync(password, account.passwordSalt, 64);
  const storedHash = Buffer.from(account.passwordHash, 'hex');
  return storedHash.length === hash.length && timingSafeEqual(storedHash, hash);
}

async function saveAccountProfile(account) {
  const profileId = `${account.role.toLowerCase()}:${account.email}`;
  const existing = (await getWorkspaceState()).userProfiles.find(profile => profile.id === profileId) || {};
  const profile = {
    ...existing,
    id: profileId,
    email: account.email,
    name: account.name,
    role: account.role,
    verificationId: account.verificationId,
    ngoProofId: ['NGO partner', 'Shelter manager'].includes(account.role) ? account.verificationId : '',
    updatedAt: new Date().toISOString()
  };
  const changes = { userProfiles: { upsert: [profile], delete: [], order: [] } };
  if (['NGO partner', 'Shelter manager'].includes(account.role)) {
    const currentState = await getWorkspaceState();
    const ngoProfile = currentState.ngoProfiles.find(item => item.email === account.email);
    changes.ngoProfiles = {
      upsert: [{
        ...ngoProfile,
        id: account.email,
        email: account.email,
        name: account.name,
        ngoProofId: account.verificationId,
        role: account.role,
        updatedAt: profile.updatedAt
      }],
      delete: currentState.ngoProfiles.filter(item => item.email === account.email && item.id !== account.email).map(item => String(item.id)),
      order: []
    };
  }
  await synchronizeWorkspaceChanges(changes);
}

app.post('/api/auth/register', async (req, res) => {
  const { name, email, role, verificationId, password, adminSignupCode } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    || typeof verificationId !== 'string' || !verificationId.trim() || verificationId.trim().length > 120
    || typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > 128
    || !ROLES.includes(role)) {
    return res.status(400).json({ error: 'Enter a valid name, email, role, verification ID, and password of at least 12 characters.' });
  }
  if (role === 'Administrator' && (!process.env.ADMIN_SIGNUP_CODE || adminSignupCode !== process.env.ADMIN_SIGNUP_CODE)) {
    const error = process.env.ADMIN_SIGNUP_CODE
      ? 'Administrator invitation code is incorrect.'
      : 'Administrator registration is disabled until the system owner configures ADMIN_SIGNUP_CODE.';
    return res.status(403).json({ error });
  }

  try {
    const { salt, passwordHash } = await hashPassword(password);
    const account = {
      _id: normalizedEmail,
      name: name.trim(),
      email: normalizedEmail,
      role,
      verificationId: verificationId.trim(),
      passwordSalt: salt,
      passwordHash,
      createdAt: new Date()
    };
    await accounts.insertOne(account);
    try {
      await saveAccountProfile(account);
      await createSession(res, account);
    } catch (error) {
      await accounts.deleteOne({ _id: account._id });
      throw error;
    }
    res.status(201).json({ user: publicAccount(account) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
    console.error('Could not create account:', error);
    res.status(500).json({ error: 'Could not create your account. Please try again.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalizedEmail || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Enter your email address and password.' });
  }
  try {
    const account = await accounts.findOne({ email: normalizedEmail });
    if (!account || !await verifyPassword(password, account)) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    await createSession(res, account);
    res.json({ user: publicAccount(account) });
  } catch (error) {
    console.error('Could not sign in:', error);
    res.status(500).json({ error: 'Could not sign in. Please try again.' });
  }
});

app.get('/api/auth/session', async (req, res) => {
  try {
    const account = await findSessionAccount(req);
    res.json({ user: account ? publicAccount(account) : null });
  } catch (error) {
    console.error('Could not restore account session:', error);
    res.status(500).json({ error: 'Could not restore your sign-in session.' });
  }
});
app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = readSessionToken(req);
    if (token) await sessions.deleteOne({ tokenHash: createHash('sha256').update(token).digest('hex') });
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    res.status(204).end();
  } catch (error) {
    console.error('Could not sign out:', error);
    res.status(500).json({ error: 'Could not sign out. Please try again.' });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'ReliefLink India API', database: 'mongodb' }));
app.get('/api/sources', (_req, res) => res.json({ sources: OFFICIAL_SOURCES, liveDataConnected: false }));
app.get('/api/state', requireAuth, async (_req, res) => {
  try { res.json(await getWorkspaceState()); } catch (error) { console.error('Could not read workspace data:', error); res.status(500).json({ error: 'Could not read workspace data.' }); }
});
app.put('/api/state', requireAuth, async (req, res) => {
  let clean;
  try { clean = cleanState(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  try { res.json(await saveWorkspaceState(clean)); } catch (error) { console.error('Could not save workspace data:', error); res.status(500).json({ error: 'Could not save workspace data.' }); }
});
app.patch('/api/state', requireAuth, async (req, res) => {
  try { res.json(await synchronizeWorkspaceChanges(req.body)); } catch (error) {
    if (error instanceof TypeError) return res.status(400).json({ error: error.message });
    console.error('Could not synchronize workspace changes:', error);
    res.status(500).json({ error: 'Could not synchronize workspace changes.' });
  }
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError) return res.status(400).json({ error: 'Invalid JSON.' });
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

export { app };

if (process.env.NETLIFY !== 'true') {
  app.listen(PORT, () => {
    console.log(`ReliefLink India running at http://localhost:${PORT}`);
    console.log(`MongoDB connected: ${mongoDb.databaseName}`);
  });
}
