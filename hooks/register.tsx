// 入力欄の上の帯に Claude の使用量(5時間の枠・1週間の枠)を出し、80%と95%を超えたら1回ずつ通知する
// 数字は Claude が最後に返事をしたときのもの。時刻は日本時間で出す
import { atom, read, update } from 'claude-code'
import type { Engine, Register, SessionRateLimit } from 'claude-code'

import type { Limit } from '../types'

const limits = atom({ plugin: 'usage-band', key: 'limits' } as const, [] as Limit[])

const NAMES: Record<string, string> = { five_hour: '5時間', seven_day: '1週間' }
const LEVELS = [95, 80]

// ISO の時刻を日本時間の「15:00」(今日)か「11/13(金) 8:00」(別の日)にする
export function jst(iso: string | undefined, nowMs: number): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const d = new Date(t + 9 * 3600 * 1000)
  const n = new Date(nowMs + 9 * 3600 * 1000)
  const hm = `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  const sameDay = d.getUTCFullYear() === n.getUTCFullYear() && d.getUTCMonth() === n.getUTCMonth() && d.getUTCDate() === n.getUTCDate()
  const wd = '日月火水木金土'[d.getUTCDay()]
  return sameDay ? hm : `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${wd}) ${hm}`
}

const pick = (rs: SessionRateLimit[]): Limit[] =>
  rs
    .filter(r => r.kind in NAMES)
    .sort((a, b) => Object.keys(NAMES).indexOf(a.kind) - Object.keys(NAMES).indexOf(b.kind))
    .map(r => ({ kind: r.kind, percentUsed: r.percentUsed, ...(r.resetsAt ? { resetsAt: r.resetsAt } : {}) }))

// 枠ごとに、どの段階(80/95)まで知らせたかを覚える。枠が戻ったら(resetsAt が変わったら)やり直す
async function warn($: Engine, ls: Limit[]) {
  const now = await $.clock.now()
  for (const l of ls) {
    const level = LEVELS.find(v => l.percentUsed >= v)
    if (!level) continue
    const key = `warned:${l.kind}`
    const prev = (await $.store.get(key)) as { resetsAt?: string; level: number } | undefined
    if (prev && prev.resetsAt === l.resetsAt && prev.level >= level) continue
    await $.store.set(key, { resetsAt: l.resetsAt, level })
    const back = jst(l.resetsAt, now)
    $.ui.toast(`Claudeの使用量：${NAMES[l.kind]}の枠が${Math.round(l.percentUsed)}%になりました${back ? `（${back}に回復）` : ''}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const ls = pick((await $.session.usage()).rateLimits)
    if (ls.length) await update($, limits, () => ls)
    return r
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      const ls = pick(e.rateLimits)
      await update($, limits, () => ls)
      await warn($, ls)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ls = await read($, limits)
    if (e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // 数字がまだ届いていないときも、帯があることが分かるように一言だけ出す
    if (ls.length === 0) return <Text dimColor>Claude 使用量　次の返事のあとに表示します</Text>
    const now = await $.clock.now()
    return (
      <Box>
        <Text dimColor>Claude 使用量　</Text>
        {ls.map((l, i) => {
          const back = jst(l.resetsAt, now)
          const high = l.percentUsed >= 80
          return (
            <Text key={l.kind} dimColor={!high} color={high ? 'warning' : undefined} bold={high}>
              {i > 0 ? '｜' : ''}
              {NAMES[l.kind]} {Math.round(l.percentUsed)}%{back ? `（${back}に回復）` : ''}
            </Text>
          )
        })}
      </Box>
    )
  })
}
