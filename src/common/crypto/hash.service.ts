import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';

@Injectable()
export class HashService {
  hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 2 ** 16,
      timeCost: 3,
      parallelism: 1,
    });
  }

  verifyPassword(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  sha256(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
  }

  randomTokenHex(bytes = 32): string {
    return randomBytes(bytes).toString('hex');
  }

  randomTokenBase64Url(bytes = 64): string {
    return randomBytes(bytes).toString('base64url');
  }

  safeEqualHex(a: string, b: string): boolean {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}
