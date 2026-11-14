# 0001. Identity of nodes, endpoints and rooms

Status: Accepted

## Context

The hub stores nodes, endpoints and rooms and names them in its API, its log and its errors.
Nodes and endpoints already have natural keys in Matter: a node has its node id, an unsigned 64-bit integer, and an endpoint has its endpoint number, unique within its node.
@matter/main 0.18.0 assigns node ids in sequence (`nextNodeId`, kept in the SDK storage) and does not reuse them.
The Matter Core specification (chapter 9, dynamic endpoint allocation) forbids a bridge to change or reuse endpoint numbers, also across restarts, while the Bridged Device Basic Information `UniqueID` was optional before revision 4 of the cluster and does not survive a factory reset of the bridge.
Rooms have no Matter counterpart.

## Decision

- A node is identified by its Matter node id, and an endpoint by its node id and its endpoint number, never by its parent or the composition of the node.
  A room is identified by a number SQLite assigns.
- In the code, all three are branded strings, built only from the native values in `packages/contract/src/common/ids.ts`:

  | Type         | Format                                               | Example              |
  | ------------ | ---------------------------------------------------- | -------------------- |
  | `NodeId`     | The node id as 16 lowercase hex digits               | `000000000000000a`   |
  | `EndpointId` | The `NodeId`, `-` and the endpoint number in decimal | `000000000000000a-2` |
  | `RoomId`     | The number in decimal                                | `7`                  |

  A string compares with `===` and keys a `Map`, which an endpoint's pair of values does not.
  Hex matches how Matter and its SDK write node ids, the fixed width makes the separator unambiguous, and `-`, unlike `:`, does not turn the id into a URL scheme.

- SQLite stores the native values, and `packages/database` converts them:
  - `nodes.id` holds the node id, and `endpoints` has the primary key `(node_id, number)`, stored `WITHOUT ROWID`.
  - Node 26.13 cannot bind a bigint of 2^63 or more, so a node id is stored as the signed 64-bit integer with the same bits.
  - The connection reads every integer as a bigint (`readBigInts`): otherwise Node 26.13 throws past 2^53, also on the last inserted rowid that every write reports, which a node id becomes.
  - `rooms.id` is `INTEGER PRIMARY KEY AUTOINCREMENT`, so a new room never takes the id of a deleted one, which plain rowids would reuse.
- The repositories create records from what is not derived (`NodeRepository.create(id)`, `EndpointRepository.create(endpoint)`, `RoomRepository.create(name)`) and return the record they stored, so an endpoint id cannot disagree with its node id and number.
- `findAll` orders nodes by node id, endpoints by node id and number, and rooms by `id`.
  The queries put the stored negative values last (`ORDER BY id < 0, id`), so the order is that of the node id and, with sequential node ids, that of commissioning.
  Rooms keep the order they were created in: alphabetical order depends on the language and is for the client.

## Alternatives

- **UUIDs for every entity**: a surrogate key next to natural keys that are already unique, which needs a two-way map between them in the Matter layer.
- **Following bridged devices by `UniqueID`**: optional on older bridges and not stable across a factory reset; endpoint numbers are stable by specification.
- **A fabric discriminator in the ids**: much longer ids to protect against restoring the Matter storage and the database separately.
- **Ordering by the stored signed value (`ORDER BY id`)**: it walks the key without sorting, but a node id of 2^63 or more would come first.
- **Storing node ids with the sign bit flipped**: the stored order would match the node id, but every node id would look unrelated to its value in `hub.db`.

## Consequences

Ids are short and match what Matter and its SDK log.
If the Matter storage is regenerated or restored without the database, or the other way round, an id can end up naming another device.
Exposing these ids to clients, and validating them, belongs to the API.
