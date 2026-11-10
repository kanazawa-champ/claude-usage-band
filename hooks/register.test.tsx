import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'usage-band',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 },
} as const

// 2026-11-09 06:00 UTC = 15:00 JST
const NOW = Date.parse('2026-11-09T06:00:00Z')

function engine(on: any, toasts: string[], store: Map<string, unknown>, rateLimits: unknown[] = []) {
  on('clock.now', () => ({ value: NOW }))
  on('store.get', (_: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: any, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('ui.toast', (_: any, e: any) => (toasts.push(e.text), { value: undefined }))
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200000 }, rateLimits } }))
}

const measure = (five: number, week: number) => ({
  context: { window: 200000 },
  rateLimits: [
    { kind: 'seven_day', percentUsed: week, resetsAt: '2026-11-12T23:00:00Z' },
    { kind: 'five_hour', percentUsed: five, resetsAt: '2026-11-09T08:00:00Z' },
  ],
  changed: ['rateLimits'],
})

const START = { cwd: '/', surface: 'desktop', isInteractive: true } as const

test('帯に5時間と1週間の数字と回復の時刻(日本時間)が出る', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts, new Map())
  await $.session.measure(measure(23.5, 41) as any)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as any)
  expect((await ui.find({ type: 'Text', text: /使用量/ }))?.text).toBe('Claude 使用量　')
  expect((await ui.find({ type: 'Text', text: /5時間/ }))?.text).toBe('5時間 24%（17:00に回復）')
  expect((await ui.find({ type: 'Text', text: /1週間/ }))?.text).toBe('｜1週間 41%（11/13(金) 8:00に回復）')
  expect(toasts.length).toBe(0)
  await ui.unmount()
})

test('80%と95%で1回ずつ通知し、同じ枠では繰り返さない', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts, new Map())
  await $.session.measure(measure(81, 10) as any)
  await $.session.measure(measure(85, 10) as any)
  await $.session.measure(measure(96, 10) as any)
  expect(toasts).toEqual([
    'Claudeの使用量：5時間の枠が81%になりました（17:00に回復）',
    'Claudeの使用量：5時間の枠が96%になりました（17:00に回復）',
  ])
})

test('まだ一度も数字がないときは「次の返事のあとに表示します」と出す', async ($, on) => {
  engine(on, [], new Map())
  await $.session.start(START as any)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as any)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('Claude 使用量　次の返事のあとに表示します')
  await ui.unmount()
})

test('返事のたびに数字を覚え、次の立ち上げで「前回 ○:○○時点」として出す', async ($, on) => {
  const store = new Map<string, unknown>()
  engine(on, [], store)
  await $.session.measure(measure(23.5, 41) as any)
  expect(store.get('last')).toEqual({
    at: NOW,
    limits: [
      { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-11-09T08:00:00Z' },
      { kind: 'seven_day', percentUsed: 41, resetsAt: '2026-11-12T23:00:00Z' },
    ],
  })
})

test('立ち上げ直後は前回の数字を出し、回復の時刻を過ぎた枠は「回復済み」と出す', async ($, on) => {
  const store = new Map<string, unknown>()
  // 前回は 11/8 18:13(JST)。5時間の枠は 11/8 21:00 に回復済み、1週間の枠はまだ
  store.set('last', {
    at: Date.parse('2026-11-08T09:13:00Z'),
    limits: [
      { kind: 'five_hour', percentUsed: 62, resetsAt: '2026-11-08T12:00:00Z' },
      { kind: 'seven_day', percentUsed: 41, resetsAt: '2026-11-12T23:00:00Z' },
    ],
  })
  engine(on, [], store)
  await $.session.start(START as any)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as any)
  expect((await ui.find({ type: 'Text', text: /使用量/ }))?.text).toBe('Claude 使用量（前回 11/8(日) 18:13時点）　')
  expect((await ui.find({ type: 'Text', text: /5時間/ }))?.text).toBe('5時間 回復済み')
  expect((await ui.find({ type: 'Text', text: /1週間/ }))?.text).toBe('｜1週間 41%（11/13(金) 8:00に回復）')
  await ui.unmount()
})

test('立ち上げのあと返事が来たら「前回」が消えて今の数字になる', async ($, on) => {
  const store = new Map<string, unknown>()
  store.set('last', { at: Date.parse('2026-11-08T09:13:00Z'), limits: [{ kind: 'five_hour', percentUsed: 62, resetsAt: '2026-11-08T12:00:00Z' }] })
  engine(on, [], store)
  await $.session.start(START as any)
  await $.session.measure(measure(5, 42) as any)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as any)
  expect((await ui.find({ type: 'Text', text: /使用量/ }))?.text).toBe('Claude 使用量　')
  expect((await ui.find({ type: 'Text', text: /5時間/ }))?.text).toBe('5時間 5%（17:00に回復）')
  await ui.unmount()
})

test('古い版が残した壊れた値は使わない', async ($, on) => {
  const store = new Map<string, unknown>()
  store.set('last', 'こわれた値')
  engine(on, [], store)
  await $.session.start(START as any)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as any)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('Claude 使用量　次の返事のあとに表示します')
  await ui.unmount()
})
