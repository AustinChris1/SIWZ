/** @siwz/core — Sign in with Zcash core protocol. */

export { SiwzMessage, generateNonce } from "./message.js";
export {
  parseAddress,
  isZcashAddress,
  encodeP2pkh,
  UA_RECEIVER_TYPES,
} from "./address.js";
export {
  verifyMessage,
  verifyTransparentSignature,
  verifySaplingSignature,
  type VerifyOptions,
} from "./verify.js";
export { SiwzError } from "./errors.js";
export {
  ZCASH_SIGNED_MESSAGE_MAGIC,
  magicHash,
  hash160,
  dsha256,
  base58checkEncode,
  base58checkDecode,
} from "./crypto.js";
export type {
  Network,
  AddressType,
  ParsedAddress,
  SiwzFields,
  VerifyResult,
  SiwzErrorCode,
} from "./types.js";
export {
  buildZip321,
  buildZip321Multi,
  isShieldedAddress,
  parseZip321,
  zecToZatoshi,
  zatoshiToZec,
  assertAddressNetwork,
} from "./zip321.js";
export type { ZIP321Request } from "./zip321.js";
export {
  issueMemoChallenge,
  verifyMemoChallenge,
  inferMemoChallengeMode,
} from "./memo-challenge.js";
export type {
  MemoChallenge,
  MemoChallengeMode,
  IssueMemoChallengeOpts,
  VerifyMemoChallengeOpts,
  VerifyMemoChallengeResult,
} from "./memo-challenge.js";
export { ZCASH_BLOCKS, type ZcashBlockName } from "./zcash-blocks.js";
