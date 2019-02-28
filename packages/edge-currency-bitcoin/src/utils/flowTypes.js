/**
 * Created by Paul Puey 2017/11/09.
 * @flow
 */

export type BitcoinFees = {
  lowFee: string,
  standardFeeLow: string,
  standardFeeHigh: string,

  // The amount of satoshis which will be charged the standardFeeLow
  standardFeeLowAmount: string,

  // The amount of satoshis which will be charged the standardFeeHigh
  standardFeeHighAmount: string,
  highFee: string,

  // The last time the fees were updated
  timestamp: number
}

export type EarnComFee = {
  minFee: number,
  maxFee: number,
  dayCount: number,
  memCount: number,
  minDelay: number,
  maxDelay: number,
  minMinutes: number,
  maxMinutes: number
}

export type EarnComFees = {
  fees: Array<EarnComFee>
}

export type SaveCache = (
  fileName: string,
  data: Object,
  cacheDirty?: boolean
) => Promise<boolean>
