import { describe, expect, mock, test } from "bun:test";
import { dispatchExCommand } from "./vimExCommands.ts";

/**
 * Consumer wiring (Requirement 3.6): the edit consumer passes
 * `onCloseRequest={() => setIsEditing(false)}`. The Vim adapter invokes that
 * callback as the `close` handler of a `:wq` dispatch. This asserts the shape
 * of that contract without mounting the heavy edit form: a `:wq` whose close
 * handler is `() => setIsEditing(false)` leaves edit mode exactly once.
 */
describe("edit consumer close wiring", () => {
    test(":wq close handler built from setIsEditing(false) is called once with false", () => {
        const setIsEditing = mock((_: boolean) => {});
        dispatchExCommand("wq", {
            submit: () => {},
            close: () => setIsEditing(false),
        });
        expect(setIsEditing).toHaveBeenCalledTimes(1);
        expect(setIsEditing).toHaveBeenCalledWith(false);
    });

    test("create consumer omits close: :wq submits and performs no close", () => {
        const submit = mock(() => {});
        dispatchExCommand("wq", { submit });
        expect(submit).toHaveBeenCalledTimes(1);
    });
});
