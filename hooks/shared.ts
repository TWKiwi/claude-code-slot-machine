export const SYMS = ['7', 'BAR', 'BEL', 'CHR', 'LMN']
// multiplier of the bet for three of a kind, by symbol index
export const TRIPLE = [100, 50, 20, 10, 5]
export const PAIR_CHERRY = 2
export const STOP_TICKS = [14, 20, 26]
export const TICK_MS = 60

export const payoutFor = (r: number[], bet: number): number => {
  if (r[0] === r[1] && r[1] === r[2]) return TRIPLE[r[0]] * bet
  if (r.filter(i => i === 3).length >= 2) return PAIR_CHERRY * bet
  return 0
}

export const LINES = 5
// payline cells as [reel][row] picks; rows 0-2 then the two diagonals
export const PAYLINES = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [0, 1, 2], [2, 1, 0]]
// each reel shows its result symbol in the middle with the strip neighbours above and below
export const gridSym = (result: number[], reel: number, row: number) =>
  (((result[reel] + row - 1) % SYMS.length) + SYMS.length) % SYMS.length
// payout of each payline, bet is per line
export const linePays = (result: number[], bet: number): number[] =>
  PAYLINES.map(l => payoutFor(l.map((row, reel) => gridSym(result, reel, row)), bet))
export const totalPay = (result: number[], bet: number) => linePays(result, bet).reduce((a, b) => a + b, 0)
export const usd = (v: number) => `$${v.toFixed(3)}`
// win tier of a spin from its per-line multipliers: a line of 7s is the jackpot, 10x+ total is big
export type Tier = 'none' | 'small' | 'big' | 'jackpot'
export const tierOf = (pays: number[]): Tier =>
  pays.some(v => v === TRIPLE[0]) ? 'jackpot' : pays.reduce((a, b) => a + b, 0) / LINES >= 10 ? 'big' : pays.some(v => v > 0) ? 'small' : 'none'
