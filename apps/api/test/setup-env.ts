/**
 * Jest `setupFiles` entry — runs in every worker BEFORE any module loads, so
 * `src/config/env.ts` (which reads process.env once at first import) sees the
 * test configuration. Converted files go to a throwaway temp folder.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

process.env.NODE_ENV = 'test';
// DB-backed specs talk to the isolated test database, never the dev one.
if (process.env.DATABASE_URL_TEST) process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.OUTPUT_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'haulbook-output-'));
process.env.OUTPUT_DIR_LABEL = './output';
process.env.INPUT_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'haulbook-input-'));
process.env.INPUT_DIR_LABEL = './input';
delete process.env.OUTPUT_UID;
delete process.env.OUTPUT_GID;
