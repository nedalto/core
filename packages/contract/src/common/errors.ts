type ErrorCode = "INTERNAL_ERROR";

/** Base of the errors a client can receive. `cause` is for the log only. */
export abstract class AppError extends Error {
    abstract readonly code: ErrorCode;

    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = new.target.name;
    }
}

/** An unexpected failure: a bug. */
export class InternalError extends AppError {
    readonly code = "INTERNAL_ERROR";
}
