import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Machine } from '../types'
import { BASE_RTP, drawRtp, LINES, linePays, STOP_TICKS, SYMS, TICK_MS, tierOf, totalPay, usd } from './shared'

const PANE = 'slot'
const machine = atom(
  { plugin: 'slot-machine', key: 'machine' } as const,
  { net: 0, stake: 0, payout: 0, isFree: true, spinId: 0, result: [0, 1, 2], last: '' } as Machine,
)
const WIN_SOUND = { small: 'win.wav', big: 'big.wav', jackpot: 'jackpot.wav' } as const
const STOP_MS = STOP_TICKS.map(t => t * TICK_MS)
// ponytail: drawn per module load (a session or a hot reload), per-spin drift averages out to 95% anyway
const RTP = drawRtp()
// payout per dollar staked, scaled from the paytable to this session's RTP
const multOf = (result: number[]) => (totalPay(result, 1) / LINES) * (RTP / BASE_RTP)

let isBusy = false
// minimized: the pane stays closed, spins and settles go on, wins show as a toast and on the status line
let isMinimized = false
const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Slots', columns: 40 })
const signed = (v: number) => `${v < 0 ? '-' : '+'}${usd(Math.abs(v))}`
const minimize = async ($: EngineInterface, isMin: boolean) => {
  isMinimized = isMin
  void $.store.set('minimized', isMin)
  if (!isMin) return $.ui.status(undefined)
  const { net } = await read($, machine)
  $.ui.status(`SLOT (minimized, /slot to restore)  P/L ${signed(net)}`)
}
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
  if (payout > 0) $.ui.toast(`SLOT: ${syms}  stake ${usd(stake)} -> +${usd(payout)}`, { timeoutMs: isMinimized ? 8000 : 4000 })
  if (isMinimized) $.ui.status(`SLOT ${syms} ${payout ? 'WIN +' + usd(payout) : '-' + usd(stake)}  P/L ${signed(net)}  (/slot)`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'slot', description: 'Open the slot machine pane and spin' })
    const saved = await $.store.get('net')
    if (typeof saved === 'number') await update($, machine, c => ({ ...c, net: saved }))
    baseUsd = await sessionUsd($)
    if ((await $.store.get('minimized')) === true) await minimize($, true)
    else void openPane($)
    return next(e)
  })

  on('command.run', { command: 'slot' }, async $ => {
    await minimize($, false)
    await openPane($)
    void spin($, true).catch(() => {})
    return { text: 'Slot machine spinning (free spin).' }
  })

  on('prompt.submit', ($, e, next) => {
    // a hot reload has no session.start, so bring the pane back on every prompt
    if (!isMinimized) void openPane($).catch(() => {})
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
    if (d?.type === 'minimize') {
      await minimize($, true)
      await $.ui.close({ id: PANE }).catch(() => {})
    }
    return next(e)
  })

  // the person closing the pane minimizes it too, so the next prompt does not bring it back
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await minimize($, true).catch(() => {})
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
