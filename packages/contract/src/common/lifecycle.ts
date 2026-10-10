/**
 * A component that owns long-lived resources, started and stopped by the hub.
 *
 * `start()` is called once. If it throws, the instance is unusable and the hub ends the
 * process, which is what releases anything the failed start had acquired.
 * `stop()` may be called at any time, also before `start()` or after a failed one, and
 * then does nothing. It may reject; the caller logs the error and goes on.
 * A stopped instance is not started again.
 */
export interface Lifecycle {
    start(): Promise<void>;
    stop(): Promise<void>;
}
