import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, key) =>
      error ? reject(error) : resolve(key)
    );
  });
}

/** 운영 비밀번호는 임의 솔트와 메모리 비용을 적용한 scrypt 해시로만 설정한다. */
export async function hashAdminPassword(password: string) {
  if (password.length < 10 || password.length > 256)
    throw new Error('비밀번호는 10자 이상 256자 이하로 입력해 주세요.');
  const salt = randomBytes(32).toString('hex');

  return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
}

/** 환경 설정의 해시 형식을 제한해 임의 비용이나 잘못된 비교를 막는다. */
export function validAdminHash(hash: string) {
  return /^scrypt\$[a-f0-9]{64}\$[a-f0-9]{128}$/.test(hash);
}

/** 평문을 저장하지 않고 같은 길이의 파생 키를 상수 시간으로 비교한다. */
export async function verifyAdminPassword(password: string, hash: string) {
  if (!validAdminHash(hash)) return false;
  const [, salt, expected] = hash.split('$');

  return timingSafeEqual(
    await derive(password, salt),
    Buffer.from(expected, 'hex')
  );
}
