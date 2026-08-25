export function createOperationCompletionTracker() {
  let current: Promise<void> | null = null;
  return {
    begin(): () => void {
      let resolve = (): void => undefined;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      current = promise;
      return () => {
        if (current === promise) current = null;
        resolve();
      };
    },
    wait(): Promise<void> {
      return current ?? Promise.resolve();
    },
  };
}
