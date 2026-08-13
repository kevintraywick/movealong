// Calendar import: mirrors a user's subscribed iCal (ICS) feed into tasks.
//
// Why a feed URL and not OAuth: Google, Proton, iCloud and Outlook all publish
// a secret iCal address, Proton has no API at all, and MoveAlong has no auth
// story to hang OAuth tokens on. One code path covers every provider.
//
// Imported rows are deliberately NOT locked. Every deadline behavior in the app
// (board anchoring, red project tabs, red task text, the amber edge) gates on
// `tasks.locked`, so locking events would misfire all of them every day.
// Exemption from spillover is instead an explicit `source != 'calendar'` check
// in the tasks route.

const ical = require('node-ical');
const { queryOne, queryAll, runSql, flushDb } = require('./db');

const WINDOW_DAYS = 14;          // today .. today+13
const FETCH_TIMEOUT_MS = 10000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_EVENTS = 500;          // a hostile feed must not mint unbounded tasks
const SYNC_INTERVAL_MS = 15 * 60 * 1000;

// ============================================
// TIME HELPERS
// ============================================
// The board keys days in UTC, but events carry real local times: an 8pm PDT
// event on the 13th is the 14th in UTC and would land on the wrong day card.
// Everything below therefore derives day keys in the user's IANA zone.

function dateKeyIn(date, tz) {
  // 'en-CA' formats as YYYY-MM-DD, which is exactly the board's key format.
  return date.toLocaleDateString('en-CA', { timeZone: tz });
}

function hhmmIn(date, tz) {
  return date.toLocaleTimeString('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
  });
}

function addDaysKey(key, n) {
  const d = new Date(key + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

// ============================================
// URL VALIDATION
// ============================================
// The server fetches a user-supplied URL, so an unguarded fetch is an SSRF
// primitive — on Railway that reaches internal metadata endpoints.
const PRIVATE_HOST_RE = new RegExp([
  '^localhost$', '^127\\.', '^0\\.', '^10\\.',
  '^192\\.168\\.', '^169\\.254\\.',
  '^172\\.(1[6-9]|2[0-9]|3[01])\\.',
  '^\\[?::1\\]?$', '^\\[?fc', '^\\[?fd', '^\\[?fe80'
].join('|'), 'i');

function normalizeFeedUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) throw new Error('Enter a calendar URL');

  // Apple and Google hand out webcal:// links; it is https in disguise.
  const swapped = trimmed.replace(/^webcal:\/\//i, 'https://');

  let url;
  try {
    url = new URL(swapped);
  } catch (e) {
    throw new Error('That does not look like a calendar URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('Calendar URL must start with https:// or webcal://');
  }
  if (PRIVATE_HOST_RE.test(url.hostname)) {
    throw new Error('That address is not reachable');
  }
  return url.toString();
}

// ============================================
// FETCH + PARSE
// ============================================

async function fetchIcsText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
    headers: { 'User-Agent': 'MoveAlong/1.0 (calendar sync)' }
  });
  if (!res.ok) {
    // 404 here usually means the user regenerated their secret address.
    throw new Error(`Calendar returned ${res.status}`);
  }
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('Calendar feed is too large');
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error('That URL did not return a calendar');
  }
  return text;
}

function asText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && typeof v.val === 'string') return v.val;
  return String(v);
}

// Holidays, birthdays and OOO blocks are what "ignore holidays, etc." means.
// Calendars tag them as all-day and/or free/transparent.
function isIgnorable(ev) {
  if (ev.datetype === 'date') return true;                  // all-day
  if (ev.start && ev.start.dateOnly) return true;
  if (asText(ev.transparency).toUpperCase() === 'TRANSPARENT') return true;
  if (asText(ev.status).toUpperCase() === 'CANCELLED') return true;
  const busy = asText(ev['MICROSOFT-CDO-BUSYSTATUS'] || ev['X-MICROSOFT-CDO-BUSYSTATUS']);
  if (busy.toUpperCase() === 'FREE') return true;
  return false;
}

/**
 * Fetch and expand a feed into occurrences inside [todayKey, todayKey+13].
 * Throws on any failure — callers depend on being able to tell "fetch failed"
 * apart from "the calendar is empty".
 *
 * @returns {Array<{uid, instanceKey, summary, dateKey, startHHMM}>}
 */
async function fetchEvents(url, tz, todayKey) {
  const text = await fetchIcsText(url);
  return expandEvents(text, tz, todayKey);
}

/**
 * Expand raw ICS text into occurrences inside [todayKey, todayKey+13].
 * Split out from fetchEvents so recurrence, DST and filtering can be tested
 * without a network round-trip.
 */
function expandEvents(text, tz, todayKey) {
  const zone = tz || 'UTC';

  let data;
  try {
    data = ical.sync.parseICS(text);
  } catch (e) {
    throw new Error('Could not read that calendar');
  }

  const endKey = addDaysKey(todayKey, WINDOW_DAYS - 1);
  // Pad the scan window by a day on each side: an occurrence's UTC instant can
  // sit outside the window while its local day sits inside it.
  const scanStart = new Date(addDaysKey(todayKey, -1) + 'T00:00:00.000Z');
  const scanEnd = new Date(addDaysKey(endKey, 2) + 'T00:00:00.000Z');

  const out = [];
  const seen = new Set();

  const push = (uid, summary, startDate) => {
    if (out.length >= MAX_EVENTS) return;
    const dateKey = dateKeyIn(startDate, zone);
    if (dateKey < todayKey || dateKey > endKey) return;
    const instanceKey = `${uid}#${dateKey}`;
    if (seen.has(instanceKey)) return;
    seen.add(instanceKey);
    out.push({
      uid,
      instanceKey,
      summary: (summary || '(no title)').slice(0, 200),
      dateKey,
      startHHMM: hhmmIn(startDate, zone)
    });
  };

  for (const key of Object.keys(data)) {
    const ev = data[key];
    if (!ev || ev.type !== 'VEVENT' || !ev.start) continue;

    const uid = asText(ev.uid) || key;

    if (!ev.rrule) {
      if (isIgnorable(ev)) continue;
      push(uid, asText(ev.summary).trim(), ev.start);
      continue;
    }

    // Recurring. The rule itself can be ignorable (an all-day recurring
    // birthday), but individual overrides are judged on their own.
    const ruleIgnorable = isIgnorable(ev);
    const occurrences = ev.rrule.between(scanStart, scanEnd, true);

    for (const occ of occurrences) {
      // node-ical already anchors occurrences to the original wall clock
      // across DST boundaries — a 9:00 standup stays 9:00 in both PST and PDT
      // (verified in both directions). Do NOT re-correct the offset here;
      // doing so double-shifts every recurring event by an hour.
      const occKey = dateKeyIn(occ, zone);
      const utcKey = occ.toISOString().split('T')[0];

      // EXDATE: this instance was deleted from the series.
      if (ev.exdate && (ev.exdate[occKey] || ev.exdate[utcKey])) continue;

      // RECURRENCE-ID: this instance was edited (moved or retitled).
      const override = ev.recurrences && (ev.recurrences[occKey] || ev.recurrences[utcKey]);
      if (override) {
        if (isIgnorable(override)) continue;
        push(uid, asText(override.summary).trim(), override.start);
        continue;
      }

      if (ruleIgnorable) continue;
      push(uid, asText(ev.summary).trim(), occ);
    }
  }

  return out;
}

// ============================================
// RECONCILIATION
// ============================================

const inFlight = new Set();

function getFeed(userId) {
  return queryOne('SELECT * FROM calendar_feeds WHERE user_id = ?', [userId]);
}

// Past events simply disappear — they are not spilled forward like tasks,
// because a meeting happened whether or not you ticked it off. This needs no
// network knowledge, so it must NOT be gated on a successful fetch: otherwise
// a broken feed leaves past events accumulating on invisible days forever.
function prunePastEvents(userId, todayKey) {
  runSql(
    "DELETE FROM tasks WHERE owner_id = ? AND source = 'calendar' AND scheduled_date < ?",
    [userId, todayKey]
  );
}

function deleteAllEvents(userId) {
  runSql("DELETE FROM tasks WHERE owner_id = ? AND source = 'calendar'", [userId]);
}

function recordSync(userId, status, error, count) {
  runSql(
    `UPDATE calendar_feeds
       SET last_synced_at = ?, last_status = ?, last_error = ?, event_count = ?
     WHERE user_id = ?`,
    [new Date().toISOString(), status, error || null, count, userId]
  );
}

/**
 * Reconcile one user's feed. Never throws — failures are recorded on the feed
 * row and surfaced in the connect popup.
 */
async function syncFeed(userId, todayKey) {
  if (inFlight.has(userId)) return { skipped: 'in-flight' };
  inFlight.add(userId);

  const today = todayKey || new Date().toISOString().split('T')[0];

  try {
    const feed = getFeed(userId);
    if (!feed || !feed.enabled) return { skipped: 'disabled' };

    const user = queryOne('SELECT id, company_id FROM users WHERE id = ?', [userId]);
    if (!user) return { skipped: 'no-user' };

    prunePastEvents(userId, today);

    let incoming;
    try {
      incoming = await fetchEvents(feed.url, feed.timezone, today);
    } catch (err) {
      // Do NOT reconcile. Treating a failed fetch as "no events" would wipe
      // every imported row the moment the feed 404s or the network blips.
      recordSync(userId, 'error', err.message, feed.event_count || 0);
      flushDb();
      return { error: err.message };
    }

    const existing = queryAll(
      "SELECT * FROM tasks WHERE owner_id = ? AND source = 'calendar'",
      [userId]
    );
    const byKey = new Map();
    for (const row of existing) byKey.set(row.external_uid, row);

    const now = new Date().toISOString();
    const endKey = addDaysKey(today, WINDOW_DAYS - 1);
    let created = 0, updated = 0, removed = 0;

    for (const ev of incoming) {
      const match = byKey.get(ev.instanceKey);
      if (match) {
        byKey.delete(ev.instanceKey);
        // Update in place. Never delete-and-recreate: subtasks CASCADE on task
        // delete, so recreating would silently destroy any subtask pane the
        // user built on this event. `completed` is never touched either.
        if (match.description !== ev.summary ||
            match.scheduled_date !== ev.dateKey ||
            match.event_start !== ev.startHHMM) {
          runSql(
            `UPDATE tasks
               SET description = ?, scheduled_date = ?, origin_date = ?,
                   event_start = ?, updated_at = ?
             WHERE id = ?`,
            [ev.summary, ev.dateKey, ev.dateKey, ev.startHHMM, now, match.id]
          );
          updated++;
        }
      } else {
        // origin_date = scheduled_date keeps the day counter at 1, which the
        // renderer hides — an event should not grow an age badge.
        runSql(
          `INSERT INTO tasks
             (company_id, owner_id, project_id, description, scheduled_date,
              origin_date, locked, priority, source, external_uid, event_start,
              created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, ?, 0, 0, 'calendar', ?, ?, ?, ?)`,
          [user.company_id, userId, ev.summary, ev.dateKey, ev.dateKey,
           ev.instanceKey, ev.startHHMM, now, now]
        );
        created++;
      }
    }

    // Anything left was cancelled or removed upstream. Only prune inside the
    // window — beyond it we simply have no knowledge.
    for (const stale of byKey.values()) {
      if (stale.scheduled_date <= endKey) {
        runSql('DELETE FROM tasks WHERE id = ?', [stale.id]);
        removed++;
      }
    }

    recordSync(userId, 'ok', null, incoming.length);
    // The per-request res.on('finish', flushDb) has already fired by the time
    // this fire-and-forget sync finishes, so it must persist its own writes.
    flushDb();
    return { created, updated, removed, total: incoming.length };
  } catch (err) {
    console.error('Calendar sync failed:', err);
    return { error: err.message };
  } finally {
    inFlight.delete(userId);
  }
}

// Kick off a sync if the feed is enabled and stale. Fire-and-forget: the caller
// serves the rows it already has, and new events land on the next board load.
function maybeSyncInBackground(userId, todayKey) {
  const feed = getFeed(userId);
  if (!feed || !feed.enabled) return;
  const last = feed.last_synced_at ? Date.parse(feed.last_synced_at) : 0;
  if (Date.now() - last < SYNC_INTERVAL_MS) return;
  syncFeed(userId, todayKey).catch(err => console.error('Background sync:', err));
}

// The feed URL is a bearer credential for the whole calendar; it is never
// returned to the client in full.
function maskUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}/…`;
  } catch (e) {
    return '…';
  }
}

module.exports = {
  normalizeFeedUrl, fetchEvents, expandEvents, syncFeed, maybeSyncInBackground,
  prunePastEvents, deleteAllEvents, getFeed, maskUrl,
  WINDOW_DAYS, SYNC_INTERVAL_MS
};
