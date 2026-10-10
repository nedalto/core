import type { WireValue } from "./wire.ts";

type ErrorCode =
    | "VALIDATION_ERROR"
    | "NOT_FOUND_ERROR"
    | "CONFLICT_ERROR"
    | "INTEGRATION_ERROR"
    | "UNREACHABLE_ERROR"
    | "INTERNAL_ERROR";

interface AppErrorOptions extends ErrorOptions {
    data?: Readonly<Record<string, WireValue>>;
}

/** Base of the errors a client can receive. `cause` is for the log only. */
export abstract class AppError extends Error {
    abstract readonly code: ErrorCode;
    readonly data: Readonly<Record<string, WireValue>> | undefined;

    constructor(message: string, options?: AppErrorOptions) {
        super(message, options);
        this.name = new.target.name;
        this.data = options?.data;
    }
}

/** The input is invalid. */
export class ValidationError extends AppError {
    readonly code = "VALIDATION_ERROR";
}

/** The entity the request names does not exist. */
export class NotFoundError extends AppError {
    readonly code = "NOT_FOUND_ERROR";
}

/** The request contradicts the current state. */
export class ConflictError extends AppError {
    readonly code = "CONFLICT_ERROR";
}

/** A system outside the hub failed: the Matter SDK, SQLite. */
export class IntegrationError extends AppError {
    readonly code = "INTEGRATION_ERROR";
}

/** The target could not be reached, so the request never arrived. */
export class UnreachableError extends AppError {
    readonly code = "UNREACHABLE_ERROR";
}

/** An unexpected failure: a bug. */
export class InternalError extends AppError {
    readonly code = "INTERNAL_ERROR";
}
