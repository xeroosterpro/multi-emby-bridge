#!/usr/bin/env node
'use strict';
/**
 * Run a single test file. Usage:
 *   node scripts/run-one.js test/dashboard/bundle.test.js
 */
const path = require('path');
const { spawnSync } = require('child_process');

const rel = process.argv[2];
if (!rel) {
  console.error('Usage: node scripts/run-one.js <test-file>');
  process.exit(1);
}

const file = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
const r = spawnSync(process.execPath, [file], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
process.exit(r.status == null ? 1 : r.status);