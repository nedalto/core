import * as v from "valibot";

import { nameSchema, type NoParams, noParamsSchema, parseOrThrow, roomIdSchema } from "../internal/valibot.ts";

// Strict, so a key the method does not take is rejected, the `$` keys the protocol reserves among them.
const getParamsSchema = v.strictObject({ id: roomIdSchema });
const addParamsSchema = v.strictObject({ name: nameSchema });
const setNameParamsSchema = v.strictObject({ id: roomIdSchema, name: nameSchema });
const removeParamsSchema = v.strictObject({ id: roomIdSchema });

export type RoomGetParams = v.InferOutput<typeof getParamsSchema>;
export type RoomAddParams = v.InferOutput<typeof addParamsSchema>;
export type RoomSetNameParams = v.InferOutput<typeof setNameParamsSchema>;
export type RoomRemoveParams = v.InferOutput<typeof removeParamsSchema>;

/** Throws a `ValidationError` listing every issue if `input` is not what `room.list` takes. */
export const validateListParams = (input: unknown): NoParams => parseOrThrow(noParamsSchema, input);

/** Each validator below throws a `ValidationError` listing every issue, or returns the typed params. */
export const validateGetParams = (input: unknown): RoomGetParams => parseOrThrow(getParamsSchema, input);
export const validateAddParams = (input: unknown): RoomAddParams => parseOrThrow(addParamsSchema, input);
export const validateSetNameParams = (input: unknown): RoomSetNameParams => parseOrThrow(setNameParamsSchema, input);
export const validateRemoveParams = (input: unknown): RoomRemoveParams => parseOrThrow(removeParamsSchema, input);
