/** 보상 규칙 변경을 원장에 남겨 과거 지급 근거를 보존한다. */
export const growthPolicy = {
  version: 'growth-v1',
  dailyLimit: 100,
  dailyGoal: 3,
  dailyBonus: 20,
  levelStep: 100,
} as const;

/** 일일·주간 경계를 서버 실행 지역과 무관하게 한국 시간으로 계산한다. */
export function growthCalendar(now = new Date()) {
  const local = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = local.toISOString().slice(0, 10);
  const weekday = (local.getUTCDay() + 6) % 7;

  local.setUTCDate(local.getUTCDate() - weekday);

  return { day, weekStart: local.toISOString().slice(0, 10) };
}

/** 능력 등급과 구분되는 누적 참여 레벨과 다음 단계 진행률을 계산한다. */
export function growthLevel(totalXp: number) {
  return {
    level: Math.floor(totalXp / growthPolicy.levelStep) + 1,
    levelXp: totalXp % growthPolicy.levelStep,
    levelTarget: growthPolicy.levelStep,
  };
}
