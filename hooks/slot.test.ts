import { test, expect, mock } from 'claude-code/testing'

import { linePays, tierOf, totalPay } from './shared'

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

test('prompt.submit spins; the turn cost becomes the stake; lever is a free spin', async ($, on) => {
  const cost = { usd: 0 }
  const played: string[] = []
  const clock = stubs(on, cost, played)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: 'submit a prompt', in: 'slot' })).toBeDefined()

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
  expect(linePays([1, 1, 1], 1)).toEqual([100, 50, 20, 0, 0])
  expect(totalPay([1, 1, 1], 2)).toBe(340)
  expect(linePays([1, 0, 4], 1)).toEqual([0, 0, 0, 100, 0])
  expect(linePays([4, 0, 1], 1)).toEqual([0, 0, 0, 0, 100])
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
  expect(tierOf([50, 0, 0, 0, 0])).toBe('big')
  expect(tierOf([0, 0, 0, 100, 0])).toBe('jackpot')
})
