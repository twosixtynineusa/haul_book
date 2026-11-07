import { BadRequestException } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Validates a JSON body against a shared contract: 400 naming the first problem. */
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BadRequestException(`${issue.path.join('.') || 'body'}: ${issue.message}`);
  }
  return parsed.data;
}
