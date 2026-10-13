import { describe, expect, test } from "bun:test";
import {
    handleSubmitShortcut,
    isSubmitShortcut,
    type KeyEventLike,
} from "./submitShortcut.ts";

const ev = (over: Partial<KeyEventLike>): KeyEventLike => ({
    key: "Enter",
    ctrlKey: false,
    metaKey: false,
    ...over,
});

describe("isSubmitShortcut", () => {
    test("Ctrl+Enter is the submit gesture", () => {
        expect(isSubmitShortcut(ev({ ctrlKey: true }))).toBe(true);
    });
    test("Cmd+Enter is the submit gesture", () => {
        expect(isSubmitShortcut(ev({ metaKey: true }))).toBe(true);
    });
    test("plain Enter is not the submit gesture", () => {
        expect(isSubmitShortcut(ev({}))).toBe(false);
    });
    test("a modified non-Enter key is not the submit gesture", () => {
        expect(isSubmitShortcut(ev({ key: "a", ctrlKey: true }))).toBe(false);
    });
});

describe("handleSubmitShortcut", () => {
    test("invokes the callback once and prevents default on Ctrl+Enter", () => {
        let prevented = 0;
        let submitted = 0;
        const handled = handleSubmitShortcut(
            ev({ ctrlKey: true }),
            () => (prevented += 1),
            () => (submitted += 1),
        );
        expect(handled).toBe(true);
        expect(prevented).toBe(1);
        expect(submitted).toBe(1);
    });

    test("does nothing for plain Enter", () => {
        let prevented = 0;
        let submitted = 0;
        const handled = handleSubmitShortcut(
            ev({}),
            () => (prevented += 1),
            () => (submitted += 1),
        );
        expect(handled).toBe(false);
        expect(prevented).toBe(0);
        expect(submitted).toBe(0);
    });

    test("does nothing when no callback is configured", () => {
        let prevented = 0;
        const handled = handleSubmitShortcut(
            ev({ metaKey: true }),
            () => (prevented += 1),
            undefined,
        );
        expect(handled).toBe(false);
        expect(prevented).toBe(0);
    });
});
