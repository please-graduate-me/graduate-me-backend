/** 학생 앱과 명시한 admin 앱의 출처만 인증과 상태 변경에 허용한다. */
export function appOrigins() {
  return [
    ...new Set(
      [process.env.AUTH_URL || 'http://localhost:3000', process.env.ADMIN_URL]
        .filter((value): value is string => Boolean(value))
        .map((value) => new URL(value).origin)
    ),
  ];
}

/** 로그인 후 이동 주소를 같은 앱 또는 설정한 admin 주소로 제한한다. */
export function authRedirect(url: string, baseUrl: string) {
  try {
    const target = new URL(url, baseUrl);

    return appOrigins().includes(target.origin) ? target.href : baseUrl;
  } catch {
    return baseUrl;
  }
}
