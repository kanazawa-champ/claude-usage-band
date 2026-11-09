import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'usage-band',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 },
} as const

// 2026-11-09 06:00 UTC = 15:00 JST
const NOW = Date.parse('2026-11-09T06:00:00Z')

function engine(on: any, toasts: string[], store: Map<string, unknown>) {
  on('clock.now', () => ({ value: NOW }))
  on('store.get', (_: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: any, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('ui.toast', (_: any, e: any) => (toasts.push(e.text), { value: undefined }))
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))
}

const measure = (five: number, week: number) => ({
  context: { window: 200000 },
  rateLimits: [
    { kind: 'seven_day', percentUsed: week, resetsAt: '2026-11-12T23:00:00Z' },
    { kind: 'five_hour', percentUsed: five, resetsAt: '2026-11-09T08:00:00Z' },
  ],
  changed: ['rateLimits'],
})

test('帯に5時間と1週間の数字と回復の時刻(日本時間)が出る', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts, new Map())
  await $.session.measure(measure(23.5, 41) as any)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as any)
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

test('まだ数字がないときは「次の返事のあとに表示します」と出す', async ($, on) => {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' } as any)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('Claude 使用量　次の返事のあとに表示します')
  await ui.unmount()
})
