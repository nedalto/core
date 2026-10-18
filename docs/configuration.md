# Configuration

The hub takes its deployment from environment variables and its behavior from a JSON configuration file.

## Environment variables

A value is trimmed, and a variable that is empty or only whitespace counts as unset.
Resolving them creates no directory and reads no file.

| Variable               | Default              | Meaning                                                |
| ---------------------- | -------------------- | ------------------------------------------------------ |
| `NEDALTO_AUTH_TOKEN`   | none, it is required | Secret that clients present to the hub.                |
| `NEDALTO_CONFIG_PATH`  | `~/.nedalto`         | Directory the configuration file is read from.         |
| `NEDALTO_STORAGE_PATH` | `~/.nedalto/storage` | Directory where the hub persists its state.            |
| `NEDALTO_LOG_PATH`     | `~/.nedalto/log`     | Directory where the log files are written and rotated. |

The token has no default and none is generated.
It must be at least 8 characters long.
It may contain only letters, digits, the characters `-_.~!#$%&'*+^|` and the backtick.

The hub creates the storage and log directories when it starts, if they do not exist.
Under the storage path it keeps `hub.db`, its database, and `matter/`, the state of the Matter controller.
Under the log path it writes `hub.log`, its own log, and `matter/hub.log`, the log of the Matter SDK.

## Configuration file

The file is `hub.json` in `NEDALTO_CONFIG_PATH`.
A JSON object.
A missing file is the same as `{}`, which gives the default of every field below.
A file that is not valid JSON, or that is JSON but not an object (an array, `null` or a primitive), is rejected.

Every section rejects a key it does not know, and the error lists the keys the section takes.
A field left out takes its default, whatever the other fields of its section say.
A section left out takes the defaults of all its fields.

The token is not part of the file.

### `server`

| Field  | Default     | Constraints                                    |
| ------ | ----------- | ---------------------------------------------- |
| `host` | `"0.0.0.0"` | A non-empty string: an address or a host name. |
| `port` | `8080`      | An integer from 1024 to 65535.                 |

The address and the port the WebSocket server listens on.

### `logger`

| Field         | Default  | Constraints                                                                 |
| ------------- | -------- | --------------------------------------------------------------------------- |
| `level`       | `"info"` | One of `"debug"`, `"info"`, `"notice"`, `"warn"`, `"error"`, `"fatal"`.     |
| `maxFileSize` | `"10M"`  | A positive integer followed by `B`, `K`, `M` or `G`, in capitals: `"512K"`. |
| `maxFiles`    | `5`      | An integer of at least 1.                                                   |

`level` is the minimum severity written.
`maxFileSize` is the size at which the current log file rotates, and `K`, `M` and `G` are powers of 1024.
`maxFiles` is how many rotated files are kept besides the current one.

### `matter`

| Field              | Default | Constraints         |
| ------------------ | ------- | ------------------- |
| `networkInterface` | none    | A non-empty string. |

The name of the network interface to use, for example `"eth0"`.
Leave it out to use every interface.

## Stopping the hub

`SIGINT` and `SIGTERM` stop the hub: it stops its components, closes the log files and exits with code 0.
A second signal while it stops is ignored.
A signal that arrives while the hub is still starting stops it as soon as it has started.

The hub exits with code 1 if the environment or the configuration file is invalid, or if it cannot start.
The error is written to stderr, and to `hub.log` when the log file was already open.
