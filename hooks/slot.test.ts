import { test, expect, mock } from 'claude-code/testing'

import { BASE_RTP, drawRtp, linePays, tierOf, totalPay } from './shared'

const PANE = { plugin: 'slot-machine', surface: 'terminal', component: 'Pane', requestId: 'slot', props: {} } as never
const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never

// engine stubs; `cost.usd` is the session's running API cost the stake is read from
const stubs = (on: Parameters<Parameters<typeof test>[1]>[1], cost: { usd: number }, played: string[] = []) => {
  mock.store(on)
  on('prompt.submit', async (_$, e) => e)
  on('turn.complete', async () => ({ text: '' }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: {}, cost: { usd: cost.usd } } }) as never)
  on('audio.play', async (_$, e) => {
    played.push(JSON.stringify(e))
    return { value: undefined } as never
  })
  on('ui.toast', async () => ({ value: undefined }) as never)
  return mock.clock(on)
}

test('no pane line is wider than 31 columns', async ($, on) => {
  stubs(on, { usd: 0 })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^.{32,}$/, in: 'slot' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^.{31}$/, in: 'slot' })).toBeDefined()
})

test('prompt.submit spins; the turn cost becomes the stake; lever is a free spin', async ($, on) => {
  const cost = { usd: 0 }
  const played: string[] = []
  const clock = stubs(on, cost, played)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: 'prompt or PULL', in: 'slot' })).toBeDefined()

  expect(await $.prompt.submit({ text: 'hello' })).toBeDefined()
  await ui.advance(100)
  expect(await ui.find({ text: 'spinning', in: 'slot' })).toBeDefined()
  expect(await ui.find({ text: 'this turn...', in: 'slot' })).toBeDefined()
  cost.usd = 0.25
  await $.turn.complete(TURN)
  await clock.advance(5000)
  await ui.advance(5000)
  expect(await ui.find({ text: 'spinning', in: 'slot' })).toBeUndefined()
  expect(await ui.find({ text: 'STAKE   $0.250', in: 'slot' })).toBeDefined()
  expect(played.join()).toContain('spin.wav')
  expect(played.join()).toContain('stop.wav')

  await ui.press({ key: 'lever' })
  await ui.advance(100)
  expect(await ui.find({ text: 'free spin', in: 'slot' })).toBeDefined()
})

test('a subagent turn does not settle the stake', async ($, on) => {
  const cost = { usd: 0 }
  stubs(on, cost)
  const ui = await $.ui.mount(PANE)
  await $.prompt.submit({ text: 'hi' })
  cost.usd = 1
  await $.turn.complete({ ...(TURN as object), agentId: 'sub' } as never)
  await ui.advance(5000)
  expect(await ui.find({ text: 'this turn...', in: 'slot' })).toBeDefined()
})

// result = middle symbol per reel; strip order 7 BAR BEL CHR LMN, rows show idx-1, idx, idx+1
test('paylines: multi-line, both diagonals', () => {
  expect(linePays([1, 1, 1], 1)).toEqual([50, 25, 15, 0, 0])
  expect(totalPay([1, 1, 1], 2)).toBe(180)
  expect(linePays([1, 0, 4], 1)).toEqual([0, 0, 0, 50, 0])
  expect(linePays([4, 0, 1], 1)).toEqual([0, 0, 0, 0, 50])
})

test('winning spin flashes a winning line, then settles on the summary', async ($, on) => {
  const cost = { usd: 0 }
  const clock = stubs(on, cost)
  const ui = await $.ui.mount(PANE)
  // Math.random is read-only here, so spin until the RNG gives a win
  let flashed = false
  for (let i = 0; i < 300 && !flashed; i++) {
    await $.prompt.submit({ text: 'spin' })
    cost.usd += 0.1
    await $.turn.complete(TURN)
    await clock.advance(1700)
    await ui.advance(1700)
    flashed = (await ui.find({ text: 'WIN x', in: 'slot' })) !== undefined
  }
  expect(flashed).toBe(true)
  await clock.advance(3500)
  await ui.advance(3500)
  expect(await ui.find({ text: '+$', in: 'slot' })).toBeDefined()
})

test('win tiers', () => {
  expect(tierOf([0, 0, 0, 0, 0])).toBe('none')
  expect(tierOf([5, 0, 0, 0, 0])).toBe('small')
  expect(tierOf([25, 25, 0, 0, 0])).toBe('big')
  expect(tierOf([0, 0, 0, 50, 0])).toBe('jackpot')
})

test('RTP: paytable return matches every reel outcome, session RTP stays in 92.5-97.5%', () => {
  let sum = 0
  for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) for (let c = 0; c < 5; c++) sum += totalPay([a, b, c], 1) / 5
  expect(Math.abs(sum / 125 - BASE_RTP)).toBeLessThan(1e-9)
  expect(drawRtp(0)).toBe(0.925)
  expect(Math.abs(drawRtp(1) - 0.975)).toBeLessThan(1e-9)
})

test('minimize closes the pane and prompts keep spinning without reopening it', async ($, on) => {
  const cost = { usd: 0 }
  const clock = stubs(on, cost)
  const calls: string[] = []
  on('ui.open', async () => (calls.push('open'), { value: { isPlaced: true } }) as never)
  on('ui.close', async () => (calls.push('close'), { value: undefined }) as never)
  on('ui.status', async (_$, e) => (calls.push(`status ${JSON.stringify(e)}`), { value: undefined }) as never)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'min' })
  await ui.advance(100)
  expect(calls).toContain('close')
  calls.length = 0
  await $.prompt.submit({ text: 'bg' })
  cost.usd = 0.1
  await $.turn.complete(TURN)
  await clock.advance(5000)
  expect(calls).not.toContain('open')
  expect(calls.join()).toContain('P/L')
})
