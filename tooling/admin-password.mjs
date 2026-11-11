import { randomBytes, scrypt } from 'node:crypto';

async function readPassword() {
  if (!process.stdin.isTTY) {
    let input = '';

    for await (const chunk of process.stdin) input += chunk;

    return input.replace(/\r?\n$/, '');
  }

  // 비밀번호가 터미널과 셸 이력에 표시되지 않게 입력을 직접 받는다.
  process.stderr.write('관리자 비밀번호 (10자 이상): ');
  process.stdin.setEncoding('utf8');
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve) => {
    let input = '';

    const receive = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003' || character === '\u0004') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stderr.write('\n입력을 취소했습니다.\n');
          process.exit(1);
        }

        if (character === '\r' || character === '\n') {
          process.stdin.off('data', receive);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stderr.write('\n');
          resolve(input);

          return;
        }

        if (character === '\u007f' || character === '\b')
          input = input.slice(0, -1);
        else input += character;
      }
    };

    process.stdin.on('data', receive);
  });
}

const password = await readPassword();

if (password.length < 10 || password.length > 256) {
  process.stderr.write('비밀번호는 10자 이상 256자 이하로 입력해 주세요.\n');
  process.exitCode = 1;
} else {
  const salt = randomBytes(32).toString('hex');

  scrypt(
    password,
    salt,
    64,
    { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
    (error, key) => {
      if (error) throw error;
      process.stdout.write(`scrypt$${salt}$${key.toString('hex')}\n`);
    }
  );
}
