/** `open` rejects with it when the session has not written a log yet. */
export class NoLogError extends Error {
  constructor(message = 'This session has no log on disk yet.') {
    super(message)
    this.name = 'NoLogError'
  }
}

/** `event` rejects with it when the log changed since the view was built; the element then calls `open` again. */
export class StaleError extends Error {
  constructor(message = 'Session log changed since the view was built.') {
    super(message)
    this.name = 'StaleError'
  }
}
