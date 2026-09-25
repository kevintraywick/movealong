#!/usr/bin/env node
// MoveAlong as an MCP server (2026-09-13).
//
// Architecture B from reference/agents-primer.md: the board holds no
// credentials and runs no agents. It exposes itself as tools, and the
// user's own Claude — with whatever mail, calendar and files it already
// has — does the work and writes results back through the same tools.
//
// Talks to the board over its REST API, never the database, so the same
// server works against localhost and against production. Configure with
// env: MOVEALONG_URL, MOVEALONG_TEAM (subdomain), MOVEALONG_USER (slug),
// MOVEALONG_AI_KEY (x-ai-key, optional). No time zone setting: every call
// reads the Mac's current zone (it follows your location), and the board
// remembers it for the phone.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readlinkSync } from 'node:fs';
import { createMoveItServer } from './tools.js';

// The Mac's zone right now. Node fixes its own zone at startup, and this
// process lives as long as the Claude session, so ask the OS each time:
// /etc/localtime is a link into .../zoneinfo/<Area/City>.
function macZone() {
  try {
    const m = readlinkSync('/etc/localtime').match(/zoneinfo\/(.+)$/);
    if (m) { new Intl.DateTimeFormat('en-US', { timeZone: m[1] }); return m[1]; }
  } catch (e) { /* not a Mac, or an odd link — fall back */ }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const TEAM = process.env.MOVEALONG_TEAM;
const USER = process.env.MOVEALONG_USER;
if (!TEAM || !USER) {
  console.error('moveit-mcp: set MOVEALONG_TEAM and MOVEALONG_USER (the team subdomain and your user slug)');
  process.exit(1);
}

const server = createMoveItServer({
  urlBase: process.env.MOVEALONG_URL || 'http://localhost:3000',
  team: TEAM,
  user: USER,
  aiKey: process.env.MOVEALONG_AI_KEY || '',
  tz: macZone
});

const transport = new StdioServerTransport();
await server.connect(transport);
