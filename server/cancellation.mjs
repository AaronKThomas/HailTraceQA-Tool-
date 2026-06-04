export class TestRunCancelledError extends Error {
  constructor(message = "Test run cancelled.") {
    super(message);
    this.name = "TestRunCancelledError";
  }
}

export function isCancellationError(error) {
  return error instanceof TestRunCancelledError
    || error?.name === "AbortError"
    || error?.name === "TestRunCancelledError";
}

export function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new TestRunCancelledError();
}

export function createRequestAbortSignal(req, res) {
  const controller = new AbortController();
  let completed = false;

  const cleanup = () => {
    req.off("aborted", abort);
    res.off("finish", complete);
    res.off("close", onResponseClose);
  };
  const complete = () => {
    completed = true;
    cleanup();
  };
  const abort = () => {
    if (completed || controller.signal.aborted) return;
    controller.abort(new TestRunCancelledError());
    cleanup();
  };
  const onResponseClose = () => {
    if (res.writableEnded) complete();
    else abort();
  };

  req.once("aborted", abort);
  res.once("finish", complete);
  res.once("close", onResponseClose);

  return controller.signal;
}
