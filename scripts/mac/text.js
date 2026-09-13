#!/usr/bin/env node
// Send an iMessage/SMS from this Mac's Messages app (2026-09-13).
//
//   node scripts/mac/text.js "Bob" "Meet me at 7 at Ralph's"
//   node scripts/mac/text.js +16155550100 "On my way"     # a number or email skips the lookup
//   add --dry to print what would be sent without sending
//
// Mac-only by nature: Messages has no API anywhere else, so "use the MoveIt
// server to text Bob" is really a job for Claude Code on the Mac — the MoveIt
// server (on Railway) can't reach Messages. A name is resolved through
// Contacts (first match on name; ambiguous names are listed, not guessed).
// Uses iMessage if the account has one, else SMS relay through the iPhone.
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const [who, ...rest] = args.filter(a => a !== '--dry');
const message = rest.join(' ');
if (!who || !message) { console.error('usage: text.js <name|number|email> <message> [--dry]'); process.exit(2); }

const osa = (script, ...argv) => execFileSync('osascript', ['-e', script, ...argv], { encoding: 'utf8' }).trim();

// Resolve a name to a handle through Contacts. Numbers and emails pass through.
function resolve(who) {
  if (/^[+\d][\d\s().-]{6,}$/.test(who) || who.includes('@')) return { handle: who.replace(/[\s().-]/g, ''), name: who };
  const out = osa(`on run argv
    set q to item 1 of argv
    tell application "Contacts"
      set found to (every person whose name contains q)
      set lines to ""
      repeat with p in found
        set nums to ""
        repeat with ph in phones of p
          set nums to nums & (value of ph) & "|"
        end repeat
        set lines to lines & (name of p) & "\t" & nums & linefeed
      end repeat
      return lines
    end tell
  end run`, who);
  const people = out.split('\n').filter(Boolean).map(l => { const [name, nums] = l.split('\t'); return { name, phones: (nums || '').split('|').filter(Boolean) }; }).filter(p => p.phones.length);
  if (!people.length) { console.error(`No contact matching "${who}" with a phone number.`); process.exit(1); }
  if (people.length > 1) {
    console.error(`"${who}" matches ${people.length} contacts — say which:\n` + people.map(p => `  ${p.name}  ${p.phones.join(', ')}`).join('\n'));
    process.exit(1);
  }
  const p = people[0];
  return { handle: p.phones[0].replace(/[\s().-]/g, ''), name: p.name };
}

const target = resolve(who);
if (dry) { console.log(`Would text ${target.name} <${target.handle}>: ${message}`); process.exit(0); }
osa(`on run argv
  set h to item 1 of argv
  set m to item 2 of argv
  tell application "Messages"
    set svc to missing value
    try
      set svc to 1st account whose service type = iMessage and enabled is true
    end try
    if svc is missing value then set svc to 1st account whose service type = SMS
    set b to participant h of svc
    send m to b
  end tell
end run`, target.handle, message);
console.log(`Texted ${target.name} <${target.handle}>: ${message}`);
