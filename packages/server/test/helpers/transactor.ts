import type { Transactor } from "@nedalto/contract/database/ports.ts";

/** A `Transactor` that runs the transaction as it is and tells a test how it was used. */
export class RecordingTransactor implements Transactor {
    runs = 0;

    /** Whether a transaction is running now. */
    active = false;

    run<T>(transaction: () => T): T {
        this.runs += 1;
        this.active = true;
        try {
            return transaction();
        } finally {
            this.active = false;
        }
    }
}
