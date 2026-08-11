#!/usr/bin/env node
/**
 * Simulate daily ritual completions for test accounts.
 *
 * Usage:
 *   node scripts/simulate-daily-rituals.js
 *   node scripts/simulate-daily-rituals.js --dry-run
 *   node scripts/simulate-daily-rituals.js --user someone@example.com
 *   node scripts/simulate-daily-rituals.js --users-file ./scripts/test-users.json
 *
 * Credentials file (gitignored): scripts/test-users.json
 *   { "users": [{ "email": "...", "password": "..." }] }
 *
 * Env:
 *   API_BASE_URL  default https://challenge-me-backend-frh7.onrender.com/api
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_API_BASE = 'https://challenge-me-backend-frh7.onrender.com/api';
const DEFAULT_USERS_FILE = path.join(__dirname, 'test-users.json');
const DEFAULT_DELAY_MS = 800;

function parseArgs(argv) {
  const args = {
    dryRun: false,
    user: null,
    usersFile: DEFAULT_USERS_FILE,
    apiBase: (process.env.API_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, ''),
    delayMs: DEFAULT_DELAY_MS
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--user') args.user = argv[++i];
    else if (arg === '--users-file') args.usersFile = path.resolve(argv[++i]);
    else if (arg === '--api-base') args.apiBase = String(argv[++i] || '').replace(/\/$/, '');
    else if (arg === '--delay') args.delayMs = Number(argv[++i]) || DEFAULT_DELAY_MS;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }

  return args;
}

function printHelp() {
  console.log(`Simulate completing today's active habit rituals for test users.

Options:
  --dry-run              Log actions without writing progress
  --user <email>         Only process one account
  --users-file <path>    Credentials JSON (default: scripts/test-users.json)
  --api-base <url>       API base URL (default: production Render API)
  --delay <ms>           Pause between users (default: ${DEFAULT_DELAY_MS})
  -h, --help             Show this help

Credentials JSON shape:
  { "users": [{ "email": "a@example.com", "password": "secret" }] }
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function localTodayYmd() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function clientDayHeaders() {
  return {
    'x-client-day': localTodayYmd(),
    'x-client-tz-offset': String(new Date().getTimezoneOffset())
  };
}

function normalizeYmd(value) {
  if (!value) return null;
  const raw = String(value);
  if (raw.length >= 10) {
    const candidate = raw.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function participantUserId(participant) {
  return participant?.userId?._id || participant?.userId || null;
}

function findParticipant(challenge, userId) {
  const target = String(userId);
  return (challenge.participants || []).find((p) => {
    const id = participantUserId(p);
    return id && String(id) === target;
  }) || null;
}

function isDateScheduledForChallenge(challenge, dateStr) {
  const startKey = normalizeYmd(challenge?.startDate);
  const endKey = normalizeYmd(challenge?.endDate);
  const key = normalizeYmd(dateStr);
  if (!startKey || !endKey || !key) return false;
  if (key < startKey || key > endKey) return false;

  if (challenge.frequency !== 'everyOtherDay') return true;

  const start = new Date(`${startKey}T00:00:00Z`);
  const current = new Date(`${key}T00:00:00Z`);
  const diffDays = Math.floor((current.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays % 2 === 0;
}

function isMissionFinalDay(challenge, clientDayStr) {
  const endKey = normalizeYmd(challenge?.endDate);
  if (!endKey || clientDayStr !== endKey) return false;
  return isDateScheduledForChallenge(challenge, clientDayStr);
}

function loadUsers(usersFile, onlyEmail) {
  if (!fs.existsSync(usersFile)) {
    throw new Error(
      `Users file not found: ${usersFile}\n` +
      `Copy scripts/test-users.example.json to scripts/test-users.json and fill in credentials.`
    );
  }

  const raw = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
  const users = Array.isArray(raw) ? raw : raw.users;
  if (!Array.isArray(users) || users.length === 0) {
    throw new Error('Users file must contain a non-empty "users" array');
  }

  const normalized = users.map((u, index) => {
    if (!u?.email || !u?.password) {
      throw new Error(`User entry #${index + 1} is missing email or password`);
    }
    return { email: String(u.email).trim().toLowerCase(), password: String(u.password) };
  });

  if (!onlyEmail) return normalized;

  const filtered = normalized.filter((u) => u.email === onlyEmail.trim().toLowerCase());
  if (filtered.length === 0) {
    throw new Error(`No user with email "${onlyEmail}" in ${usersFile}`);
  }
  return filtered;
}

async function apiRequest(apiBase, method, route, { token, body, headers } = {}) {
  const url = `${apiBase}${route.startsWith('/') ? route : `/${route}`}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!res.ok) {
    const message = data?.message || res.statusText || `HTTP ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function login(apiBase, email, password) {
  const data = await apiRequest(apiBase, 'POST', '/auth/login', {
    body: { email, password }
  });
  if (!data?.token || !data?.user?.id) {
    throw new Error('Login response missing token or user.id');
  }
  return { token: data.token, user: data.user };
}

async function fetchActiveHabits(apiBase, token, userId) {
  const data = await apiRequest(
    apiBase,
    'GET',
    `/challenges/user/${userId}?type=habit&activity=active`,
    { token, headers: clientDayHeaders() }
  );
  return Array.isArray(data) ? data : (data?.challenges || []);
}

async function completeRitual(apiBase, token, userId, challenge, today, dryRun) {
  const participant = findParticipant(challenge, userId);
  if (!participant) {
    return { status: 'skipped', reason: 'not a participant' };
  }

  if (participant.habitMissionEndedAt) {
    return { status: 'skipped', reason: 'mission already ended' };
  }

  if (!isDateScheduledForChallenge(challenge, today)) {
    return { status: 'skipped', reason: 'today not scheduled' };
  }

  const existing = [...new Set(
    (participant.completedDays || [])
      .map(normalizeYmd)
      .filter(Boolean)
  )].sort();

  if (existing.includes(today)) {
    return { status: 'skipped', reason: 'already completed today' };
  }

  const completedDays = [...new Set([...existing, today])].sort();
  const title = challenge.title || challenge._id;
  const useFinalDayFlow = isMissionFinalDay(challenge, today);

  if (dryRun) {
    return {
      status: 'would-complete',
      reason: useFinalDayFlow ? 'final day (end-habit-mission)' : 'update completedDays',
      title
    };
  }

  if (useFinalDayFlow) {
    await apiRequest(apiBase, 'POST', `/challenges/${challenge._id}/end-habit-mission`, {
      token,
      headers: clientDayHeaders(),
      body: { completedDays }
    });
    return { status: 'completed', reason: 'final day ended', title };
  }

  await apiRequest(
    apiBase,
    'PUT',
    `/challenges/${challenge._id}/participant/${userId}/completedDays`,
    {
      token,
      headers: clientDayHeaders(),
      body: { completedDays }
    }
  );

  return { status: 'completed', reason: 'today marked', title };
}

async function processUser(apiBase, account, today, dryRun) {
  console.log(`\n=== ${account.email} ===`);

  const { token, user } = await login(apiBase, account.email, account.password);
  console.log(`Logged in as ${user.name || user.email} (${user.id})`);

  const habits = await fetchActiveHabits(apiBase, token, user.id);
  console.log(`Active habit rituals: ${habits.length}`);

  const summary = { completed: 0, skipped: 0, wouldComplete: 0, errors: 0 };

  for (const challenge of habits) {
    const label = challenge.title || challenge._id;
    try {
      const result = await completeRitual(apiBase, token, user.id, challenge, today, dryRun);
      if (result.status === 'completed') {
        summary.completed += 1;
        console.log(`  ✓ ${label} — ${result.reason}`);
      } else if (result.status === 'would-complete') {
        summary.wouldComplete += 1;
        console.log(`  ○ ${label} — would ${result.reason}`);
      } else {
        summary.skipped += 1;
        console.log(`  · ${label} — skipped (${result.reason})`);
      }
    } catch (error) {
      summary.errors += 1;
      console.error(`  ✗ ${label} — ${error.message}`);
    }
  }

  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (typeof fetch !== 'function') {
    console.error('This script requires Node.js 18+ (global fetch).');
    process.exit(1);
  }

  const today = localTodayYmd();
  const users = loadUsers(args.usersFile, args.user);

  console.log(`API: ${args.apiBase}`);
  console.log(`Today (local): ${today}`);
  console.log(`Users: ${users.length}${args.dryRun ? ' (dry-run)' : ''}`);

  const totals = { completed: 0, skipped: 0, wouldComplete: 0, errors: 0, loginFailures: 0 };

  for (let i = 0; i < users.length; i += 1) {
    const account = users[i];
    try {
      const summary = await processUser(args.apiBase, account, today, args.dryRun);
      totals.completed += summary.completed;
      totals.skipped += summary.skipped;
      totals.wouldComplete += summary.wouldComplete;
      totals.errors += summary.errors;
    } catch (error) {
      totals.loginFailures += 1;
      console.error(`Failed for ${account.email}: ${error.message}`);
    }

    if (i < users.length - 1 && args.delayMs > 0) {
      await sleep(args.delayMs);
    }
  }

  console.log('\n--- Summary ---');
  if (args.dryRun) {
    console.log(`Would complete: ${totals.wouldComplete}`);
  } else {
    console.log(`Completed: ${totals.completed}`);
  }
  console.log(`Skipped: ${totals.skipped}`);
  console.log(`Errors: ${totals.errors}`);
  console.log(`Login failures: ${totals.loginFailures}`);

  if (totals.errors > 0 || totals.loginFailures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
