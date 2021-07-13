export function getExpirationDate (ms: number) {
  return new Date(Date.now() + ms)
}

export function isExpired (expires: Date | undefined) {
  if (!expires) { return false }
  return new Date(expires) <= new Date()
}

export function timeExpired (expires: Date | undefined) {
  if (!expires) { return 0 }
  return new Date(expires).getTime() - new Date().getTime()
}
