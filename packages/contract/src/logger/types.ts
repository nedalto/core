/** Log severities, from least to most severe. */
export const LogLevel = {
    Debug: "debug",
    Info: "info",
    Notice: "notice",
    Warn: "warn",
    Error: "error",
    Fatal: "fatal",
} as const satisfies Record<string, string>;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];
