export type Machine = {
  // all money in USD; stake is the round's API cost, null until the turn ends
  net: number
  stake: number | null
  payout: number | null
  isFree: boolean
  spinId: number
  result: number[]
  last: string
}

declare module 'claude-code' {
  interface PluginState {
    'slot-machine': { machine: Machine }
  }
}
