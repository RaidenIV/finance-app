import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import bcrypt from 'bcryptjs';
import connectMongo from 'connect-mongo';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import helmet from 'helmet';
import mongoose from 'mongoose';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI;
const SESSION_SECRET = process.env.SESSION_SECRET;
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);

if (!MONGO_URL) {
  console.error('MONGO_URL or MONGODB_URI is required.');
  process.exit(1);
}

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be configured with at least 32 characters.');
  process.exit(1);
}

mongoose.set('strictQuery', true);
await mongoose.connect(MONGO_URL, {
  serverSelectionTimeoutMS: 15_000,
  maxPoolSize: 10
});

const householdSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  inviteCode: { type: String, required: true, unique: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true },
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true, index: true },
  role: { type: String, enum: ['owner', 'member'], default: 'member' }
}, { timestamps: true });

const householdStateSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true, unique: true, index: true },
  state: { type: mongoose.Schema.Types.Mixed, required: true },
  version: { type: Number, default: 1, min: 1 }
}, { timestamps: true, minimize: false });

const Household = mongoose.model('Household', householdSchema);
const User = mongoose.model('User', userSchema);
const HouseholdState = mongoose.model('HouseholdState', householdStateSchema);

function defaultState({ householdName = 'Our Household', memberName = 'Person 1' } = {}) {
  return {
    household: { name: householdName, currency: 'USD', weekStart: 'sunday' },
    members: [
      { id: 'member-1', name: memberName },
      { id: 'member-2', name: 'Person 2' },
      { id: 'shared', name: 'Shared' }
    ],
    accounts: [
      { id: 'account-joint', name: 'Joint Checking', type: 'checking', owner: 'shared', institution: '' },
      { id: 'account-credit', name: 'Household Credit Card', type: 'credit', owner: 'shared', institution: '' }
    ],
    transactions: [],
    rules: [
      { id: 'rule-1', field: 'merchant', operator: 'contains', value: 'KROGER', category: 'Groceries', owner: 'shared', type: 'expense', priority: 50 },
      { id: 'rule-2', field: 'merchant', operator: 'contains', value: 'NETFLIX', category: 'Entertainment', owner: 'shared', type: 'expense', priority: 100 }
    ],
    imports: [],
    settings: { compactRows: false, hideCents: false }
  };
}

function createInviteCode() {
  return randomBytes(5).toString('hex').toUpperCase();
}

async function uniqueInviteCode() {
  for (let i = 0; i < 8; i += 1) {
    const code = createInviteCode();
    if (!(await Household.exists({ inviteCode: code }))) return code;
  }
  throw new Error('Unable to create a unique invite code.');
}

function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    householdId: String(user.householdId)
  };
}

function normalizeState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const cloned = structuredClone(input);
  const arrays = ['members', 'accounts', 'transactions', 'rules', 'imports'];
  if (!cloned.household || typeof cloned.household !== 'object') return null;
  if (!cloned.settings || typeof cloned.settings !== 'object') cloned.settings = {};
  for (const key of arrays) {
    if (!Array.isArray(cloned[key])) return null;
  }
  if (JSON.stringify(cloned).length > 8_000_000) return null;
  return cloned;
}

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      workerSrc: ["'self'", 'blob:', 'https://cdnjs.cloudflare.com'],
      connectSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '10mb' }));

const MongoStore = connectMongo.create({
  mongoUrl: MONGO_URL,
  collectionName: 'sessions',
  ttl: 60 * 60 * 24 * 14,
  autoRemove: 'native'
});

app.use(session({
  name: 'homeledger.sid',
  secret: SESSION_SECRET,
  store: MongoStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' }
});


async function establishSession(req, user) {
  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.userId = String(user._id);
  req.session.householdId = String(user.householdId);
  await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
}

function requireAuth(req, res, next) {
  if (!req.session.userId || !req.session.householdId) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  next();
}

function requireSameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    const originUrl = new URL(origin);
    const expectedHost = req.get('host');
    if (originUrl.host !== expectedHost) {
      res.status(403).json({ error: 'Request origin was rejected.' });
      return;
    }
  } catch {
    res.status(403).json({ error: 'Request origin was rejected.' });
    return;
  }
  next();
}
app.use('/api', requireSameOrigin);

app.get('/health', (_req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({ status: connected ? 'ok' : 'degraded', database: connected ? 'connected' : 'disconnected' });
});

app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const householdName = String(req.body?.householdName || '').trim();
    const inviteCode = String(req.body?.inviteCode || '').trim().toUpperCase().replace(/\s+/g, '');

    if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Enter a valid name.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Password must be 8–128 characters.' });
    if (await User.exists({ email })) return res.status(409).json({ error: 'An account already exists for that email.' });

    let household;
    let role = 'member';
    let createdHousehold = false;

    if (inviteCode) {
      household = await Household.findOne({ inviteCode });
      if (!household) return res.status(404).json({ error: 'That household invite code was not found.' });
    } else {
      if (householdName.length < 2 || householdName.length > 60) return res.status(400).json({ error: 'Enter a household name.' });
      household = await Household.create({ name: householdName, inviteCode: await uniqueInviteCode() });
      role = 'owner';
      createdHousehold = true;
    }

    let user;
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      user = await User.create({ name, email, passwordHash, householdId: household._id, role });

      if (createdHousehold) {
        household.createdBy = user._id;
        await household.save();
        await HouseholdState.create({ householdId: household._id, state: defaultState({ householdName: household.name, memberName: name }), version: 1 });
      } else {
        const stateDoc = await HouseholdState.findOne({ householdId: household._id });
        if (stateDoc) {
          const available = stateDoc.state.members?.find(member => member.id !== 'shared' && /^Person\s+\d+$/i.test(String(member.name || '')));
          if (available) {
            available.name = name;
            stateDoc.markModified('state');
            stateDoc.version += 1;
            await stateDoc.save();
          }
        }
      }

      await establishSession(req, user);
      res.status(201).json({ user: publicUser(user), household: { id: String(household._id), name: household.name, inviteCode: household.inviteCode } });
    } catch (error) {
      if (user?._id) await User.deleteOne({ _id: user._id }).catch(() => {});
      if (createdHousehold) {
        await HouseholdState.deleteOne({ householdId: household._id }).catch(() => {});
        await Household.deleteOne({ _id: household._id }).catch(() => {});
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = await User.findOne({ email });
    const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !valid) return res.status(401).json({ error: 'Email or password is incorrect.' });
    const household = await Household.findById(user.householdId);
    if (!household) return res.status(409).json({ error: 'The household for this account is unavailable.' });

    await establishSession(req, user);
    res.json({ user: publicUser(user), household: { id: String(household._id), name: household.name, inviteCode: household.inviteCode } });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res, next) => {
  try {
    await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
    res.clearCookie('homeledger.sid');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', async (req, res, next) => {
  try {
    if (!req.session.userId || !req.session.householdId) return res.status(401).json({ error: 'Authentication required.' });
    const [user, household] = await Promise.all([
      User.findById(req.session.userId),
      Household.findById(req.session.householdId)
    ]);
    if (!user || !household) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Authentication required.' });
    }
    res.json({ user: publicUser(user), household: { id: String(household._id), name: household.name, inviteCode: household.inviteCode } });
  } catch (error) {
    next(error);
  }
});

app.get('/api/state', requireAuth, async (req, res, next) => {
  try {
    let doc = await HouseholdState.findOne({ householdId: req.session.householdId }).lean();
    if (!doc) {
      const household = await Household.findById(req.session.householdId).lean();
      doc = await HouseholdState.create({ householdId: req.session.householdId, state: defaultState({ householdName: household?.name || 'Our Household' }), version: 1 });
    }
    res.json({ state: doc.state, version: doc.version, updatedAt: doc.updatedAt });
  } catch (error) {
    next(error);
  }
});

app.put('/api/state', requireAuth, async (req, res, next) => {
  try {
    const state = normalizeState(req.body?.state);
    const version = Number(req.body?.version);
    if (!state || !Number.isInteger(version) || version < 1) return res.status(400).json({ error: 'Invalid household state payload.' });

    const updated = await HouseholdState.findOneAndUpdate(
      { householdId: req.session.householdId, version },
      { $set: { state }, $inc: { version: 1 } },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) {
      const latest = await HouseholdState.findOne({ householdId: req.session.householdId }).lean();
      return res.status(409).json({ error: 'Household data changed on another device.', state: latest?.state, version: latest?.version, updatedAt: latest?.updatedAt });
    }

    const nextName = String(state.household?.name || '').trim();
    if (nextName) await Household.updateOne({ _id: req.session.householdId }, { $set: { name: nextName.slice(0, 60) } });
    res.json({ version: updated.version, updatedAt: updated.updatedAt });
  } catch (error) {
    next(error);
  }
});

app.post('/api/state/reset', requireAuth, async (req, res, next) => {
  try {
    const [household, user, existing] = await Promise.all([
      Household.findById(req.session.householdId).lean(),
      User.findById(req.session.userId).lean(),
      HouseholdState.findOne({ householdId: req.session.householdId }).lean()
    ]);
    if (user?.role !== 'owner') return res.status(403).json({ error: 'Only the household owner can reset household data.' });
    const state = defaultState({ householdName: existing?.state?.household?.name || household?.name || 'Our Household', memberName: existing?.state?.members?.[0]?.name || user?.name || 'Person 1' });
    if (Array.isArray(existing?.state?.members) && existing.state.members.length) state.members = existing.state.members;
    const doc = await HouseholdState.findOneAndUpdate(
      { householdId: req.session.householdId },
      { $set: { state }, $inc: { version: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    res.json({ state: doc.state, version: doc.version, updatedAt: doc.updatedAt });
  } catch (error) {
    next(error);
  }
});

app.post('/api/household/invite-code', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.session.userId).lean();
    if (user?.role !== 'owner') return res.status(403).json({ error: 'Only the household owner can generate a new invite code.' });
    const inviteCode = await uniqueInviteCode();
    const household = await Household.findByIdAndUpdate(req.session.householdId, { $set: { inviteCode } }, { new: true }).lean();
    res.json({ inviteCode: household.inviteCode });
  } catch (error) {
    next(error);
  }
});

const PUBLIC_DIR = join(__dirname, 'public');

app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: IS_PRODUCTION ? '1h' : 0,
  setHeaders(res, path) {
    if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
app.use((req, res, next) => {
  if (req.method === 'GET' && req.accepts('html')) {
    res.sendFile(join(PUBLIC_DIR, 'index.html'));
    return;
  }
  next();
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.code === 11000) return res.status(409).json({ error: 'That email or invite code is already in use.' });
  res.status(500).json({ error: 'The server could not complete that request.' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`HomeLedger is running on port ${PORT}`);
});

function shutdown(signal) {
  console.log(`${signal} received. Closing HomeLedger...`);
  server.close(async () => {
    await mongoose.connection.close().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
