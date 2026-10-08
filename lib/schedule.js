// SPDX-License-Identifier: GPL-2.0

export const Kind = {
    POMODORO: 'POMODORO',
    SHORT_BREAK: 'SHORT_BREAK',
    LONG_BREAK: 'LONG_BREAK',
};

export function isBreak(kind) {
    return kind === Kind.SHORT_BREAK || kind === Kind.LONG_BREAK;
}

/**
 * The interval that follows `kind` inside a set.
 *
 * `slot` counts the pomodoro slots already consumed, and a skipped pomodoro
 * consumes one exactly like a finished one — otherwise a set would never end.
 *
 * @returns {{kind: string, slot: number}}
 */
export function advanceAfter(kind, slot, setSize) {
    if (kind === Kind.POMODORO) {
        const consumed = slot + 1;
        return {
            kind: consumed >= setSize ? Kind.LONG_BREAK : Kind.SHORT_BREAK,
            slot: consumed,
        };
    }
    if (kind === Kind.LONG_BREAK)
        return {kind: Kind.POMODORO, slot: 0};
    return {kind: Kind.POMODORO, slot};
}

export function shouldAutoStart(nextKind, {autoStartBreaks, autoStartWork}) {
    return isBreak(nextKind) ? autoStartBreaks : autoStartWork;
}
