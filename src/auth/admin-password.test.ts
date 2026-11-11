import { describe, expect, it } from 'vitest';
import {
  hashAdminPassword,
  validAdminHash,
  verifyAdminPassword,
} from './admin-password.js';

describe('운영 비밀번호 해시', () => {
  it('임의 솔트로 해시를 만들고 일치하는 비밀번호만 허용한다', async () => {
    const password = '테스트에서만 사용하는 충분히 긴 비밀번호';
    const hash = await hashAdminPassword(password);

    expect(validAdminHash(hash)).toBe(true);
    expect(hash).not.toContain(password);
    expect(await verifyAdminPassword(password, hash)).toBe(true);
    expect(await verifyAdminPassword('틀린 비밀번호', hash)).toBe(false);
    expect(await hashAdminPassword(password)).not.toBe(hash);
  });

  it('10자 비밀번호를 해시로 설정할 수 있다', async () => {
    const hash = await hashAdminPassword('test-pass!');

    expect(await verifyAdminPassword('test-pass!', hash)).toBe(true);
  });

  it('형식이 잘못된 해시와 짧은 비밀번호 설정은 거부한다', async () => {
    expect(await verifyAdminPassword('password', 'plain-password')).toBe(false);
    await expect(hashAdminPassword('short')).rejects.toThrow();
  });
});
