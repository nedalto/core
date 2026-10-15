import { AppError, InternalError, ValidationError } from "@nedalto/contract/common/errors.ts";
import { decode } from "@nedalto/contract/common/wire.ts";
import {
    type JsonRpcError,
    type JsonRpcErrorResponse,
    type JsonRpcId,
    type JsonRpcNotification,
    type JsonRpcRequest,
    type JsonRpcSuccessResponse,
    validateClientMessage,
    validateParamsByName,
} from "@nedalto/contract/server/schemas.ts";
import { JsonRpcErrorCode } from "@nedalto/contract/server/types.ts";

export const errorResponse = (id: JsonRpcId | null, error: JsonRpcError): JsonRpcErrorResponse => ({
    jsonrpc: "2.0",
    id,
    error,
});

export const successResponse = (id: JsonRpcId, result: unknown): JsonRpcSuccessResponse => ({
    jsonrpc: "2.0",
    id,
    result,
});

export const notification = (method: string, params: object): JsonRpcNotification => ({
    jsonrpc: "2.0",
    method,
    params: { ...params },
});

/** What a client frame is: exactly one of the members is present. */
export type ParseOutcome =
    | { readonly request: JsonRpcRequest }
    | { readonly notification: JsonRpcNotification }
    | { readonly error: JsonRpcErrorResponse };

/** Turns a frame into a request or a notification, or into the error response that answers it. */
export function parseClientMessage(text: string): ParseOutcome {
    let parsed: unknown;
    try {
        parsed = decode(text);
    } catch {
        return { error: errorResponse(null, { code: JsonRpcErrorCode.ParseError, message: "Parse error" }) };
    }

    let message: JsonRpcRequest | JsonRpcNotification;
    try {
        message = validateClientMessage(parsed);
    } catch (error) {
        return {
            error: errorResponse(null, {
                code: JsonRpcErrorCode.InvalidRequest,
                message: "Invalid Request",
                data: error instanceof ValidationError ? error.data : undefined,
            }),
        };
    }

    if (!("id" in message)) {
        return { notification: message };
    }
    try {
        validateParamsByName(message.params);
    } catch (error) {
        return { error: errorResponse(message.id, toJsonRpcError(error)) };
    }
    return { request: message };
}

/** Whether `error` is a bug, which only the log should hear the details of. */
export const isUnexpected = (error: unknown): boolean =>
    !(error instanceof AppError) || error.code === "INTERNAL_ERROR";

/** Translates an error thrown while handling a request. */
export function toJsonRpcError(error: unknown): JsonRpcError {
    const appError = error instanceof AppError ? error : new InternalError("Internal error");
    return {
        code: appError instanceof ValidationError ? JsonRpcErrorCode.InvalidParams : JsonRpcErrorCode.ApplicationError,
        message: appError.code === "INTERNAL_ERROR" ? "Internal error" : appError.message,
        data: { ...appError.data, code: appError.code },
    };
}
