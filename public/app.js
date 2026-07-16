const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

const DEFAULT_CATEGORIES = [
  'Housing', 'Mortgage', 'Rent', 'Auto Payment', 'Loan Repayment', 'Insurance',
  'Groceries', 'Dining', 'Restaurants', 'Transportation', 'Gas', 'Car Payment',
  'Bills & Utilities', 'Gas & Electric', 'Internet & Cable', 'Phone', 'Subscriptions',
  'Shopping', 'Clothing', 'Home Improvement', 'Furniture & Housewares', 'Entertainment',
  'Health & Wellness', 'Fitness', 'Education', 'Pets', 'Travel', 'Gifts & Donations',
  'Personal Care', 'Garbage', 'Income', 'Paychecks', 'Interest', 'Transfer', 'Other'
];

const CATEGORY_COLORS = {
  'Housing': '#02a7c8', 'Mortgage': '#02a7c8', 'Rent': '#02a7c8',
  'Groceries': '#ffc43d', 'Dining': '#ff6532', 'Restaurants': '#ff6532',
  'Transportation': '#2aa876', 'Gas': '#8e5ad7', 'Car Payment': '#02a7c8',
  'Bills & Utilities': '#5cc8df', 'Gas & Electric': '#2fb06f', 'Internet & Cable': '#95dc5a', 'Phone': '#3f72db',
  'Shopping': '#ff6532', 'Clothing': '#71d2e8', 'Entertainment': '#d53f9d',
  'Health & Wellness': '#dc8d6d', 'Insurance': '#8e5ad7', 'Education': '#ca8cff',
  'Pets': '#71d2e8', 'Travel': '#2aa876', 'Gifts & Donations': '#dc8d6d',
  'Personal Care': '#ed9ac4', 'Home Improvement': '#0ba5c2', 'Furniture & Housewares': '#2aa876',
  'Auto Payment': '#02a7c8', 'Loan Repayment': '#2aa876', 'Garbage': '#ffc43d', 'Fitness': '#95dc5a',
  'Subscriptions': '#d53f9d', 'Income': '#2d8a45', 'Paychecks': '#2d8a45', 'Interest': '#2d8a45',
  'Transfer': '#2f80ed', 'Other': '#b9b4aa'
};

const DEFAULT_STATE = {
  household: { name: 'Our Household', currency: 'USD', weekStart: 'sunday' },
  members: [
    { id: 'member-1', name: 'Person 1' },
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
  budgets: {},
  goals: [
    { id: 'goal-emergency', name: 'Emergency fund', target: 5000, saved: 0, dueDate: '' }
  ],
  settings: { compactRows: false, hideCents: false }
};

let state = structuredClone(DEFAULT_STATE);
let currentView = 'dashboard';
let currentReportMode = 'spending';
let selectedTransactionIds = new Set();
let importDraft = null;
let transactionPage = 1;
let currentUser = null;
let householdMeta = null;
let serverVersion = 1;
let lastServerUpdate = null;
let appInitialized = false;
let saveTimer = null;
let savePending = false;
let saveRunning = false;
let joinHousehold = false;
let pendingImportedTypeRepairs = 0;
const PAGE_SIZE = 25;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));

class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers,
    ...options,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data?.error || 'The request could not be completed.', response.status, data || {});
  return data;
}

function normalizeLoadedState(saved) {
  if (!saved || typeof saved !== 'object') {
    pendingImportedTypeRepairs = 0;
    return structuredClone(DEFAULT_STATE);
  }
  const normalized = {
    ...structuredClone(DEFAULT_STATE),
    ...saved,
    household: { ...DEFAULT_STATE.household, ...(saved.household || {}) },
    settings: { ...DEFAULT_STATE.settings, ...(saved.settings || {}) },
    members: Array.isArray(saved.members) && saved.members.length ? saved.members : structuredClone(DEFAULT_STATE.members),
    accounts: Array.isArray(saved.accounts) && saved.accounts.length ? saved.accounts : structuredClone(DEFAULT_STATE.accounts),
    transactions: Array.isArray(saved.transactions) ? saved.transactions : [],
    rules: Array.isArray(saved.rules) ? saved.rules : [],
    imports: Array.isArray(saved.imports) ? saved.imports : [],
    budgets: saved.budgets && typeof saved.budgets === 'object' ? saved.budgets : {},
    goals: Array.isArray(saved.goals) && saved.goals.length ? saved.goals : structuredClone(DEFAULT_STATE.goals)
  };
  pendingImportedTypeRepairs = repairImportedTransactionTypes(normalized);
  return normalized;
}

function setSyncStatus(status, label) {
  const pill = $('#syncPill');
  if (pill) {
    pill.classList.toggle('saving', status === 'saving');
    pill.classList.toggle('error', status === 'error');
  }
  if ($('#syncStatusText')) $('#syncStatusText').textContent = label;
  if ($('#settingsSyncStatus')) $('#settingsSyncStatus').textContent = label;
}

function updateLastServerUpdate(value) {
  lastServerUpdate = value || new Date().toISOString();
  if ($('#lastServerUpdate')) {
    const parsed = new Date(lastServerUpdate);
    $('#lastServerUpdate').textContent = Number.isNaN(parsed.getTime()) ? 'Just now' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(parsed);
  }
}

function saveState(options = {}) {
  savePending = true;
  setSyncStatus('saving', 'Saving');
  clearTimeout(saveTimer);
  if (options.immediate) return persistState();
  saveTimer = setTimeout(() => persistState(), 350);
  return Promise.resolve();
}

async function persistState() {
  clearTimeout(saveTimer);
  if (saveRunning || !savePending || !currentUser) return;
  saveRunning = true;
  try {
    while (savePending) {
      savePending = false;
      const snapshot = structuredClone(state);
      const result = await apiRequest('/api/state', { method: 'PUT', body: { state: snapshot, version: serverVersion } });
      serverVersion = result.version;
      updateLastServerUpdate(result.updatedAt);
    }
    setSyncStatus('synced', 'Synced');
  } catch (error) {
    if (error.status === 409 && error.data?.state) {
      state = normalizeLoadedState(error.data.state);
      serverVersion = error.data.version || serverVersion;
      updateLastServerUpdate(error.data.updatedAt);
      savePending = false;
      hydrateAllSelects();
      applyDisplaySettings();
      renderAll();
      setSyncStatus('synced', 'Reloaded');
      toast('Newer household data loaded', 'Another device saved changes first, so HomeLedger reloaded the latest server copy.');
    } else if (error.status === 401) {
      showSignedOut();
    } else {
      savePending = true;
      setSyncStatus('error', 'Save failed');
      toast('Could not sync changes', 'Your edits remain open in this browser. Check the connection and try Refresh from server.');
    }
  } finally {
    saveRunning = false;
    if (savePending && currentUser) saveTimer = setTimeout(() => persistState(), 1000);
  }
}

async function refreshState({ announce = true } = {}) {
  setSyncStatus('saving', 'Refreshing');
  try {
    const result = await apiRequest('/api/state');
    state = normalizeLoadedState(result.state);
    serverVersion = result.version || 1;
    updateLastServerUpdate(result.updatedAt);
    selectedTransactionIds.clear();
    hydrateAllSelects();
    applyDisplaySettings();
    renderAll();
    renderSessionInfo();
    setSyncStatus('synced', 'Synced');
    persistPendingImportedTypeRepairs();
    if (announce) toast('Household refreshed', 'The latest MongoDB-backed household data is now displayed.');
  } catch (error) {
    setSyncStatus('error', 'Refresh failed');
    if (error.status === 401) showSignedOut();
    else if (announce) toast('Could not refresh data', error.message);
  }
}

function showAuthMessage(message, success = false) {
  const element = $('#authMessage');
  element.textContent = message;
  element.classList.remove('hidden');
  element.classList.toggle('success', success);
}

function clearAuthMessage() {
  $('#authMessage').classList.add('hidden');
  $('#authMessage').classList.remove('success');
  $('#authMessage').textContent = '';
}

function switchAuthTab(tab) {
  const login = tab === 'login';
  $('#loginTab').classList.toggle('active', login);
  $('#registerTab').classList.toggle('active', !login);
  $('#loginTab').setAttribute('aria-selected', String(login));
  $('#registerTab').setAttribute('aria-selected', String(!login));
  $('#loginForm').classList.toggle('hidden', !login);
  $('#registerForm').classList.toggle('hidden', login);
  clearAuthMessage();
}

function setJoinHouseholdMode(join) {
  joinHousehold = join;
  $('#createHouseholdMode').classList.toggle('active', !join);
  $('#joinHouseholdMode').classList.toggle('active', join);
  $('#householdNameGroup').classList.toggle('hidden', join);
  $('#inviteCodeGroup').classList.toggle('hidden', !join);
  $('#registerHouseholdName').required = !join;
  $('#registerInviteCode').required = join;
}

function bindAuth() {
  $('#loginTab').addEventListener('click', () => switchAuthTab('login'));
  $('#registerTab').addEventListener('click', () => switchAuthTab('register'));
  $('#createHouseholdMode').addEventListener('click', () => setJoinHouseholdMode(false));
  $('#joinHouseholdMode').addEventListener('click', () => setJoinHouseholdMode(true));
  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    clearAuthMessage();
    const button = $('button[type="submit"]', event.currentTarget);
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      const session = await apiRequest('/api/auth/login', { method: 'POST', body: { email: $('#loginEmail').value, password: $('#loginPassword').value } });
      await startAuthenticatedSession(session);
      event.currentTarget.reset();
    } catch (error) {
      showAuthMessage(error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });
  $('#registerForm').addEventListener('submit', async event => {
    event.preventDefault();
    clearAuthMessage();
    const button = $('button[type="submit"]', event.currentTarget);
    button.disabled = true;
    button.textContent = joinHousehold ? 'Joining household…' : 'Creating household…';
    try {
      const payload = {
        name: $('#registerName').value,
        email: $('#registerEmail').value,
        password: $('#registerPassword').value,
        householdName: joinHousehold ? '' : $('#registerHouseholdName').value,
        inviteCode: joinHousehold ? $('#registerInviteCode').value : ''
      };
      const session = await apiRequest('/api/auth/register', { method: 'POST', body: payload });
      await startAuthenticatedSession(session);
      event.currentTarget.reset();
      setJoinHouseholdMode(false);
    } catch (error) {
      showAuthMessage(error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Create account';
    }
  });
}

async function bootstrap() {
  try {
    const session = await apiRequest('/api/auth/me');
    await startAuthenticatedSession(session);
  } catch (error) {
    showSignedOut(false);
    if (error.status !== 401) showAuthMessage('HomeLedger could not reach the server. Please refresh and try again.');
  }
}

async function startAuthenticatedSession(session) {
  currentUser = session.user;
  householdMeta = session.household;
  const result = await apiRequest('/api/state');
  state = normalizeLoadedState(result.state);
  serverVersion = result.version || 1;
  updateLastServerUpdate(result.updatedAt);
  $('#authScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  if (!appInitialized) {
    init();
    appInitialized = true;
  } else {
    hydrateAllSelects();
    applyDisplaySettings();
    renderAll();
    switchView('dashboard');
  }
  renderSessionInfo();
  setSyncStatus('synced', 'Synced');
  persistPendingImportedTypeRepairs();
}

function showSignedOut(clearSession = true) {
  if (clearSession) {
    currentUser = null;
    householdMeta = null;
  }
  clearTimeout(saveTimer);
  savePending = false;
  $('#appShell').classList.add('hidden');
  $('#authScreen').classList.remove('hidden');
  switchAuthTab('login');
}

function renderSessionInfo() {
  if (!currentUser) return;
  if ($('#sessionUserName')) $('#sessionUserName').textContent = currentUser.name;
  if ($('#sessionUserEmail')) $('#sessionUserEmail').textContent = currentUser.email;
  if ($('#sessionAvatar')) $('#sessionAvatar').textContent = String(currentUser.name || 'H').trim().charAt(0).toUpperCase();
  if ($('#householdInviteCode')) $('#householdInviteCode').textContent = householdMeta?.inviteCode || '—';
  const ownerOnly = currentUser.role !== 'owner';
  if ($('#regenerateInviteCodeBtn')) $('#regenerateInviteCodeBtn').classList.toggle('hidden', ownerOnly);
  if ($('#clearAllDataBtn')) $('#clearAllDataBtn').classList.toggle('hidden', ownerOnly);
  updateLastServerUpdate(lastServerUpdate);
}

async function logout() {
  await persistState();
  try { await apiRequest('/api/auth/logout', { method: 'POST' }); } catch {}
  showSignedOut();
  toast('Signed out', 'Your household data remains securely stored in MongoDB.');
}

async function copyInviteCode() {
  const code = householdMeta?.inviteCode;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    toast('Invite code copied', 'Your wife can use this code when creating her HomeLedger login.');
  } catch {
    window.prompt('Copy this household invite code:', code);
  }
}

async function regenerateInviteCode() {
  if (!confirm('Generate a new household invite code? The current code will stop working.')) return;
  try {
    const result = await apiRequest('/api/household/invite-code', { method: 'POST' });
    householdMeta.inviteCode = result.inviteCode;
    renderSessionInfo();
    toast('New invite code created', 'Only the new code can be used to join this household.');
  } catch (error) {
    toast('Could not create invite code', error.message);
  }
}

function getCurrencyFormatter(decimals = true) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency', currency: state.household.currency || 'USD',
    minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0
  });
}

function money(amount, options = {}) {
  const hide = options.forceDecimals ? false : state.settings.hideCents;
  return getCurrencyFormatter(!hide).format(Number(amount || 0));
}

function formatDate(date) {
  if (!date) return '—';
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

function monthKey(date) { return String(date || '').slice(0, 7); }
function currentMonthKey() { return new Date().toISOString().slice(0, 7); }
function previousMonth(key) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return d.toISOString().slice(0, 7);
}
function daysBetween(a, b) { return Math.abs((new Date(a) - new Date(b)) / 86400000); }
function memberName(id) { return state.members.find(m => m.id === id)?.name || 'Unassigned'; }
function accountName(id) { return state.accounts.find(a => a.id === id)?.name || 'Unassigned'; }
function accountDisplayName(id) {
  if (importDraft?.account === id && importDraft.accountName) return importDraft.accountName;
  return accountName(id);
}
function normalizeAccountKey(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function titleCaseWords(value = '') {
  return String(value).toLowerCase().replace(/\b[a-z0-9]/g, ch => ch.toUpperCase()).replace(/\s+/g, ' ').trim();
}
function statementFileStem(fileName = '') {
  return String(fileName).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function detectInstitution(text = '') {
  const value = String(text || '');
  const institutions = ['Chase', 'Capital One', 'American Express', 'Amex', 'Discover', 'Citi', 'Citibank', 'Bank of America', 'Wells Fargo', 'US Bank', 'U.S. Bank', 'PNC', 'Fifth Third', 'Huntington', 'Navy Federal', 'SoFi', 'Venmo', 'Cash App', 'PayPal'];
  return institutions.find(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=[^a-z0-9]|\\d|$)`, 'i').test(value);
  }) || '';
}
function detectAccountLast4(text = '') {
  const value = String(text || '');
  const patterns = [
    /(?:account|acct|card)(?:\s*(?:number|no\.?|#))?\s*(?:ending\s*(?:in)?|x{2,}|\*{2,}|\.{2,})?\s*(\d{4})\b/i,
    /(?:ending\s*(?:in)?|last\s*4)\s*(\d{4})\b/i,
    /(?:chase|account|acct|card)\s*(\d{4})\b/i
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1];
  }
  return '';
}
function detectAccountTypeFromText(text = '') {
  const value = String(text || '').toLowerCase();
  if (/credit card|cardmember|minimum payment|available credit|credit limit|statement balance|payment due/.test(value)) return 'credit';
  if (/savings|save\b|sav\b/.test(value)) return 'savings';
  if (/checking|chk\b|debit card|ach_credit|ach_debit|acct_xfer|account transfer|posting date/.test(value)) return 'checking';
  return 'checking';
}
function cleanDetectedAccountName(name = '') {
  return String(name || '')
    .replace(/\bactivity\b.*$/i, '')
    .replace(/\bstatement\b.*$/i, '')
    .replace(/\btransactions?\b.*$/i, '')
    .replace(/\b\d{8}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function extractStatementAccountMetadata({ fileName = '', text = '', rows = [], headers = [] } = {}) {
  const headerText = headers.join(' ');
  const rowText = rows.slice(0, 12).map(row => row.join(' ')).join(' ');
  const combined = `${fileName} ${headerText} ${text || rowText}`.replace(/\s+/g, ' ').trim();
  const institution = detectInstitution(combined);
  const last4 = detectAccountLast4(combined);
  const accountType = detectAccountTypeFromText(combined);
  const explicitNamePatterns = [
    /account\s+name\s*[:\-]\s*([^\n\r|,]+)/i,
    /account\s+summary\s+for\s+([^\n\r|,]+)/i,
    /statement\s+for\s+([^\n\r|,]+)/i
  ];
  let name = '';
  for (const pattern of explicitNamePatterns) {
    const match = String(text || '').match(pattern);
    if (match) { name = cleanDetectedAccountName(match[1]); break; }
  }
  if (!name) {
    const stem = cleanDetectedAccountName(statementFileStem(fileName).replace(/([A-Za-z])(?=\d{4}\b)/g, '$1 '));
    if (institution && last4) name = `${institution} ${last4}`;
    else if (stem) name = titleCaseWords(stem);
  }
  if (!name) name = `${institution || 'Imported'} ${accountType === 'credit' ? 'Credit Card' : 'Account'}${last4 ? ` ${last4}` : ''}`.trim();
  const importKey = normalizeAccountKey([institution, accountType, last4 || name].filter(Boolean).join('-'));
  return { institution, last4, accountType, name, importKey, source: last4 || institution ? 'statement' : 'file name' };
}
function findExistingAccountForMetadata(metadata = {}) {
  const importKey = normalizeAccountKey(metadata.importKey || '');
  const normalizedName = normalizeAccountKey(metadata.name || '');
  return state.accounts.find(account => {
    const accountKey = normalizeAccountKey(account.importKey || '');
    const accountNameKey = normalizeAccountKey(account.name || '');
    const sameImportKey = importKey && accountKey && accountKey === importKey;
    const sameLast4 = metadata.last4 && account.last4 === metadata.last4 && (!metadata.institution || !account.institution || normalizeAccountKey(metadata.institution) === normalizeAccountKey(account.institution));
    const sameName = normalizedName && accountNameKey === normalizedName;
    return sameImportKey || sameLast4 || sameName;
  });
}
function resolveStatementAccount(file, parsedRows, fallbackAccount = {}) {
  const metadata = parsedRows?.metadata || extractStatementAccountMetadata({ fileName: file?.name || '' });
  const existing = findExistingAccountForMetadata(metadata);
  if (existing) {
    return { accountId: existing.id, accountRecord: existing, accountName: existing.name, accountIsNew: false, metadata, detectionLabel: `Matched ${existing.name}` };
  }
  const fallbackHasOnlyDefault = fallbackAccount && /^account-(joint|credit)$/.test(String(fallbackAccount.id || ''));
  const hasStatementIdentity = !!(metadata.last4 || metadata.institution || metadata.source === 'statement');
  if (!hasStatementIdentity && fallbackAccount?.id && !fallbackHasOnlyDefault) {
    return { accountId: fallbackAccount.id, accountRecord: fallbackAccount, accountName: fallbackAccount.name, accountIsNew: false, metadata, detectionLabel: `Fallback: ${fallbackAccount.name}` };
  }
  let baseId = `account-${normalizeAccountKey(metadata.importKey || metadata.name || uid('imported-account'))}`;
  if (state.accounts.some(account => account.id === baseId)) baseId = uid('account');
  const accountRecord = {
    id: baseId,
    name: metadata.name || 'Imported Account',
    type: metadata.accountType || fallbackAccount.type || 'checking',
    owner: fallbackAccount.owner || 'shared',
    institution: metadata.institution || fallbackAccount.institution || '',
    last4: metadata.last4 || '',
    importKey: metadata.importKey || normalizeAccountKey(metadata.name || baseId)
  };
  return { accountId: accountRecord.id, accountRecord, accountName: accountRecord.name, accountIsNew: true, metadata, detectionLabel: `Detected ${accountRecord.name}` };
}
function categoryColor(category) { return CATEGORY_COLORS[category] || CATEGORY_COLORS.Other; }

function normalizeAmountForType(amount, type) {
  const value = Math.abs(Number(amount || 0));
  if (type === 'income') return value;
  if (type === 'expense') return -value;
  return Number(amount || 0);
}

function transactionType(tx) {
  if (tx.type) return tx.type;
  return Number(tx.amount) >= 0 ? 'income' : 'expense';
}

function signedTransactionType(amount) {
  return Number(amount || 0) >= 0 ? 'income' : 'expense';
}

function transactionTypeLabel(type) {
  return ({ income: 'Income', expense: 'Expense', transfer: 'Transfer', excluded: 'Excluded' })[type] || String(type || 'Expense');
}

function transactionBankTypeLabel(tx) {
  const bankType = String(tx?.bankType || '').trim();
  const bankDirection = String(tx?.bankDirection || '').trim();
  const flowHint = String(tx?.bankFlowHint || '').trim();
  return bankType || bankDirection || flowHint || '';
}

function fingerprint(tx) {
  const date = tx.date || '';
  const amount = Number(tx.amount || 0).toFixed(2);
  const desc = String(tx.description || tx.merchant || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${tx.account || ''}|${date}|${amount}|${desc}`;
}

function isDuplicate(tx) {
  const fp = tx.fingerprint || fingerprint(tx);
  return state.transactions.some(existing => (existing.fingerprint || fingerprint(existing)) === fp);
}

function applyRules(tx) {
  const sorted = [...state.rules].sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100));
  const result = { ...tx };
  for (const rule of sorted) {
    const source = String(result[rule.field] || '').toLowerCase();
    const needle = String(rule.value || '').toLowerCase();
    let matches = false;
    if (rule.operator === 'equals') matches = source === needle;
    else if (rule.operator === 'starts') matches = source.startsWith(needle);
    else matches = source.includes(needle);
    if (!matches) continue;
    if (rule.category) result.category = rule.category;
    if (rule.owner) result.owner = rule.owner;
    if (rule.type && rule.type !== 'auto') {
      result.type = rule.type;
      result.amount = normalizeAmountForType(result.amount, rule.type);
    }
    result.appliedRuleId = rule.id;
    break;
  }
  return result;
}

const IMPORT_INCOME_PATTERNS = [
  // Only explicit earned/benefit income indicators qualify as household income. Bank transaction
  // types such as "ACH credit" describe money direction, not whether the credit is income.
  /\bpayroll\b/i, /\bsalary\b/i, /\bpaycheck\b/i, /\bwages?\b/i,
  /\bdirect dep(?:osit)?\b/i, /\bemployer (?:deposit|payment)\b/i,
  /\bbonus\b/i, /\bcommission\b/i, /\btip(?:s| payout)?\b/i,
  /\bsocial security\b/i, /\bssa treas\b/i, /\bpension\b/i,
  /\bannuity\b/i, /\bunemployment\b/i, /\binterest (?:earned|paid)\b/i,
  /\bpayout\b/i, /\bpayou\b/i, /\bevent payou\b/i
];
const IMPORT_EXPENSE_PATTERNS = [
  /\b(?:debit|checkcard|card purchase|purchase|pos)\b/i, /\bwithdrawal\b/i,
  /\batm\b/i, /\bservice fee\b/i, /\boverdraft fee\b/i, /\bmonthly fee\b/i,
  /\bbill pay\b/i, /\bpayment to\b/i, /\brecurring (?:card )?purchase\b/i,
  /\b(?:ach|electronic) debit\b/i, /\bcheck paid\b/i, /\bfee charged\b/i,
  /\binterest charged\b/i, /\bcash advance\b/i
];
const IMPORT_CREDIT_ADJUSTMENT_PATTERNS = [
  /\brefund\b/i, /\breturned?\b/i, /\breversal\b/i, /\bcash ?back\b/i,
  /\bstatement credit\b/i, /\bcredit adjustment\b/i, /\brebate\b/i,
  /\bmerchant credit\b/i, /\bpromotional credit\b/i
];
const IMPORT_INTERNAL_TRANSFER_PATTERNS = [
  /\binternal transfer\b/i, /\btransfer (?:to|from)\b/i, /\bxfer (?:to|from)\b/i,
  /\bmove money\b/i, /\baccount transfer\b/i,
  // Chase identifies these incoming person-to-person credits separately from earned income.
  /\bzelle (?:payment )?from\b/i, /\bzelle credit\b/i,
  /\bvenmo cashout\b/i, /\bvenmo transfer (?:to|from)\b/i,
  /\bpaypal transfer (?:to|from)\b/i, /\bcash app (?:cash ?out|transfer)\b/i,
  /\bapple cash bank xfer\b/i, /\bbank xfer\b/i,
  /\bcash app\*raiden labs\b/i
];
const IMPORT_NON_INCOME_CREDIT_PATTERNS = [
  // These labels indicate an incoming credit, but do not establish that the money is income.
  /\bach credit\b/i, /\bzelle credit\b/i, /\bcredit received\b/i,
  /\bincoming (?:ach|wire)\b/i, /\bcard credit\b/i,
  /\b(?:edi|ppd|ccd|web) (?:credit|payment)\b/i
];
const IMPORT_CARD_PAYMENT_PATTERNS = [
  /\b(?:online|automatic|autopay|mobile)\s+payment(?: received)?\b/i,
  /\bpayment received\b/i,
  /\bpayment[- ]thank you\b/i, /\bthank you for your payment\b/i,
  /\bcredit card payment\b/i, /\bcard payment\b/i
];
const CHASE_BANK_TYPE_TRANSFER_CODES = new Set([
  'ACCT_XFER', 'LOAN_PMT'
]);
const CHASE_BANK_TYPE_OUTFLOW_CODES = new Set([
  'CHASE_TO_PARTNERFI', 'QUICKPAY_DEBIT', 'ACH_DEBIT', 'MISC_DEBIT',
  'FEE_TRANSACTION', 'WIRE_OUTGOING'
]);
const CHASE_BANK_TYPE_INFLOW_CODES = new Set([
  'ACH_CREDIT', 'MISC_CREDIT', 'QUICKPAY_CREDIT', 'PARTNERFI_TO_CHASE',
  'ATM', 'ATM_DEPOSIT', 'CHECK_DEPOSIT'
]);
const CHASE_BANK_TYPE_CARD_CODE = 'DEBIT_CARD';

const PDF_CREDIT_SECTION_PATTERNS = [
  /\bdeposits?(?:\s+and\s+(?:other\s+)?(?:credits?|additions?))?\b/i,
  /\bcredits?(?:\s+and\s+deposits?)?\b/i,
  /\belectronic deposits?\b/i, /\bdirect deposits?\b/i, /\bother deposits?\b/i,
  /\badditions?\b/i, /\bincoming (?:payments?|transfers?|wires?)\b/i,
  /\binterest (?:earned|paid)\b/i
];
const PDF_DEBIT_SECTION_PATTERNS = [
  /\bwithdrawals?(?:\s+and\s+(?:other\s+)?debits?)?\b/i,
  /\bdebits?(?:\s+and\s+withdrawals?)?\b/i,
  /\belectronic withdrawals?\b/i, /\batm(?:\s+and)?\s+debit card withdrawals?\b/i,
  /\bchecks? paid\b/i, /\bother withdrawals?\b/i, /\bpayments? and other debits?\b/i,
  /\bpurchases?(?:\s+and\s+adjustments?)?\b/i, /\bfees?(?:\s+charged)?\b/i,
  /\binterest charged\b/i, /\bcash advances?\b/i
];

function matchesAnyPattern(text, patterns) {
  const value = String(text || '');
  return patterns.some(pattern => pattern.test(value));
}

function categoryFromText(text) {
  const value = String(text || '').toLowerCase();
  const groups = [
    ['Income', ['payroll', 'salary', 'direct dep', 'paycheck', 'income']],
    ['Groceries', ['kroger', 'whole foods', 'aldi', 'grocery', 'market', 'meijer', 'costco']],
    ['Dining', ['restaurant', 'cafe', 'coffee', 'starbucks', 'doordash', 'uber eats', 'grubhub', 'mcdonald', 'chipotle']],
    ['Transportation', ['shell', 'speedway', 'bp ', 'exxon', 'marathon', 'uber', 'lyft', 'parking', 'fuel', 'gas station']],
    ['Bills & Utilities', ['electric', 'utility', 'water', 'internet', 'spectrum', 'verizon', 'at&t', 'tmobile', 'phone']],
    ['Entertainment', ['netflix', 'spotify', 'hulu', 'disney', 'max.com', 'cinema', 'theater', 'xbox', 'playstation']],
    ['Shopping', ['amazon', 'target', 'walmart', 'best buy', 'ebay', 'etsy', 'shop']],
    ['Health & Wellness', ['pharmacy', 'cvs', 'walgreens', 'hospital', 'medical', 'dental', 'gym', 'fitness']],
    ['Insurance', ['insurance', 'geico', 'progressive', 'state farm']],
    ['Housing', ['mortgage', 'rent', 'property management']],
    ['Travel', ['airlines', 'hotel', 'airbnb', 'booking.com']],
    ['Personal Care', ['barber', 'salon', 'spa']],
    ['Pets', ['petco', 'petsmart', 'veterinary', 'vet ']]
  ];
  for (const [category, tokens] of groups) if (tokens.some(token => value.includes(token))) return category;
  return '';
}

function autoCategory(text, amount) {
  return categoryFromText(text) || (Number(amount) > 0 ? 'Income' : 'Other');
}

function importTransactionText(tx) {
  return `${tx?.merchant || ''} ${tx?.description || ''}`.replace(/\s+/g, ' ').trim();
}

function hasIncomeSignal(text) {
  return matchesAnyPattern(text, IMPORT_INCOME_PATTERNS);
}

function hasExpenseSignal(text) {
  const category = categoryFromText(text);
  return matchesAnyPattern(text, IMPORT_EXPENSE_PATTERNS) || (!!category && category !== 'Income');
}

function hasCreditAdjustmentSignal(text) {
  return matchesAnyPattern(text, IMPORT_CREDIT_ADJUSTMENT_PATTERNS);
}

function hasNonIncomeCreditSignal(text) {
  return matchesAnyPattern(text, IMPORT_NON_INCOME_CREDIT_PATTERNS);
}

function hasTransferSignal(text, accountType = '') {
  if (matchesAnyPattern(text, IMPORT_INTERNAL_TRANSFER_PATTERNS)) return true;
  if (accountType === 'credit' && matchesAnyPattern(text, IMPORT_CARD_PAYMENT_PATTERNS)) return true;
  return /\b(?:credit card|card) payment\b/i.test(String(text || ''));
}

function normalizeBankCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeBankDirection(value) {
  const normalized = normalizeBankCode(value);
  if (/^(CREDIT|CR|DEPOSIT|DSLIP)$/.test(normalized)) return 'credit';
  if (/^(DEBIT|DBT|WITHDRAWAL|WD)$/.test(normalized)) return 'debit';
  return '';
}

function isChaseCardTransferCredit(text) {
  return /\bcash app\*raiden labs\b/i.test(String(text || ''))
    || /\b(?:cash app|apple cash|venmo|paypal)\b.*\b(?:cash ?out|bank xfer|transfer)\b/i.test(String(text || ''));
}

function isCreditCardPaymentText(text) {
  return /\b(?:citi|chase|capital one|discover|amex|american express|credit card|card)\b.*\b(?:online\s+)?payment\b/i.test(String(text || ''))
    || /\bpayment to chase card\b/i.test(String(text || ''));
}

function classifyImportedBankTransaction(raw, account = {}) {
  const bankType = normalizeBankCode(raw?.bankType || raw?.bankTransactionType || raw?.transactionCode || raw?.entryType || '');
  const bankDirection = normalizeBankDirection(raw?.bankDirection || raw?.details || raw?.direction || '');
  const amount = Number(raw?.amount || 0);

  // Imported bank activity is classified by the actual money direction. The statement's Type
  // value is preserved as bankType for display and review, but it is not treated as a separate
  // income/expense category. Negative amounts are expenses; positive amounts are income.
  if (Number.isFinite(amount) && amount !== 0) return signedTransactionType(amount);

  if (bankDirection === 'debit') return 'expense';
  if (bankDirection === 'credit') return 'income';
  if (CHASE_BANK_TYPE_OUTFLOW_CODES.has(bankType) || bankType === CHASE_BANK_TYPE_CARD_CODE) return 'expense';
  if (CHASE_BANK_TYPE_INFLOW_CODES.has(bankType) || CHASE_BANK_TYPE_TRANSFER_CODES.has(bankType)) return 'income';

  return '';
}


function inferStatementConvention(rows, account = {}) {
  if (account.type === 'credit') return 'credit-card';
  const genericRows = rows.filter(row => !row.flowHint && row.amountSource !== 'debit-credit');
  if (!genericRows.length) return 'explicit-columns';
  let positiveExpense = 0;
  let positiveIncome = 0;
  let negativeExpense = 0;
  let negativeIncome = 0;
  for (const row of genericRows) {
    const text = importTransactionText(row);
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    if (amount > 0 && hasExpenseSignal(text)) positiveExpense++;
    if (amount > 0 && hasIncomeSignal(text)) positiveIncome++;
    if (amount < 0 && hasExpenseSignal(text)) negativeExpense++;
    if (amount < 0 && hasIncomeSignal(text)) negativeIncome++;
  }
  const allPositive = genericRows.every(row => Number(row.amount) > 0);
  const positiveLooksLikeSpending = positiveExpense >= 2 && positiveExpense >= positiveIncome * 2;
  if ((allPositive && positiveExpense >= 1 && positiveIncome === 0) || positiveLooksLikeSpending || negativeIncome > negativeExpense) {
    return 'expenses-positive';
  }
  return 'expenses-negative';
}

function classifyImportedTransaction(raw, account = {}, convention = 'expenses-negative') {
  const amount = Number(raw.amount || 0);

  // For imported statements, the amount sign is authoritative: negative numbers are expenses and
  // positive numbers are income. The original bank-provided Type remains stored as bankType so the
  // transaction still shows the rail/source used by the bank.
  if (Number.isFinite(amount) && amount !== 0) return signedTransactionType(amount);

  const bankTypeClassification = classifyImportedBankTransaction(raw, account);
  if (bankTypeClassification) return bankTypeClassification;

  return convention === 'expenses-positive' ? 'expense' : 'income';
}


function repairImportedTransactionTypes(loadedState) {
  if (!loadedState || !Array.isArray(loadedState.transactions)) return 0;
  const accounts = new Map((loadedState.accounts || []).map(account => [account.id, account]));
  let repaired = 0;
  loadedState.transactions = loadedState.transactions.map(tx => {
    const source = String(tx.source || '').toLowerCase();
    if (!['csv', 'pdf'].includes(source)) return tx;
    const account = accounts.get(tx.account) || {};
    const currentType = transactionType(tx);
    const correctedType = classifyImportedTransaction({ ...tx, sourceFormat: source }, account, 'expenses-negative');
    if (!correctedType || correctedType === currentType) return tx;

    repaired++;
    const text = importTransactionText(tx);
    const category = correctedType === 'income'
      ? 'Income'
      : (!tx.category || ['Income', 'Transfer', 'Excluded'].includes(tx.category))
        ? (categoryFromText(text) || 'Other')
        : tx.category;
    return {
      ...tx,
      type: correctedType,
      amount: normalizeAmountForType(tx.amount, correctedType),
      category,
      updatedAt: new Date().toISOString()
    };
  });
  return repaired;
}


function persistPendingImportedTypeRepairs() {
  if (!pendingImportedTypeRepairs || !currentUser) return;
  pendingImportedTypeRepairs = 0;
  saveState({ immediate: true });
}

function selectedMonth() { return $('#monthFilter').value || currentMonthKey(); }
function monthTransactions(key = selectedMonth()) { return state.transactions.filter(tx => monthKey(tx.date) === key); }
function reportingTransactions(key = selectedMonth()) { return monthTransactions(key).filter(tx => !['transfer', 'excluded'].includes(transactionType(tx))); }

function getMetrics(key = selectedMonth()) {
  const txs = reportingTransactions(key);
  const income = txs.filter(tx => transactionType(tx) === 'income').reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0);
  const expense = txs.filter(tx => transactionType(tx) === 'expense').reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0);
  const net = income - expense;
  const rate = income > 0 ? (net / income) * 100 : 0;
  return { income, expense, net, rate, count: txs.length };
}

function percentChange(current, previous) {
  if (!previous && !current) return 0;
  if (!previous) return 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function init() {
  $('#monthFilter').value = currentMonthKey();
  bindNavigation();
  bindGeneralActions();
  bindForms();
  bindImport();
  hydrateAllSelects();
  applyDisplaySettings();
  renderAll();
}

function bindNavigation() {
  $$('.nav-item').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  $$('[data-go-view]').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.goView)));
  $('#mobileMenu')?.addEventListener('click', openSidebar);
  $('#sidebarClose')?.addEventListener('click', closeSidebar);
  $('#sidebarScrim')?.addEventListener('click', closeSidebar);
}

function openSidebar() { $('#sidebar').classList.add('open'); $('#sidebarScrim').classList.add('open'); }
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#sidebarScrim').classList.remove('open'); }

function switchView(view) {
  currentView = view;
  $$('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  $$('[data-view-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.viewPanel === view));
  const meta = {
    dashboard: ['OVERVIEW', `${state.household.name} Dashboard`],
    accounts: ['ACCOUNTS', 'Accounts'],
    transactions: ['LEDGER', 'Transactions'],
    cashflow: ['CASH FLOW', 'Cash Flow'],
    reports: ['REPORTS', 'Reports'],
    budget: ['BUDGET', 'Budget'],
    recurring: ['RECURRING', 'Recurring'],
    goals: ['GOALS', 'Goals'],
    advice: ['ADVICE', 'Advice'],
    import: ['IMPORT', 'Statement Import'],
    rules: ['AUTOMATION', 'Categorization Rules'],
    settings: ['PREFERENCES', 'Settings']
  }[view] || ['HOMELEDGER', 'HomeLedger'];
  $('#viewEyebrow').textContent = meta[0];
  $('#viewTitle').textContent = meta[1];
  $('#monthControlWrap').classList.toggle('hidden', !['dashboard', 'transactions', 'cashflow', 'reports', 'budget', 'recurring', 'accounts'].includes(view));
  closeSidebar();
  if (view === 'accounts') renderAccounts();
  if (view === 'transactions') renderTransactions();
  if (view === 'cashflow') renderCashFlowDetail();
  if (view === 'reports') renderReports();
  if (view === 'budget') renderBudget();
  if (view === 'recurring') renderRecurring();
  if (view === 'goals') renderGoals();
  if (view === 'advice') renderAdvice();
  if (view === 'import') renderImportHistory();
  if (view === 'rules') renderRules();
  if (view === 'settings') renderSettings();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindGeneralActions() {
  $('#monthFilter').addEventListener('change', () => { transactionPage = 1; renderAll(); });
  $('#quickImportBtn').addEventListener('click', () => switchView('import'));
  $('#quickAddBtn').addEventListener('click', () => openTransactionModal());
  $('#exportBackupBtn').addEventListener('click', exportBackup);
  $('#settingsExportBtn').addEventListener('click', exportBackup);
  $('#transactionSearch').addEventListener('input', debounce(() => { transactionPage = 1; renderTransactions(); }, 120));
  $('#transactionTypeFilter').addEventListener('change', () => { transactionPage = 1; syncQuickTransactionView(); renderTransactions(); });
  $('#transactionOwnerFilter').addEventListener('change', () => { transactionPage = 1; renderTransactions(); });
  $('#transactionCategoryFilter').addEventListener('change', () => { transactionPage = 1; renderTransactions(); });
  $('#transactionQuickView').addEventListener('change', event => { $('#transactionTypeFilter').value = event.target.value; transactionPage = 1; renderTransactions(); });
  $('#transactionSearchToggle').addEventListener('click', () => { $('#transactionFiltersCard').classList.toggle('collapsed'); $('#transactionSearch').focus({ preventScroll: true }); });
  $('#transactionFilterToggle').addEventListener('click', () => $('#transactionFiltersCard').classList.toggle('collapsed'));
  $('#transactionDateShortcut').addEventListener('click', () => $('#monthFilter').showPicker ? $('#monthFilter').showPicker() : $('#monthFilter').focus());
  $('#transactionAddBtn').addEventListener('click', () => openTransactionModal());
  $('#accountsAddAccountBtn').addEventListener('click', () => openAccountModal());
  $('#clearFiltersBtn').addEventListener('click', clearTransactionFilters);
  $('#selectAllTransactions').addEventListener('change', event => {
    visibleTransactionPage().forEach(tx => event.target.checked ? selectedTransactionIds.add(tx.id) : selectedTransactionIds.delete(tx.id));
    renderTransactions();
  });
  $('#bulkTransferBtn').addEventListener('click', () => bulkUpdateType('transfer'));
  $('#bulkDeleteBtn').addEventListener('click', bulkDelete);
  $('#addRuleBtn').addEventListener('click', () => openRuleModal());
  $('#addAccountBtn').addEventListener('click', () => openAccountModal());
  $('#clearAllDataBtn').addEventListener('click', clearAllData);
  $('#logoutBtn').addEventListener('click', logout);
  $('#refreshDataBtn').addEventListener('click', () => refreshState());
  $('#copyInviteCodeBtn').addEventListener('click', copyInviteCode);
  $('#regenerateInviteCodeBtn').addEventListener('click', regenerateInviteCode);
  window.addEventListener('online', () => currentUser && refreshState({ announce: false }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentUser && !savePending && !saveRunning) refreshState({ announce: false });
  });
  $('#backupImportInput').addEventListener('change', importBackup);
  $('#compactRowsToggle').addEventListener('change', e => { state.settings.compactRows = e.target.checked; saveState(); applyDisplaySettings(); });
  $('#hideCentsToggle').addEventListener('change', e => { state.settings.hideCents = e.target.checked; saveState(); renderAll(); });
  $$('[data-close-modal]').forEach(btn => btn.addEventListener('click', closeModals));
  $('#modalBackdrop').addEventListener('click', closeModals);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModals(); });
}

function clearTransactionFilters() {
  $('#transactionSearch').value = '';
  $('#transactionTypeFilter').value = 'all';
  $('#transactionOwnerFilter').value = 'all';
  $('#transactionCategoryFilter').value = 'all';
  transactionPage = 1;
  renderTransactions();
  $('#transactionSearch').focus({ preventScroll: true });
}

function bindForms() {
  $('#transactionForm').addEventListener('submit', saveTransactionFromForm);
  $('#ruleForm').addEventListener('submit', saveRuleFromForm);
  $('#accountForm').addEventListener('submit', saveAccountFromForm);
  $('#householdForm').addEventListener('submit', saveHouseholdSettings);
}

function bindImport() {
  const dropZone = $('#dropZone');
  const fileInput = $('#statementFile');
  const openPicker = () => fileInput.click();
  dropZone.addEventListener('click', event => { if (!event.target.closest('button')) openPicker(); });
  dropZone.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); openPicker(); } });
  $('#browseFileBtn').addEventListener('click', event => { event.stopPropagation(); openPicker(); });
  fileInput.addEventListener('change', () => fileInput.files[0] && processStatementFile(fileInput.files[0]));
  ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove('dragover'); }));
  dropZone.addEventListener('drop', event => { const file = event.dataTransfer.files[0]; if (file) processStatementFile(file); });
  $('#confirmImportBtn').addEventListener('click', confirmImport);
  $('#selectAllImportBtn').addEventListener('click', () => { importDraft.transactions.forEach(tx => tx.selected = true); renderImportReview(); });
  $('#deselectDuplicatesBtn').addEventListener('click', () => { importDraft.transactions.forEach(tx => { if (tx.duplicate) tx.selected = false; }); renderImportReview(); });
}

function renderAll() {
  hydrateAllSelects();
  renderDashboard();
  renderAccounts();
  renderTransactions();
  renderCashFlowDetail();
  renderReports();
  renderBudget();
  renderRecurring();
  renderGoals();
  renderAdvice();
  renderRules();
  renderImportHistory();
  renderSettings();
  $('#transactionCount').textContent = state.transactions.length;
  if ($('#accountCount')) $('#accountCount').textContent = state.accounts.length;
  renderSessionInfo();
}

function renderDashboard() {
  const month = selectedMonth();
  const current = getMetrics(month);
  const prev = getMetrics(previousMonth(month));
  const summary = [
    { key: 'income', label: 'Household income', value: money(current.income), trend: percentChange(current.income, prev.income), note: 'vs. previous month' },
    { key: 'expense', label: 'Household spending', value: money(current.expense), trend: percentChange(current.expense, prev.expense), note: 'vs. previous month', invert: true },
    { key: 'net', label: 'Net cash flow', value: money(current.net), trend: percentChange(current.net, prev.net), note: 'income minus spending' },
    { key: 'rate', label: 'Savings rate', value: `${current.rate.toFixed(1)}%`, trend: current.rate - prev.rate, note: 'of household income', percentagePoint: true }
  ];
  $('#summaryCards').innerHTML = summary.map(item => {
    const trend = Number.isFinite(item.trend) ? item.trend : 0;
    const favorable = item.invert ? trend <= 0 : trend >= 0;
    const displayTrend = item.percentagePoint ? `${Math.abs(trend).toFixed(1)} pts` : `${Math.abs(trend).toFixed(1)}%`;
    return `<article class="summary-card ${item.key}">
      <div class="summary-card-label">${item.label}</div>
      <div class="summary-card-value">${item.value}</div>
      <div class="summary-card-foot"><span class="summary-trend ${favorable ? 'up' : 'down'}">${trend >= 0 ? '↑' : '↓'} ${displayTrend}</span><span>${item.note}</span></div>
    </article>`;
  }).join('');
  renderCashFlowChart(month);
  renderCategoryDonut(month);
  renderTopMerchants(month);
  renderRecentTransactions(month);
  renderReviewCenter(month);
}

function renderCashFlowChart(activeMonth) {
  const keys = [];
  const [year, month] = activeMonth.split('-').map(Number);
  for (let offset = 5; offset >= 0; offset--) {
    const d = new Date(year, month - 1 - offset, 1);
    keys.push(d.toISOString().slice(0, 7));
  }
  const data = keys.map(key => ({ key, ...getMetrics(key) }));
  const max = Math.max(1, ...data.flatMap(d => [d.income, d.expense]));
  const width = 760, height = 250, left = 48, right = 12, top = 12, bottom = 33;
  const innerW = width - left - right, innerH = height - top - bottom;
  const groupW = innerW / data.length, barW = Math.min(24, groupW * .25);
  let svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Six month income and spending chart">`;
  for (let i = 0; i <= 4; i++) {
    const y = top + innerH * (i / 4);
    const value = max * (1 - i / 4);
    svg += `<line class="chart-grid-line" x1="${left}" x2="${width-right}" y1="${y}" y2="${y}"/><text class="chart-axis-label" x="0" y="${y+3}">${compactMoney(value)}</text>`;
  }
  data.forEach((d, i) => {
    const center = left + groupW * i + groupW / 2;
    const incomeH = (d.income / max) * innerH;
    const expenseH = (d.expense / max) * innerH;
    const label = new Date(`${d.key}-01T12:00:00`).toLocaleDateString(undefined, { month: 'short' });
    svg += `<rect class="chart-bar-income" x="${center-barW-2}" y="${top+innerH-incomeH}" width="${barW}" height="${incomeH}" rx="3"/><rect class="chart-bar-expense" x="${center+2}" y="${top+innerH-expenseH}" width="${barW}" height="${expenseH}" rx="3"/><text class="chart-axis-label" text-anchor="middle" x="${center}" y="${height-7}">${label}</text>`;
  });
  svg += `</svg>`;
  $('#cashFlowChart').innerHTML = svg;
}

function compactMoney(value) {
  const abs = Math.abs(value);
  if (abs >= 1000000) return `$${(value / 1000000).toFixed(1)}m`;
  if (abs >= 1000) return `$${(value / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(value)}`;
}

function categoryBreakdown(month) {
  const map = new Map();
  reportingTransactions(month).filter(tx => transactionType(tx) === 'expense').forEach(tx => {
    const category = tx.category || 'Other';
    map.set(category, (map.get(category) || 0) + Math.abs(Number(tx.amount)));
  });
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

function renderCategoryDonut(month) {
  const data = categoryBreakdown(month);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) {
    $('#categoryDonut').innerHTML = emptyState('No spending data', 'Import transactions to see your category breakdown.');
    $('#categoryLegend').innerHTML = '';
    return;
  }
  const size = 220, center = 110, radius = 76, stroke = 25, circumference = 2 * Math.PI * radius;
  let offset = 0;
  const circles = data.slice(0, 7).map(item => {
    const fraction = item.value / total;
    const dash = Math.max(0, fraction * circumference - 2.5);
    const circle = `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${categoryColor(item.name)}" stroke-width="${stroke}" stroke-linecap="butt" stroke-dasharray="${dash} ${circumference-dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${center} ${center})"/>`;
    offset += fraction * circumference;
    return circle;
  }).join('');
  $('#categoryDonut').innerHTML = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Spending by category donut chart"><circle cx="110" cy="110" r="76" fill="none" stroke="#222831" stroke-width="25"/>${circles}<text class="donut-center-label" x="110" y="103" text-anchor="middle">TOTAL SPENT</text><text class="donut-center-value" x="110" y="126" text-anchor="middle">${escapeHtml(compactMoney(total))}</text></svg>`;
  $('#categoryLegend').innerHTML = data.slice(0, 6).map(item => `<div class="category-legend-row"><i style="background:${categoryColor(item.name)}"></i><span class="name">${escapeHtml(item.name)}</span><span class="value">${money(item.value)}</span></div>`).join('');
}

function renderTopMerchants(month) {
  const map = new Map();
  reportingTransactions(month).filter(tx => transactionType(tx) === 'expense').forEach(tx => {
    const key = tx.merchant || tx.description || 'Unknown';
    map.set(key, (map.get(key) || 0) + Math.abs(Number(tx.amount)));
  });
  const data = [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5);
  if (!data.length) { $('#topMerchants').innerHTML = emptyState('No merchant activity', 'Your largest merchants will appear after an import.'); return; }
  const max = data[0].value;
  $('#topMerchants').innerHTML = data.map(item => `<div class="merchant-row"><div class="merchant-row-top"><span>${escapeHtml(item.name)}</span><span>${money(item.value)}</span></div><div class="progress-track"><div class="progress-fill" style="width:${(item.value/max)*100}%"></div></div></div>`).join('');
}

function renderRecentTransactions(month) {
  const txs = monthTransactions(month).sort((a,b) => String(b.date).localeCompare(String(a.date))).slice(0, 6);
  if (!txs.length) { $('#recentTransactions').innerHTML = emptyState('No transactions yet', 'Upload a statement or add a manual transaction.', true); return; }
  $('#recentTransactions').innerHTML = txs.map(tx => recentRow(tx)).join('');
  $$('#recentTransactions .recent-row').forEach(row => row.addEventListener('click', () => openTransactionModal(state.transactions.find(tx => tx.id === row.dataset.id))));
}

function recentRow(tx) {
  const type = transactionType(tx);
  const amount = Number(tx.amount);
  const initial = String(tx.merchant || tx.description || '?').trim().charAt(0).toUpperCase();
  return `<div class="recent-row" data-id="${tx.id}"><div class="transaction-icon ${type}">${escapeHtml(initial)}</div><div class="recent-main"><div class="recent-title">${escapeHtml(tx.merchant || tx.description || 'Untitled transaction')}</div><div class="recent-meta">${escapeHtml(tx.category || 'Other')} · ${formatDate(tx.date)}</div></div><div class="recent-amount ${type}">${type === 'income' ? '+' : type === 'expense' ? '−' : ''}${money(Math.abs(amount))}</div></div>`;
}

function renderReviewCenter(month) {
  const other = monthTransactions(month).filter(tx => (tx.category || 'Other') === 'Other' && !['transfer','excluded'].includes(transactionType(tx)));
  const possibleTransfers = detectExistingTransferPairs(monthTransactions(month));
  const items = [];
  if (other.length) items.push({ title: `${other.length} uncategorized transaction${other.length === 1 ? '' : 's'}`, text: 'Assign categories to improve your household reports.' });
  if (possibleTransfers.length) items.push({ title: `${possibleTransfers.length} possible transfer match${possibleTransfers.length === 1 ? '' : 'es'}`, text: 'Review equal and opposite transactions to prevent double counting.' });
  if (!monthTransactions(month).length) items.push({ title: 'Import your first statement', text: 'CSV is recommended for the most reliable extraction.' });
  if (!items.length) items.push({ title: 'Everything looks organized', text: 'No obvious categorization or transfer issues were found.' });
  $('#reviewCenter').innerHTML = items.map(item => `<div class="review-item"><div class="review-icon"><svg viewBox="0 0 24 24"><path d="M12 9v4m0 4h.01M10 3h4l8 16H2L10 3Z"/></svg></div><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p></div></div>`).join('');
}

function detectExistingTransferPairs(txs) {
  const pairs = [];
  const used = new Set();
  txs.forEach((a, i) => txs.slice(i + 1).forEach(b => {
    if (used.has(a.id) || used.has(b.id)) return;
    if (Math.abs(Number(a.amount) + Number(b.amount)) < .01 && daysBetween(a.date, b.date) <= 5 && a.account !== b.account) {
      pairs.push([a, b]); used.add(a.id); used.add(b.id);
    }
  }));
  return pairs;
}

function normalizeFilterText(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function transactionFilterState() {
  return {
    search: $('#transactionSearch').value.trim(),
    type: $('#transactionTypeFilter').value || 'all',
    owner: $('#transactionOwnerFilter').value || 'all',
    category: $('#transactionCategoryFilter').value || 'all'
  };
}

function activeTransactionFilters(filters = transactionFilterState()) {
  const active = [];
  const typeLabels = { income: 'Income', expense: 'Expenses', transfer: 'Transfers', excluded: 'Excluded' };
  if (filters.search) active.push({ key: 'search', label: `Search: “${filters.search}”` });
  if (filters.type !== 'all') active.push({ key: 'type', label: typeLabels[filters.type] || filters.type });
  if (filters.owner !== 'all') active.push({ key: 'owner', label: memberName(filters.owner) });
  if (filters.category !== 'all') active.push({ key: 'category', label: filters.category });
  return active;
}

function transactionSearchText(tx) {
  const amount = Math.abs(Number(tx.amount || 0));
  return normalizeFilterText([
    tx.merchant,
    tx.description,
    tx.category || 'Other',
    memberName(tx.owner),
    accountName(tx.account),
    state.accounts.find(account => account.id === tx.account)?.institution,
    tx.notes,
    transactionType(tx),
    transactionTypeLabel(transactionType(tx)),
    transactionBankTypeLabel(tx),
    tx.bankDirection,
    tx.bankFlowHint,
    Number.isFinite(amount) ? amount.toFixed(2) : ''
  ].filter(Boolean).join(' '));
}

function filteredTransactions(filters = transactionFilterState()) {
  const search = normalizeFilterText(filters.search);
  return monthTransactions(selectedMonth())
    .filter(tx => !search || transactionSearchText(tx).includes(search))
    .filter(tx => filters.type === 'all' || transactionType(tx) === filters.type)
    .filter(tx => filters.owner === 'all' || tx.owner === filters.owner)
    .filter(tx => filters.category === 'all' || (tx.category || 'Other') === filters.category)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function visibleTransactionPage(rows = filteredTransactions()) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  transactionPage = Math.max(1, Math.min(transactionPage, pages));
  return rows.slice((transactionPage - 1) * PAGE_SIZE, transactionPage * PAGE_SIZE);
}

function clearSingleTransactionFilter(key) {
  const targets = {
    search: ['#transactionSearch', ''],
    type: ['#transactionTypeFilter', 'all'],
    owner: ['#transactionOwnerFilter', 'all'],
    category: ['#transactionCategoryFilter', 'all']
  };
  const target = targets[key];
  if (!target) return;
  $(target[0]).value = target[1];
  transactionPage = 1;
  renderTransactions();
}

function renderTransactionFilterStatus(filters, rows, monthRows) {
  const active = activeTransactionFilters(filters);
  const hasFilters = active.length > 0;
  $('#transactionResultTitle').textContent = hasFilters ? 'Filtered transactions' : 'All transactions';
  $('#transactionTableCount').textContent = hasFilters
    ? `${rows.length} of ${monthRows.length} transaction${monthRows.length === 1 ? '' : 's'}`
    : `${rows.length} transaction${rows.length === 1 ? '' : 's'}`;
  $('#clearFiltersBtn').disabled = !hasFilters;
  $('#transactionFilterStatus').classList.toggle('hidden', !hasFilters);
  $('#transactionFilterSummary').textContent = `${rows.length} match${rows.length === 1 ? '' : 'es'} in the selected month`;
  $('#activeTransactionFilters').innerHTML = active.map(filter => `<button class="filter-chip" type="button" data-filter-key="${filter.key}" aria-label="Remove ${escapeHtml(filter.label)} filter"><span>${escapeHtml(filter.label)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button>`).join('');
  $$('#activeTransactionFilters .filter-chip').forEach(button => button.addEventListener('click', () => clearSingleTransactionFilter(button.dataset.filterKey)));
}

function renderTransactions() {
  const filters = transactionFilterState();
  const monthRows = monthTransactions(selectedMonth());
  const rows = filteredTransactions(filters);
  const visible = visibleTransactionPage(rows);
  renderTransactionFilterStatus(filters, rows, monthRows);
  $('#transactionTableBody').innerHTML = visible.length ? visible.map(transactionTableRow).join('') : `<tr><td colspan="8">${emptyState('No matching transactions', 'Adjust or clear the active filters to see more activity.')}</td></tr>`;
  $('#mobileTransactionList').innerHTML = visible.length ? visible.map(mobileTransactionCard).join('') : emptyState('No matching transactions', 'Adjust or clear the active filters to see more activity.');
  renderTransactionSummaryPanel(rows, monthRows);
  bindTransactionRowEvents();
  renderPagination(rows.length);
  selectedTransactionIds = new Set([...selectedTransactionIds].filter(id => state.transactions.some(tx => tx.id === id)));
  const selected = selectedTransactionIds.size;
  $('#bulkActions').classList.toggle('hidden', !selected);
  $('#selectedCount').textContent = `${selected} selected`;
  const allVisibleSelected = visible.length > 0 && visible.every(tx => selectedTransactionIds.has(tx.id));
  $('#selectAllTransactions').checked = allVisibleSelected;
  $('#selectAllTransactions').indeterminate = visible.some(tx => selectedTransactionIds.has(tx.id)) && !allVisibleSelected;
  $('#transactionCount').textContent = state.transactions.length;
  renderSessionInfo();
}

function transactionTableRow(tx) {
  const type = transactionType(tx);
  const bankType = transactionBankTypeLabel(tx);
  const bankMeta = bankType ? `Statement type: ${bankType}` : '';
  return `<tr data-id="${tx.id}" class="transaction-row ${type}">
    <td class="checkbox-cell"><input type="checkbox" class="transaction-select" ${selectedTransactionIds.has(tx.id) ? 'checked' : ''} aria-label="Select transaction" /></td>
    <td>${formatDate(tx.date)}</td>
    <td><div class="transaction-main"><strong>${escapeHtml(tx.merchant || tx.description || 'Untitled transaction')}</strong><span>${escapeHtml([tx.description, memberName(tx.owner), bankMeta].filter(Boolean).join(' · '))}</span></div></td>
    <td class="type-cell"><span class="type-pill ${type}">${escapeHtml(transactionTypeLabel(type))}</span></td>
    <td><span class="category-pill">${escapeHtml(tx.category || 'Other')}</span></td>
    <td><span class="account-pill">${escapeHtml(accountName(tx.account))}</span></td>
    <td class="amount-cell"><span class="amount-value ${type}">${type === 'income' ? '+' : type === 'expense' ? '−' : ''}${money(Math.abs(Number(tx.amount)))}</span></td>
    <td class="actions-cell"><button class="row-action edit-transaction" aria-label="Edit transaction"><svg viewBox="0 0 24 24"><path d="m4 16-.8 4 4-.8L18 8.4 15.6 6 4 16Z"/><path d="m13.8 7.8 2.4 2.4"/></svg></button></td>
  </tr>`;
}

function mobileTransactionCard(tx) {
  const type = transactionType(tx);
  const bankType = transactionBankTypeLabel(tx);
  return `<div class="mobile-transaction-card ${type}" data-id="${tx.id}">
    <input type="checkbox" class="transaction-select" ${selectedTransactionIds.has(tx.id) ? 'checked' : ''} aria-label="Select transaction" />
    <div class="mobile-transaction-main"><div class="mobile-transaction-title">${escapeHtml(tx.merchant || tx.description || 'Untitled transaction')}</div><div class="mobile-transaction-meta"><span>${formatDate(tx.date)}</span>${bankType ? `<span>·</span><span>${escapeHtml(bankType)}</span>` : ''}<span>·</span><span>${escapeHtml(tx.category || 'Other')}</span><span>·</span><span>${escapeHtml(memberName(tx.owner))}</span></div></div>
    <div class="mobile-transaction-side"><span class="type-pill ${type}">${escapeHtml(transactionTypeLabel(type))}</span><span class="amount-value ${type}">${type === 'income' ? '+' : type === 'expense' ? '−' : ''}${money(Math.abs(Number(tx.amount)))}</span><button class="row-action edit-transaction" aria-label="Edit transaction"><svg viewBox="0 0 24 24"><path d="m4 16-.8 4 4-.8L18 8.4 15.6 6 4 16Z"/><path d="m13.8 7.8 2.4 2.4"/></svg></button></div>
  </div>`;
}

function bindTransactionRowEvents() {
  $$('.transaction-select').forEach(input => input.addEventListener('change', event => {
    const id = event.target.closest('[data-id]').dataset.id;
    event.target.checked ? selectedTransactionIds.add(id) : selectedTransactionIds.delete(id);
    renderTransactions();
  }));
  $$('.edit-transaction').forEach(btn => btn.addEventListener('click', event => {
    event.stopPropagation();
    const id = btn.closest('[data-id]').dataset.id;
    openTransactionModal(state.transactions.find(tx => tx.id === id));
  }));
}

function renderPagination(totalRows) {
  const pages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  if (pages <= 1) { $('#transactionPagination').innerHTML = ''; return; }
  const buttons = [];
  buttons.push(`<button class="page-button" data-page="${transactionPage - 1}" ${transactionPage === 1 ? 'disabled' : ''}>‹</button>`);
  for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - transactionPage) <= 1) buttons.push(`<button class="page-button ${i === transactionPage ? 'active' : ''}" data-page="${i}">${i}</button>`);
  buttons.push(`<button class="page-button" data-page="${transactionPage + 1}" ${transactionPage === pages ? 'disabled' : ''}>›</button>`);
  $('#transactionPagination').innerHTML = buttons.join('');
  $$('#transactionPagination .page-button').forEach(btn => btn.addEventListener('click', () => { transactionPage = Number(btn.dataset.page); renderTransactions(); }));
}

function bulkUpdateType(type) {
  state.transactions = state.transactions.map(tx => selectedTransactionIds.has(tx.id) ? { ...tx, type, category: type === 'transfer' ? 'Transfer' : tx.category } : tx);
  selectedTransactionIds.clear(); saveState(); renderAll(); toast('Transactions updated', 'Selected transactions were marked as transfers.');
}

function bulkDelete() {
  if (!selectedTransactionIds.size || !confirm(`Delete ${selectedTransactionIds.size} selected transaction(s)?`)) return;
  state.transactions = state.transactions.filter(tx => !selectedTransactionIds.has(tx.id));
  selectedTransactionIds.clear(); saveState(); renderAll(); toast('Transactions deleted', 'The selected records were removed from the shared household ledger.');
}

function hydrateAllSelects() {
  const memberOptions = state.members.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
  const ownerAll = `<option value="all">All owners</option>${memberOptions}`;
  ['#transactionOwnerFilter'].forEach(sel => { const old = $(sel)?.value; if ($(sel)) { $(sel).innerHTML = ownerAll; if ([...$(sel).options].some(o => o.value === old)) $(sel).value = old; } });
  ['#importOwner','#transactionOwnerInput','#ruleOwnerInput','#accountOwnerInput'].forEach(sel => { const old = $(sel)?.value; if ($(sel)) { $(sel).innerHTML = memberOptions; if ([...$(sel).options].some(o => o.value === old)) $(sel).value = old; } });
  const accountOptions = state.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  ['#importAccount','#transactionAccountInput'].forEach(sel => { const old = $(sel)?.value; if ($(sel)) { $(sel).innerHTML = accountOptions || '<option value="">No accounts available</option>'; if ([...$(sel).options].some(o => o.value === old)) $(sel).value = old; } });
  const availableCategories = [...new Set([
    ...DEFAULT_CATEGORIES,
    ...state.transactions.map(tx => tx.category).filter(Boolean),
    ...state.rules.map(rule => rule.category).filter(Boolean)
  ])].sort((a, b) => a.localeCompare(b));
  const categoryOptions = availableCategories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  ['#transactionCategoryInput','#ruleCategoryInput'].forEach(sel => { const old = $(sel)?.value; $(sel).innerHTML = categoryOptions; if ([...$(sel).options].some(o => o.value === old)) $(sel).value = old; });
  const oldCategory = $('#transactionCategoryFilter').value;
  $('#transactionCategoryFilter').innerHTML = `<option value="all">All categories</option>${categoryOptions}`;
  if ([...$('#transactionCategoryFilter').options].some(o => o.value === oldCategory)) $('#transactionCategoryFilter').value = oldCategory;
}

function openModal(id) { $('#modalBackdrop').classList.remove('hidden'); $(id).classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeModals() { $('#modalBackdrop').classList.add('hidden'); $$('.modal').forEach(modal => modal.classList.add('hidden')); document.body.style.overflow = ''; }

function openTransactionModal(tx = null) {
  hydrateAllSelects();
  $('#transactionModalTitle').textContent = tx ? 'Edit transaction' : 'Add manual transaction';
  $('#transactionIdInput').value = tx?.id || '';
  $('#transactionDateInput').value = tx?.date || new Date().toISOString().slice(0,10);
  $('#transactionAmountInput').value = tx ? Math.abs(Number(tx.amount)).toFixed(2) : '';
  $('#transactionMerchantInput').value = tx?.merchant || '';
  $('#transactionDescriptionInput').value = tx?.description || '';
  $('#transactionTypeInput').value = tx ? transactionType(tx) : 'expense';
  $('#transactionCategoryInput').value = tx?.category || 'Other';
  $('#transactionOwnerInput').value = tx?.owner || 'shared';
  $('#transactionAccountInput').value = tx?.account || state.accounts[0]?.id || '';
  $('#transactionNotesInput').value = tx?.notes || '';
  $('#createRuleCheckbox').checked = false;
  openModal('#transactionModal');
}

function saveTransactionFromForm(event) {
  event.preventDefault();
  const id = $('#transactionIdInput').value || uid('tx');
  const type = $('#transactionTypeInput').value;
  const existing = state.transactions.find(tx => tx.id === id);
  const tx = {
    ...existing, id, date: $('#transactionDateInput').value,
    merchant: $('#transactionMerchantInput').value.trim(),
    description: $('#transactionDescriptionInput').value.trim(),
    type, amount: normalizeAmountForType($('#transactionAmountInput').value, type),
    category: type === 'transfer' ? 'Transfer' : $('#transactionCategoryInput').value,
    owner: $('#transactionOwnerInput').value, account: $('#transactionAccountInput').value,
    notes: $('#transactionNotesInput').value.trim(), source: existing?.source || 'manual',
    createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  tx.fingerprint = fingerprint(tx);
  const index = state.transactions.findIndex(item => item.id === id);
  if (index >= 0) state.transactions[index] = tx; else state.transactions.push(tx);
  if ($('#createRuleCheckbox').checked && tx.merchant) {
    state.rules.push({ id: uid('rule'), field: 'merchant', operator: 'contains', value: tx.merchant, category: tx.category, owner: tx.owner, type: tx.type, priority: 100 });
  }
  saveState(); closeModals(); renderAll(); toast(index >= 0 ? 'Transaction updated' : 'Transaction added', `${tx.merchant} was saved to your household ledger.`);
}


function syncQuickTransactionView() {
  if ($('#transactionQuickView')) $('#transactionQuickView').value = $('#transactionTypeFilter').value || 'all';
}

function monthDateLabel(key = selectedMonth()) {
  const parsed = new Date(`${key}-01T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? key : new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(parsed);
}

function allLedgerTransactions() {
  return [...state.transactions].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function transactionsForRange(mode = 'month') {
  if (mode === 'all') return allLedgerTransactions();
  return monthTransactions(selectedMonth());
}

function metricRowsFromTransactions(txs) {
  const income = txs.filter(tx => transactionType(tx) === 'income').reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0);
  const expense = txs.filter(tx => transactionType(tx) === 'expense').reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0);
  const transfer = txs.filter(tx => transactionType(tx) === 'transfer').reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0);
  const excluded = txs.filter(tx => transactionType(tx) === 'excluded').reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0);
  return { income, expense, transfer, excluded, net: income - expense, count: txs.length };
}

function summaryRows(metrics) {
  return `<div class="metric-list">
    <div><span>Total transactions</span><strong>${metrics.count.toLocaleString()}</strong></div>
    <div><span>Total income</span><strong class="positive">${money(metrics.income)}</strong></div>
    <div><span>Total spending</span><strong>${money(metrics.expense)}</strong></div>
    <div><span>Net cash flow</span><strong class="${metrics.net >= 0 ? 'positive' : 'negative'}">${money(metrics.net)}</strong></div>
    <div><span>Transfers</span><strong>${money(metrics.transfer)}</strong></div>
  </div>`;
}

function renderTransactionSummaryPanel(rows = filteredTransactions(), monthRows = monthTransactions(selectedMonth())) {
  if (!$('#transactionSummaryPanel')) return;
  const metrics = metricRowsFromTransactions(rows);
  const amounts = rows.map(tx => Math.abs(Number(tx.amount))).filter(Number.isFinite);
  const largest = amounts.length ? Math.max(...amounts) : 0;
  const dates = rows.map(tx => tx.date).filter(Boolean).sort();
  $('#transactionSummaryPanel').innerHTML = `<div class="summary-total-card"><strong>${money(metrics.net)}</strong><span>Net activity this view</span></div>
    <div class="metric-list">
      <div><span>Total transactions</span><strong>${rows.length.toLocaleString()}</strong></div>
      <div><span>Largest transaction</span><strong>${money(largest)}</strong></div>
      <div><span>Average transaction</span><strong>${money(amounts.length ? amounts.reduce((s, v) => s + v, 0) / amounts.length : 0)}</strong></div>
      <div><span>Total income</span><strong class="positive">${money(metrics.income)}</strong></div>
      <div><span>Total spending</span><strong>${money(metrics.expense)}</strong></div>
      <div><span>First transaction</span><strong>${dates[0] ? formatDate(dates[0]) : '—'}</strong></div>
      <div><span>Last transaction</span><strong>${dates.at(-1) ? formatDate(dates.at(-1)) : '—'}</strong></div>
    </div>`;
}

function accountMetrics(accountId, txs = monthTransactions(selectedMonth())) {
  return metricRowsFromTransactions(txs.filter(tx => tx.account === accountId));
}

function renderAccounts() {
  if (!$('#accountsDashboardList')) return;
  const txs = monthTransactions(selectedMonth());
  const total = metricRowsFromTransactions(txs);
  const maxFlow = Math.max(1, ...state.accounts.map(a => Math.abs(accountMetrics(a.id, txs).net)));
  $('#accountPerformanceChart').innerHTML = simpleLineChart(monthlyMetricSeries('net'), 'Account activity trend');
  $('#accountsDashboardList').innerHTML = state.accounts.length ? state.accounts.map(account => {
    const metrics = accountMetrics(account.id, txs);
    const width = Math.min(100, Math.abs(metrics.net) / maxFlow * 100);
    return `<div class="account-dashboard-row" data-id="${account.id}"><div class="account-logo">${escapeHtml((account.institution || account.name || 'A').charAt(0).toUpperCase())}</div><div class="account-row-main"><strong>${escapeHtml(account.name)}</strong><span>${escapeHtml(account.type)} · ${escapeHtml(memberName(account.owner))}${account.institution ? ` · ${escapeHtml(account.institution)}` : ''}</span><div class="mini-track"><i style="width:${width}%"></i></div></div><div class="account-row-values"><strong class="${metrics.net >= 0 ? 'positive' : 'negative'}">${money(metrics.net)}</strong><span>${metrics.count} transaction${metrics.count === 1 ? '' : 's'}</span></div><button class="row-action edit-account" aria-label="Rename account"><svg viewBox="0 0 24 24"><path d="m4 16-.8 4 4-.8L18 8.4 15.6 6 4 16Z"/></svg></button></div>`;
  }).join('') : emptyState('No accounts', 'Add an account or import a statement to begin.', true);
  $('#accountsSummary').innerHTML = `${summaryRows(total)}<button class="button primary full-width" type="button" data-go-view="import">Import statement</button>`;
  $$('#accountsDashboardList .edit-account').forEach(btn => btn.addEventListener('click', () => openAccountModal(state.accounts.find(a => a.id === btn.closest('[data-id]').dataset.id))));
  $$('[data-go-view="import"]', $('#accountsSummary')).forEach(btn => btn.addEventListener('click', () => switchView('import')));
}

function monthlyMetricSeries(metric = 'expense', months = 8) {
  const [year, month] = selectedMonth().split('-').map(Number);
  const keys = [];
  for (let offset = months - 1; offset >= 0; offset--) {
    const d = new Date(year, month - 1 - offset, 1);
    keys.push(d.toISOString().slice(0, 7));
  }
  return keys.map(key => ({ key, ...getMetrics(key) })).map(item => ({ label: new Date(`${item.key}-01T12:00:00`).toLocaleDateString(undefined, { month: 'short' }), value: item[metric] || 0, key: item.key }));
}

function simpleLineChart(data, label = 'Trend') {
  const width = 720, height = 220, left = 44, right = 18, top = 18, bottom = 34;
  const max = Math.max(1, ...data.map(d => Math.abs(d.value)));
  const step = data.length > 1 ? (width - left - right) / (data.length - 1) : 1;
  const zeroY = top + (height - top - bottom) * 0.72;
  const points = data.map((d, i) => {
    const x = left + i * step;
    const y = zeroY - (d.value / max) * (height - top - bottom) * 0.56;
    return `${x},${Math.max(top, Math.min(height - bottom, y))}`;
  }).join(' ');
  const labels = data.map((d, i) => `<text class="chart-axis-label" text-anchor="middle" x="${left + i * step}" y="${height - 9}">${escapeHtml(d.label)}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(label)}"><line class="chart-grid-line" x1="${left}" x2="${width-right}" y1="${zeroY}" y2="${zeroY}"/>${labels}<polyline class="line-chart-path" points="${points}" fill="none"/><g>${data.map((d, i) => `<circle class="line-chart-point" cx="${left + i * step}" cy="${(points.split(' ')[i] || '0,0').split(',')[1]}" r="4"/>`).join('')}</g></svg>`;
}

function stackedBarChart(data, mode = 'expense') {
  const width = 920, height = 280, left = 70, right = 24, top = 24, bottom = 42;
  const max = Math.max(1, ...data.map(d => d.total));
  const groupW = (width - left - right) / Math.max(1, data.length);
  let svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(mode)} bar chart">`;
  for (let i = 0; i <= 3; i++) {
    const y = top + (height - top - bottom) * (i / 3);
    const val = max * (1 - i / 3);
    svg += `<line class="chart-grid-line" x1="${left}" x2="${width-right}" y1="${y}" y2="${y}"/><text class="chart-axis-label" x="2" y="${y+4}">${compactMoney(val)}</text>`;
  }
  data.forEach((d, i) => {
    const barW = Math.min(52, groupW * .52);
    const x = left + i * groupW + (groupW - barW) / 2;
    let running = height - bottom;
    d.parts.forEach(part => {
      const h = (part.value / max) * (height - top - bottom);
      running -= h;
      svg += `<rect x="${x}" y="${running}" width="${barW}" height="${Math.max(1, h)}" rx="2" fill="${categoryColor(part.name)}"/>`;
    });
    svg += `<text class="chart-axis-label" text-anchor="middle" x="${x + barW/2}" y="${height - 12}">${escapeHtml(d.label)}</text>`;
  });
  svg += `</svg>`;
  return svg;
}

function renderCashFlowDetail() {
  if (!$('#cashFlowDetailChart')) return;
  const data = monthlyMetricSeries('net', 9);
  $('#cashFlowDetailChart').innerHTML = simpleLineChart(data, 'Net cash flow by month');
  const current = getMetrics(selectedMonth());
  const prev = getMetrics(previousMonth(selectedMonth()));
  $('#cashFlowSummary').innerHTML = `<div class="summary-total-card"><strong class="${current.net >= 0 ? 'positive' : 'negative'}">${money(current.net)}</strong><span>${monthDateLabel()} net cash flow</span></div>${summaryRows({ ...current, transfer: monthTransactions(selectedMonth()).filter(tx => transactionType(tx) === 'transfer').reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0) })}<div class="metric-list"><div><span>Change from previous month</span><strong class="${current.net - prev.net >= 0 ? 'positive' : 'negative'}">${money(current.net - prev.net)}</strong></div></div>`;
}

function reportBreakdown(mode = currentReportMode) {
  const txs = allLedgerTransactions().filter(tx => mode === 'income' ? transactionType(tx) === 'income' : mode === 'cashflow' ? !['transfer','excluded'].includes(transactionType(tx)) : transactionType(tx) === 'expense');
  const map = new Map();
  txs.forEach(tx => {
    const key = mode === 'cashflow' ? transactionTypeLabel(transactionType(tx)) : (tx.category || 'Other');
    map.set(key, (map.get(key) || 0) + Math.abs(Number(tx.amount)));
  });
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

function renderReports() {
  if (!$('#reportChartLayout')) return;
  $$('.report-subtab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.reportMode === currentReportMode);
    btn.onclick = () => { currentReportMode = btn.dataset.reportMode; renderReports(); };
  });
  const data = reportBreakdown(currentReportMode);
  const total = data.reduce((s, item) => s + item.value, 0);
  const titleMap = { spending: 'Spending by category', cashflow: 'Cash flow by type', income: 'Income by source' };
  $('#reportKicker').textContent = titleMap[currentReportMode].toUpperCase();
  $('#reportTitle').textContent = 'All time';
  const size = 250, center = 125, radius = 82, stroke = 27, circumference = 2 * Math.PI * radius;
  let offset = 0;
  const circles = total ? data.slice(0, 10).map(item => {
    const fraction = item.value / total;
    const dash = Math.max(0, fraction * circumference - 2.5);
    const circle = `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${categoryColor(item.name)}" stroke-width="${stroke}" stroke-dasharray="${dash} ${circumference-dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${center} ${center})"/>`;
    offset += fraction * circumference;
    return circle;
  }).join('') : '';
  const legend = data.slice(0, 12).map(item => `<div class="report-legend-row"><i style="background:${categoryColor(item.name)}"></i><span>${escapeHtml(item.name)}<strong>${money(item.value)} (${total ? (item.value / total * 100).toFixed(1) : '0.0'}%)</strong></span></div>`).join('');
  $('#reportChartLayout').innerHTML = total ? `<div class="report-donut"><svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Report donut"><circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="#ece8df" stroke-width="${stroke}"/>${circles}<text class="donut-center-value" x="${center}" y="${center-4}" text-anchor="middle">${escapeHtml(compactMoney(total))}</text><text class="donut-center-label" x="${center}" y="${center+18}" text-anchor="middle">Total</text></svg></div><div class="report-legend-grid">${legend}</div>` : emptyState('No report data', 'Import transactions to generate this report.');
  const txs = allLedgerTransactions().filter(tx => currentReportMode === 'income' ? transactionType(tx) === 'income' : currentReportMode === 'spending' ? transactionType(tx) === 'expense' : !['transfer','excluded'].includes(transactionType(tx))).slice(0, 6);
  $('#reportTransactionsList').innerHTML = txs.length ? txs.map(tx => recentRow(tx)).join('') : emptyState('No transactions', 'No transactions match this report yet.');
  const metrics = metricRowsFromTransactions(txs.length ? allLedgerTransactions() : []);
  $('#reportSummaryPanel').innerHTML = summaryRows(metrics);
}

function budgetKey() { return selectedMonth(); }
function getBudgetFor(category) { return Number(state.budgets?.[budgetKey()]?.[category] || 0); }
function setBudgetFor(category, value) {
  state.budgets ||= {};
  state.budgets[budgetKey()] ||= {};
  state.budgets[budgetKey()][category] = Math.max(0, Number(value || 0));
}

function renderBudget() {
  if (!$('#budgetTable')) return;
  $('#budgetMonthTitle').textContent = `${monthDateLabel()} budget`;
  const month = selectedMonth();
  const expenseData = categoryBreakdown(month);
  const incomeActual = reportingTransactions(month).filter(tx => transactionType(tx) === 'income').reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0);
  const incomeBudget = getBudgetFor('Income') || incomeActual;
  const expenseCategories = [...new Set([...expenseData.map(d => d.name), 'Housing', 'Groceries', 'Bills & Utilities', 'Transportation', 'Dining', 'Shopping', 'Subscriptions'])];
  const expenseRows = expenseCategories.map(category => ({ category, actual: expenseData.find(d => d.name === category)?.value || 0, budget: getBudgetFor(category) }));
  const totalExpenseBudget = expenseRows.reduce((s, row) => s + row.budget, 0);
  const totalExpenseActual = expenseRows.reduce((s, row) => s + row.actual, 0);
  const incomeRemaining = incomeBudget - incomeActual;
  const sections = [
    { name: 'Income', rows: [{ category: 'Paychecks', budgetCategory: 'Income', actual: incomeActual, budget: incomeBudget }], kind: 'income' },
    { name: 'Expenses', rows: expenseRows, kind: 'expense' }
  ];
  $('#budgetTable').innerHTML = sections.map(section => `<div class="budget-section"><div class="budget-section-row"><button type="button" aria-label="Expand ${section.name}">⌄</button><strong>${section.name}</strong><span>${money(section.rows.reduce((s,r)=>s+r.budget,0))}</span><span>${money(section.rows.reduce((s,r)=>s+r.actual,0))}</span><span class="${section.kind === 'income' ? 'positive' : (section.rows.reduce((s,r)=>s+r.budget-r.actual,0) >= 0 ? 'positive' : 'negative')}">${money(section.rows.reduce((s,r)=>s+r.budget-r.actual,0))}</span></div>${section.rows.map(row => budgetRow(row, section.kind)).join('')}</div>`).join('');
  $$('#budgetTable .budget-input').forEach(input => input.addEventListener('change', event => { setBudgetFor(event.target.dataset.category, event.target.value); saveState(); renderBudget(); }));
  const left = incomeActual - totalExpenseActual;
  const budgetStatusClass = left >= 0 ? 'positive-state' : 'negative-state';
  const budgetStatusLabel = left >= 0 ? 'Left after spending' : 'Over income';
  $('#budgetSummaryPanel').innerHTML = `<div class="budget-left-card ${budgetStatusClass}"><strong>${money(left)}</strong><span>${budgetStatusLabel}</span></div><div class="budget-tabs"><button class="active" type="button">Summary</button><button type="button">Income</button><button type="button">Expenses</button></div><div class="budget-summary-list"><div><span>Income actual</span><strong>${money(incomeActual)}</strong></div><div><span>Expense budget</span><strong>${money(totalExpenseBudget)}</strong></div><div><span>Expense actual</span><strong>${money(totalExpenseActual)}</strong></div><div><span>Remaining budget</span><strong class="${totalExpenseBudget - totalExpenseActual >= 0 ? 'positive' : 'negative'}">${money(totalExpenseBudget - totalExpenseActual)}</strong></div></div>`;
}

function budgetRow(row, kind) {
  const category = row.budgetCategory || row.category;
  const remaining = row.budget - row.actual;
  const width = row.budget ? Math.min(100, (row.actual / row.budget) * 100) : (row.actual ? 100 : 0);
  return `<div class="budget-line ${kind}"><span class="budget-category"><i style="background:${categoryColor(row.category)}"></i>${escapeHtml(row.category)}</span><span><input class="budget-input" data-category="${escapeHtml(category)}" type="number" min="0" step="1" value="${row.budget ? row.budget.toFixed(0) : ''}" placeholder="0" /></span><span>${money(row.actual)}</span><span class="${remaining >= 0 ? 'positive' : 'negative'}">${money(remaining)}</span><em style="width:${width}%"></em></div>`;
}

function recurringCandidates() {
  const byName = new Map();
  allLedgerTransactions().forEach(tx => {
    const key = normalizeFilterText(tx.merchant || tx.description || 'Unknown');
    if (!key) return;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(tx);
  });
  return [...byName.values()].filter(rows => rows.length >= 2).map(rows => {
    rows.sort((a,b) => String(a.date).localeCompare(String(b.date)));
    const avg = rows.reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0) / rows.length;
    const gaps = rows.slice(1).map((tx, i) => daysBetween(tx.date, rows[i].date));
    const avgGap = gaps.length ? gaps.reduce((s, v) => s + v, 0) / gaps.length : 30;
    const last = rows.at(-1);
    const next = new Date(`${last.date}T12:00:00`); next.setDate(next.getDate() + Math.round(avgGap || 30));
    return { name: last.merchant || last.description || 'Unknown', category: last.category || 'Other', type: transactionType(last), count: rows.length, avg, avgGap, nextDate: next.toISOString().slice(0,10) };
  }).sort((a,b) => b.avg - a.avg).slice(0, 12);
}

function renderRecurring() {
  if (!$('#recurringList')) return;
  const rows = recurringCandidates();
  $('#recurringList').innerHTML = rows.length ? rows.map(item => `<div class="recurring-row ${item.type}"><div class="transaction-icon ${item.type}">${escapeHtml(item.name.charAt(0).toUpperCase())}</div><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.category)} · about every ${Math.round(item.avgGap)} days · ${item.count} hits</span></div><div><strong>${money(item.avg)}</strong><span>Next around ${formatDate(item.nextDate)}</span></div></div>`).join('') : emptyState('No recurring activity detected', 'Import more statement history to identify recurring bills and income.');
  $('#recurringSummary').innerHTML = summaryRows(metricRowsFromTransactions(rows.map(item => ({ amount: item.type === 'expense' ? -item.avg : item.avg, type: item.type }))));
}

function renderGoals() {
  if (!$('#goalsGrid')) return;
  const netAllTime = allLedgerTransactions().filter(tx => !['transfer','excluded'].includes(transactionType(tx))).reduce((s, tx) => s + (transactionType(tx) === 'income' ? Math.abs(Number(tx.amount)) : -Math.abs(Number(tx.amount))), 0);
  $('#goalsGrid').innerHTML = state.goals.map(goal => {
    const saved = Math.max(0, Number(goal.saved || 0) + Math.max(0, netAllTime));
    const target = Math.max(1, Number(goal.target || 1));
    const pct = Math.min(100, saved / target * 100);
    return `<div class="goal-card" data-id="${goal.id}"><div class="goal-card-head"><strong>${escapeHtml(goal.name)}</strong><span>${pct.toFixed(0)}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><div class="goal-fields"><label>Target <input class="goal-target-input" type="number" min="1" step="100" value="${target}" /></label><label>Starting saved <input class="goal-saved-input" type="number" min="0" step="100" value="${Number(goal.saved || 0)}" /></label></div><p>${money(saved)} of ${money(target)}</p></div>`;
  }).join('');
  $$('#goalsGrid .goal-target-input').forEach(input => input.addEventListener('change', event => { const goal = state.goals.find(g => g.id === event.target.closest('[data-id]').dataset.id); goal.target = Number(event.target.value || 0); saveState(); renderGoals(); }));
  $$('#goalsGrid .goal-saved-input').forEach(input => input.addEventListener('change', event => { const goal = state.goals.find(g => g.id === event.target.closest('[data-id]').dataset.id); goal.saved = Number(event.target.value || 0); saveState(); renderGoals(); }));
  const first = state.goals[0];
  $('#goalsSummary').innerHTML = `<div class="summary-total-card"><strong>${money(Math.max(0, netAllTime))}</strong><span>All-time positive cash flow available for goals</span></div><div class="metric-list"><div><span>Active goals</span><strong>${state.goals.length}</strong></div><div><span>Primary target</span><strong>${money(first?.target || 0)}</strong></div></div>`;
}

function renderAdvice() {
  if (!$('#adviceList')) return;
  const month = selectedMonth();
  const metrics = getMetrics(month);
  const breakdown = categoryBreakdown(month);
  const budgetRows = breakdown.map(item => ({ ...item, budget: getBudgetFor(item.name) })).filter(item => item.budget);
  const overBudget = budgetRows.filter(item => item.value > item.budget);
  const items = [];
  if (metrics.income && metrics.rate < 10) items.push({ title: 'Increase savings margin', text: `Your selected-month savings rate is ${metrics.rate.toFixed(1)}%. Aim for at least 10–20% by reducing flexible categories first.` });
  if (overBudget.length) items.push({ title: 'Review over-budget categories', text: `${overBudget[0].name} is ${money(overBudget[0].value - overBudget[0].budget)} over budget this month.` });
  if (breakdown[0]) items.push({ title: `Watch ${breakdown[0].name}`, text: `${breakdown[0].name} is your largest spending category at ${money(breakdown[0].value)} for ${monthDateLabel(month)}.` });
  if (!state.transactions.length) items.push({ title: 'Import transaction history', text: 'Upload checking and credit-card statements to unlock budget, recurring, and report insights.' });
  if (!items.length) items.push({ title: 'Spending is organized', text: 'Your current month has positive cash flow and no obvious budget exceptions.' });
  $('#adviceList').innerHTML = items.map((item, index) => `<div class="advice-card"><span>${index + 1}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p></div></div>`).join('');
  $('#adviceSummary').innerHTML = `<div class="summary-total-card"><strong class="${metrics.net >= 0 ? 'positive' : 'negative'}">${money(metrics.net)}</strong><span>${monthDateLabel()} net cash flow</span></div>${summaryRows({ ...metrics, transfer: 0 })}`;
}

function renderRules() {
  const rules = [...state.rules].sort((a,b) => Number(a.priority||100) - Number(b.priority||100));
  if (!rules.length) { $('#rulesList').innerHTML = emptyState('No rules yet', 'Create a rule to automate categories and ownership.', true); return; }
  $('#rulesList').innerHTML = rules.map((rule, index) => `<div class="rule-row" data-id="${rule.id}">
    <div class="rule-index">${String(index+1).padStart(2,'0')}</div>
    <div class="rule-condition"><strong>${escapeHtml(rule.field)} ${escapeHtml(rule.operator)} “${escapeHtml(rule.value)}”</strong><span>Priority ${rule.priority || 100}</span></div>
    <div class="rule-result"><strong>${escapeHtml(rule.category)}</strong><span>${rule.type === 'auto' ? 'Keep detected type' : escapeHtml(rule.type)}</span></div>
    <div class="rule-owner"><span class="owner-pill">${escapeHtml(memberName(rule.owner))}</span></div>
    <div class="rule-actions"><button class="row-action edit-rule" aria-label="Edit rule"><svg viewBox="0 0 24 24"><path d="m4 16-.8 4 4-.8L18 8.4 15.6 6 4 16Z"/></svg></button><button class="row-action delete-rule" aria-label="Delete rule"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/></svg></button></div>
  </div>`).join('');
  $$('.edit-rule').forEach(btn => btn.addEventListener('click', () => openRuleModal(state.rules.find(rule => rule.id === btn.closest('[data-id]').dataset.id))));
  $$('.delete-rule').forEach(btn => btn.addEventListener('click', () => { const id = btn.closest('[data-id]').dataset.id; if (confirm('Delete this categorization rule?')) { state.rules = state.rules.filter(rule => rule.id !== id); saveState(); renderRules(); toast('Rule deleted', 'Future imports will no longer use this rule.'); } }));
}

function openRuleModal(rule = null) {
  hydrateAllSelects();
  $('#ruleModalTitle').textContent = rule ? 'Edit categorization rule' : 'New categorization rule';
  $('#ruleIdInput').value = rule?.id || '';
  $('#ruleFieldInput').value = rule?.field || 'merchant';
  $('#ruleOperatorInput').value = rule?.operator || 'contains';
  $('#ruleValueInput').value = rule?.value || '';
  $('#ruleCategoryInput').value = rule?.category || 'Other';
  $('#ruleOwnerInput').value = rule?.owner || 'shared';
  $('#ruleTypeInput').value = rule?.type || 'auto';
  $('#rulePriorityInput').value = rule?.priority || 100;
  openModal('#ruleModal');
}

function saveRuleFromForm(event) {
  event.preventDefault();
  const id = $('#ruleIdInput').value || uid('rule');
  const rule = { id, field: $('#ruleFieldInput').value, operator: $('#ruleOperatorInput').value, value: $('#ruleValueInput').value.trim(), category: $('#ruleCategoryInput').value, owner: $('#ruleOwnerInput').value, type: $('#ruleTypeInput').value, priority: Number($('#rulePriorityInput').value) || 100 };
  const index = state.rules.findIndex(item => item.id === id);
  if (index >= 0) state.rules[index] = rule; else state.rules.push(rule);
  saveState(); closeModals(); renderRules(); toast(index >= 0 ? 'Rule updated' : 'Rule created', 'The rule will be applied during future statement imports.');
}

function renderSettings() {
  $('#householdNameInput').value = state.household.name;
  $('#memberOneInput').value = state.members.find(m => m.id === 'member-1')?.name || 'Person 1';
  $('#memberTwoInput').value = state.members.find(m => m.id === 'member-2')?.name || 'Person 2';
  $('#currencyInput').value = state.household.currency || 'USD';
  $('#weekStartInput').value = state.household.weekStart || 'sunday';
  $('#compactRowsToggle').checked = !!state.settings.compactRows;
  $('#hideCentsToggle').checked = !!state.settings.hideCents;
  renderAccountList();
}

function saveHouseholdSettings(event) {
  event.preventDefault();
  state.household.name = $('#householdNameInput').value.trim() || 'Our Household';
  state.household.currency = $('#currencyInput').value;
  state.household.weekStart = $('#weekStartInput').value;
  const one = state.members.find(m => m.id === 'member-1');
  const two = state.members.find(m => m.id === 'member-2');
  if (one) one.name = $('#memberOneInput').value.trim() || 'Person 1';
  if (two) two.name = $('#memberTwoInput').value.trim() || 'Person 2';
  saveState(); hydrateAllSelects(); renderAll(); switchView('settings'); toast('Household settings saved', 'Names and reporting preferences were updated.');
}

function renderAccountList() {
  if (!state.accounts.length) { $('#accountList').innerHTML = emptyState('No accounts', 'Add an account before importing a statement.', true); return; }
  $('#accountList').innerHTML = state.accounts.map(account => `<div class="account-row" data-id="${account.id}">
    <div class="account-icon"><svg viewBox="0 0 24 24"><path d="M4 7h16v11H4zM4 10h16M8 15h3"/></svg></div>
    <div><strong>${escapeHtml(account.name)}</strong><span>${escapeHtml(account.type)} · ${escapeHtml(memberName(account.owner))}${account.institution ? ` · ${escapeHtml(account.institution)}` : ''}</span></div>
    <div class="account-actions"><button class="row-action edit-account" aria-label="Edit account"><svg viewBox="0 0 24 24"><path d="m4 16-.8 4 4-.8L18 8.4 15.6 6 4 16Z"/></svg></button><button class="row-action delete-account" aria-label="Delete account"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/></svg></button></div>
  </div>`).join('');
  $$('.edit-account').forEach(btn => btn.addEventListener('click', () => openAccountModal(state.accounts.find(a => a.id === btn.closest('[data-id]').dataset.id))));
  $$('.delete-account').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.closest('[data-id]').dataset.id;
    const inUse = state.transactions.some(tx => tx.account === id);
    if (inUse) return toast('Account is in use', 'Reassign or delete its transactions before removing the account.');
    if (confirm('Delete this account?')) { state.accounts = state.accounts.filter(a => a.id !== id); saveState(); hydrateAllSelects(); renderSettings(); toast('Account deleted', 'The account was removed from your statement list.'); }
  }));
}

function openAccountModal(account = null) {
  hydrateAllSelects();
  $('#accountModalTitle').textContent = account ? 'Edit statement account' : 'Add statement account';
  $('#accountIdInput').value = account?.id || '';
  $('#accountNameInput').value = account?.name || '';
  $('#accountTypeInput').value = account?.type || 'checking';
  $('#accountOwnerInput').value = account?.owner || 'shared';
  $('#accountInstitutionInput').value = account?.institution || '';
  openModal('#accountModal');
}

function saveAccountFromForm(event) {
  event.preventDefault();
  const id = $('#accountIdInput').value || uid('account');
  const account = { id, name: $('#accountNameInput').value.trim(), type: $('#accountTypeInput').value, owner: $('#accountOwnerInput').value, institution: $('#accountInstitutionInput').value.trim() };
  const index = state.accounts.findIndex(item => item.id === id);
  if (index >= 0) state.accounts[index] = account; else state.accounts.push(account);
  saveState();
  closeModals();
  hydrateAllSelects();
  renderAll();
  toast(index >= 0 ? 'Account updated' : 'Account added', `${account.name} is ready for statement imports.`);
}

function applyDisplaySettings() { document.body.classList.toggle('compact-rows', !!state.settings.compactRows); }

async function processStatementFile(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (!['csv','pdf'].includes(extension)) { toast('Unsupported file type', 'Choose a CSV or PDF statement.'); return; }
  if (file.size > 15 * 1024 * 1024) toast('Large file', 'Processing may take longer than usual in your browser.');
  showImportStatus(true, 'Reading statement…', `Processing ${file.name}`);
  try {
    const fallbackAccountId = $('#importAccount').value;
    const fallbackAccountRecord = state.accounts.find(item => item.id === fallbackAccountId) || {};
    let parsed;
    if (extension === 'csv') parsed = await parseCsvFile(file, fallbackAccountRecord);
    else parsed = await parsePdfFile(file, fallbackAccountRecord);
    if (!parsed.length) throw new Error(extension === 'pdf' ? 'No transactions were detected. This may be a scanned PDF.' : 'No transaction rows were detected in the CSV.');
    const resolvedAccount = resolveStatementAccount(file, parsed, fallbackAccountRecord);
    const account = resolvedAccount.accountId;
    const accountRecord = resolvedAccount.accountRecord;
    const owner = $('#importOwner').value || accountRecord.owner || 'shared';
    const statementConvention = inferStatementConvention(parsed, accountRecord);
    const normalized = parsed.map(raw => {
      const detectedType = raw.type || classifyImportedTransaction(raw, accountRecord, statementConvention);
      const detectedAmount = normalizeAmountForType(raw.amount, detectedType);
      let tx = {
        id: uid('draft'), date: raw.date, merchant: raw.merchant || cleanMerchant(raw.description),
        description: raw.description || raw.merchant || 'Imported transaction', amount: detectedAmount,
        type: detectedType,
        category: raw.category || (detectedType === 'income'
          ? 'Income'
          : detectedType === 'transfer'
            ? 'Transfer'
            : detectedType === 'excluded'
              ? 'Other'
              : autoCategory(`${raw.merchant || ''} ${raw.description || ''}`, detectedAmount)),
        owner, account, notes: '', source: extension,
        bankType: raw.bankType || '', bankDirection: raw.bankDirection || '', bankFlowHint: raw.flowHint || '',
        selected: true
      };
      tx = applyRules(tx);
      tx.account = account;
      tx.fingerprint = fingerprint(tx);
      tx.duplicate = isDuplicate(tx);
      if (tx.duplicate) tx.selected = false;
      return tx;
    }).filter(tx => tx.date && Number.isFinite(tx.amount) && tx.amount !== 0);
    markTransferSuggestions(normalized);
    importDraft = {
      fileName: file.name,
      fileType: extension.toUpperCase(),
      transactions: normalized,
      account,
      accountRecord,
      accountName: resolvedAccount.accountName,
      accountOriginalName: resolvedAccount.accountName,
      accountIsNew: resolvedAccount.accountIsNew,
      accountMetadata: resolvedAccount.metadata,
      accountDetectionLabel: resolvedAccount.detectionLabel,
      owner,
      importedAt: new Date().toISOString()
    };
    renderImportReview();
    openModal('#importReviewModal');
  } catch (error) {
    console.error(error);
    toast('Could not read statement', error.message || 'The file format could not be parsed.');
  } finally {
    showImportStatus(false);
    $('#statementFile').value = '';
  }
}

function showImportStatus(show, title = '', text = '') {
  $('#importStatus').classList.toggle('hidden', !show);
  if (show) { $('#importStatusTitle').textContent = title; $('#importStatusText').textContent = text; }
}

async function parseCsvFile(file, account = {}) {
  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headerIndex = rows.findIndex(row => row.some(cell => /date|description|merchant|amount|debit|credit|withdrawal|deposit/i.test(cell)));
  const headers = (rows[headerIndex >= 0 ? headerIndex : 0] || []).map(h => normalizeHeader(h));
  const dataRows = rows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);
  const dateIndex = findHeader(headers, ['date','transaction date','posted date','posting date']);
  const descIndex = findHeader(headers, ['description','merchant','name','details','transaction description','memo']);
  const bankDirectionIndex = findHeader(headers, ['details','debit credit','debit/credit','transaction direction','direction']);
  const bankTypeIndex = findHeader(headers, ['type','transaction type','transaction code','entry type']);
  const balanceIndex = findHeader(headers, ['balance','running balance']);
  const amountIndex = findHeader(headers, ['amount','transaction amount']);
  const debitIndex = findHeader(headers, ['debit','withdrawal','withdrawals','charge']);
  const creditIndex = findHeader(headers, ['credit','deposit','deposits','payment']);
  if (dateIndex < 0 || descIndex < 0 || (amountIndex < 0 && debitIndex < 0 && creditIndex < 0)) throw new Error('The CSV needs date, description, and amount/debit/credit columns.');
  const parsedRows = dataRows.map(row => {
    const date = parseDateValue(row[dateIndex]);
    const description = String(row[descIndex] || '').trim();
    const bankDirection = bankDirectionIndex >= 0 ? String(row[bankDirectionIndex] || '').trim() : '';
    const bankType = bankTypeIndex >= 0 ? String(row[bankTypeIndex] || '').trim() : '';
    const balance = balanceIndex >= 0 ? parseMoneyValue(row[balanceIndex]) : null;
    let amount;
    let amountSource = 'amount';
    let flowHint = normalizeBankDirection(bankDirection);
    if (amountIndex >= 0) amount = parseMoneyValue(row[amountIndex]);
    else {
      amountSource = 'debit-credit';
      const debit = debitIndex >= 0 ? Math.abs(parseMoneyValue(row[debitIndex]) || 0) : 0;
      const credit = creditIndex >= 0 ? Math.abs(parseMoneyValue(row[creditIndex]) || 0) : 0;
      amount = credit ? credit : -debit;
      flowHint = credit ? 'credit' : debit ? 'debit' : flowHint;
    }
    return {
      date,
      description,
      merchant: cleanMerchant(description),
      amount,
      amountSource,
      flowHint,
      bankDirection,
      bankType,
      balance,
      sourceFormat: 'csv'
    };
  }).filter(row => row.date && row.description && Number.isFinite(row.amount) && row.amount !== 0);
  parsedRows.metadata = extractStatementAccountMetadata({ fileName: file.name, text, rows, headers });
  return parsedRows;
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i+1];
    if (ch === '"' && quoted && next === '"') { field += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if ((ch === ',' || ch === '\t' || ch === ';') && !quoted) { row.push(field.trim()); field = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i++;
      row.push(field.trim()); field = '';
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field.trim());
  if (row.some(cell => cell !== '')) rows.push(row);
  return rows;
}

function normalizeHeader(value) { return String(value || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function findHeader(headers, candidates) {
  for (const candidate of candidates) { const exact = headers.indexOf(candidate); if (exact >= 0) return exact; }
  for (let i = 0; i < headers.length; i++) if (candidates.some(candidate => headers[i].includes(candidate))) return i;
  return -1;
}

async function parsePdfFile(file, account = {}) {
  const pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const allLines = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = groupPdfItemsIntoLines(content.items).map(line => ({ ...line, pageNumber }));
    allLines.push(...lines);
  }
  const parsedRows = parseTransactionLines(allLines, account);
  parsedRows.metadata = extractStatementAccountMetadata({ fileName: file.name, text: allLines.map(line => line.text).join('\n') });
  return parsedRows;
}

function groupPdfItemsIntoLines(items) {
  const rows = [];
  const sorted = [...items].sort((a,b) => {
    const yDiff = b.transform[5] - a.transform[5];
    return Math.abs(yDiff) > 2 ? yDiff : a.transform[4] - b.transform[4];
  });
  sorted.forEach(item => {
    const y = item.transform[5];
    let row = rows.find(r => Math.abs(r.y - y) <= 2.5);
    if (!row) { row = { y, items: [] }; rows.push(row); }
    const text = String(item.str || '').replace(/\s+/g, ' ').trim();
    if (text) row.items.push({ x: item.transform[4], width: Number(item.width || 0), text });
  });
  return rows.sort((a,b) => b.y - a.y).map(row => {
    const orderedItems = row.items.sort((a,b) => a.x - b.x);
    let text = '';
    const segments = [];
    orderedItems.forEach(item => {
      if (text) text += ' ';
      const start = text.length;
      text += item.text;
      segments.push({ start, end: text.length, x: item.x, width: item.width, text: item.text });
    });
    return { y: row.y, text, items: orderedItems, segments };
  }).filter(line => line.text);
}

function getPdfLineText(line) {
  return typeof line === 'string' ? line : String(line?.text || '');
}

function pdfHeaderX(line, patterns) {
  if (!line || typeof line === 'string' || !Array.isArray(line.items)) return null;
  const positions = [];
  line.items.forEach(item => {
    for (const pattern of patterns) {
      const match = String(item.text || '').match(pattern);
      if (!match) continue;
      const offset = Number(match.index || 0) / Math.max(1, String(item.text || '').length);
      positions.push(Number(item.x || 0) + Number(item.width || 0) * offset);
      break;
    }
  });
  if (!positions.length) return null;
  return positions.reduce((sum, position) => sum + position, 0) / positions.length;
}

function detectPdfColumnMap(line, accountType = '') {
  const text = getPdfLineText(line);
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!/\bdate\b/.test(normalized)) return null;
  const hasBalance = /\bbalance\b/.test(normalized);
  const hasDebit = /\bwithdrawals?\b|\bdebits?\b|\bcharges?\b|\bsubtractions?\b/.test(normalized);
  const hasCredit = /\bdeposits?\b|\bcredits?\b|\badditions?\b/.test(normalized);
  const hasAmount = /\bamount\b/.test(normalized);
  if (!hasBalance && !hasDebit && !hasCredit && !hasAmount) return null;

  const columns = {
    debit: hasDebit ? pdfHeaderX(line, [/withdraw/i, /debit/i, /charge/i, /subtract/i]) : null,
    credit: hasCredit ? pdfHeaderX(line, [/deposit/i, /credit/i, /addition/i]) : null,
    amount: hasAmount ? pdfHeaderX(line, [/amount/i]) : null,
    balance: hasBalance ? pdfHeaderX(line, [/balance/i]) : null,
    balanceOnly: hasBalance && !hasDebit && !hasCredit && !hasAmount
  };

  // A credit-card header labeled "Payments and Credits" represents money credited to the card,
  // not household income. The account-aware classifier handles that flow as a transfer/credit.
  if (accountType === 'credit' && /payments?\s+(?:and|&)\s+credits?/.test(normalized)) {
    columns.credit = columns.credit ?? pdfHeaderX(line, [/payment/i, /credit/i]);
  }
  return columns;
}

function detectPdfSectionFlow(text, accountType = '') {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value || value.length > 110) return '';
  if (accountType === 'credit' && /\bpayments?\s+(?:and|&)\s+credits?\b/i.test(value)) return 'credit';
  if (matchesAnyPattern(value, PDF_DEBIT_SECTION_PATTERNS)) return 'debit';
  if (matchesAnyPattern(value, PDF_CREDIT_SECTION_PATTERNS)) return 'credit';
  return '';
}

function looksLikePdfTableHeader(text) {
  const value = String(text || '').toLowerCase();
  return /\bdate\b/.test(value) && /\b(?:description|details?|transaction|amount|debit|credit|withdrawal|deposit|balance)\b/.test(value);
}

function looksLikePdfSummaryLine(text) {
  const value = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return /\b(?:beginning|ending|opening|closing|average daily|minimum daily|maximum daily) balance\b/.test(value)
    || /\b(?:account|statement|daily balance|balance) summary\b/.test(value)
    || /^total\b/.test(value)
    || /\btotal (?:deposits?|withdrawals?|credits?|debits?|fees?|purchases?|payments?)\b/.test(value);
}

function extractPdfMoneyMatches(line) {
  const text = getPdfLineText(line);
  const moneyPattern = /(?:\(?-?\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})\)?|-?\$?\s*\d+\.\d{2})/g;
  return [...text.matchAll(moneyPattern)].map(match => {
    const index = Number(match.index || 0);
    const mappedIndex = index + (match[0].match(/^\s*/)?.[0].length || 0);
    let x = null;
    if (line && typeof line !== 'string' && Array.isArray(line.segments)) {
      const segment = line.segments.find(item => mappedIndex >= item.start && mappedIndex < item.end);
      if (segment) {
        const relative = Math.max(0, mappedIndex - segment.start) / Math.max(1, segment.end - segment.start);
        x = Number(segment.x || 0) + Number(segment.width || 0) * relative;
      }
    }
    return { text: match[0], index, x };
  });
}

function nearestPdfColumn(x, columns) {
  if (!Number.isFinite(x) || !columns) return { key: '', distance: Infinity };
  const candidates = ['debit', 'credit', 'amount', 'balance']
    .filter(key => Number.isFinite(columns[key]))
    .map(key => ({ key, position: Number(columns[key]) }))
    .sort((a, b) => a.position - b.position);
  if (!candidates.length) return { key: '', distance: Infinity };

  // Statement values are commonly right-aligned within the column that starts at the header's X
  // position. Prefer the nearest column start at or to the left of the value, then fall back to
  // ordinary proximity when the value begins before the first header.
  const left = [...candidates].reverse().find(item => item.position <= x + 4);
  const selected = left || [...candidates].sort((a, b) => Math.abs(x - a.position) - Math.abs(x - b.position))[0];
  return { key: selected.key, distance: Math.abs(x - selected.position) };
}

function inferPdfInlineFlow(text, accountType = '') {
  const value = String(text || '');
  if (matchesAnyPattern(value, IMPORT_EXPENSE_PATTERNS)) return 'debit';
  if (hasIncomeSignal(value)) return 'credit';
  if (accountType === 'credit' && matchesAnyPattern(value, IMPORT_CARD_PAYMENT_PATTERNS)) return 'credit';
  return '';
}

function choosePdfTransactionAmount(line, amountMatches, columns, sectionFlowHint, accountType = '') {
  if (!amountMatches.length) return null;
  let selected = null;
  let columnKey = '';

  if (columns && !columns.balanceOnly) {
    const positioned = amountMatches
      .map(match => ({ match, nearest: nearestPdfColumn(match.x, columns) }))
      .filter(item => item.nearest.key && item.nearest.key !== 'balance');
    if (positioned.length) {
      positioned.sort((a, b) => a.match.index - b.match.index || a.nearest.distance - b.nearest.distance);
      selected = positioned[0].match;
      columnKey = positioned[0].nearest.key;
    }
  }

  // In transaction tables that also show a running balance, the transaction amount is normally
  // the first monetary value and the balance is the final value. Never default to the final value.
  if (!selected) selected = amountMatches[0];

  let flowHint = columnKey === 'debit' ? 'debit' : columnKey === 'credit' ? 'credit' : '';
  if (!flowHint) flowHint = inferPdfInlineFlow(getPdfLineText(line), accountType);
  if (!flowHint) flowHint = sectionFlowHint;

  return { ...selected, flowHint, columnKey };
}

function parseTransactionLines(lines, account = {}) {
  const results = [];
  const datePattern = /^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{2,4})?)/i;
  let current = null;
  let sectionFlowHint = '';
  let columns = null;
  let currentPage = null;

  for (const line of lines) {
    const text = getPdfLineText(line).replace(/\s+/g, ' ').trim();
    if (!text) continue;

    if (line && typeof line !== 'string' && line.pageNumber !== currentPage) {
      currentPage = line.pageNumber;
      columns = null;
    }

    const dateMatch = text.match(datePattern);
    const detectedColumns = detectPdfColumnMap(line, account.type || '');
    if (detectedColumns && looksLikePdfTableHeader(text)) {
      columns = detectedColumns;
      current = null;
      continue;
    }

    if (!dateMatch) {
      const detectedSection = detectPdfSectionFlow(text, account.type || '');
      if (detectedSection) {
        sectionFlowHint = detectedSection;
        current = null;
        continue;
      }
    }

    if (looksLikePdfSummaryLine(text)) {
      current = null;
      continue;
    }

    const amountMatches = extractPdfMoneyMatches(line);
    if (dateMatch && amountMatches.length) {
      if (columns?.balanceOnly) continue;
      const selected = choosePdfTransactionAmount(line, amountMatches, columns, sectionFlowHint, account.type || '');
      if (!selected) continue;
      const date = parseDateValue(dateMatch[1]);
      if (!date) continue;

      let amount = parseMoneyValue(selected.text);
      if (selected.flowHint === 'debit') amount = -Math.abs(amount);
      else if (selected.flowHint === 'credit') amount = Math.abs(amount);

      const description = text.slice(dateMatch[0].length, selected.index).replace(/\s+/g, ' ').trim();
      current = {
        date,
        description: description || 'Imported transaction',
        merchant: cleanMerchant(description),
        amount,
        amountSource: selected.columnKey === 'debit' || selected.columnKey === 'credit' ? 'debit-credit' : 'pdf-table',
        flowHint: selected.flowHint,
        sourceFormat: 'pdf'
      };
      results.push(current);
    } else if (current && text.length < 120 && !/page \d|statement|balance|total|account number/i.test(text) && !dateMatch && !amountMatches.length) {
      current.description = `${current.description} ${text}`.replace(/\s+/g, ' ').trim();
      current.merchant = cleanMerchant(current.description);
    }
  }
  return results.filter(row => row.date && row.description && Number.isFinite(row.amount) && row.amount !== 0);
}

function parseDateValue(value) {
  if (!value) return '';
  let input = String(value).trim().replace(/\./g,'/');
  const currentYear = new Date().getFullYear();
  if (/^\d{1,2}[\/-]\d{1,2}$/.test(input)) input += `/${currentYear}`;
  if (/^[A-Za-z]{3,9}\s+\d{1,2}$/.test(input)) input += `, ${currentYear}`;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear(), m = String(date.getMonth()+1).padStart(2,'0'), d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

function parseMoneyValue(value) {
  if (value == null || value === '') return NaN;
  const text = String(value).trim();
  const negative = /^\(.*\)$/.test(text) || /^-/.test(text);
  const number = Number(text.replace(/[()$,\s]/g,'').replace(/\+/,''));
  if (!Number.isFinite(number)) return NaN;
  return negative ? -Math.abs(number) : number;
}

function cleanMerchant(description = '') {
  return String(description)
    .replace(/\b(?:POS|ACH|DEBIT|CREDIT|PURCHASE|CHECKCARD|CARD PURCHASE|ONLINE PMT|PENDING)\b/gi, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/[\*#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70) || 'Imported transaction';
}

function markTransferSuggestions(transactions) {
  transactions.forEach((a, i) => transactions.slice(i + 1).forEach(b => {
    if (Math.abs(Number(a.amount) + Number(b.amount)) < .01 && daysBetween(a.date, b.date) <= 5 && a.account !== b.account) {
      a.transferSuggestion = b.id; b.transferSuggestion = a.id;
    }
  }));
  transactions.forEach(tx => {
    const match = state.transactions.find(existing => Math.abs(Number(tx.amount) + Number(existing.amount)) < .01 && daysBetween(tx.date, existing.date) <= 5 && tx.account !== existing.account);
    if (match) tx.transferSuggestion = match.id;
  });
}

function renderImportReview() {
  if (!importDraft) return;
  const txs = importDraft.transactions;
  const selected = txs.filter(tx => tx.selected);
  const income = selected.filter(tx => tx.type === 'income').reduce((s,tx) => s + Math.abs(tx.amount),0);
  const expense = selected.filter(tx => tx.type === 'expense').reduce((s,tx) => s + Math.abs(tx.amount),0);
  const duplicates = txs.filter(tx => tx.duplicate).length;
  const metadata = importDraft.accountMetadata || {};
  $('#importReviewSubtitle').textContent = `${importDraft.fileName} · ${importDraft.accountIsNew ? 'New detected account' : 'Existing account'}`;
  $('#importAccountReview').innerHTML = `<div class="review-account-card">
    <div class="review-account-copy">
      <span class="review-account-label">Account assignment</span>
      <strong>${escapeHtml(importDraft.accountDetectionLabel || accountDisplayName(importDraft.account))}</strong>
      <small>${metadata.source === 'statement' ? 'Detected from statement data' : 'Detected from file name or fallback'}${metadata.last4 ? ` · ending ${escapeHtml(metadata.last4)}` : ''}${metadata.institution ? ` · ${escapeHtml(metadata.institution)}` : ''}</small>
    </div>
    <label class="field-group review-account-name"><span>Account name</span><input type="text" id="importAccountNameInput" value="${escapeHtml(importDraft.accountName || accountDisplayName(importDraft.account))}" maxlength="60" /></label>
    <span class="status-badge ${importDraft.accountIsNew ? 'new-account' : ''}">${importDraft.accountIsNew ? 'NEW ACCOUNT' : 'MATCHED'}</span>
  </div>`;
  $('#importAccountNameInput').addEventListener('input', event => {
    importDraft.accountName = event.target.value.trim() || importDraft.accountOriginalName || 'Imported Account';
    $$('#importReviewBody .import-account-pill').forEach(pill => { pill.textContent = importDraft.accountName; });
  });
  $('#importReviewSummary').innerHTML = [
    ['Detected', txs.length], ['Selected', selected.length], ['Income', money(income)], ['Spending', money(expense)]
  ].map(([label,value]) => `<div class="review-stat"><span>${label}</span><strong>${value}</strong></div>`).join('');
  $('#reviewMessage').textContent = `${duplicates ? `${duplicates} duplicate${duplicates === 1 ? '' : 's'} automatically deselected. ` : ''}Review every row before importing.`;
  $('#importReviewBody').innerHTML = txs.map(tx => `<tr data-id="${tx.id}" class="${tx.duplicate ? 'duplicate-row' : ''}">
    <td><input type="checkbox" class="import-select" ${tx.selected ? 'checked' : ''} /></td>
    <td><input type="date" class="import-date" value="${tx.date}" /></td>
    <td class="review-description"><input type="text" class="import-description" value="${escapeHtml(tx.merchant || tx.description)}" />${transactionBankTypeLabel(tx) ? `<div class="transfer-suggestion">Statement type: ${escapeHtml(transactionBankTypeLabel(tx))}</div>` : ''}${tx.duplicate ? '<div class="transfer-suggestion">Possible duplicate</div>' : tx.transferSuggestion ? '<div class="transfer-suggestion">Possible internal transfer</div>' : ''}</td>
    <td><span class="import-account-pill">${escapeHtml(accountDisplayName(tx.account))}</span></td>
    <td><select class="import-category">${DEFAULT_CATEGORIES.map(c => `<option value="${c}" ${c === tx.category ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
    <td><select class="import-owner">${state.members.map(m => `<option value="${m.id}" ${m.id === tx.owner ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}</select></td>
    <td><select class="import-type"><option value="expense" ${tx.type === 'expense' ? 'selected' : ''}>Expense</option><option value="income" ${tx.type === 'income' ? 'selected' : ''}>Income</option><option value="transfer" ${tx.type === 'transfer' ? 'selected' : ''}>Transfer</option><option value="excluded" ${tx.type === 'excluded' ? 'selected' : ''}>Excluded</option></select></td>
    <td class="amount-cell"><input type="number" step="0.01" class="import-amount" value="${Math.abs(Number(tx.amount)).toFixed(2)}" /></td>
  </tr>`).join('');
  $$('#importReviewBody tr').forEach(row => bindImportReviewRow(row));
  $('#confirmImportBtn').textContent = `Import ${selected.length} selected transaction${selected.length === 1 ? '' : 's'}`;
}

function bindImportReviewRow(row) {
  const tx = importDraft.transactions.find(item => item.id === row.dataset.id);
  $('.import-select', row).addEventListener('change', e => { tx.selected = e.target.checked; renderImportReview(); });
  $('.import-date', row).addEventListener('change', e => { tx.date = e.target.value; tx.fingerprint = fingerprint(tx); });
  $('.import-description', row).addEventListener('change', e => { tx.merchant = e.target.value.trim(); tx.description = e.target.value.trim(); tx.fingerprint = fingerprint(tx); });
  $('.import-category', row).addEventListener('change', e => { tx.category = e.target.value; });
  $('.import-owner', row).addEventListener('change', e => { tx.owner = e.target.value; });
  $('.import-type', row).addEventListener('change', e => { tx.type = e.target.value; tx.amount = normalizeAmountForType(tx.amount, tx.type); if (tx.type === 'transfer') tx.category = 'Transfer'; renderImportReview(); });
  $('.import-amount', row).addEventListener('change', e => { tx.amount = normalizeAmountForType(e.target.value, tx.type); tx.fingerprint = fingerprint(tx); });
}

function confirmImport() {
  if (!importDraft) return;
  const selected = importDraft.transactions.filter(tx => tx.selected && !isDuplicate(tx));
  if (!selected.length) { toast('Nothing selected', 'Select at least one new transaction to import.'); return; }
  const now = new Date().toISOString();
  const accountNameForImport = (importDraft.accountName || importDraft.accountOriginalName || 'Imported Account').trim();
  const existingAccountIndex = state.accounts.findIndex(account => account.id === importDraft.account);
  if (existingAccountIndex >= 0) {
    state.accounts[existingAccountIndex] = { ...state.accounts[existingAccountIndex], name: accountNameForImport, updatedAt: now };
  } else {
    state.accounts.push({ ...importDraft.accountRecord, id: importDraft.account, name: accountNameForImport, owner: importDraft.accountRecord?.owner || importDraft.owner || 'shared', createdAt: now, updatedAt: now });
  }
  const final = selected.map(tx => ({
    id: uid('tx'), date: tx.date, merchant: tx.merchant, description: tx.description,
    amount: normalizeAmountForType(tx.amount, tx.type), type: tx.type,
    category: tx.type === 'transfer' ? 'Transfer' : tx.category,
    owner: tx.owner, account: tx.account, notes: tx.notes || '', source: tx.source,
    bankType: tx.bankType || '', bankDirection: tx.bankDirection || '', bankFlowHint: tx.bankFlowHint || '',
    fingerprint: fingerprint(tx), createdAt: now, updatedAt: now
  }));
  state.transactions.push(...final);
  state.imports.unshift({ id: uid('import'), fileName: importDraft.fileName, fileType: importDraft.fileType, account: importDraft.account, owner: importDraft.owner, count: final.length, importedAt: now });
  state.imports = state.imports.slice(0, 20);
  saveState();
  const count = final.length;
  importDraft = null; closeModals(); renderAll(); switchView('dashboard');
  toast('Statement imported', `${count} transaction${count === 1 ? '' : 's'} added to your household ledger.`);
}

function renderImportHistory() {
  if (!state.imports.length) { $('#importHistory').innerHTML = `<div class="empty-state"><strong>No imports yet</strong><p>Your recent statement uploads will be listed here.</p></div>`; return; }
  $('#importHistory').innerHTML = state.imports.slice(0,6).map(item => `<div class="import-history-row"><div><strong>${escapeHtml(item.fileName)}</strong><span>${formatDate(item.importedAt.slice(0,10))} · ${escapeHtml(accountName(item.account))}</span></div><b>${item.count}</b></div>`).join('');
}

function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: 'HomeLedger', version: 2, exportedAt: new Date().toISOString(), state }, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `homeledger-backup-${new Date().toISOString().slice(0,10)}.json`);
  toast('Backup exported', 'Your synchronized household data was downloaded as a JSON file.');
}

async function importBackup(event) {
  const file = event.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const imported = data.state || data;
    if (!Array.isArray(imported.transactions) || !Array.isArray(imported.accounts)) throw new Error('Invalid backup format');
    if (!confirm('Replace the current household data in MongoDB with this backup?')) return;
    state = { ...structuredClone(DEFAULT_STATE), ...imported, household: { ...DEFAULT_STATE.household, ...(imported.household || {}) }, settings: { ...DEFAULT_STATE.settings, ...(imported.settings || {}) } };
    saveState(); applyDisplaySettings(); renderAll(); switchView('dashboard'); toast('Backup restored', 'Your household data was loaded and queued for MongoDB synchronization.');
  } catch { toast('Could not restore backup', 'The selected JSON file is not a valid HomeLedger backup.'); }
  finally { event.target.value = ''; }
}

async function clearAllData() {
  if (!confirm('Reset all transactions, imports, accounts, rules, and household settings stored for this household? This affects every signed-in device and cannot be undone unless you have a backup.')) return;
  try {
    setSyncStatus('saving', 'Resetting');
    const result = await apiRequest('/api/state/reset', { method: 'POST' });
    state = normalizeLoadedState(result.state);
    serverVersion = result.version || 1;
    updateLastServerUpdate(result.updatedAt);
    selectedTransactionIds.clear();
    hydrateAllSelects();
    applyDisplaySettings();
    renderAll();
    switchView('dashboard');
    setSyncStatus('synced', 'Synced');
    toast('Household data reset', 'The MongoDB-backed household workspace was reset to its defaults.');
  } catch (error) {
    setSyncStatus('error', 'Reset failed');
    toast('Could not reset data', error.message);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function emptyState(title, text, withButton = false) {
  return `<div class="empty-state"><svg viewBox="0 0 24 24"><path d="M4 6h16v12H4zM8 10h8M8 14h5"/></svg><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p>${withButton ? '<button class="text-button" data-go-view="import">Import a statement</button>' : ''}</div>`;
}

function toast(title, message) {
  const item = document.createElement('div'); item.className = 'toast';
  item.innerHTML = `<div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div><button aria-label="Dismiss">×</button>`;
  $('#toastStack').appendChild(item);
  $('button', item).addEventListener('click', () => item.remove());
  setTimeout(() => item.remove(), 5200);
}

function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }

bindAuth();
bootstrap();
