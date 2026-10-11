/** Groups writes, also across repositories, so they are stored together or not at all. */
export interface Transactor {
    /**
     * Runs `transaction`, committing if it returns and rolling back if it throws, in which case
     * the error propagates unchanged.
     * It is synchronous so that no `await` can hold the transaction open, and it cannot be nested.
     */
    run<T>(transaction: () => T): T;
}
