import {
    validateAddParams,
    validateGetParams,
    validateListParams,
    validateRemoveParams,
    validateSetNameParams,
} from "@nedalto/contract/room/schemas.ts";

import type { RoomUseCase } from "../use-cases/room.ts";
import type { RoomView } from "../views/room.ts";

export interface RoomHandlerDeps {
    readonly roomView: RoomView;
    readonly roomUseCase: RoomUseCase;
}

export const roomHandlers = ({ roomView, roomUseCase }: RoomHandlerDeps) => ({
    "room.list": (params: unknown) => {
        validateListParams(params);
        return roomView.list();
    },
    "room.get": (params: unknown) => {
        const { id } = validateGetParams(params);
        return roomView.get(id);
    },
    "room.add": (params: unknown) => {
        const { name } = validateAddParams(params);
        return roomUseCase.create(name);
    },
    "room.setName": (params: unknown) => {
        const { id, name } = validateSetNameParams(params);
        roomUseCase.rename(id, name);
        return null;
    },
    "room.remove": (params: unknown) => {
        const { id } = validateRemoveParams(params);
        roomUseCase.remove(id);
        return null;
    },
});
