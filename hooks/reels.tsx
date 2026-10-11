import type { ClientModule } from 'claude-code'

import { LINES, linePays, PAIR_CHERRY, PAYLINES, STOP_TICKS, SYMS, TICK_MS, TRIPLE, tierOf, usd } from './shared'

type Props = {
  spinId: number
  result: number[]
  net: number
  stake: number | null
  payout: number | null
  isFree: boolean
  last: string
}
type Local = { spinId: number; tick: number }

const DONE = STOP_TICKS[2]
// win tiers by total payout per stake: small < 10x <= big, jackpot = a line of 7s.
// ticks the celebration runs (~1.8s / 3s / 5s); SHOW is the longest, for the frame clock
const TIERS = {
  small: { ticks: 30, coins: 2, title: '** WINNER **' },
  big: { ticks: 50, coins: 4, title: '$$ BIG  WIN $$' },
  jackpot: { ticks: 84, coins: 8, title: '!!! JACKPOT !!!' },
} as const
const SHOW = TIERS.jackpot.ticks
const LINE_TICKS = 10
const W = 31
const center = (s: string, n: number) => {
  const left = Math.floor((n - s.length) / 2)
  return ' '.repeat(Math.max(0, left)) + s + ' '.repeat(Math.max(0, n - s.length - left))
}
const cell = (i: number) => center(SYMS[((i % 5) + 5) % 5], 5)
// clip to the inner width so no framed line can exceed W columns
const frame = (inner: string) => `| ${center(inner.slice(0, W - 4), W - 4)} |`
const bar = '+' + '-'.repeat(W - 2) + '+'
const PARTY = ['red', 'yellow', 'green', 'cyan', 'magenta'] as const
// win effects: chasing marquee lights on the cabinet edge and coins falling past the reels
const marquee = (t: number) => '+' + Array.from({ length: W - 2 }, (_, i) => ((i + t) % 4 === 0 ? '*' : (i + t) % 4 === 2 ? 'o' : '-')).join('') + '+'
const coins = (t: number, seed: number, n: number) => {
  const row = Array.from({ length: W - 4 }, () => ' ')
  for (let k = 0; k < n; k++) row[(k * 7 + seed * 3 + t * (k % 2 ? 1 : -1) + 400) % (W - 4)] = k % 2 ? '$' : 'o'
  return `| ${row.join('')} |`
}

const Machine: ClientModule<Props, Local> = (p, surface) => {
  const { Box, Text, Button } = surface.elements
  let s = surface.state
  if (s === undefined) {
    // first draw: start the frame clock once; ticks only redraw while a spin runs
    surface.every(TICK_MS, () => {
      const cur = surface.state
      if (cur && cur.tick < DONE + SHOW) surface.setState({ ...cur, tick: cur.tick + 1 })
    })
    s = { spinId: p.spinId, tick: p.spinId === 0 ? DONE : 0 }
    surface.setState(s)
  } else if (s.spinId !== p.spinId) {
    s = { spinId: p.spinId, tick: 0 }
    surface.setState(s)
  }
  const tick = s.tick
  const isSpinning = tick < DONE
  const win = !isSpinning && p.spinId > 0 && linePays(p.result, 1).some(v => v > 0)

  // three rows per reel: above, payline, below
  const col = (r: number) => {
    if (tick >= STOP_TICKS[r]) return [p.result[r] - 1, p.result[r], p.result[r] + 1]
    const t = tick * (r + 2) + r * 3
    return [t, t + 1, t + 2]
  }
  const cols = [0, 1, 2].map(col)
  const pays = isSpinning ? [] : linePays(p.result, 1)
  const wins = (n: number) => pays[n] > 0
  const winLines = pays.map((v, n) => (v > 0 ? n : -1)).filter(n => n >= 0)
  const phase = tick - DONE
  // line currently being shown by the win animation, -1 when idle
  const tierName = tierOf(pays)
  const tier = TIERS[tierName === 'none' ? 'small' : tierName]
  const showing = !isSpinning && winLines.length > 0 && phase < tier.ticks ? winLines[Math.floor(phase / LINE_TICKS) % winLines.length] : -1
  const flashOn = Math.floor(phase / 2) % 2 === 0
  const onShown = (reel: number, row: number) => showing >= 0 && PAYLINES[showing][reel] === row
  // the celebration runs while the winning lines are being shown
  const party = showing >= 0
  const hue = PARTY[Math.floor(phase / 2) % PARTY.length]
  const isJackpot = party && tierName === 'jackpot'
  // small: steady yellow lights; big: rainbow, flashing title; jackpot: double-speed rainbow, the whole cabinet flashes
  const lights = party ? (tierName === 'small' ? 'yellow' : hue) : 'yellow'
  const title = party ? (flashOn ? tier.title : '') : '* SLOT  MACHINE *'
  const edge = party
    ? <Text color={lights} bold inverse={isJackpot && flashOn}>{marquee(isJackpot ? phase * 2 : phase)}</Text>
    : <Text color="yellow" bold>{bar}</Text>
  const onAnyWin = (reel: number, row: number) => winLines.some(n => PAYLINES[n][reel] === row)
  // rows carry their line number on the left and a marker on the right when that row line wins
  const line = (row: number) => {
    const hot = wins(row)
    const c = (reel: number) => {
      const lit = onShown(reel, row) && flashOn
      return (
        <Text
          color={lit ? 'black' : onAnyWin(reel, row) ? 'yellow' : undefined}
          backgroundColor={lit ? 'yellow' : undefined}
          bold={onAnyWin(reel, row)}
        >
          {cell(cols[reel][row])}
        </Text>
      )
    }
    const mark = showing === row ? '<' : hot ? '<' : ' '
    // same 31 columns as frame(): '|' + 3 pad + 23 inner + 3 pad + '|'
    return (
      <Box>
        <Text color={isJackpot ? hue : hot ? 'yellow' : undefined} bold={hot || isJackpot} inverse={isJackpot && flashOn}>{`|   ${row + 1} |`}</Text>
        {c(0)}
        <Text>|</Text>
        {c(1)}
        <Text>|</Text>
        {c(2)}
        <Text color={isJackpot ? hue : hot ? 'yellow' : undefined} bold={hot || isJackpot} inverse={isJackpot && flashOn}>{`| ${mark}   |`}</Text>
      </Box>
    )
  }

  const msg = isSpinning
    ? 'spinning...'
    : p.spinId === 0
      ? 'prompt or PULL to spin'
      : showing >= 0
        ? `LINE ${showing + 1} WIN x${pays[showing]}`
        : p.isFree
        ? (win ? `FREE WIN L${winLines.map(n => n + 1).join(',')}` : 'free spin: no luck')
        : p.payout === null
        ? (win ? `WIN L${winLines.map(n => n + 1).join(',')} (cost?)` : 'no luck (cost?)')
        : win
        ? `WIN L${winLines.map(n => n + 1).join(',')} +${usd(p.payout)}`
        : `no luck -${usd(p.stake ?? 0)}`
  const stakeText = p.isFree ? 'free spin' : p.stake === null ? 'this turn...' : usd(p.stake)
  const netText = `${p.net < 0 ? '-' : '+'}${usd(Math.abs(p.net))}`

  return (
    <Box flexDirection="column">
      {edge}
      <Text color={lights} bold inverse={party && tierName !== 'small' && flashOn}>{frame(title)}</Text>
      {edge}
      <Box>
        <Box flexDirection="column">
          {party ? <Text color="yellow" bold>{coins(phase, 0, tier.coins)}</Text> : <Text>{frame(' ')}</Text>}
          {line(0)}
          {line(1)}
          {line(2)}
          {party ? <Text color="yellow" bold>{coins(phase, 5, tier.coins)}</Text> : <Text>{frame(' ')}</Text>}
        </Box>
        <Box flexDirection="column" marginLeft={1}>
          <Text> </Text>
          <Text color="red" bold>{' (O)'}</Text>
          <Button key="lever" label="PULL" hotkey="l" onPress={() => surface.post({ type: 'pull' })} />
          <Text color="red">{'  |'}</Text>
          <Text>{'  |'}</Text>
          <Button key="min" label="MIN" hotkey="m" onPress={() => surface.post({ type: 'minimize' })} />
        </Box>
      </Box>
      <Box>
        <Text dimColor>{'| LINES: 1-3 rows '}</Text>
        {[4, 5].map(n => (
          <Text color={wins(n - 1) ? 'yellow' : undefined} bold={wins(n - 1)} dimColor={!wins(n - 1)}>{n === 4 ? '4=\\ ' : '5=/ '}</Text>
        ))}
        <Text>{' '.repeat(W - 27) + '|'}</Text>
      </Box>
      {edge}
      <Text color={p.net < 0 ? 'red' : 'green'} bold>{frame(`P/L     ${netText}`.padEnd(21))}</Text>
      <Text>{frame(`STAKE   ${stakeText}`.padEnd(21))}</Text>
      <Text color={win ? 'green' : undefined} bold={win}>{frame(msg)}</Text>
      <Text dimColor>{frame(`last: ${p.last || '-'}`)}</Text>
      <Text color="yellow" bold>{bar}</Text>
      <Text dimColor>{frame(`PAYOUT x(stake/${LINES})/line`)}</Text>
      {SYMS.map((n, i) => (
        <Text dimColor>{frame(`${n} ${n} ${n}`.padEnd(11) + `x${TRIPLE[i]}`.padStart(6))}</Text>
      ))}
      <Text dimColor>{frame('CHR CHR any'.padEnd(11) + `x${PAIR_CHERRY}`.padStart(6))}</Text>
      <Text color="yellow" bold>{bar}</Text>
    </Box>
  )
}

export default Machine
