#!/usr/bin/env node
'use strict';
/** Alias: node scripts/bundle-run.js → dashboard bundle unit test */
const path = require('path');
const { spawnSync } = require('child_process');

const file = path.join(__dirname, '..', 'test', 'dashboard', 'bundle.test.js');
const r = spawnSync(process.execPath, [file], { stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);