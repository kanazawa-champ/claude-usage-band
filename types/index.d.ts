export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// 前回の数字を、会話をまたいで覚えておく形($.store の 'last')
export type Saved = { limits: Limit[]; at: number }

declare module 'claude-code' {
  interface PluginState {
    // savedAt: 前回の数字を出しているときの、その数字を受け取った時刻(ミリ秒)。今の数字なら null
    'usage-band': { limits: Limit[]; savedAt: number | null }
  }
}
