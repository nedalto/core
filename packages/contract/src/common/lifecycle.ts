/**
 * A component that owns long-lived resources.
 *
 * `start()` is called once. If it throws, the instance is unusable.
 * `stop()` may be called at any time, also before `start()` or after a failed one, and
 * then does nothing. It may reject.
 * A stopped instance is not started again.
 */
export interface Lifecycle {
    start(): Promise<void>;
    stop(): Promise<void>;
}
