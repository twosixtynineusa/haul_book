import * as fsp from 'node:fs/promises';
import { Logger } from '@nestjs/common';
import { env } from '../config/env';

const logger = new Logger('HostFiles');
let warned = false;

/**
 * Hands a file or folder we created in a bind-mounted host folder (OUTPUT_DIR,
 * INPUT_DIR) to the host user. In dev the api/worker run as root, so without
 * this a docker-ce host would end up with root-owned files. No-op when not root.
 * Windows folders have no Unix owner and refuse it: that's warned about once.
 */
export async function handToHostUser(target: string): Promise<void> {
  if (env.outputUid === null || process.getuid?.() !== 0) return;
  try {
    await fsp.chown(target, env.outputUid, env.outputGid ?? env.outputUid);
  } catch (e) {
    if (warned) return;
    warned = true;
    logger.warn(`Could not chown ${target} (normal on Windows folders): ${(e as Error).message}`);
  }
}
