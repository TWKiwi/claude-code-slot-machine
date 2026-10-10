import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Machine } from '../types'
import { LINES, linePays, STOP_TICKS, SYMS, TICK_MS, tierOf, totalPay, usd } from './shared'

const PANE = 'slot'
const machine = atom(
  { plugin: 'slot-machine', key: 'machine' } as const,
  { net: 0, stake: 0, payout: 0, isFree: true, spinId: 0, result: [0, 1, 2], last: '' } as Machine,
)
const WIN_SOUND = { small: 'win.wav', big: 'big.wav', jackpot: 'jackpot.wav' } as const
const STOP_MS = STOP_TICKS.map(t => t * TICK_MS)
// payout per dollar staked
const multOf = (result: number[]) => totalPay(result, 1) / LINES

let isBusy = false
// session cost at the last settlement; the next round's stake is the cost added since
let baseUsd: number | undefined
const sessionUsd = async ($: EngineInterface) => (await $.session.usage()).cost?.usd ?? 0

async function spin($: EngineInterface, isFree: boolean) {
  if (isBusy) return
  isBusy = true
  // hot-loaded mid-session there was no session.start: the first staked spin sets the base
  if (!isFree && baseUsd === undefined) baseUsd = await sessionUsd($)
  const result = [0, 0, 0].map(() => Math.floor(Math.random() * SYMS.length))
  await update($, machine, cur => ({
    ...cur, spinId: cur.spinId + 1, result, isFree,
    stake: isFree ? 0 : null, payout: isFree ? 0 : null,
    last: isFree ? `${result.map(i => SYMS[i]).join(' ')} free` : cur.last,
  }))

  const loop = new AbortController()
  void $.audio.play({ asset: 'sounds/spin.wav' }, { shouldLoop: true, signal: loop.signal })
  STOP_MS.forEach((ms, i) => {
    $.clock.after(ms, () => {
      void $.audio.play({ asset: 'sounds/stop.wav' })
      if (i < 2) return
      loop.abort()
      const tier = tierOf(linePays(result, 1))
      if (tier !== 'none') void $.audio.play({ asset: `sounds/${WIN_SOUND[tier]}` })
      isBusy = false
    })
  })
}

// the main-loop turn ended: its cost is the stake of the pending spin
async function settle($: EngineInterface) {
  const now = await sessionUsd($)
  const stake = Math.max(0, now - (baseUsd ?? now))
  baseUsd = now
  const m = await read($, machine)
  if (m.stake !== null) return
  const payout = stake * multOf(m.result)
  const net = m.net + payout - stake
  const syms = m.result.map(i => SYMS[i]).join(' ')
  await update($, machine, cur => ({
    ...cur, stake, payout, net, last: `${syms} ${payout ? '+' + usd(payout) : '-' + usd(stake)}`,
  }))
  void $.store.set('net', net)
  if (payout > 0) $.ui.toast(`SLOT: ${syms}  stake ${usd(stake)} -> +${usd(payout)}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'slot', description: 'Open the slot machine pane and spin' })
    const saved = await $.store.get('net')
    if (typeof saved === 'number') await update($, machine, c => ({ ...c, net: saved }))
    baseUsd = await sessionUsd($)
    void $.ui.open({ id: PANE, title: 'Slots', columns: 40 })
    return next(e)
  })

  on('command.run', { command: 'slot' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Slots', columns: 40 })
    void spin($, true).catch(() => {})
    return { text: 'Slot machine spinning (free spin).' }
  })

  on('prompt.submit', ($, e, next) => {
    // a hot reload has no session.start, so bring the pane back on every prompt
    void $.ui.open({ id: PANE, title: 'Slots', columns: 40 }).catch(() => {})
    void spin($, false).catch(() => {})
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) void settle($).catch(() => {})
    return r
  })

  on('ui.message', async ($, e, next) => {
    const d = e.data as { type?: string }
    if (d?.type === 'pull') void spin($, true).catch(() => {})
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Client } = $.ui.resolve(e)
    const { net, stake, payout, isFree, spinId, result, last } = await read($, machine)
    return (
      <Client
        key="slot"
        module="./reels.tsx"
        props={{ net, stake, payout, isFree, spinId, result, last }}
      />
    )
  })
}
