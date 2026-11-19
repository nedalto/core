/** Removes the subscription; calling it again does nothing. */
export type Unsubscribe = () => void;

/**
 * In-process bus between packages.
 *
 * Dispatch is synchronous: handlers run inside `emit()`, and one that throws neither stops
 * the others nor reaches the emitter.
 * There is no replay: a handler sees only what is emitted after `on()`.
 * There is no backpressure: persist before emitting what must survive.
 */
export interface EventBus<TEventMap> {
    emit<K extends keyof TEventMap>(eventName: K, payload: TEventMap[K]): void;
    on<K extends keyof TEventMap>(eventName: K, handler: (payload: TEventMap[K]) => void): Unsubscribe;
}
